import { Component, OnInit, inject } from '@angular/core';
import { ConfirmationService, MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AdminService } from '../services/admin.service';
import { AuthService, AuthUser } from '../services/auth.service';
import { DevSettingsService, CustomField } from '../services/dev-settings.service';
import { FamilyMemberDetails, FamilyMemberSummary, FamilyService } from '../services/family.service';
import { KhorsJoinRequestView, KhorsRequestsService } from '../services/khors-requests.service';
import { FamilyJoinRequestService, FamilyJoinRequestView } from '../services/family-join-request.service';
import {
  buildVisibleCustomFieldEntries,
  customFieldHasTarget,
  effectiveShowInTargets
} from '../shared/custom-field-display';
import { DEFAULT_FAMILY_ORDER, canonicalFamilyName, sortFamiliesByPreferredOrder } from '../shared/family-utils';
import { createPdfText, ensureDejaVuFont } from '../shared/pdf-utils';
import { hasRole, normalizeAssignmentRole, normalizeRole } from '../shared/role-utils';

type FamilyAssignmentLike = { familyName?: string; role?: string | number; roleCode?: number };

type AttendanceCardKey =
  | 'FRIDAY_LITURGY'
  | 'TASBEEHA'
  | 'FAMILY_MEETING'
  | 'MARMARKOS_KHORS'
  | 'ATHANASIUS_KHORS';

type CardColorState = 'white' | 'green' | 'yellow' | 'red';

type MemberAttendanceItem = {
  key: AttendanceCardKey;
  label: string;
  present: number;
  total: number;
  text: string;
};

type MemberAttendanceVisual = {
  present: number;
  total: number;
  percent: number | null;
  percentText: string;
  colorState: CardColorState;
  fillRatio: number;
  surfaceOpacity: number;
};

type Member = {
  id: number;
  fullName: string;
  role: string;
  familyName?: string;
  deaconFamily: string;
  address?: string;
  phoneNumber?: string;
  guardiansPhone?: string;
  schoolGrade?: string;
  dateOfBirth?: string;
  khors?: string;
  khorsYear?: number | string | null;
  servingScope?: string;
  fridayLiturgy?: number;
  tasbeeha?: number;
  familyMeeting?: number;
  fridayLiturgyPresent?: number;
  fridayLiturgyTotal?: number;
  tasbeehaPresent?: number;
  tasbeehaTotal?: number;
  familyMeetingPresent?: number;
  familyMeetingTotal?: number;
  marmarkosKhorsPresent?: number;
  marmarkosKhorsTotal?: number;
  athanasiusKhorsPresent?: number;
  athanasiusKhorsTotal?: number;
  selected?: boolean;
  uiDisplayPhone: string;
  uiPhoneCaption: string;
  uiGradeLabel: string;
  uiBirthDateLabel: string;
  uiBirthdayMonth: number | null;
  uiBirthdayDay: number | null;
  uiAttendanceItems: MemberAttendanceItem[];
  uiAttendanceVisual: MemberAttendanceVisual;
};

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

type BirthdayMonthOption = {
  value: number;
  label: string;
  count: number;
  disabled: boolean;
};

