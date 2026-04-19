import { Component, OnInit, inject } from '@angular/core';
import { FamilyService } from '../services/family.service';
import { AuthService, AuthUser } from '../services/auth.service';
import { MessageService } from 'primeng/api';
import { AttendanceService, type AttendanceType, type DailyAttendanceResponse } from '../services/attendance.service';
import { IftekadService, type IftekadVisitRecord } from '../services/iftekad.service';
import { normalizeAssignmentRole, normalizeRole, roleLabel } from '../shared/role-utils';
import { createPdfText, ensureDejaVuFont } from '../shared/pdf-utils';
import { DEFAULT_FAMILY_ORDER, sortFamiliesByPreferredOrder } from '../shared/family-utils';
import { FamilyMemberDetails, FamilyMemberSummary } from '../services/family.service';
import { DevSettingsService, CustomField } from '../services/dev-settings.service';
import { buildVisibleCustomFieldEntries } from '../shared/custom-field-display';

type Member = {
  id: number;
  fullName: string;
  role: string;
  familyName?: string;
  deaconFamily: string;

  // choir membership (used to hide choir sections inside details)
  attendKhors?: string; // MARMARKOS / ATHANASIUS / NONE / BOTH
  khors?: string; // MARMARKOS / ATHANASIUS / BOTH
  khorsYear?: number | null;
  servingScope?: string;

  // iftekad
  lastIftekadDate?: string | null; // yyyy-MM-dd

  // backward compatible fields (present count)
  fridayLiturgy: number;
  tasbeeha: number;
  familyMeeting: number;

  // new fields (present/total)
  fridayLiturgyPresent?: number;
  fridayLiturgyTotal?: number;
  tasbeehaPresent?: number;
  tasbeehaTotal?: number;
  familyMeetingPresent?: number;
  familyMeetingTotal?: number;

  // choir (present/total)
  marmarkosKhorsPresent?: number;
  marmarkosKhorsTotal?: number;
  athanasiusKhorsPresent?: number;
  athanasiusKhorsTotal?: number;

  /** UI selection for export */
  selected?: boolean;
};

type AttendanceRow = {
  id: number;
  // Keep this aligned with backend enum + AttendanceService.AttendanceType
  type: AttendanceType;
  date: string;
  time?: string;
  createdAt?: string;
  status?: 'PRESENT' | 'ABSENT';
  takenBy?: { id: number; fullName: string; role: string } | null;
};

type IftekadVisitView = {
  id: number;
  memberId: number;
  visitDate: string; // yyyy-MM-dd
  description?: string | null;
  companions?: string | null;
  createdAt?: string;
  recordedBy?: { id: number; fullName: string; role: string } | null;
};

