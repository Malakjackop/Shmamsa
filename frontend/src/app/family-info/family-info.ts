import { Component, OnInit, inject } from '@angular/core';
import { FamilyService } from '../services/family.service';
import { AdminService } from '../services/admin.service';
import { AuthService } from '../services/auth.service';
import { KhorsRequestsService, KhorsJoinRequestView } from '../services/khors-requests.service';
import { MessageService, ConfirmationService } from 'primeng/api';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

type Member = {
  id: number;
  fullName: string;
  role: string;
  deaconFamily: string;
  address?: string;
  phoneNumber?: string;
  guardiansPhone?: string;
  /** shown in table */
  schoolGrade?: string;
  /** UI selection for export */
  selected?: boolean;
};

@Component({
  selector: 'app-family-info',
  standalone: false,
  templateUrl: './family-info.html',
  styleUrls: ['./family-info.css'],
  providers: [MessageService, ConfirmationService]
})
export class FamilyInfoComponent implements OnInit {
  private familySvc = inject(FamilyService);
  private adminSvc = inject(AdminService);
  private auth = inject(AuthService);
  private khorsReq = inject(KhorsRequestsService);
  private message = inject(MessageService);
  private confirm = inject(ConfirmationService);

  me: any;
  members: Member[] = [];
  families: string[] = [];
  selectedFamily = '';
  loading = false;

  selectAll = false;

  exportMode = false;
  pendingExport: 'pdf' | null = null;

  profileFor: Member | null = null;
  profile: any = null;

  allRoles: string[] = [];

  pendingRequestsCount = 0;
  requestsOpen = false;
  requestsLoading = false;
  requests: KhorsJoinRequestView[] = [];
  private readonly preferredFamilyOrder: string[] = [
    'اسرة السمائين',
    'اسرة القديس ابانوب',
    'اسرة القديس ديسقورس',
    'اسرة القديس سيدهم بشاي',
    'اسرة القديس اسكلابيوس',
    'اسرة القديس البابا كيرلس',
    'اسرة القديس الانبا ابرام',
    'اسرة القديس اسطفانوس',
    'خورس مارمرقس',
    'خورس البابا اثناسيوس'
  ];

  ngOnInit() {
    this.auth.getUserData().subscribe({
      next: (u) => {
        this.me = u;
        this.loadRoles();
        this.initFamilyMode();
        this.loadPendingRequestsCount();
      },
      error: () => {}
    });
  }

  isAminKhedmaOrDev(): boolean {
    return this.hasRole('AMIN_KHEDMA', 'DEVELOPER', 'DEV');
  }

  isKhadim(): boolean {
    return this.hasRole('KHADIM');
  }

  private isKhadimServingKhors(): boolean {
    if (!this.isKhadim()) return false;
    const scope = String(this.me?.servingScope || '').toUpperCase();
    const khors = String(this.me?.khors || '').toUpperCase();
    const scopeIncludesKhors = scope === 'KHORS_ONLY' || scope === 'BOTH';
    const khorsSelectedFromList = !!khors && khors !== 'NONE';
    return scopeIncludesKhors || khorsSelectedFromList;
  }

  canSeeKhorsRequests(): boolean {

    if (!this.isKhorsFamilySelected()) return false;
    return this.canDecideKhorsRequests();
  }

  canDecideKhorsRequests(): boolean {
    return this.isAminKhedmaOrDev() || this.isKhadimServingKhors();
  }

  private normalizeRole(role: any): string {
    const raw = String(role || '').trim().toUpperCase();
    return raw.startsWith('ROLE_') ? raw.slice(5) : raw;
  }

  private hasRole(...allowed: string[]): boolean {
    const role = this.normalizeRole(this.me?.role);
    return allowed.map((x) => this.normalizeRole(x)).includes(role);
  }

