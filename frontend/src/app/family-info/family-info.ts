import { Component, OnInit, inject } from '@angular/core';
import { FamilyService } from '../services/family.service';
import { AdminService } from '../services/admin.service';
import { AuthService, AuthUser } from '../services/auth.service';
import { KhorsRequestsService, KhorsJoinRequestView } from '../services/khors-requests.service';
import { MessageService, ConfirmationService } from 'primeng/api';
import { of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { hasRole, normalizeAssignmentRole, normalizeRole } from '../shared/role-utils';
import { createPdfText, ensureDejaVuFont } from '../shared/pdf-utils';
import { DEFAULT_FAMILY_ORDER, sortFamiliesByPreferredOrder } from '../shared/family-utils';
import { FamilyMemberDetails, FamilyMemberSummary } from '../services/family.service';
import { DevSettingsService, CustomField } from '../services/dev-settings.service';
import { buildVisibleCustomFieldEntries, customFieldHasTarget, effectiveShowInTargets } from '../shared/custom-field-display';

type Member = {
  id: number;
  fullName: string;
  role: string;
  familyName?: string;
  deaconFamily: string;
  address?: string;
  phoneNumber?: string;
  guardiansPhone?: string;
  /** shown in table */
  schoolGrade?: string;
  /** UI selection for export */
  selected?: boolean;
};

type FamilyAssignmentLike = { familyName?: string; role?: string | number; roleCode?: number };

type ProfileView = {
  username?: string;
  email?: string;
  customFields?: Record<string, string>;
  familyAssignments?: FamilyAssignmentLike[];
  role?: string | number;
  deaconFamily?: string;
  khors?: string;
  khorsYear?: number | string | null;
  deaconDegree?: string;
  nationalId?: string;
  phoneNumber?: string;
  address?: string;
  guardiansPhone?: string;
  guardianRelation?: string;
  dateOfBirth?: string;
  gender?: string;
  status?: string;
  studyType?: string;
  schoolName?: string;
  schoolGrade?: string;
  universityName?: string;
  faculty?: string;
  universityGrade?: string;
  graduatedFrom?: string;
  graduateJob?: string;
  isWorking?: boolean | string | number | null;
  workDetails?: string;
};

type CurrentUser = AuthUser & { id?: number };

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
  private devSettings = inject(DevSettingsService);
  private message = inject(MessageService);
  private confirm = inject(ConfirmationService);

  me: CurrentUser | null = null;
  members: Member[] = [];
  families: string[] = [];
  selectedFamily = '';
  loading = false;

  selectAll = false;

  exportMode = false;
  pendingExport: 'pdf' | null = null;

  profileFor: Member | null = null;
  profile: ProfileView | null = null;
  familyInfoFields: CustomField[] = [];
  familyInfoFieldsLoaded = false;

  allRoles: string[] = [];

  pendingRequestsCount = 0;
  requestsOpen = false;
  requestsLoading = false;
  requests: KhorsJoinRequestView[] = [];
  private readonly preferredFamilyOrder = DEFAULT_FAMILY_ORDER;

  ngOnInit() {
    this.loadCustomFieldDefinitions();
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

  private normalizeRole(role: unknown): string {
    return normalizeRole(role);
  }

  private assignmentsOf(entity: { familyAssignments?: FamilyAssignmentLike[]; role?: string | number; deaconFamily?: string } | null | undefined): Array<{ familyName: string; role: string }> {
    const assignments = Array.isArray(entity?.familyAssignments) ? entity.familyAssignments : [];
    return assignments
      .map((x) => ({
        familyName: String(x?.familyName || '').trim(),
        role: normalizeAssignmentRole(x, entity?.role)
      }))
      .filter((x) => !!x.familyName);
  }

  familyLabel(entity: { familyAssignments?: FamilyAssignmentLike[]; role?: string | number; deaconFamily?: string } | null | undefined): string {
    return this.assignmentsOf(entity).map((x) => x.familyName).join(' + ') || String(entity?.deaconFamily || '').trim();
  }

  private hasRole(...allowed: string[]): boolean {
    return hasRole(this.me?.role, allowed);
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
    return hasRole(this.me?.role, ['AMIN_OSRA', 'AMIN_KHEDMA', 'DEVELOPER']);
  }

  canDeleteMember(m: Member): boolean {
    if (!this.canDeleteAccounts()) return false;
    if (!m) return false;
    const myId = Number(this.me?.['id'] || 0);
    if (myId && m.id === myId) return false;
    if (normalizeRole(m.role) === 'DEVELOPER') return false;
    return true;
  }

  canEditRoles(): boolean {
    return this.isAminKhedmaOrDev();
  }

  private initFamilyMode() {
    if (this.canSelectFamily()) {
      this.familySvc.families().subscribe({
        next: (f) => {
          this.families = sortFamiliesByPreferredOrder(f || [], this.preferredFamilyOrder);
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
      this.selectedFamily = this.assignmentsOf(this.me)[0]?.familyName || '';
      this.loadMembers();
      this.loadPendingRequestsCount();
    }
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
        this.members = ((m || []) as FamilyMemberSummary[]).map((x) => ({ ...(x as Member), selected: false }));
        this.selectAll = false;
        this.loading = false;
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

  // ===== Profile =====
  openProfile(member: Member) {
    this.profileFor = member;
    this.profile = null;
    const famParam = this.canSelectFamily() ? this.selectedFamily : undefined;

    this.familySvc.memberDetails(member.id, famParam).subscribe({
      next: (p) => (this.profile = (p as ProfileView | null)),
      error: () => (this.profile = null)
    });
  }

  closeProfile() {
    this.profileFor = null;
    this.profile = null;
  }

  async copyPhone(value: unknown) {
    const phone = String(value ?? '').trim();
    if (!phone) return;

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(phone);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = phone;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }

      this.message.add({ severity: 'success', summary: 'تم', detail: 'تم نسخ الرقم' });
    } catch {
      this.message.add({ severity: 'error', summary: 'خطأ', detail: 'فشل نسخ الرقم' });
    }
  }

  private hasDisplayValue(v: unknown): boolean {
    if (v === false || v === 0) return true;
    return String(v ?? '').trim() !== '';
  }

  private yesNoAr(v: unknown): string {
    if (v === true) return 'نعم';
    if (v === false) return 'لا';
    return String(v ?? '').trim();
  }

  private khorsYearAr(year: unknown): string {
    const y = Number(year || 0);
    if (y === 1) return 'سنة أولى';
    if (y === 2) return 'سنة ثانية';
    if (y === 3) return 'سنة ثالثة';
    if (y === 4) return 'سنة رابعة';
    if (y === 5) return 'سنة خامسة';
    return '';
  }

  private memberKhorsLabel(khors: unknown, khorsYear?: unknown): string {
    const k = String(khors || '').trim().toUpperCase();

    if (!k || k === 'NONE') return '';
    if (k === 'MARMARKOS') {
      const yearLabel = this.khorsYearAr(khorsYear);
      return yearLabel ? `خورس مارمرقس - ${yearLabel}` : 'خورس مارمرقس';
    }
    if (k === 'ATHANASIUS') return 'خورس البابا اثناسيوس';
    if (k === 'BOTH') return 'خورس مارمرقس + خورس البابا اثناسيوس';

    return String(khors || '').trim();
  }

  profileEntries(): Array<{ label: string; value: string }> {
    if (!this.profile) return [];

    const p = this.profile as ProfileView;
    const schoolValue = [p.schoolName, p.schoolGrade].filter((x) => this.hasDisplayValue(x)).join(' - ');
    const universityValue = [p.universityName, p.faculty, p.universityGrade]
      .filter((x) => this.hasDisplayValue(x))
      .join(' - ');

    const rows = [
      { label: 'اسم المستخدم', value: String(p.username ?? '').trim(), fieldKeys: ['username'] },
      { label: 'البريد الإلكتروني', value: String(p.email ?? '').trim(), fieldKeys: ['email'] },
      { label: 'الأسرة', value: this.assignmentsOf(p).map((x) => x.familyName).join(' + '), fieldKeys: ['deaconFamily'] },
      { label: 'الخورس', value: this.memberKhorsLabel(p.khors, p.khorsYear), fieldKeys: ['khors'] },
      { label: 'الرتبة', value: String(p.deaconDegree ?? '').trim(), fieldKeys: ['deaconDegree'] },
      { label: 'الرقم القومي', value: String(p.nationalId ?? '').trim(), fieldKeys: ['nationalId'] },
      { label: 'الهاتف', value: String(p.phoneNumber ?? '').trim(), fieldKeys: ['phoneNumber'] },
      { label: 'العنوان', value: String(p.address ?? '').trim(), fieldKeys: ['address'] },
      { label: 'هاتف ولي الأمر', value: String(p.guardiansPhone ?? '').trim(), fieldKeys: ['guardiansPhone'] },
      { label: 'صلة القرابة', value: String(p.guardianRelation ?? '').trim(), fieldKeys: ['guardianRelation'] },
      { label: 'تاريخ الميلاد', value: String(p.dateOfBirth ?? '').trim(), fieldKeys: ['dateOfBirth'] },
      { label: 'النوع', value: String(p.gender ?? '').trim(), fieldKeys: ['gender'] },
      { label: 'الحالة', value: String(p.status ?? '').trim(), fieldKeys: ['status'] },
      { label: 'نوع الدراسة', value: String(p.studyType ?? '').trim(), fieldKeys: ['studyType'] },
      { label: 'المدرسة', value: schoolValue, fieldKeys: ['schoolName', 'schoolGrade'] },
      { label: 'الجامعة', value: universityValue, fieldKeys: ['universityName', 'faculty', 'universityGrade'] },
      { label: 'تخرج من', value: String(p.graduatedFrom ?? '').trim(), fieldKeys: ['graduatedFrom'] },
      { label: 'الوظيفة', value: String(p.graduateJob ?? '').trim(), fieldKeys: ['graduateJob'] },
      {
        label: 'يعمل',
        value:
          p.isWorking === null || p.isWorking === undefined || String(p.isWorking).trim() === ''
            ? ''
            : this.yesNoAr(p.isWorking),
        fieldKeys: ['isWorking']
      },
      { label: 'تفاصيل العمل', value: String(p.workDetails ?? '').trim(), fieldKeys: ['workDetails'] }
    ];

    return [
      ...rows
        .filter((row) => row.fieldKeys.some((fieldKey) => this.showFamilyInfoField(fieldKey)))
        .filter((row) => this.hasDisplayValue(row.value))
        .map(({ label, value }) => ({ label, value })),
      ...buildVisibleCustomFieldEntries(this.familyInfoFields, p.customFields, 'FAMILY_INFO')
    ];
  }

  isPhoneLabel(label: string): boolean {
    return label === 'الهاتف' || label === 'هاتف ولي الأمر';
  }

  private loadRoles() {
    if (!this.canEditRoles()) return;
    this.adminSvc.roles().subscribe({ next: (r) => (this.allRoles = r || []) });
  }

  private loadCustomFieldDefinitions() {
    this.devSettings.getEnabledFields().subscribe({
      next: (fields) => {
        this.familyInfoFields = fields || [];
        this.familyInfoFieldsLoaded = true;
      },
      error: () => {
        this.familyInfoFields = [];
        this.familyInfoFieldsLoaded = true;
      }
    });
  }

  private showFamilyInfoField(fieldKey: string): boolean {
    const normalizedFieldKey = String(fieldKey || '').trim();
    if (!normalizedFieldKey) {
      return false;
    }

    const configuredField = this.familyInfoFields.find(field => field.fieldKey === normalizedFieldKey);
    if (configuredField) {
      return customFieldHasTarget(configuredField, 'FAMILY_INFO');
    }

    if (this.familyInfoFieldsLoaded) {
      return false;
    }

    return effectiveShowInTargets({
      fieldKey: normalizedFieldKey,
      isSystem: true,
      showIn: ''
    }).includes('FAMILY_INFO');
  }

  rolesForMember(member: Member): string[] {
    const currentRole = normalizeRole(member?.role);
    return (this.allRoles || []).filter((role) => {
      const candidate = normalizeRole(role);
      if (candidate === 'ADMIN') return false;
      if (candidate === 'DEVELOPER') return false;
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

      await ensureDejaVuFont(doc);
      const pdfText = createPdfText(doc, jsPDF);
      const pageRight = doc.internal.pageSize.getWidth() - 14;

      doc.setFontSize(14);
      doc.text(pdfText('بيانات الأعضاء'), pageRight, 14, { align: 'right' });
      doc.setFontSize(10);
      if (this.selectedFamily) {
        doc.text(pdfText(`الأسرة: ${this.selectedFamily}`), pageRight, 22, { align: 'right' });
      }

      let y = 28;
      selected.forEach((m, idx) => {
        const d = (detailsArr[idx] || null) as ProfileView | null;
        const detail = d || {};

        doc.setFontSize(12);
        doc.text(pdfText(`${m.fullName} (${this.roleAr(m.role)})`), pageRight, y, { align: 'right' });
        y += 4;

        const toYesNo = (v: unknown) => {
          if (v === true) return 'نعم';
          if (v === false) return 'لا';
          return (v ?? '') + '';
        };

        const show = (v: unknown) => {
          const s = String(v ?? '').trim();
          return s ? s : '-';
        };

        const rows: [string, string][] = [
          ['رقم الهاتف', String(detail.phoneNumber ?? m.phoneNumber ?? '')],
          ['هاتف ولي الأمر', String(detail.guardiansPhone ?? m.guardiansPhone ?? '')],
          ['العنوان', String(detail.address ?? m.address ?? '')],
          ['الصف الدراسي', String(detail.schoolGrade ?? m.schoolGrade ?? '')],
          ['اسم المستخدم', String(detail.username ?? '')],
          ['البريد الإلكتروني', String(detail.email ?? '')],
          ['الرقم القومي', String(detail.nationalId ?? '')],
          ['الرتبة', String(detail.deaconDegree ?? '')],
          ['صلة القرابة', this.guardianRelationAr(detail.guardianRelation)],
          ['تاريخ الميلاد', String(detail.dateOfBirth ?? '')],
          ['النوع', this.genderAr(detail.gender)],
          ['الحالة', this.statusAr(detail.status)],
          ['نوع الدراسة', this.studyTypeAr(detail.studyType)],
          ['اسم المدرسة', String(detail.schoolName ?? '')],
          ['اسم الجامعة', String(detail.universityName ?? '')],
          ['الكلية', String(detail.faculty ?? '')],
          ['السنة الجامعية', String(detail.universityGrade ?? '')],
          ['الوظيفة', String(detail.graduateJob ?? '')],
          ['هل يعمل', toYesNo(detail.isWorking)],
          ['تفاصيل العمل', String(detail.workDetails ?? '')]
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

  private fetchDetailsForMembers(list: Member[], famParam?: string): Promise<FamilyMemberDetails[]> {
    if (!list?.length) return Promise.resolve([]);

    return Promise.all(
      list.map((mem) =>
        new Promise<FamilyMemberDetails>((resolve) => {
          this.familySvc.memberDetails(mem.id, famParam).pipe(catchError(() => of({}))).subscribe({
            next: (details) => resolve((details || {}) as FamilyMemberDetails),
            error: () => resolve({})
          });
        })
      )
    );
  }

  private roleAr(role?: string): string {
    const r = normalizeRole(role);
    if (r === 'DEVELOPER') return 'مطوّر';
    if (r === 'AMIN_KHEDMA') return 'أمين خدمة';
    if (r === 'AMIN_OSRA') return 'أمين أسرة';
    if (r === 'KHADIM') return 'خادم';
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