type MemberWithIftekad = Member & { lastIftekadDate?: string | null };
type FamilyAssignmentLike = { familyName?: string; role?: string | number; roleCode?: number };
type AttendanceArchiveLike = {
  archived?: boolean | number | string;
  isArchived?: boolean | number | string;
  inArchive?: boolean | number | string;
  isInArchive?: boolean | number | string;
  archiveId?: number | null;
  archive?: unknown;
  archiveName?: string;
  archivedAt?: string;
  archiveDate?: string;
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

@Component({
  selector: 'app-family-attendance',
  standalone: false,
  templateUrl: './family-attendance.html',
  styleUrls: ['./family-attendance.css'],
  providers: [MessageService]
})
export class FamilyAttendanceComponent implements OnInit {

  readonly allAttendanceTypes: AttendanceRow['type'][] = [
    'TASBEEHA',
    'FRIDAY_LITURGY',
    'MARMARKOS_KHORS',
    'ATHANASIUS_KHORS',
    'FAMILY_MEETING'
  ];

  private familySvc = inject(FamilyService);
  private auth = inject(AuthService);
  private devSettings = inject(DevSettingsService);
  private message = inject(MessageService);
  private iftekadSvc = inject(IftekadService);
  private attendanceSvc = inject(AttendanceService);

  me: AuthUser | null = null;
  members: Member[] = [];
  families: string[] = [];
  selectedFamily = '';
  private readonly preferredFamilyOrder = DEFAULT_FAMILY_ORDER;
  loading = false;

  exportMode = false;
  pendingExport: 'pdf' | '' = '';
  selectAll = false;

  detailsFor: Member | null = null;
  details: AttendanceRow[] = [];
  detailsType: '' | AttendanceType = '';

  profileFor: Member | null = null;
  profile: ProfileView | null = null;
  familyInfoFields: CustomField[] = [];

  // ===== Daily attendance (حضور اليوم) =====
  showDaily = false;
  dailyDate: Date | null = null;
  dailyType: AttendanceType | null = null;
  dailyLoading = false;
  dailyTotal = 0;
  dailyPresentCount = 0;
  dailyAbsentCount = 0;
  dailyRecordsCount = 0;
  dailyPresent: Array<{ id: number; fullName: string; role?: string; familyName?: string; deaconFamily?: string; familyAssignments?: Array<{ familyName?: string }> }> = [];
  dailyAbsent: Array<{ id: number; fullName: string; role?: string; familyName?: string; deaconFamily?: string; familyAssignments?: Array<{ familyName?: string }> }> = [];
  dailyMaxDate: Date = this.buildDailyMaxDate();
  dailyDisabledWeekDays: number[] = [0, 1, 2, 3]; // الأحد - الاثنين - الثلاثاء - الأربعاء

  arDatePickerLocale = {
    firstDayOfWeek: 1,
    dayNames: ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
    dayNamesShort: ['أحد', 'اثن', 'ثلا', 'أرب', 'خم', 'جم', 'سبت'],
    dayNamesMin: ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'],
    monthNames: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
    monthNamesShort: ['ينا', 'فبر', 'مار', 'أبر', 'ماي', 'يون', 'يول', 'أغس', 'سبت', 'أكت', 'نوف', 'ديس'],
    today: 'اليوم',
    clear: 'مسح'
  };

  // confirm remove (mark absent)
  showDailyRemoveConfirm = false;
  dailyRemoveTarget: { id: number; fullName: string } | null = null;
  dailyRemoveSaving = false;

  // ===== Iftekad (visitation) =====
  iftekadFor: Member | null = null;
  iftekadDate: Date | null = null;
  iftekadDesc = '';
  iftekadCompanions = '';
  iftekadSaving = false;

  iftekadHistory: IftekadVisitView[] = [];
  iftekadHistoryLoading = false;

  editingVisitId: number | null = null;
  editVisitDate: Date | null = null;
  editVisitDesc = '';
  editVisitCompanions = '';
  editSaving = false;

   // ✅ NEW: confirm dialog inside the page (no browser confirm)
  showDeleteConfirm = false;
  visitToDelete: IftekadVisitView | null = null;
  deleteSaving = false;

  isChoirSelected(): boolean {
    const x = String(this.selectedFamily || '').trim();
    return x === 'خورس مارمرقس' || x === 'خورس البابا اثناسيوس';
  }

  ngOnInit() {
    this.loadCustomFieldDefinitions();
    this.auth.getUserData().subscribe({
      next: (u) => {
        this.me = u;
        this.initFamilyMode();
      },
      error: () => {}
    });
  }

  get selectedFamilyName(): string {
    return String(this.selectedFamily || '').trim();
  }

  get isMarmarkosChoir(): boolean {
    return this.selectedFamilyName === 'خورس مارمرقس';
  }

  get isAthanasiusChoir(): boolean {
    return this.selectedFamilyName === 'خورس البابا اثناسيوس';
  }

  get showMarmarkosColumn(): boolean {
    return this.isMarmarkosChoir;
  }

  get showAthanasiusColumn(): boolean {
    return this.isAthanasiusChoir;
  }

  get showFamilyMeetingColumn(): boolean {
    return !this.isChoirSelected();
  }

  isAminKhedmaOrDev(): boolean {
    return ['AMIN_KHEDMA', 'DEVELOPER'].includes(normalizeRole(this.me?.role));
  }

  isKhadim(): boolean {
    return normalizeRole(this.me?.role) === 'KHADIM';
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

  canSelectFamily(): boolean {
    return this.isAminKhedmaOrDev() || this.isKhadim();
  }

  private initFamilyMode() {
    if (this.canSelectFamily()) {
      this.familySvc.families().subscribe({
        next: (f) => {
          this.families = sortFamiliesByPreferredOrder(f || [], this.preferredFamilyOrder);
          if (this.families.length) {
            this.selectedFamily = this.families[0];
            this.loadMembers();
          }
        },
        error: () => {
          this.families = [];
          this.selectedFamily = '';
          this.loadMembers();
        }
      });
    } else {
      this.selectedFamily = this.assignmentsOf(this.me)[0]?.familyName || '';
      this.loadMembers();
    }
  }

  onFamilyChange() {
    this.loadMembers();
  }

  loadMembers() {
    this.loading = true;
    const famParam = this.canSelectFamily() ? this.selectedFamily : undefined;

    this.familySvc.members(famParam).subscribe({
      next: (m) => {
        this.members = (m || []) as Member[];
        this.refreshIftekadLastDates();
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.message.add({ severity: 'error', summary: 'خطأ', detail: err?.error?.error || 'خطأ في التحميل' });
      }
    });
  }

  private refreshIftekadLastDates() {
    const ids = (this.members || []).map((x) => x?.id).filter((x) => x != null) as number[];
    if (!ids.length) return;

    this.iftekadSvc.lastVisitDates(ids).subscribe({
      next: (map) => {
        const m = map || {};
        this.members.forEach((mem) => {
          const key = String(mem.id);
          (mem as MemberWithIftekad).lastIftekadDate = m[key] || null;
        });
      },
      error: () => {
        this.members.forEach((mem) => (((mem as MemberWithIftekad).lastIftekadDate = null)));
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

  private async fetchDetailsForMembers(members: Member[], famParam?: string): Promise<FamilyMemberDetails[]> {
    const { firstValueFrom } = await import('rxjs');
    return Promise.all(
      members.map(async (m) => {
        try {
          return await firstValueFrom(this.familySvc.memberDetails(m.id, famParam));
        } catch {
          return null;
        }
      })
    );
  }

  private async fetchAttendanceForMembers(members: Member[], famParam?: string): Promise<AttendanceRow[][]> {
    const { firstValueFrom } = await import('rxjs');
    return Promise.all(
      members.map(async (m) => {
        try {
          const rows = await firstValueFrom(this.familySvc.memberAttendance(m.id, famParam));
          return (rows || []) as AttendanceRow[];
        } catch {
          return [];
        }
      })
    );
  }

  openDetails(member: Member) {
    this.detailsFor = member;
    this.detailsType = '';
    this.reloadDetails();
  }

  reloadDetails() {
    if (!this.detailsFor) return;

    // لو نوع الفلتر مش مسموح للعضو ده (مثلا مش في خورس) رجّعه للكل
    if (this.detailsType && !this.isAttendanceTypeAllowedForMember(this.detailsFor, this.detailsType)) {
      this.detailsType = '';
    }

    const famParam = this.canSelectFamily() ? this.selectedFamily : undefined;

    this.familySvc.memberAttendance(this.detailsFor.id, famParam, this.detailsType || undefined).subscribe({
      next: (d) => (this.details = this.filterOutArchivedRows((d || []) as AttendanceRow[])),
      error: () => (this.details = [])
    });
  }

  private filterOutArchivedRows(rows: AttendanceRow[]): AttendanceRow[] {
    return (Array.isArray(rows) ? rows : []).filter((r) => !this.isArchivedRow(r)) as AttendanceRow[];
  }

  private isArchivedRow(row: AttendanceRow & AttendanceArchiveLike): boolean {
    const isTrue = (v: unknown) => {
      const s = String(v ?? '').trim().toLowerCase();
      return v === true || v === 1 || s === 'true' || s === 'yes' || s === 'y';
    };
    const hasArchiveRef = row?.archiveId !== null && row?.archiveId !== undefined && row?.archiveId !== 0;

    return (
      isTrue(row?.archived) ||
      isTrue(row?.isArchived) ||
      isTrue(row?.inArchive) ||
      isTrue(row?.isInArchive) ||
      !!row?.archive ||
      !!row?.archiveName ||
      !!row?.archivedAt ||
      !!row?.archiveDate ||
      hasArchiveRef
    );
  }

  countLabel(
    m: Member,
    kind: 'FRIDAY_LITURGY' | 'MARMARKOS_KHORS' | 'ATHANASIUS_KHORS' | 'TASBEEHA' | 'FAMILY_MEETING'
  ): string {
    const fallbackPresent =
      kind === 'FRIDAY_LITURGY'
        ? m.fridayLiturgy
        : kind === 'MARMARKOS_KHORS'
          ? (m as any).marmarkosKhorsPresent
          : kind === 'ATHANASIUS_KHORS'
            ? (m as any).athanasiusKhorsPresent
            : kind === 'TASBEEHA'
              ? m.tasbeeha
              : m.familyMeeting;

    const present =
      kind === 'FRIDAY_LITURGY'
        ? m.fridayLiturgyPresent ?? fallbackPresent
        : kind === 'MARMARKOS_KHORS'
          ? (m as any).marmarkosKhorsPresent ?? fallbackPresent
          : kind === 'ATHANASIUS_KHORS'
            ? (m as any).athanasiusKhorsPresent ?? fallbackPresent
            : kind === 'TASBEEHA'
              ? m.tasbeehaPresent ?? fallbackPresent
              : m.familyMeetingPresent ?? fallbackPresent;

    const total =
      kind === 'FRIDAY_LITURGY'
        ? m.fridayLiturgyTotal
        : kind === 'MARMARKOS_KHORS'
          ? (m as any).marmarkosKhorsTotal
          : kind === 'ATHANASIUS_KHORS'
            ? (m as any).athanasiusKhorsTotal
            : kind === 'TASBEEHA'
              ? m.tasbeehaTotal
              : m.familyMeetingTotal;

    // لو التوتال مش موجود لسه (قبل تحديث الباك), اعرض الرقم القديم بس
    if (total == null) return String(present ?? 0);
    return `${present ?? 0}/${total}`;
  }

  titleForType(t: AttendanceRow['type']): string {
    if (t === 'TASBEEHA') return 'تسبحة';
    if (t === 'FRIDAY_LITURGY') return 'قداس الجمعة';
    if (t === 'MARMARKOS_KHORS') return 'خورس مارمرقس';
    if (t === 'ATHANASIUS_KHORS') return 'خورس البابا اثناسيوس';
    return 'اجتماع الأسرة';
  }

  private statusAr(v?: AttendanceRow['status'] | string): string {
    const s = (v || '').toUpperCase();
    if (s === 'PRESENT') return 'حاضر';
    if (s === 'ABSENT') return 'غائب';
    return v || '';
  }

  private roleAr(role?: string): string {
    const normalized = normalizeRole(role);
    if (normalized === 'DEVELOPER') return 'مطوّر';
    if (normalized === 'AMIN_KHEDMA') return 'أمين خدمة';
    if (normalized === 'AMIN_OSRA') return 'أمين أسرة';
    if (normalized === 'KHADIM') return 'خادم';
    return roleLabel(role);
  }

  private memberChoirMembership(m: Pick<Member, 'attendKhors' | 'khors'>): '' | 'MARMARKOS' | 'ATHANASIUS' | 'BOTH' {
    const attend = String(m?.attendKhors || '').trim().toUpperCase();
    if (attend === 'MARMARKOS') return 'MARMARKOS';
    if (attend === 'ATHANASIUS') return 'ATHANASIUS';
    if (attend === 'BOTH') return 'BOTH';

    const k = String(m?.khors || '').trim().toUpperCase();
    if (k === 'MARMARKOS') return 'MARMARKOS';
    if (k === 'ATHANASIUS') return 'ATHANASIUS';
    if (k === 'BOTH') return 'BOTH';

    return '';
  }

  isAttendanceTypeAllowedForMember(member: Member, t: AttendanceType): boolean {
    if (t === 'MARMARKOS_KHORS' || t === 'ATHANASIUS_KHORS') {
      const mem = this.memberChoirMembership(member);
      if (t === 'MARMARKOS_KHORS') return mem === 'MARMARKOS' || mem === 'BOTH';
      return mem === 'ATHANASIUS' || mem === 'BOTH';
    }
    return true;
  }

  visibleAttendanceTypes(): AttendanceRow['type'][] {
    const baseTypes = this.showFamilyMeetingColumn
      ? this.allAttendanceTypes
      : this.allAttendanceTypes.filter((t) => t !== 'FAMILY_MEETING');

    if (!this.detailsFor) return baseTypes;
    return baseTypes.filter((t) => this.isAttendanceTypeAllowedForMember(this.detailsFor!, t));
  }

  filteredDetails(t: AttendanceRow['type']): AttendanceRow[] {
    return (this.details || []).filter((d) => d?.type === t);
  }

  closeDetails() {
    this.detailsFor = null;
    this.details = [];
    this.detailsType = '';
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

    if (k === 'ATHANASIUS') {
      return 'خورس البابا اثناسيوس';
    }

    if (k === 'BOTH') {
      return 'خورس مارمرقس + خورس البابا اثناسيوس';
    }

    return String(khors || '').trim();
  }

  profileEntries(): Array<{ label: string; value: string }> {
    if (!this.profile) return [];

    const p = this.profile as ProfileView;

    const schoolValue = [p.schoolName, p.schoolGrade]
      .filter((x) => this.hasDisplayValue(x))
      .join(' - ');

    const universityValue = [p.universityName, p.faculty, p.universityGrade]
      .filter((x) => this.hasDisplayValue(x))
      .join(' - ');

    const rows = [
      { label: 'اسم المستخدم', value: String(p.username ?? '').trim() },
      { label: 'البريد الإلكتروني', value: String(p.email ?? '').trim() },
      { label: 'الأسرة', value: this.familyLabel(p) },
      { label: 'الخورس', value: this.memberKhorsLabel(p.khors, p.khorsYear) },
      { label: 'الرتبة', value: String(p.deaconDegree ?? '').trim() },
      { label: 'الرقم القومي', value: String(p.nationalId ?? '').trim() },
      { label: 'الهاتف', value: String(p.phoneNumber ?? '').trim() },
      { label: 'العنوان', value: String(p.address ?? '').trim() },
      { label: 'هاتف ولي الأمر', value: String(p.guardiansPhone ?? '').trim() },
      { label: 'صلة القرابة', value: String(p.guardianRelation ?? '').trim() },
      { label: 'تاريخ الميلاد', value: String(p.dateOfBirth ?? '').trim() },
      { label: 'النوع', value: String(p.gender ?? '').trim() },
      { label: 'الحالة', value: String(p.status ?? '').trim() },
      { label: 'نوع الدراسة', value: String(p.studyType ?? '').trim() },
      { label: 'المدرسة', value: schoolValue },
      { label: 'الجامعة', value: universityValue },
      { label: 'تخرج من', value: String(p.graduatedFrom ?? '').trim() },
      { label: 'الوظيفة', value: String(p.graduateJob ?? '').trim() },
      {
        label: 'يعمل',
        value:
          p.isWorking === null || p.isWorking === undefined || String(p.isWorking).trim() === ''
            ? ''
            : this.yesNoAr(p.isWorking)
      },
      { label: 'تفاصيل العمل', value: String(p.workDetails ?? '').trim() }
    ];

    return [
      ...rows.filter((row) => this.hasDisplayValue(row.value)),
      ...buildVisibleCustomFieldEntries(this.familyInfoFields, p.customFields, 'FAMILY_INFO')
    ];
  }

  isPhoneLabel(label: string): boolean {
    return label === 'الهاتف' || label === 'هاتف ولي الأمر';
  }

  private clearDailyAttendanceData(): void {
    this.dailyLoading = false;
    this.dailyPresent = [];
    this.dailyAbsent = [];
    this.dailyTotal = 0;
    this.dailyPresentCount = 0;
    this.dailyAbsentCount = 0;
    this.dailyRecordsCount = 0;
    this.showDailyRemoveConfirm = false;
    this.dailyRemoveTarget = null;
    this.dailyRemoveSaving = false;
  }

  // ===== Daily attendance (حضور اليوم) =====

  canEditDailyAttendance(): boolean {
    const r = normalizeRole(this.me?.role);
    return r === 'KHADIM' || r === 'AMIN_OSRA' || r === 'AMIN_KHEDMA' || r === 'DEVELOPER';
  }

  private buildDailyMaxDate(): Date {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d;
  }

  private toIsoDateOnly(value: Date | string | null): string {
    if (!value) return '';

    const d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return '';

    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  private loadCustomFieldDefinitions() {
    this.devSettings.getEnabledFields().subscribe({
      next: (fields) => {
        this.familyInfoFields = fields || [];
      },
      error: () => {
        this.familyInfoFields = [];
      }
    });
  }

  private toDateValue(value: Date | string | null): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(`${value}T00:00:00`);
  return isNaN(d.getTime()) ? null : d;
  }

  displayDateOnly(value: Date | string | null): string {
    return this.toIsoDateOnly(value);
  }

  private isAllowedDailyDate(value: Date | null): boolean {
    if (!value) return false;

    const d = value instanceof Date ? new Date(value) : new Date(value);
    if (isNaN(d.getTime())) return false;

    d.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // يمنع الأيام المستقبلية
    if (d.getTime() > today.getTime()) return false;

    // يسمح فقط بالخميس والجمعة والسبت
    const day = d.getDay(); // 4 الخميس - 5 الجمعة - 6 السبت
    return day === 4 || day === 5 || day === 6;
  }

  openDailyAttendance() {
    this.showDaily = true;
    this.dailyDate = null;
    this.dailyType = null;
    this.dailyMaxDate = this.buildDailyMaxDate();
    this.clearDailyAttendanceData();
  }

  closeDailyAttendance() {
    this.showDaily = false;
    this.dailyDate = null;
    this.dailyType = null;
    this.clearDailyAttendanceData();
  }

  setDailyToday() {
    const d = new Date();
    if (this.isAllowedDailyDate(d)) {
      this.dailyDate = d;
    } else {
      this.dailyDate = null;
    }
  }

  private dailyFamilyParam(): string | undefined {
    if (this.canSelectFamily()) return this.selectedFamily;
    return this.assignmentsOf(this.me)[0]?.familyName;
  }

  private canShowDailyKhorsTypes(): boolean {
    const selected = String(this.selectedFamily || '').trim();
    if (selected === 'خورس مارمرقس' || selected === 'خورس البابا اثناسيوس') return true;

    const role = normalizeRole(this.me?.role);
    if (role !== 'KHADIM') return false;

    const scope = String(this.me?.servingScope || '').trim().toUpperCase();
    if (scope === 'KHORS_ONLY' || scope === 'BOTH') return true;

    const kh = String(this.me?.khors || '').trim().toUpperCase();
    return kh === 'MARMARKOS' || kh === 'ATHANASIUS' || kh === 'BOTH';
  }

  dailyTypeOptions(): AttendanceType[] {
    const base: AttendanceType[] = this.showFamilyMeetingColumn
      ? ['FRIDAY_LITURGY', 'TASBEEHA', 'FAMILY_MEETING']
      : ['FRIDAY_LITURGY', 'TASBEEHA'];
    if (this.canShowDailyKhorsTypes()) {
      base.push('MARMARKOS_KHORS', 'ATHANASIUS_KHORS');
    }
    return base;
  }

  private defaultDailyTypeForDate(dateIso: string): AttendanceType | null {
    const options = this.dailyTypeOptions();
    if (!dateIso) return options[0] || null;

    const d = new Date(`${dateIso}T00:00:00`);
    if (isNaN(d.getTime())) return options[0] || null;
    const dow = d.getDay();

    if (dow === 4) return options.includes('FAMILY_MEETING') ? 'FAMILY_MEETING' : (options[0] || null);
    if (dow === 5) {
      if (this.isMarmarkosChoir && options.includes('MARMARKOS_KHORS')) return 'MARMARKOS_KHORS';
      if (this.isAthanasiusChoir && options.includes('ATHANASIUS_KHORS')) return 'ATHANASIUS_KHORS';
      if (options.includes('FRIDAY_LITURGY')) return 'FRIDAY_LITURGY';
    }
    if (dow === 6) return options.includes('TASBEEHA') ? 'TASBEEHA' : (options[0] || null);

    return options[0] || null;
  }

  dailyTypeLabel(t: AttendanceType | null): string {
    if (!t) return '';
    if (t === 'FRIDAY_LITURGY') return 'قداس الجمعة';
    if (t === 'MARMARKOS_KHORS') return 'خورس مارمرقس';
    if (t === 'ATHANASIUS_KHORS') return 'خورس البابا اثناسيوس';
    if (t === 'TASBEEHA') return 'تسبحة';
    if (t === 'FAMILY_MEETING') return 'اجتماع الأسرة';
    return t;
  }

  onDailyDateChange() {
    this.reloadDaily();
  }

  onDailyTypeChange() {
    this.reloadDaily();
  }

  reloadDaily() {
    if (!this.showDaily) return;

    const isoDate = this.toIsoDateOnly(this.dailyDate);

    if (!this.dailyDate || !this.dailyType || !isoDate) {
      this.clearDailyAttendanceData();
      return;
    }

    if (!this.isAllowedDailyDate(this.dailyDate)) {
      this.clearDailyAttendanceData();
      this.message.add({
        severity: 'warn',
        summary: 'تنبيه',
        detail: 'مسموح فقط بالخميس والجمعة والسبت من الأيام السابقة أو اليوم.'
      });
      return;
    }

    this.dailyLoading = true;
    const fam = this.dailyFamilyParam();

    this.attendanceSvc.daily(isoDate, this.dailyType, fam).subscribe({
      next: (res: DailyAttendanceResponse) => {
        const familyTotal = Number(this.members?.length || 0);

        this.dailyPresentCount = Number(res?.presentCount || 0);
        this.dailyAbsentCount = Number(res?.absentCount || 0);
        this.dailyRecordsCount = Number(res?.recordsCount || 0);
        this.dailyPresent = res?.present || [];
        this.dailyAbsent = res?.absent || [];

        this.dailyTotal = familyTotal > 0 ? familyTotal : Number(res?.total || 0);

        if (this.dailyRecordsCount === 0) {
          this.dailyAbsent = [];
          this.dailyAbsentCount = 0;
        }

        this.dailyLoading = false;
      },
      error: (err) => {
        this.clearDailyAttendanceData();
        this.message.add({
          severity: 'error',
          summary: 'خطأ',
          detail: err?.error?.error || 'خطأ في التحميل'
        });
      }
    });
  }

  askDailyMarkAbsent(p: { id: number; fullName: string }) {
    const isoDate = this.toIsoDateOnly(this.dailyDate);
    if (!this.dailyType || !isoDate) return;
    if (!this.canEditDailyAttendance()) return;
    this.dailyRemoveTarget = { id: p.id, fullName: p.fullName };
    this.showDailyRemoveConfirm = true;
  }

  cancelDailyRemove() {
    this.showDailyRemoveConfirm = false;
    this.dailyRemoveTarget = null;
    this.dailyRemoveSaving = false;
  }

  confirmDailyRemove() {
    const isoDate = this.toIsoDateOnly(this.dailyDate);
    if (!this.dailyType || !isoDate || !this.dailyRemoveTarget) return;
    const fam = this.dailyFamilyParam();
    this.dailyRemoveSaving = true;
    this.attendanceSvc.markAbsent(this.dailyRemoveTarget.id, isoDate, this.dailyType, fam).subscribe({
      next: () => {
        this.dailyRemoveSaving = false;
        this.cancelDailyRemove();
        this.message.add({ severity: 'success', summary: 'تم', detail: 'تم إلغاء الحضور وتسجيله غياب' });
        this.reloadDaily();
      },
      error: (err) => {
        this.dailyRemoveSaving = false;
        this.message.add({ severity: 'error', summary: 'خطأ', detail: err?.error?.error || 'خطأ في التحميل' });
      }
    });
  }

  // ===== Iftekad =====
  openIftekad(member: Member) {
    this.iftekadFor = member;
    this.iftekadDesc = '';
    this.iftekadCompanions = '';
    this.iftekadDate = null;

    this.editingVisitId = null;
    this.editVisitDate = null;
    this.editVisitDesc = '';
    this.editVisitCompanions = '';
    this.editSaving = false;

    this.loadIftekadHistory(member.id);
  }

  closeIftekad() {
    this.iftekadFor = null;
    this.iftekadDesc = '';
    this.iftekadCompanions = '';
    this.iftekadDate = null;
    this.iftekadSaving = false;

    this.iftekadHistory = [];
    this.iftekadHistoryLoading = false;

    this.editingVisitId = null;
    this.editVisitDate = null;
    this.editVisitDesc = '';
    this.editVisitCompanions = '';
    this.editSaving = false;
  }

  setIftekadToday() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    this.iftekadDate = new Date();
  }

  private loadIftekadHistory(memberId: number) {
    this.iftekadHistoryLoading = true;
    this.iftekadHistory = [];

    this.iftekadSvc.getVisits(memberId).subscribe({
      next: (rows) => {
        this.iftekadHistory = (rows || []) as IftekadVisitView[];
        this.iftekadHistoryLoading = false;
        this.refreshLastIftekadFromHistory();
      },
      error: () => {
        this.iftekadHistory = [];
        this.iftekadHistoryLoading = false;
        this.refreshLastIftekadFromHistory();
      }
    });
  }

  private refreshLastIftekadFromHistory() {
    if (!this.iftekadFor) return;
    const last = (this.iftekadHistory && this.iftekadHistory.length) ? this.iftekadHistory[0].visitDate : null;
    (this.iftekadFor as MemberWithIftekad).lastIftekadDate = last;
    const idx = this.members.findIndex((x) => x.id === this.iftekadFor!.id);
    if (idx >= 0) (this.members[idx] as MemberWithIftekad).lastIftekadDate = last;
  }

  needsIftekadAttention(member: Member): boolean {
    const s = String((member as MemberWithIftekad)?.lastIftekadDate || '').trim();
    if (!s) return true;

    const last = new Date(`${s}T00:00:00`);
    if (isNaN(last.getTime())) return true;

    const threshold = new Date();
    threshold.setHours(0, 0, 0, 0);
    threshold.setMonth(threshold.getMonth() - 3);
    return last.getTime() < threshold.getTime();
  }

  saveIftekad() {
    if (!this.iftekadFor) return;

    const visitDate = this.toIsoDateOnly(this.iftekadDate);
    if (!visitDate) {
      this.message.add({ severity: 'warn', summary: 'تنبيه', detail: 'اختار التاريخ أولاً' });
      return;
    }

    this.iftekadSaving = true;
    this.iftekadSvc
      .createVisit({
        memberId: this.iftekadFor.id,
        date: visitDate,
        description: this.iftekadDesc || undefined,
        companions: this.iftekadCompanions || undefined
      })
      .subscribe({
        next: (created: IftekadVisitRecord) => {
          (this.iftekadFor as MemberWithIftekad).lastIftekadDate = visitDate;
          const idx = this.members.findIndex((x) => x.id === this.iftekadFor!.id);
          if (idx >= 0) (this.members[idx] as MemberWithIftekad).lastIftekadDate = visitDate;

          if (created) {
            const row: IftekadVisitView = {
              id: created.id,
              memberId: created.memberId,
              visitDate: created.visitDate,
              description: created.description,
              companions: created.companions,
              createdAt: created.createdAt,
              recordedBy: created.recordedBy
            };
            this.iftekadHistory = [row, ...(this.iftekadHistory || [])];
          } else {
            this.loadIftekadHistory(this.iftekadFor!.id);
          }

          this.message.add({ severity: 'success', summary: 'تم', detail: 'تم تسجيل الافتقاد' });
          this.iftekadSaving = false;

          this.iftekadDesc = '';
          this.iftekadCompanions = '';
        },
        error: (err) => {
          this.iftekadSaving = false;
          this.message.add({ severity: 'error', summary: 'خطأ', detail: err?.error?.error || 'خطأ في الحفظ' });
        }
      });
  }

  startEditVisit(v: IftekadVisitView) {
    this.editingVisitId = v.id;
    this.editVisitDate = this.toDateValue(v.visitDate);
    this.editVisitDesc = (v.description || '') as string;
    this.editVisitCompanions = (v.companions || '') as string;
  }

  cancelEditVisit() {
    this.editingVisitId = null;
    this.editVisitDate = null;
    this.editVisitDesc = '';
    this.editVisitCompanions = '';
    this.editSaving = false;
  }

  saveEditVisit(v: IftekadVisitView) {
    if (!this.iftekadFor) return;

    const editDate = this.toIsoDateOnly(this.editVisitDate);
    if (!editDate) {
      this.message.add({ severity: 'warn', summary: 'تنبيه', detail: 'اختار التاريخ أولاً' });
      return;
    }

    this.editSaving = true;

    const expected = {
      date: editDate,
      description: (this.editVisitDesc || '').trim(),
      companions: (this.editVisitCompanions || '').trim()
    };

    this.iftekadSvc
      .updateVisit(v.id, {
        date: expected.date,
        description: expected.description || undefined,
        companions: expected.companions || undefined
      })
      .subscribe({
        next: () => {
          this.message.add({ severity: 'success', summary: 'تم', detail: 'تم تعديل الافتقاد' });
          this.editSaving = false;
          this.cancelEditVisit();
          this.loadIftekadHistory(this.iftekadFor!.id);
        },
        error: (err) => {
          this.verifyVisitUpdatedAfterError(v.id, expected, err);
        }
      });
  }
  private verifyVisitUpdatedAfterError(
  visitId: number,
  expected: { date: string; description: string; companions: string },
  originalErr: { error?: { error?: string }; message?: string } | null | undefined
) {
  if (!this.iftekadFor) {
    this.editSaving = false;
    this.message.add({ severity: 'error', summary: 'خطأ', detail: 'خطأ في التحديث' });
    return;
  }

  // نعمل Reload للسجل من الباك
  this.iftekadSvc.getVisits(this.iftekadFor.id).subscribe({
    next: (rows) => {
      this.iftekadHistory = (rows || []) as IftekadVisitView[];

      const found = (this.iftekadHistory || []).find((x) => x.id === visitId);

      const norm = (v: unknown) => String(v ?? '').trim();

      // ✅ لو لقينا نفس الزيارة ومتسجلة بالقيم الجديدة يبقى التعديل حصل فعلاً
      const ok =
        !!found &&
        norm(found.visitDate) === norm(expected.date) &&
        norm(found.description) === norm(expected.description) &&
        norm(found.companions) === norm(expected.companions);

      if (ok) {
        // ✅ التعديل حصل.. اعرض Success بدل Error
        this.message.add({ severity: 'success', summary: 'تم', detail: 'تم تعديل الافتقاد' });
        this.editSaving = false;
        this.cancelEditVisit();
        this.refreshLastIftekadFromHistory(); // علشان النقطة الحمرا
      } else {
        // ❌ فعلاً فشل
        this.editSaving = false;
        this.message.add({
          severity: 'error',
          summary: 'خطأ',
          detail: originalErr?.error?.error || originalErr?.message || 'خطأ في التحديث'
        });
      }
    },
    error: () => {
      this.editSaving = false;
      this.message.add({
        severity: 'error',
        summary: 'خطأ',
        detail: originalErr?.error?.error || originalErr?.message || 'خطأ في التحديث'
      });
    }
  });
}

  // ✅ open confirm dialog
  askDeleteVisit(v: IftekadVisitView) {
    this.visitToDelete = v;
    this.showDeleteConfirm = true;
    this.deleteSaving = false;
  }

  cancelDelete() {
    this.showDeleteConfirm = false;
    this.visitToDelete = null;
    this.deleteSaving = false;
  }

  confirmDelete() {
    if (!this.iftekadFor || !this.visitToDelete) return;

    this.deleteSaving = true;
    this.iftekadSvc.deleteVisit(this.visitToDelete.id).subscribe({
      next: () => {
        this.message.add({ severity: 'success', summary: 'تم', detail: 'تم مسح الافتقاد' });
        this.deleteSaving = false;
        this.showDeleteConfirm = false;
        this.visitToDelete = null;
        this.loadIftekadHistory(this.iftekadFor!.id);
      },
      error: (err) => {
        // ✅ Same parsing edge-case safeguard
        if (err && err.status === 200) {
          this.message.add({ severity: 'success', summary: 'تم', detail: 'تم مسح الافتقاد' });
          this.deleteSaving = false;
          this.showDeleteConfirm = false;
          this.visitToDelete = null;
          this.loadIftekadHistory(this.iftekadFor!.id);
          return;
        }

        this.deleteSaving = false;
        this.message.add({ severity: 'error', summary: 'خطأ', detail: err?.error?.error || 'خطأ في الحذف' });
      }
    });
  }

  formatRecordedAt(dateStr?: string): string {
    if (!dateStr) return '';

    let s = String(dateStr).trim();

    s = s.replace(/(\.\d{3})\d+/, '$1');

    const d = new Date(s);
    if (isNaN(d.getTime())) return dateStr;

    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();

    const minutes = String(d.getMinutes()).padStart(2, '0');

    const h24 = d.getHours();
    const ampmRaw = h24 >= 12 ? 'م' : 'ص';
    const LRM = '\u200E';
    const ampm = `${LRM}${ampmRaw}${LRM}`;
    const h12 = h24 % 12 || 12;

    return `${day}/${month}/${year} - ${h12}:${minutes} ${ampm}`;
  }

  // ===== Export =====
  async exportPdf() {
    // 1st click -> enter selection mode
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

      // Load Arabic-capable font (DejaVuSans) so Arabic text doesn't become garbled.
      // Keep direction LTR to avoid "mirrored" text.
      const selected = this.getSelectedMembers();
      if (!selected.length) {
        this.message.add({ severity: 'warn', summary: 'حدد الاعضاء', detail: ' اختر عضو واحد علي الافل' });
        return;
      }

      const famParam = this.canSelectFamily() ? this.selectedFamily : undefined;
      const detailsArr = await this.fetchDetailsForMembers(selected, famParam);
      const attArr = await this.fetchAttendanceForMembers(selected, famParam);

      const doc = new jsPDF({ orientation: 'landscape' });
      await ensureDejaVuFont(doc);
      const pdfText = createPdfText(doc, jsPDF);
      const pageRight = doc.internal.pageSize.getWidth() - 14;
      doc.setFontSize(14);
      doc.text(pdfText('تفاصيل حضور الأعضاء'), pageRight, 14, { align: 'right' });
      doc.setFontSize(10);

      let y = 20;
      for (let idx = 0; idx < selected.length; idx++) {
        const m = selected[idx];
        const d = (detailsArr[idx] || null) as ProfileView | null;
        const fam = this.assignmentsOf(d)[0]?.familyName || this.assignmentsOf(m)[0]?.familyName || '';
        const phone = d?.phoneNumber || '';
        const records = attArr[idx] || [];

        doc.setFontSize(12);
        doc.text(pdfText(`${m.fullName} (${this.roleAr(m.role)})`), pageRight, y, { align: 'right' });
        y += 6;
        doc.setFontSize(10);
        doc.text(pdfText(`الأسرة: ${fam}`), pageRight, y, { align: 'right' });
        doc.text(pdfText(`الهاتف: ${phone}`), pageRight - 110, y, { align: 'right' });
        y += 4;

        // Group by Type and merge the Type cell (rowSpan) so each type appears once.
        const body: any[] = [];
        if (records.length) {
          const sorted = [...records].sort((a, b) => {
            const t = (a.type || '').localeCompare(b.type || '');
            if (t !== 0) return t;
            return (a.date || '').localeCompare(b.date || '');
          });

          const groups = new Map<string, AttendanceRow[]>();
          sorted.forEach((r) => {
            const key = r.type || '';
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(r);
          });

          for (const [type, list] of groups) {
            list.forEach((r, i) => {
              // IMPORTANT: With rowSpan, subsequent rows must NOT include a placeholder cell
              // for the spanned column, otherwise cells shift into wrong columns.
              if (i === 0) {
                const typeCell = {
                  content: pdfText(this.titleForType(type as AttendanceRow['type'])),
                  rowSpan: list.length,
                  styles: { valign: 'middle', fontStyle: 'bold', font: 'DejaVu', halign: 'right' }
                };
                body.push([
                  typeCell,
                  pdfText(r.date || ''),
                  pdfText(this.statusAr(r.status)),
                  pdfText(this.formatRecordedAt(r.createdAt)),
                  r.takenBy?.fullName ? pdfText(`${r.takenBy.fullName}`) : ''
                ]);
              } else {
                body.push([
                  pdfText(r.date || ''),
                  pdfText(this.statusAr(r.status)),
                  pdfText(this.formatRecordedAt(r.createdAt)),
                  r.takenBy?.fullName ? pdfText(`${r.takenBy.fullName}`) : ''
                ]);
              }
            });
          }
        }

        autoTable(doc, {
          startY: y,
          head: [[pdfText('النوع'), pdfText('تاريخ المناسبة'), pdfText('الحالة'), pdfText('وقت التسجيل'), pdfText('المسجّل')]],
          body: body.length ? body : [['', '', '', '', '']],
          theme: 'grid',
          margin: { left: 14, right: 14 },
          tableWidth: doc.internal.pageSize.getWidth() - 28,
          tableLineColor: [120, 120, 120],
          tableLineWidth: 0.25,
          styles: {
            fontSize: 9,
            font: 'DejaVu',
            halign: 'right',
            lineColor: [145, 145, 145],
            lineWidth: 0.2
          },
          headStyles: {
            lineColor: [90, 90, 90],
            lineWidth: 0.3,
            textColor: [255, 255, 255]
          },
          bodyStyles: {
            lineColor: [150, 150, 150],
            lineWidth: 0.2
          },
          columnStyles: {
            0: { cellWidth: (doc.internal.pageSize.getWidth() - 28) * 0.24 },
            1: { cellWidth: (doc.internal.pageSize.getWidth() - 28) * 0.18 },
            2: { cellWidth: (doc.internal.pageSize.getWidth() - 28) * 0.12 },
            3: { cellWidth: (doc.internal.pageSize.getWidth() - 28) * 0.22 },
            4: { cellWidth: (doc.internal.pageSize.getWidth() - 28) * 0.24 }
          }
        });

        // @ts-ignore
        y = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 10 : y + 20;
        if (y > 180) {
          doc.addPage();
          y = 14;
        }
      }

      doc.save('members_attendance.pdf');

      this.exitExportMode();
    } catch {
      this.message.add({ severity: 'error', summary: 'خطأ ', detail: 'فشل في تحميل PDF' });
    }
  }
  cancelExport() {
    this.exitExportMode();
  }

  private exitExportMode() {
    this.exportMode = false;
    this.pendingExport = '';
    this.selectAll = false;
    this.members.forEach((m) => (m.selected = false));
  }
}