  private loadPendingRequestsCount() {
    if (!this.canSeeKhorsRequests()) return;
    this.khorsReq.pending().subscribe({
      next: (list) => (this.pendingRequestsCount = this.filterRequestsBySelectedKhors(list || []).length),
      error: () => (this.pendingRequestsCount = 0)
    });
  }

  openKhorsRequests() {
    if (!this.canSeeKhorsRequests()) return;
    this.requestsOpen = true;
    this.requestsLoading = true;
    this.khorsReq.pending().subscribe({
      next: (list) => {
        this.requests = this.filterRequestsBySelectedKhors(list || []);
        this.requestsLoading = false;
        this.pendingRequestsCount = this.requests.length;
      },
      error: (err) => {
        this.requestsLoading = false;
        this.requests = [];
        this.pendingRequestsCount = 0;
        const isServerError = Number(err?.status) >= 500;
        this.message.add({
          severity: isServerError ? 'warn' : 'error',
          summary: 'خطأ',
          detail: isServerError
            ? 'تعذر تحميل طلبات الخورس حاليًا. برجاء المحاولة لاحقًا.'
            : (err?.error?.error || 'فشل تحميل طلبات الخورس')
        });
      }
    });
  }

  closeKhorsRequests() {
    this.requestsOpen = false;
    this.requestsLoading = false;
    this.requests = [];
    this.loadPendingRequestsCount();
  }

  decideKhorsRequest(req: KhorsJoinRequestView, approved: boolean) {
    if (!this.canDecideKhorsRequests()) return;
    if (!req?.requestId) return;
    this.khorsReq.decide(req.requestId, approved).subscribe({
      next: () => {
        this.requests = (this.requests || []).filter((x) => x.requestId !== req.requestId);
        this.pendingRequestsCount = this.requests.length;
        if (approved && this.isKhorsFamilySelected()) {
          this.loadMembers();
        }
        this.message.add({
          severity: 'success',
          summary: 'تم',
          detail: approved ? 'تم قبول الطلب' : 'تم رفض الطلب'
        });
      },
      error: (err) => {
        this.message.add({
          severity: 'error',
          summary: 'خطأ',
          detail: err?.error?.error || 'فشل تنفيذ القرار'
        });
      }
    });
  }

  canSelectFamily(): boolean {
    return this.isAminKhedmaOrDev() || this.isKhadim();
  }

  canDeleteAccounts(): boolean {
    return this.me?.role === 'AMIN_OSRA' || this.me?.role === 'AMIN_KHEDMA' || this.me?.role === 'DEVELOPER';
  }

  canDeleteMember(m: Member): boolean {
    if (!this.canDeleteAccounts()) return false;
    if (!m) return false;
    if (this.me?.id && m.id === this.me.id) return false;
    if ((m.role || '').toUpperCase() === 'DEVELOPER') return false;
    return true;
  }

  canEditRoles(): boolean {
    return this.isAminKhedmaOrDev();
  }

  private initFamilyMode() {
    if (this.canSelectFamily()) {
      this.familySvc.families().subscribe({
        next: (f) => {
          this.families = this.sortFamiliesByPreferredOrder(f || []);
          if (this.families.length) {
            this.selectedFamily = this.families[0];
            this.loadMembers();
            this.loadPendingRequestsCount();
          }
        },
        error: () => {
          this.families = [];
          this.selectedFamily = '';
          this.loadMembers();
          this.pendingRequestsCount = 0;
        }
      });
    } else {
      this.selectedFamily = this.me?.deaconFamily;
      this.loadMembers();
      this.loadPendingRequestsCount();
    }
  }