type BirthdayDayOption = {
  value: number;
  label: string;
  count: number;
  disabled: boolean;
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
  private familyJoinReq = inject(FamilyJoinRequestService);
  private devSettings = inject(DevSettingsService);
  private message = inject(MessageService);
  private confirm = inject(ConfirmationService);

  readonly birthdayMonths = [
    'يناير',
    'فبراير',
    'مارس',
    'أبريل',
    'مايو',
    'يونيو',
    'يوليو',
    'أغسطس',
    'سبتمبر',
    'أكتوبر',
    'نوفمبر',
    'ديسمبر'
  ];

  me: CurrentUser | null = null;
  members: Member[] = [];
  filteredMembers: Member[] = [];
  families: string[] = [];
  selectedFamily = '';
  loading = false;

  selectAll = false;
  exportMode = false;
  pendingExport: 'pdf' | null = null;

  selectedSchoolGrade = '';
  gradeOptions: string[] = [];
  birthdayPanelOpen = false;
  birthdayFilterMode: 'DAY' | 'MONTH' = 'DAY';
  selectedBirthdayMonth: number | null = null;
  selectedBirthdayDay: number | null = null;
  birthdayMonthOptions: BirthdayMonthOption[] = [];
  birthdayDayOptions: BirthdayDayOption[] = [];

  profileFor: Member | null = null;
  profile: ProfileView | null = null;
  profileLoading = false;
  familyInfoFields: CustomField[] = [];
  familyInfoFieldsLoaded = false;
  private profileCache = new Map<number, ProfileView | null>();

  allRoles: string[] = [];

  familyRequestsPendingCount = 0;
  familyRequestsOpen = false;
  familyRequestsLoading = false;
  familyRequests: FamilyJoinRequestView[] = [];
  khorsRequests: KhorsJoinRequestView[] = [];
  private readonly preferredFamilyOrder = DEFAULT_FAMILY_ORDER;

  ngOnInit() {
    this.loadCustomFieldDefinitions();
    this.auth.getUserData().subscribe({
      next: (u) => {
        this.me = u;
        this.loadRoles();
        this.initFamilyMode();
      },
      error: () => {}
    });
  }

  trackByMember = (_: number, member: Member) => member.id;

  isAminKhedmaOrDev(): boolean {
    return this.hasRole('AMIN_KHEDMA', 'DEVELOPER', 'DEV');
  }

  isKhadim(): boolean {
    return this.hasRole('KHADIM');
  }

  canSelectFamily(): boolean {
    return this.isAminKhedmaOrDev() || this.isKhadim();
  }

  canDeleteAccounts(): boolean {
    return hasRole(this.me?.role, ['AMIN_OSRA', 'AMIN_KHEDMA', 'DEVELOPER']);
  }

  canDeleteMember(member: Member | null | undefined): boolean {
    if (!this.canDeleteAccounts() || !member) return false;
    const myId = Number(this.me?.id || 0);
    if (myId && member.id === myId) return false;
    if (normalizeRole(member.role) === 'DEVELOPER') return false;
    return true;
  }

  canEditRoles(): boolean {
    return this.isAminKhedmaOrDev();
  }

  isCardExpanded(member: Member): boolean {
    return this.profileFor?.id === member.id;
  }

  hasBirthdayFilter(): boolean {
    if (this.birthdayFilterMode === 'MONTH') {
      return this.selectedBirthdayMonth != null;
    }
    return this.selectedBirthdayMonth != null && this.selectedBirthdayDay != null;
  }

  birthdayFilterLabel(): string {
    if (this.birthdayFilterMode === 'MONTH' && this.selectedBirthdayMonth != null) {
      return `مواليد ${this.monthLabel(this.selectedBirthdayMonth)}`;
    }
    if (
      this.birthdayFilterMode === 'DAY' &&
      this.selectedBirthdayMonth != null &&
      this.selectedBirthdayDay != null
    ) {
      return `${this.selectedBirthdayDay} ${this.monthLabel(this.selectedBirthdayMonth)}`;
    }
    return this.birthdayFilterMode === 'MONTH' ? 'اختر الشهر' : 'اختر اليوم';
  }

  selectedMembersCount(): number {
    return this.getSelectedMembers().length;
  }

  hasEnabledBirthdayDayOptions(): boolean {
    return this.birthdayDayOptions.some((option) => !option.disabled);
  }

  toggleBirthdayPanel() {
    this.birthdayPanelOpen = !this.birthdayPanelOpen;
  }

  setBirthdayFilterMode(mode: 'DAY' | 'MONTH') {
    if (this.birthdayFilterMode === mode) return;
    this.birthdayFilterMode = mode;
    this.selectedBirthdayDay = null;
    this.applyFilters();
  }

  selectBirthdayMonth(month: number) {
    const option = this.birthdayMonthOptions.find((item) => item.value === month);
    if (!option || option.disabled) return;
    this.selectedBirthdayMonth = month;
    this.selectedBirthdayDay = null;
    this.rebuildBirthdayDayOptions();
    this.applyFilters();
  }

  selectBirthdayDay(day: number) {
    if (this.selectedBirthdayMonth == null) return;
    const option = this.birthdayDayOptions.find((item) => item.value === day);
    if (!option || option.disabled) return;
    this.selectedBirthdayDay = day;
    this.applyFilters();
  }

  clearBirthdayFilter() {
    this.selectedBirthdayMonth = null;
    this.selectedBirthdayDay = null;
    this.rebuildBirthdayDayOptions();
    this.applyFilters();
  }

  onSchoolGradeChange() {
    this.applyFilters();
  }

  onFamilyChange() {
    this.resetInteractiveStateForNewFamily();
    this.loadMembers();
    this.loadFamilyPendingRequestsCount();
  }

  openProfile(member: Member) {
    if (this.profileFor?.id === member.id) {
      this.closeProfile();
      return;
    }

    this.profileFor = member;
    this.profile = null;
    this.profileLoading = true;

    if (this.profileCache.has(member.id)) {
      this.profile = this.profileCache.get(member.id) || null;
      this.profileLoading = false;
      return;
    }

    const famParam = this.canSelectFamily() ? this.selectedFamily : undefined;
    this.familySvc.memberDetails(member.id, famParam).subscribe({
      next: (p) => {
        const profile = (p as ProfileView | null) || null;
        this.profileCache.set(member.id, profile);
        if (this.profileFor?.id === member.id) {
          this.profile = profile;
          this.profileLoading = false;
        }
      },
      error: () => {
        this.profileCache.set(member.id, null);
        if (this.profileFor?.id === member.id) {
          this.profile = null;
          this.profileLoading = false;
        }
      }
    });
  }

  closeProfile() {
    this.profileFor = null;
    this.profile = null;
    this.profileLoading = false;
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

  toggleSelectAll() {
    this.members.forEach((member) => (member.selected = this.selectAll));
  }

  onMemberSelectionChange() {
    const anySelected = this.members.some((member) => !!member.selected);
    if (!anySelected) {
      this.selectAll = false;
      return;
    }
    this.selectAll = this.members.every((member) => !!member.selected);
  }

  private getSelectedMembers(): Member[] {
    return (this.members || []).filter((member) => !!member.selected);
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
      {
        label: 'الأسرة',
        value: this.assignmentsOf(p).map((x) => x.familyName).join(' + '),
        fieldKeys: ['deaconFamily']
      },
      { label: 'الخورس', value: this.memberKhorsLabel(p.khors, p.khorsYear), fieldKeys: ['khors'] },
      { label: 'الرتبة', value: String(p.deaconDegree ?? '').trim(), fieldKeys: ['deaconDegree'] },
      { label: 'الرقم القومي', value: String(p.nationalId ?? '').trim(), fieldKeys: ['nationalId'] },
      { label: 'الهاتف', value: String(p.phoneNumber ?? '').trim(), fieldKeys: ['phoneNumber'] },
      { label: 'العنوان', value: String(p.address ?? '').trim(), fieldKeys: ['address'] },
      {
        label: 'هاتف ولي الأمر',
        value: String(p.guardiansPhone ?? '').trim(),
        fieldKeys: ['guardiansPhone']
      },
      { label: 'صلة القرابة', value: String(p.guardianRelation ?? '').trim(), fieldKeys: ['guardianRelation'] },
      { label: 'تاريخ الميلاد', value: this.formatDateValue(p.dateOfBirth), fieldKeys: ['dateOfBirth'] },
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

  rolesForMember(member: Member): string[] {
    const currentRole = normalizeRole(member?.role);
    return (this.allRoles || []).filter((role) => {
      const candidate = normalizeRole(role);
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
        this.message.add({ severity: 'error', summary: 'خطأ', detail: err?.error?.error || 'فشل تحديث الدور' });
      }
    });
  }

  deleteMember(member: Member) {
    if (!this.canDeleteMember(member)) return;

    this.confirm.confirm({
      header: 'تأكيد الحذف',
      icon: 'pi pi-exclamation-triangle',
      message: `هل تريد مسح اكونت ${member.fullName} ؟`,
      acceptLabel: 'حذف',
      rejectLabel: 'إلغاء',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.familySvc.deleteMember(member.id).subscribe({
          next: () => {
            this.message.add({ severity: 'success', summary: 'حذف', detail: 'تم حذف الاكونت' });
            this.members = this.members.filter((item) => item.id !== member.id);
            this.profileCache.delete(member.id);
            this.rebuildFilterOptions();
            this.applyFilters();
            if (this.profileFor?.id === member.id) {
              this.closeProfile();
            }
          },
          error: (err) => {
            this.message.add({
              severity: 'error',
              summary: 'خطأ',
              detail: err?.error?.error || 'خطأ في مسح الاكونت'
            });
          }
        });
      }
    });
  }

  async exportPdf() {
    if (!this.exportMode) {
      this.exportMode = true;
      this.pendingExport = 'pdf';
      this.message.add({ severity: 'info', summary: 'حدد الاعضاء', detail: 'اختر عضو ثم اضغط تحميل' });
      return;
    }

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
      selected.forEach((member, idx) => {
        const detail = ((detailsArr[idx] || null) as ProfileView | null) || {};

        doc.setFontSize(12);
        doc.text(pdfText(`${member.fullName} (${this.roleAr(member.role)})`), pageRight, y, { align: 'right' });
        y += 4;

        const show = (value: unknown) => {
          const text = String(value ?? '').trim();
          return text ? text : '-';
        };

        const rows: [string, string][] = [
          ['رقم الهاتف', String(detail.phoneNumber ?? member.phoneNumber ?? '')],
          ['هاتف ولي الأمر', String(detail.guardiansPhone ?? member.guardiansPhone ?? '')],
          ['العنوان', String(detail.address ?? member.address ?? '')],
          ['الصف الدراسي', String(detail.schoolGrade ?? member.schoolGrade ?? '')],
          ['اسم المستخدم', String(detail.username ?? '')],
          ['البريد الإلكتروني', String(detail.email ?? '')],
          ['الرقم القومي', String(detail.nationalId ?? '')],
          ['الرتبة', String(detail.deaconDegree ?? '')],
          ['صلة القرابة', this.guardianRelationAr(detail.guardianRelation)],
          ['تاريخ الميلاد', this.formatDateValue(detail.dateOfBirth)],
          ['النوع', this.genderAr(detail.gender)],
          ['الحالة', this.statusAr(detail.status)],
          ['نوع الدراسة', this.studyTypeAr(detail.studyType)],
          ['اسم المدرسة', String(detail.schoolName ?? '')],
          ['اسم الجامعة', String(detail.universityName ?? '')],
          ['الكلية', String(detail.faculty ?? '')],
          ['السنة الجامعية', String(detail.universityGrade ?? '')],
          ['الوظيفة', String(detail.graduateJob ?? '')],
          ['هل يعمل', this.yesNoAr(detail.isWorking)],
          ['تفاصيل العمل', String(detail.workDetails ?? '')]
        ];

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

        y = (doc as any).lastAutoTable.finalY + 10;
        if (y > 180 && idx < selected.length - 1) {
          doc.addPage();
          y = 20;
        }
      });

      doc.save(`family_${this.selectedFamily || 'my'}_members_info.pdf`);
      this.exitExportMode();
    } catch {
      this.message.add({ severity: 'error', summary: 'خطأ', detail: 'فشل تصدير PDF' });
    }
  }

  cancelExport() {
    this.exitExportMode();
  }

  private exitExportMode() {
    this.exportMode = false;
    this.pendingExport = null;
    this.selectAll = false;
    this.members.forEach((member) => (member.selected = false));
  }

  canDecideKhorsRequests(): boolean {
    return this.isAminKhedmaOrDev() || this.isKhadimServingKhors();
  }

  decideKhorsRequest(req: KhorsJoinRequestView, approved: boolean) {
    if (!this.canDecideKhorsRequests() || !req?.requestId) return;

    this.khorsReq.decide(req.requestId, approved).subscribe({
      next: () => {
        this.khorsRequests = (this.khorsRequests || []).filter((item) => item.requestId !== req.requestId);
        this.familyRequestsPendingCount = this.familyRequests.length + this.khorsRequests.length;
        if (approved && !!this.selectedKhorsCode()) {
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

  /* ── Join Requests (Family + Khors) ─────────────────── */
  openFamilyRequests() {
    this.familyRequestsOpen = true;
    this.familyRequestsLoading = true;
    this.familyRequests = [];
    this.khorsRequests = [];

    this.familyJoinReq.pending().subscribe({
      next: (list) => {
        this.familyRequests = list || [];
        this.tryFinalizeLoadingRequests();
      },
      error: () => {
        this.familyRequests = [];
        this.tryFinalizeLoadingRequests();
      }
    });

    if (this.canDecideKhorsRequests() && !!this.selectedKhorsCode()) {
      this.khorsReq.pending().subscribe({
        next: (list) => {
          this.khorsRequests = this.filterRequestsBySelectedKhors(list || []);
          this.tryFinalizeLoadingRequests();
        },
        error: () => {
          this.khorsRequests = [];
          this.tryFinalizeLoadingRequests();
        }
      });
    } else {
      this.tryFinalizeLoadingRequests();
    }
  }

  private requestsLoadedCount = 0;
  private readonly REQUESTS_LOADERS = 2;

  private tryFinalizeLoadingRequests() {
    this.requestsLoadedCount++;
    if (this.requestsLoadedCount >= this.REQUESTS_LOADERS) {
      this.requestsLoadedCount = 0;
      this.familyRequestsLoading = false;
      this.familyRequestsPendingCount = this.familyRequests.length + this.khorsRequests.length;
    }
  }

  closeFamilyRequests() {
    this.familyRequestsOpen = false;
    this.familyRequestsLoading = false;
    this.familyRequests = [];
    this.khorsRequests = [];
    this.requestsLoadedCount = 0;
    this.loadFamilyPendingRequestsCount();
  }

  decideFamilyRequest(req: FamilyJoinRequestView, approved: boolean) {
    if (!req?.requestId) return;
    this.familyJoinReq.decide(req.requestId, approved).subscribe({
      next: () => {
        this.familyRequests = (this.familyRequests || []).filter((item) => item.requestId !== req.requestId);
        this.familyRequestsPendingCount = this.familyRequests.length;
        if (approved) this.loadMembers();
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

  private loadFamilyPendingRequestsCount() {
    let familyCount = 0;
    let khorsCount = 0;

    this.familyJoinReq.pending().subscribe({
      next: (list) => {
        familyCount = (list || []).length;
        this.tryFinalizePendingCount(familyCount, khorsCount);
      },
      error: () => {
        this.tryFinalizePendingCount(familyCount, khorsCount);
      }
    });

    if (this.canDecideKhorsRequests() && !!this.selectedKhorsCode()) {
      this.khorsReq.pending().subscribe({
        next: (list) => {
          khorsCount = this.filterRequestsBySelectedKhors(list || []).length;
          this.tryFinalizePendingCount(familyCount, khorsCount);
        },
        error: () => {
          this.tryFinalizePendingCount(familyCount, khorsCount);
        }
      });
    } else {
      this.tryFinalizePendingCount(familyCount, khorsCount);
    }
  }

  private pendingCountLoaded = 0;

  private tryFinalizePendingCount(familyCount: number, khorsCount: number) {
    this.pendingCountLoaded++;
    if (this.pendingCountLoaded >= 2) {
      this.pendingCountLoaded = 0;
      this.familyRequestsPendingCount = familyCount + khorsCount;
    }
  }

  familyLabel(
    entity: { familyAssignments?: FamilyAssignmentLike[]; role?: string | number; deaconFamily?: string } | null | undefined
  ): string {
    return this.assignmentsOf(entity).map((x) => x.familyName).join(' + ') || String(entity?.deaconFamily || '').trim();
  }

  private initFamilyMode() {
    if (this.canSelectFamily()) {
      this.familySvc.families().subscribe({
        next: (families) => {
          this.families = sortFamiliesByPreferredOrder(families || [], this.preferredFamilyOrder);
          if (this.families.length) {
            this.selectedFamily = this.families[0];
            this.loadMembers();
            this.loadFamilyPendingRequestsCount();
          }
        },
        error: () => {
          this.families = [];
          this.selectedFamily = '';
          this.loadMembers();
          this.familyRequestsPendingCount = 0;
        }
      });
    } else {
      this.selectedFamily = this.assignmentsOf(this.me)[0]?.familyName || '';
      this.loadMembers();
      this.loadFamilyPendingRequestsCount();
    }
  }

  private loadMembers() {
    this.loading = true;
    const famParam = this.selectedFamily || undefined;

    this.familySvc.members(famParam).subscribe({
      next: (rows) => {
        this.members = ((rows || []) as FamilyMemberSummary[]).map((row) => this.prepareMember(row));
        this.rebuildFilterOptions();
        this.applyFilters();
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.members = [];
        this.filteredMembers = [];
        this.message.add({ severity: 'error', summary: 'خطأ', detail: err?.error?.error || 'فشل تحميل البيانات' });
      }
    });
  }

  private prepareMember(summary: FamilyMemberSummary): Member {
    const base = summary as Member;
    const displayPhone = String(base.phoneNumber || base.guardiansPhone || '').trim();
    const birthdayParts = this.extractBirthdayParts(base.dateOfBirth);
    const attendanceItems = this.buildAttendanceItems(base);
    const attendanceVisual = this.buildAttendanceVisual(attendanceItems);

    return {
      ...base,
      fullName: String(base.fullName || '').trim(),
      role: String(base.role || '').trim(),
      deaconFamily: String(base.deaconFamily || '').trim(),
      selected: !!base.selected,
      uiDisplayPhone: displayPhone,
      uiPhoneCaption: base.phoneNumber ? 'الهاتف' : base.guardiansPhone ? 'هاتف ولي الأمر' : 'لا يوجد رقم',
      uiGradeLabel: String(base.schoolGrade || '').trim() || 'غير مسجلة',
      uiBirthDateLabel: this.formatDateValue(base.dateOfBirth),
      uiBirthdayMonth: birthdayParts.month,
      uiBirthdayDay: birthdayParts.day,
      uiAttendanceItems: attendanceItems,
      uiAttendanceVisual: attendanceVisual
    };
  }

  private buildAttendanceItems(member: Member): MemberAttendanceItem[] {
    const primaryKind = this.selectedFamilyAttendanceKind();
    const keys: AttendanceCardKey[] = [primaryKind, 'FRIDAY_LITURGY', 'TASBEEHA'];

    return keys.map((key) => {
      const counts = this.attendanceCounts(member, key);
      return {
        key,
        label: this.attendanceLabelForCard(key),
        present: counts.present,
        total: counts.total,
        text: `${counts.present}/${counts.total}`
      };
    });
  }

  private buildAttendanceVisual(items: MemberAttendanceItem[]): MemberAttendanceVisual {
    const present = items.reduce((sum, item) => sum + item.present, 0);
    const total = items.reduce((sum, item) => sum + item.total, 0);

    if (total <= 0) {
      return {
        present: 0,
        total: 0,
        percent: null,
        percentText: 'بداية السنة',
        colorState: 'white',
        fillRatio: 0,
        surfaceOpacity: 0
      };
    }

    const rawPercent = (present / total) * 100;
    const percent = Math.round(rawPercent);
    const colorState: CardColorState = rawPercent >= 70 ? 'green' : rawPercent >= 40 ? 'yellow' : 'red';
    const fillRatio = rawPercent <= 0 ? 1 : Math.max(0, Math.min(rawPercent / 100, 1));

    let surfaceOpacity = 0.34;
    if (colorState === 'green') {
      surfaceOpacity = 0.38 + ((rawPercent - 70) / 30) * 0.18;
    } else if (colorState === 'yellow') {
      surfaceOpacity = 0.34 + ((rawPercent - 40) / 29) * 0.12;
    } else {
      surfaceOpacity = 0.42 + ((39 - Math.min(rawPercent, 39)) / 39) * 0.18;
    }

    return {
      present,
      total,
      percent,
      percentText: `${percent}%`,
      colorState,
      fillRatio,
      surfaceOpacity: Math.max(0.32, Math.min(surfaceOpacity, 0.6))
    };
  }

  private attendanceCounts(member: Member, key: AttendanceCardKey): { present: number; total: number } {
    const fallback = (value: unknown) => Number(value || 0);

    switch (key) {
      case 'FRIDAY_LITURGY':
        return {
          present: fallback(member.fridayLiturgyPresent ?? member.fridayLiturgy),
          total: fallback(member.fridayLiturgyTotal)
        };
      case 'TASBEEHA':
        return {
          present: fallback(member.tasbeehaPresent ?? member.tasbeeha),
          total: fallback(member.tasbeehaTotal)
        };
      case 'MARMARKOS_KHORS':
        return {
          present: fallback(member.marmarkosKhorsPresent),
          total: fallback(member.marmarkosKhorsTotal)
        };
      case 'ATHANASIUS_KHORS':
        return {
          present: fallback(member.athanasiusKhorsPresent),
          total: fallback(member.athanasiusKhorsTotal)
        };
      default:
        return {
          present: fallback(member.familyMeetingPresent ?? member.familyMeeting),
          total: fallback(member.familyMeetingTotal)
        };
    }
  }

  private attendanceLabelForCard(key: AttendanceCardKey): string {
    switch (key) {
      case 'FRIDAY_LITURGY':
        return 'القداس';
      case 'TASBEEHA':
        return 'التسبحة';
      case 'MARMARKOS_KHORS':
      case 'ATHANASIUS_KHORS':
        return 'الخورس';
      default:
        return 'الأسرة';
    }
  }

  private selectedFamilyAttendanceKind(): AttendanceCardKey {
    return 'FAMILY_MEETING';
  }

  private rebuildFilterOptions() {
    const grades = Array.from(
      new Set(
        this.members
          .map((member) => String(member.schoolGrade || '').trim())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b, 'ar'));

    this.gradeOptions = grades;
    if (this.selectedSchoolGrade && !grades.includes(this.selectedSchoolGrade)) {
      this.selectedSchoolGrade = '';
    }

    this.rebuildBirthdayMonthOptions();
    this.rebuildBirthdayDayOptions();
  }

  private rebuildBirthdayMonthOptions() {
    const counts = new Map<number, number>();

    this.members.forEach((member) => {
      if (member.uiBirthdayMonth != null) {
        counts.set(member.uiBirthdayMonth, (counts.get(member.uiBirthdayMonth) || 0) + 1);
      }
    });

    this.birthdayMonthOptions = this.birthdayMonths.map((label, index) => {
      const value = index + 1;
      const count = counts.get(value) || 0;
      return { value, label, count, disabled: count === 0 };
    });

    if (
      this.selectedBirthdayMonth != null &&
      !this.birthdayMonthOptions.some((option) => option.value === this.selectedBirthdayMonth && !option.disabled)
    ) {
      this.selectedBirthdayMonth = null;
      this.selectedBirthdayDay = null;
    }
  }

  private rebuildBirthdayDayOptions() {
    if (this.selectedBirthdayMonth == null) {
      this.birthdayDayOptions = [];
      return;
    }

    const counts = new Map<number, number>();
    this.members
      .filter((member) => member.uiBirthdayMonth === this.selectedBirthdayMonth)
      .forEach((member) => {
        if (member.uiBirthdayDay != null) {
          counts.set(member.uiBirthdayDay, (counts.get(member.uiBirthdayDay) || 0) + 1);
        }
      });

    const daysInMonth = new Date(2024, this.selectedBirthdayMonth, 0).getDate();
    this.birthdayDayOptions = Array.from({ length: daysInMonth }, (_, index) => {
      const value = index + 1;
      const count = counts.get(value) || 0;
      return { value, label: String(value), count, disabled: count === 0 };
    });

    if (
      this.selectedBirthdayDay != null &&
      !this.birthdayDayOptions.some((option) => option.value === this.selectedBirthdayDay && !option.disabled)
    ) {
      this.selectedBirthdayDay = null;
    }
  }

  private applyFilters() {
    let result = [...this.members];

    if (this.selectedSchoolGrade) {
      result = result.filter((member) => String(member.schoolGrade || '').trim() === this.selectedSchoolGrade);
    }

    if (this.birthdayFilterMode === 'MONTH' && this.selectedBirthdayMonth != null) {
      result = result.filter((member) => member.uiBirthdayMonth === this.selectedBirthdayMonth);
    }

    if (
      this.birthdayFilterMode === 'DAY' &&
      this.selectedBirthdayMonth != null &&
      this.selectedBirthdayDay != null
    ) {
      result = result.filter(
        (member) =>
          member.uiBirthdayMonth === this.selectedBirthdayMonth && member.uiBirthdayDay === this.selectedBirthdayDay
      );
    }

    this.filteredMembers = result;
    this.selectAll = this.members.length > 0 && this.members.every((member) => !!member.selected);

    if (this.profileFor && !result.some((member) => member.id === this.profileFor?.id)) {
      this.closeProfile();
    }
  }

  private resetInteractiveStateForNewFamily() {
    this.selectedSchoolGrade = '';
    this.selectedBirthdayMonth = null;
    this.selectedBirthdayDay = null;
    this.birthdayPanelOpen = false;
    this.selectAll = false;
    this.closeProfile();
  }

  private monthLabel(month: number): string {
    return this.birthdayMonths[month - 1] || '';
  }

  private extractBirthdayParts(value?: string): { month: number | null; day: number | null } {
    const raw = String(value || '').trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      return {
        month: Number(match[2]),
        day: Number(match[3])
      };
    }

    const parsed = raw ? new Date(raw) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) {
      return { month: null, day: null };
    }

    return {
      month: parsed.getMonth() + 1,
      day: parsed.getDate()
    };
  }

  private formatDateValue(value?: string): string {
    const raw = String(value || '').trim();
    if (!raw) return 'غير مسجل';

    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      return `${match[3]}/${match[2]}/${match[1]}`;
    }

    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return raw;

    const day = String(parsed.getDate()).padStart(2, '0');
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const year = parsed.getFullYear();
    return `${day}/${month}/${year}`;
  }

  private isKhadimServingKhors(): boolean {
    if (!this.isKhadim()) return false;
    const scope = String(this.me?.servingScope || '').toUpperCase();
    const khors = String(this.me?.khors || '').toUpperCase();
    const scopeIncludesKhors = scope === 'KHORS_ONLY' || scope === 'BOTH';
    const khorsSelectedFromList = !!khors && khors !== 'NONE';
    return scopeIncludesKhors || khorsSelectedFromList;
  }

  private hasRole(...allowed: string[]): boolean {
    return hasRole(this.me?.role, allowed);
  }

  private assignmentsOf(
    entity: { familyAssignments?: FamilyAssignmentLike[]; role?: string | number; deaconFamily?: string } | null | undefined
  ): Array<{ familyName: string; role: string }> {
    const assignments = Array.isArray(entity?.familyAssignments) ? entity.familyAssignments : [];
    return assignments
      .map((assignment) => ({
        familyName: String(assignment?.familyName || '').trim(),
        role: normalizeAssignmentRole(assignment, entity?.role)
      }))
      .filter((item) => !!item.familyName);
  }

  private hasDisplayValue(value: unknown): boolean {
    if (value === false || value === 0) return true;
    return String(value ?? '').trim() !== '';
  }

  private yesNoAr(value: unknown): string {
    if (value === true) return 'نعم';
    if (value === false) return 'لا';
    return String(value ?? '').trim();
  }

  private khorsYearAr(year: unknown): string {
    const numeric = Number(year || 0);
    if (numeric === 1) return 'سنة أولى';
    if (numeric === 2) return 'سنة ثانية';
    if (numeric === 3) return 'سنة ثالثة';
    if (numeric === 4) return 'سنة رابعة';
    if (numeric === 5) return 'سنة خامسة';
    return '';
  }

  private memberKhorsLabel(khors: unknown, khorsYear?: unknown): string {
    const value = String(khors || '').trim().toUpperCase();

    if (!value || value === 'NONE') return '';
    if (value === 'MARMARKOS') {
      const yearLabel = this.khorsYearAr(khorsYear);
      return yearLabel ? `خورس مارمرقس - ${yearLabel}` : 'خورس مارمرقس';
    }
    if (value === 'ATHANASIUS') return 'خورس البابا اثناسيوس';
    if (value === 'BOTH') return 'خورس مارمرقس + خورس البابا اثناسيوس';

    return String(khors || '').trim();
  }

  private loadRoles() {
    if (!this.canEditRoles()) return;
    this.adminSvc.roles().subscribe({ next: (roles) => (this.allRoles = roles || []) });
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
    if (!normalizedFieldKey) return false;

    const configuredField = this.familyInfoFields.find((field) => field.fieldKey === normalizedFieldKey);
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

  private fetchDetailsForMembers(list: Member[], famParam?: string): Promise<FamilyMemberDetails[]> {
    if (!list?.length) return Promise.resolve([]);

    return Promise.all(
      list.map(
        (member) =>
          new Promise<FamilyMemberDetails>((resolve) => {
            this.familySvc
              .memberDetails(member.id, famParam)
              .pipe(catchError(() => of({})))
              .subscribe({
                next: (details) => resolve((details || {}) as FamilyMemberDetails),
                error: () => resolve({})
              });
          })
      )
    );
  }

  private roleAr(role?: string): string {
    const normalized = normalizeRole(role);
    if (normalized === 'DEVELOPER') return 'مطوّر';
    if (normalized === 'AMIN_KHEDMA') return 'أمين خدمة';
    if (normalized === 'AMIN_OSRA') return 'أمين أسرة';
    if (normalized === 'KHADIM') return 'خادم';
    return role || '';
  }

  private genderAr(value?: string): string {
    const normalized = (value || '').toUpperCase();
    if (normalized === 'MALE') return 'ذكر';
    if (normalized === 'FEMALE') return 'أنثى';
    return value || '';
  }

  private studyTypeAr(value?: string): string {
    const normalized = (value || '').toUpperCase();
    if (normalized === 'SCHOOL') return 'مدرسي';
    if (normalized === 'UNIVERSITY') return 'جامعي';
    if (normalized === 'GRADUATE') return 'خريج';
    return value || '';
  }

  private statusAr(value?: string): string {
    const normalized = (value || '').toUpperCase();
    if (normalized === 'ACTIVE') return 'نشط';
    if (normalized === 'INACTIVE') return 'غير نشط';
    if (normalized === 'SUSPENDED') return 'موقوف';
    if (normalized === 'STUDENT') return 'طالب';
    return value || '';
  }

  private guardianRelationAr(value?: string): string {
    const normalized = (value || '').toUpperCase();
    if (normalized === 'MOTHER' || normalized === 'MOM') return 'الأم';
    if (normalized === 'FATHER' || normalized === 'DAD') return 'الأب';
    if (normalized === 'BROTHER') return 'الأخ';
    if (normalized === 'SISTER') return 'الأخت';
    return value || '';
  }

  private isKhorsFamilySelected(): boolean {
    return !!this.selectedKhorsCode();
  }

  private getSelectedKhorsCode(): 'MARMARKOS' | 'ATHANASIUS' | '' {
    const familyRaw = String(this.selectedFamily || '').trim();
    const family = familyRaw.toUpperCase();
    if (!family) return '';

    if (family === 'MARMARKOS' || family.includes('مارمر') || family.includes('MARMARKOS')) return 'MARMARKOS';
    if (family === 'ATHANASIUS' || family.includes('اثناس') || family.includes('ATHANASIUS')) return 'ATHANASIUS';
    if (family.includes('KHORS')) {
      if (family.includes('MARMARKOS')) return 'MARMARKOS';
      if (family.includes('ATHANASIUS')) return 'ATHANASIUS';
    }
    return '';
  }

  private filterRequestsBySelectedKhors(list: KhorsJoinRequestView[]): KhorsJoinRequestView[] {
    const selected = this.selectedKhorsCode();
    if (!selected) return [];
    return (list || []).filter((item) => String(item?.requestedKhors || '').toUpperCase() === selected);
  }

  private selectedKhorsCode(): 'MARMARKOS' | 'ATHANASIUS' | '' {
    const family = canonicalFamilyName(String(this.selectedFamily || '').trim());
    if (!family) return '';
    if (family.includes('مارمرقس')) return 'MARMARKOS';
    if (family.includes('اثناسيوس') || family.includes('أثناسيوس')) return 'ATHANASIUS';
    return '';
  }
}