  private normalizeFamilyName(value: any): string {
    return String(value || '')
      .trim()
      .replace(/[أإآ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  private familyOrderKey(family: string): string {
    const n = this.normalizeFamilyName(family);

    if (n.includes('خورس') && n.includes('مار') && n.includes('مرقس')) return 'خورس مارمرقس';
    if (n.includes('خورس') && n.includes('اثناسيوس')) return 'خورس البابا اثناسيوس';
    if (n.includes('سمائ')) return 'اسرة السمائين';
    if (n.includes('ابانوب')) return 'اسرة القديس ابانوب';
    if (n.includes('ديسقورس')) return 'اسرة القديس ديسقورس';
    if (n.includes('سيدهم') || n.includes('بشاي')) return 'اسرة القديس سيدهم بشاي';
    if (n.includes('اسكلابيوس')) return 'اسرة القديس اسكلابيوس';
    if (n.includes('كيرلس')) return 'اسرة القديس البابا كيرلس';
    if (n.includes('ابرام')) return 'اسرة القديس الانبا ابرام';
    if (n.includes('اسطفانوس') || n.includes('استفانوس')) return 'اسرة القديس اسطفانوس';

    return family;
  }

  private sortFamiliesByPreferredOrder(families: string[]): string[] {
    const cleaned = (families || []).map((x) => this.familyOrderKey(String(x || '').trim())).filter(Boolean);
    const deduped = Array.from(new Set(cleaned));
    const orderMap = new Map(
      this.preferredFamilyOrder.map((name, index) => [this.normalizeFamilyName(name), index])
    );

    return [...deduped].sort((a, b) => {
      const aKey = this.familyOrderKey(a);
      const bKey = this.familyOrderKey(b);
      const aOrder = orderMap.get(this.normalizeFamilyName(aKey));
      const bOrder = orderMap.get(this.normalizeFamilyName(bKey));

      if (aOrder != null && bOrder != null) return aOrder - bOrder;
      if (aOrder != null) return -1;
      if (bOrder != null) return 1;
      return a.localeCompare(b, 'ar');
    });
  }

  onFamilyChange() {
    this.loadMembers();
    if (this.canSeeKhorsRequests()) {
      this.loadPendingRequestsCount();
    } else {
      this.pendingRequestsCount = 0;
      this.requestsOpen = false;
      this.requestsLoading = false;
      this.requests = [];
    }
  }

  loadMembers() {
    this.loading = true;
    const famParam = this.canSelectFamily() ? this.selectedFamily : undefined;

    this.familySvc.members(famParam).subscribe({
      next: (m) => {
        this.members = ((m as any) || []).map((x: any) => ({ ...x, selected: false }));
        this.selectAll = false;
        //  old UX: basic fields visible, full profile only via button
        // we still need school grade, so fetch minimal fields once.
        this.loadBasicFieldsForAllMembers(famParam);
      },
      error: (err) => {
        this.loading = false;
        this.message.add({ severity: 'error', summary: 'Error', detail: err?.error?.error || 'Failed to load' });
      }
    });
  }

  toggleSelectAll() {
    this.members.forEach((m) => (m.selected = this.selectAll));
  }

  onMemberSelectionChange() {
    const any = this.members.some((m) => !!m.selected);
    if (!any) {
      this.selectAll = false;
      return;
    }
    this.selectAll = this.members.every((m) => !!m.selected);
  }

  private getSelectedMembers(): Member[] {
    return (this.members || []).filter((m) => !!m.selected);
  }

  private loadBasicFieldsForAllMembers(famParam?: string) {
    if (!this.members?.length) {
      this.loading = false;
      return;
    }

    const calls = this.members.map((mem) =>
      this.familySvc.memberDetails(mem.id, famParam).pipe(catchError(() => of(null)))
    );

    forkJoin(calls).subscribe({
      next: (detailsArr) => {
        this.members = this.members.map((mem, idx) => {
          const details = detailsArr[idx] || null;
          return {
            ...mem,
            // keep common fields in sync
            address: details?.address ?? mem.address,
            phoneNumber: details?.phoneNumber ?? mem.phoneNumber,
            guardiansPhone: details?.guardiansPhone ?? mem.guardiansPhone,
            schoolGrade: details?.schoolGrade ?? mem.schoolGrade
          };
        });
        this.loading = false;
      },
      error: () => {
        // still show basic list
        this.loading = false;
      }
    });
  }

  // ===== Profile =====
  openProfile(member: Member) {
    this.profileFor = member;
    this.profile = null;
    const famParam = this.canSelectFamily() ? this.selectedFamily : undefined;

    this.familySvc.memberDetails(member.id, famParam).subscribe({
      next: (p) => (this.profile = p),
      error: () => (this.profile = null)
    });
  }

  closeProfile() {
    this.profileFor = null;
    this.profile = null;
  }

  private loadRoles() {
    if (!this.canEditRoles()) return;
    this.adminSvc.roles().subscribe({ next: (r) => (this.allRoles = r || []) });
  }

  rolesForMember(member: Member): string[] {
    const currentRole = String(member?.role || '').toUpperCase();
    return (this.allRoles || []).filter((role) => {
      const candidate = String(role || '').toUpperCase();
      if (candidate === 'DEVELOPER' || candidate === 'DEV' || candidate === 'ROLE_DEVELOPER') return false;
      if (currentRole === 'KHADIM' && candidate === 'MAKHDOM') return false;
      return true;
    });
  }

  changeRole(member: Member, newRole: string) {
    if (!this.canEditRoles()) return;

    this.adminSvc.changeRole(member.id, newRole).subscribe({
      next: () => {
        this.message.add({ severity: 'success', summary: 'تحديث', detail: 'تم تحديث الدور' });
        member.role = newRole;
      },
      error: (err) => {
        this.message.add({ severity: 'error', summary: 'Error', detail: err?.error?.error || 'خطاء' });
      }
    });
  }

  deleteMember(member: Member) {
    if (!this.canDeleteMember(member)) return;

    this.confirm.confirm({
      header: 'تاكيد الحذف',
      icon: 'pi pi-exclamation-triangle',
      message: `هل تريد مسح اكونت ${member.fullName} ؟  `,
      acceptLabel: 'حذف',
      rejectLabel: 'الغاء',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.familySvc.deleteMember(member.id).subscribe({
          next: () => {
            this.message.add({ severity: 'success', summary: 'حذف', detail: 'تم حذف الاكونت' });
            this.members = (this.members || []).filter((m) => m.id !== member.id);
            if (this.profileFor?.id === member.id) {
              this.closeProfile();
            }
          },
          error: (err) => {
            this.message.add({
              severity: 'خطاء',
              summary: 'خطاء',
              detail: err?.error?.error || 'خطاء في مسح الاكونت'
            });
          }
        });
      }
    });
  }

  async exportPdf() {
    // 1st click -> enter selection mode
    if (!this.exportMode) {
      this.exportMode = true;
      this.pendingExport = 'pdf';
      this.message.add({ severity: 'info', summary: 'حدد الاعضاء', detail: 'اختر عضو ثم اضغط تحميل' });
      return;
    }

    // in selection mode but another export is pending
    if (this.pendingExport && this.pendingExport !== 'pdf') {
      this.pendingExport = 'pdf';
      this.message.add({ severity: 'info', summary: 'حدد الاعضاء', detail: 'اختر عضو ثم اضغط تحميل' });
      return;
    }

    try {
      const jsPDF = (await import('jspdf')).default;
      const autoTable = (await import('jspdf-autotable')).default;

      const selected = this.getSelectedMembers();
      if (!selected.length) {
        this.message.add({ severity: 'warn', summary: 'حدد الاعضاء', detail: 'برجاء اختيار عضو واحد علي الاقل' });
        return;
      }

      const famParam = this.canSelectFamily() ? this.selectedFamily : undefined;
      const detailsArr = await this.fetchDetailsForMembers(selected, famParam);

      // Use landscape layout and avoid a super-wide table (which breaks rendering).
      const doc = new jsPDF({ orientation: 'landscape' });

      const ensureDejaVu = async (d: any) => {
        try {
          if (typeof d.setR2L === 'function') d.setR2L(false);
          if (d.__hasDejaVu) {
            d.setFont('DejaVu', 'normal');
            return;
          }
          const res = await fetch('assets/fonts/DejaVuSans.ttf');
          const buf = await res.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let binary = '';
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
          const base64 = btoa(binary);
          d.addFileToVFS('DejaVuSans.ttf', base64);
          d.addFont('DejaVuSans.ttf', 'DejaVu', 'normal');
          d.__hasDejaVu = true;
          d.setFont('DejaVu', 'normal');
        } catch {
          // If font loading fails, PDF still generates (Arabic may not render correctly)
        }
      };

      await ensureDejaVu(doc);

      // Shape Arabic glyphs and isolate direction to keep mixed RTL/LTR text stable in PDF.
      const hasArabic = (s: string) => /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(s);
      const processArabic =
        (doc as any).processArabic ||
        ((jsPDF as any)?.API?.processArabic
          ? (text: string) => (jsPDF as any).API.processArabic(text)
          : null);
      const pdfText = (v: any) => {
        const s = (v ?? '') + '';
        if (!s) return '';
        if (!hasArabic(s)) return s;
        return typeof processArabic === 'function' ? processArabic(s) : s;
      };
      const pageRight = doc.internal.pageSize.getWidth() - 14;

      doc.setFontSize(14);
      doc.text(pdfText('بيانات الأعضاء'), pageRight, 14, { align: 'right' });
      doc.setFontSize(10);
      if (this.selectedFamily) {
        doc.text(pdfText(`الأسرة: ${this.selectedFamily}`), pageRight, 22, { align: 'right' });
      }

      let y = 28;
      selected.forEach((m, idx) => {
        const d = detailsArr[idx] || {};

        doc.setFontSize(12);
        doc.text(pdfText(`${m.fullName} (${this.roleAr(m.role)})`), pageRight, y, { align: 'right' });
        y += 4;

        const toYesNo = (v: any) => {
          if (v === true) return 'نعم';
          if (v === false) return 'لا';
          return (v ?? '') + '';
        };

        const show = (v: any) => {
          const s = String(v ?? '').trim();
          return s ? s : '-';
        };

        const rows: [string, string][] = [
          ['رقم الهاتف', d.phoneNumber ?? m.phoneNumber],
          ['هاتف ولي الأمر', d.guardiansPhone ?? m.guardiansPhone],
          ['العنوان', d.address ?? m.address],
          ['الصف الدراسي', d.schoolGrade ?? m.schoolGrade],
          ['اسم المستخدم', d.username],
          ['البريد الإلكتروني', d.email],
          ['الرقم القومي', d.nationalId],
          ['الرتبة', d.deaconDegree],
          ['صلة القرابة', this.guardianRelationAr(d.guardianRelation)],
          ['تاريخ الميلاد', d.dateOfBirth],
          ['النوع', this.genderAr(d.gender)],
          ['الحالة', this.statusAr(d.status)],
          ['نوع الدراسة', this.studyTypeAr(d.studyType)],
          ['اسم المدرسة', d.schoolName],
          ['اسم الجامعة', d.universityName],
          ['الكلية', d.faculty],
          ['السنة الجامعية', d.universityGrade],
          ['الوظيفة', d.graduateJob],
          ['هل يعمل', toYesNo(d.isWorking)],
          ['تفاصيل العمل', d.workDetails]
        ];

        // Always render every field row so table borders stay consistent.
        const kv: [string, string][] = rows.map(([k, v]) => [pdfText(show(v)), pdfText(k)]);

        autoTable(doc, {
          startY: y,
          head: [[pdfText('القيمة'), pdfText('البيان')]],
          body: kv,
          theme: 'grid',
          styles: { font: 'DejaVu', fontSize: 9, cellPadding: 2, overflow: 'linebreak', halign: 'right' },
          columnStyles: {
            0: { cellWidth: 220 },
            1: { cellWidth: 45 }
          },
          margin: { left: 14, right: 14 }
        });

        // @ts-ignore (autotable attaches lastAutoTable)
        y = (doc as any).lastAutoTable.finalY + 10;

        // New page if needed
        if (y > 180 && idx < selected.length - 1) {
          doc.addPage();
          y = 20;
        }
      });

      doc.save(`family_${this.selectedFamily || 'my'}_members_info.pdf`);

      // exit export mode after success
      this.exitExportMode();
    } catch {
      this.message.add({ severity: 'error', summary: 'Export failed', detail: 'PDF export failed' });
    }
  }

  cancelExport() {
    this.exitExportMode();
  }

  private exitExportMode() {
    this.exportMode = false;
    this.pendingExport = null;
    this.selectAll = false;
    this.members.forEach((m) => (m.selected = false));
  }

  private fetchDetailsForMembers(list: Member[], famParam?: string): Promise<any[]> {
    if (!list?.length) return Promise.resolve([]);

    const calls = list.map((mem) => this.familySvc.memberDetails(mem.id, famParam).pipe(catchError(() => of({}))));

    return new Promise((resolve) => {
      forkJoin(calls).subscribe({
        next: (arr) => resolve(arr as any[]),
        error: () => resolve([])
      });
    });
  }

  private roleAr(role?: string): string {
    const r = (role || '').toUpperCase();
    if (r === 'DEVELOPER') return 'مطوّر';
    if (r === 'AMIN_KHEDMA') return 'أمين خدمة';
    if (r === 'AMIN_OSRA') return 'أمين أسرة';
    if (r === 'KHADIM') return 'خادم';
    if (r === 'MEMBER') return 'عضو';
    return role || '';
  }

  private genderAr(v?: string): string {
    const x = (v || '').toUpperCase();
    if (x === 'MALE') return 'ذكر';
    if (x === 'FEMALE') return 'أنثى';
    return v || '';
  }

  private studyTypeAr(v?: string): string {
    const x = (v || '').toUpperCase();
    if (x === 'SCHOOL') return 'مدرسي';
    if (x === 'UNIVERSITY') return 'جامعي';
    if (x === 'GRADUATE') return 'خريج';
    return v || '';
  }

  private statusAr(v?: string): string {
    const x = (v || '').toUpperCase();
    if (x === 'ACTIVE') return 'نشط';
    if (x === 'INACTIVE') return 'غير نشط';
    if (x === 'SUSPENDED') return 'موقوف';
    if (x === 'STUDENT') return 'طالب';
    return v || '';
  }

  private guardianRelationAr(v?: string): string {
    const x = (v || '').toUpperCase();
    if (x === 'MOTHER' || x === 'MOM') return 'الأم';
    if (x === 'FATHER' || x === 'DAD') return 'الأب';
    if (x === 'BROTHER') return 'الأخ';
    if (x === 'SISTER') return 'الأخت';
    return v || '';
  }

  private isKhorsFamilySelected(): boolean {
    return !!this.getSelectedKhorsCode();
  }

  private getSelectedKhorsCode(): 'MARMARKOS' | 'ATHANASIUS' | '' {
    const famRaw = String(this.selectedFamily || '').trim();
    const fam = famRaw.toUpperCase();
    if (!fam) return '';

    if (fam === 'MARMARKOS' || fam.includes('مارمر') || fam.includes('MARMARKOS')) return 'MARMARKOS';
    if (fam === 'ATHANASIUS' || fam.includes('اثناس') || fam.includes('ATHANASIUS')) return 'ATHANASIUS';
    if (fam.includes('KHORS')) {
      if (fam.includes('MARMARKOS')) return 'MARMARKOS';
      if (fam.includes('ATHANASIUS')) return 'ATHANASIUS';
    }
    return '';
  }

  private filterRequestsBySelectedKhors(list: KhorsJoinRequestView[]): KhorsJoinRequestView[] {
    const selected = this.getSelectedKhorsCode();
    if (!selected) return [];
    return (list || []).filter((x) => String(x?.requestedKhors || '').toUpperCase() === selected);
  }
}

