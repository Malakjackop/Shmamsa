import { Component, OnInit, inject } from '@angular/core';
import { FamilyService } from '../services/family.service';
import { AuthService, AuthUser } from '../services/auth.service';
import { MessageService } from 'primeng/api';
import { AttendanceService, type AttendanceType, type DailyAttendanceResponse, type AttendanceCustomEvent } from '../services/attendance.service';
import { IftekadService, type IftekadVisitRecord } from '../services/iftekad.service';
import { normalizeAssignmentRole, normalizeRole, roleLabel } from '../shared/role-utils';
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

  // choir membership
  attendKhors?: string;
  khors?: string;
  khorsYear?: number | null;
  servingScope?: string;

  // iftekad
  lastIftekadDate?: string | null;

  // phone
  phoneNumber?: string;
  guardiansPhone?: string;

  // attendance counts
  fridayLiturgy: number;
  tasbeeha: number;
  familyMeeting: number;

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
  customTitle?: string;
  title?: string;
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
type DailyEventItem = {
  key: string;
  type: AttendanceType;
  label: string;
  customEventId?: number;
  dayOfWeek: number;
};

type DetailsDisplayItem = {
  type: AttendanceRow['type'];
  label: string;
  customTitle?: string;
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
    'FAMILY_MEETING',
    'CUSTOM_EVENT'
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
  detailsType = '';
  detailsCustomTitle: string | null = null;
  expandedDetailsItem: string | null = null;
  allCustomEvents: AttendanceCustomEvent[] = [];

  profileFor: Member | null = null;
  profile: ProfileView | null = null;
  familyInfoFields: CustomField[] = [];
  familyInfoFieldsLoaded = false;

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
  dailyMinDate: Date | null = null;
  familyCustomEvents: AttendanceCustomEvent[] = [];
  availableDailyCustomEvents: AttendanceCustomEvent[] = [];
  selectedDailyCustomEventId: number | '' = '';

  dailyEvents: DailyEventItem[] = [];
  dailySelectedEventKey = '';
  dailyDisabledDates: Date[] = [];
  dailyCancelledFamilies: string[] = [];
  private scheduleDays: Record<string, Partial<Record<AttendanceType, number[]>>> = {};
  private scheduleTimes: Record<string, Partial<Record<AttendanceType, Record<string, string>>>> = {};
  private scheduleCreatedDates: Record<string, Partial<Record<AttendanceType, Record<string, string>>>> = {};

  // schedule management within daily modal
  showDailyScheduleSection = false;
  scheduleSaving = false;
  scheduleItems: any[] = [];
  scheduleForm: { familyBase: string; type: AttendanceType; dayOfWeek: number; time: Date | null } = {
    familyBase: '',
    type: 'FRIDAY_LITURGY',
    dayOfWeek: 5,
    time: null
  };
  readonly scheduleTypeOptions: { value: AttendanceType; label: string }[] = [
    { value: 'FRIDAY_LITURGY', label: 'قداس الجمعة' },
    { value: 'TASBEEHA', label: 'تسبحة' },
    { value: 'FAMILY_MEETING', label: 'اجتماع الأسرة' },
    { value: 'MARMARKOS_KHORS', label: 'خورس مارمرقس' },
    { value: 'ATHANASIUS_KHORS', label: 'خورس البابا اثناسيوس' },
  ];
  readonly scheduleDayOptions: { value: number; label: string }[] = [
    { value: 0, label: 'الأحد' },
    { value: 1, label: 'الاثنين' },
    { value: 2, label: 'الثلاثاء' },
    { value: 3, label: 'الأربعاء' },
    { value: 4, label: 'الخميس' },
    { value: 5, label: 'الجمعة' },
    { value: 6, label: 'السبت' },
  ];

  // edit attendance record date
  editingAttendanceId: number | null = null;
  editingAttendanceDate: Date | null = null;
  editingAttendanceSaving = false;

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

  // cancel day
  showCancelDayConfirm = false;
  dailyCancelSaving = false;
  dailyCancelFamilies: string[] = [];
  dailyCancelSelectedFamilies = new Set<string>();
  dailyCancelAllSelected = false;
  dailyCancelEventLabel = '';

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
    return this.hasAminKhedmaPrivilege() || normalizeRole(this.me?.role) === 'DEVELOPER';
  }

  isKhadim(): boolean {
    return normalizeRole(this.me?.role) === 'KHADIM';
  }

  private hasScopedAssignmentRole(role: 'AMIN_OSRA' | 'AMIN_KHEDMA'): boolean {
    return this.assignmentsOf(this.me).some((assignment) => assignment.role === role);
  }

  private hasAminOsraPrivilege(): boolean {
    return normalizeRole(this.me?.role) === 'AMIN_OSRA' || this.hasScopedAssignmentRole('AMIN_OSRA');
  }

  private hasAminKhedmaPrivilege(): boolean {
    return normalizeRole(this.me?.role) === 'AMIN_KHEDMA' || this.hasScopedAssignmentRole('AMIN_KHEDMA');
  }

  private canOverrideDailyAttendanceDateRestriction(): boolean {
    return this.hasAminOsraPrivilege() || this.isAminKhedmaOrDev();
  }

  get dailyDisabledWeekDays(): number[] {
    return this.canOverrideDailyAttendanceDateRestriction() ? [] : [0, 1, 2, 3];
  }

  private mainFamily(name: string): string {
    if (!name) return '';
    const f = String(name).trim();
    if (f.endsWith(' أ')) return f.slice(0, -2).trim();
    if (f.endsWith(' ب')) return f.slice(0, -2).trim();
    return f;
  }

  private hasAminOsraScopeForFamily(family: string): boolean {
    const target = this.mainFamily(String(family || '').trim()).toUpperCase();
    if (!target) return false;
    const scopedAssignments = this.assignmentsOf(this.me).filter((x) => x.role === 'AMIN_OSRA');
    if (scopedAssignments.length) {
      return scopedAssignments.some((x) =>
        this.mainFamily(String(x.familyName || '').trim()).toUpperCase() === target
      );
    }
    if (!this.hasAminOsraPrivilege()) return false;
    return this.assignmentsOf(this.me).some((x) =>
      x.role === 'AMIN_OSRA' && this.mainFamily(String(x.familyName || '').trim()).toUpperCase() === target
    ) || this.mainFamily(this.familyLabel(this.me)).toUpperCase() === target;
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
    this.detailsCustomTitle = null;
    this.expandedDetailsItem = null;
    this.loadCustomEventsForDetails();
    this.reloadDetails();
  }

  private loadCustomEventsForDetails(): void {
    const famParam = this.canSelectFamily() ? this.selectedFamily : undefined;
    this.attendanceSvc.listCustomEvents(famParam).subscribe({
      next: (events) => { this.allCustomEvents = events || []; },
      error: () => { this.allCustomEvents = []; }
    });
  }

  toggleDetailsSection(item: DetailsDisplayItem): void {
    const key = this.itemKey(item);
    this.expandedDetailsItem = this.expandedDetailsItem === key ? null : key;
  }

  isExpanded(item: DetailsDisplayItem): boolean {
    return this.expandedDetailsItem === this.itemKey(item);
  }

  private itemKey(item: DetailsDisplayItem): string {
    return item.customTitle ? `CUSTOM_EVENT:${item.customTitle}` : item.type;
  }

  uniqueCustomEventTitles(): string[] {
    const titles = new Set<string>();
    for (const event of this.allCustomEvents) {
      if (event.title) titles.add(event.title);
    }
    for (const d of this.details || []) {
      if (d.type === 'CUSTOM_EVENT' && d.customTitle) {
        titles.add(d.customTitle);
      }
    }
    return [...titles];
  }

reloadDetails(): void {
    if (!this.detailsFor) return;

    let apiType: string | undefined;
    this.detailsCustomTitle = null;

    if (this.detailsType?.startsWith('CUSTOM_EVENT:')) {
      this.detailsCustomTitle = this.detailsType.replace('CUSTOM_EVENT:', '');
      apiType = 'CUSTOM_EVENT';
    } else if (this.detailsType) {
      if (!this.isAttendanceTypeAllowedForMember(this.detailsFor, this.detailsType as AttendanceType)) {
        this.detailsType = '';
        return this.reloadDetails();
      }
      apiType = this.detailsType;
    }

    const famParam = this.canSelectFamily() ? this.selectedFamily : undefined;
    this.familySvc.memberAttendance(this.detailsFor.id, famParam, apiType).subscribe({
      next: (d) => {
        let rows = this.mapAttendanceRows(d || []);
        if (this.detailsCustomTitle) {
          rows = rows.filter((r) => r.type === 'CUSTOM_EVENT' && r.customTitle === this.detailsCustomTitle);
        }
        this.details = rows;
      },
      error: () => (this.details = [])
    });
  }

  private mapAttendanceRows(rows: any[]): AttendanceRow[] {
    return (Array.isArray(rows) ? rows : [])
      .filter((r) => !this.isArchivedRow(r))
      .map((row) => ({
        id: Number(row?.id ?? row?.attendanceId ?? 0),
        type: String(row?.type ?? row?.attendanceType ?? 'FAMILY_MEETING') as AttendanceType,
        date: String(row?.date ?? row?.attendanceDate ?? row?.day ?? ''),
        time: row?.time ? String(row.time) : row?.attendanceTime ? String(row.attendanceTime) : undefined,
        createdAt: row?.createdAt ? String(row.createdAt) : undefined,
        status: row?.status === 'ABSENT' ? 'ABSENT' : row?.status === 'PRESENT' ? 'PRESENT' : undefined,
        takenBy: row?.takenBy && typeof row.takenBy === 'object'
          ? {
              id: Number(row.takenBy.id ?? 0),
              fullName: String(row.takenBy.fullName ?? ''),
              role: String(row.takenBy.role ?? '')
            }
          : null,
        customTitle: String(row?.customTitle ?? row?.title ?? '').trim() || undefined,
        title: String(row?.title ?? row?.customTitle ?? '').trim() || undefined
      }));
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

  memberPhone(m: Member): string {
    return String(m.phoneNumber || m.guardiansPhone || '').trim();
  }

  attendanceStatusText(m: Member, kind: 'FRIDAY_LITURGY' | 'MARMARKOS_KHORS' | 'ATHANASIUS_KHORS' | 'TASBEEHA' | 'FAMILY_MEETING'): string {
    const label = this.titleForType(kind);
    const count = this.countLabel(m, kind);
    return `${label}: ${count}`;
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
    if (t === 'CUSTOM_EVENT') return 'مناسبة مخصصة';
    return 'اجتماع الأسرة';
  }

  attendanceRowLabel(row: AttendanceRow): string {
    if (row.type === 'CUSTOM_EVENT') {
      return String(row.customTitle || row.title || '').trim() || 'مناسبة مخصصة';
    }
    return this.titleForType(row.type);
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

  detailsDisplayItems(): DetailsDisplayItem[] {
    const items: DetailsDisplayItem[] = [];
    const allowed = this.visibleAttendanceTypes();

    for (const t of allowed) {
      if (t === 'CUSTOM_EVENT') continue;
      items.push({ type: t, label: this.titleForType(t) });
    }

    const usedTitles = new Set(
      (this.details || [])
        .filter(d => d.type === 'CUSTOM_EVENT')
        .map(d => d.customTitle || '')
        .filter(Boolean)
    );

    const allCustomTitles = new Set<string>();
    for (const event of this.allCustomEvents) {
      if (event.title) allCustomTitles.add(event.title);
    }
    for (const t of usedTitles) {
      allCustomTitles.add(t);
    }

    for (const title of allCustomTitles) {
      items.push({ type: 'CUSTOM_EVENT', label: title, customTitle: title });
    }

    return items;
  }

  filteredDetails(t: AttendanceRow['type']): AttendanceRow[] {
    return (this.details || []).filter((d) => d?.type === t);
  }

  filteredDetailsForItem(item: DetailsDisplayItem): AttendanceRow[] {
    return (this.details || []).filter((d) => {
      if (d.type !== item.type) return false;
      if (item.customTitle) return d.customTitle === item.customTitle;
      return true;
    });
  }

  trackByMember(_: number, m: Member): number {
    return m.id;
  }

  toggleMemberSelection(m: Member) {
    m.selected = !m.selected;
    this.onMemberSelectionChange();
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
      { label: 'اسم المستخدم', value: String(p.username ?? '').trim(), fieldKeys: ['username'] },
      { label: 'البريد الإلكتروني', value: String(p.email ?? '').trim(), fieldKeys: ['email'] },
      { label: 'الأسرة', value: this.familyLabel(p), fieldKeys: ['deaconFamily'] },
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

  private clearDailyAttendanceData(): void {
    this.dailyLoading = false;
    this.dailyPresent = [];
    this.dailyAbsent = [];
    this.dailyTotal = 0;
    this.dailyPresentCount = 0;
    this.dailyAbsentCount = 0;
    this.dailyRecordsCount = 0;
    this.availableDailyCustomEvents = [];
    this.selectedDailyCustomEventId = '';
    this.showDailyRemoveConfirm = false;
    this.dailyRemoveTarget = null;
    this.dailyRemoveSaving = false;
  }

  // ===== Daily attendance (حضور اليوم) =====

  canEditDailyAttendance(): boolean {
    return this.isKhadim() || this.hasAminOsraPrivilege() || this.isAminKhedmaOrDev();
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

    if (this.canOverrideDailyAttendanceDateRestriction()) return true;

    // يسمح فقط بالخميس والجمعة والسبت
    const day = d.getDay(); // 4 الخميس - 5 الجمعة - 6 السبت
    return day === 4 || day === 5 || day === 6;
  }

  private scheduleDaysForType(t: AttendanceType, family?: string): number[] {
    const base = family || this.dailyFamilyParam() || '';
    return this.scheduleDays?.[base]?.[t] || [];
  }

  private dayOfWeekForType(t: AttendanceType): number {
    if (t === 'FRIDAY_LITURGY' || t === 'MARMARKOS_KHORS' || t === 'ATHANASIUS_KHORS') return 5;
    if (t === 'TASBEEHA') return 6;
    if (t === 'FAMILY_MEETING') return 4;
    return 5;
  }

  buildDailyEvents(): void {
    const items: DailyEventItem[] = [];
    const types = this.dailyTypeOptions();
    const family = this.dailyFamilyParam() || '';

    for (const t of types) {
      if (t === 'CUSTOM_EVENT') {
        for (const ce of this.availableDailyCustomEvents) {
          items.push({
            key: `CUSTOM_EVENT:${ce.id}`,
            type: 'CUSTOM_EVENT',
            label: ce.title || '',
            customEventId: ce.id,
            dayOfWeek: Number(ce.dayOfWeek ?? 5)
          });
        }
      } else {
        const scheduleDays = this.scheduleDays?.[family]?.[t];
        if (!scheduleDays || !scheduleDays.length) continue;
        items.push({
          key: t,
          type: t,
          label: this.dailyTypeLabel(t),
          dayOfWeek: this.dayOfWeekForType(t)
        });
      }
    }
    this.dailyEvents = items;
    if (items.length && !this.dailySelectedEventKey) {
      this.onDailyEventSelect(items[0].key);
    } else if (!items.length) {
      this.dailySelectedEventKey = '';
      this.dailyType = null;
      this.dailyDate = null;
      this.clearDailyAttendanceData();
    }
  }

  onDailyEventSelect(key: string): void {
    this.dailySelectedEventKey = key;
    const event = this.dailyEvents.find(e => e.key === key);
    if (!event) return;

    this.dailyType = event.type;
    if (event.type === 'CUSTOM_EVENT') {
      this.selectedDailyCustomEventId = event.customEventId ?? '';
    } else {
      this.selectedDailyCustomEventId = '';
    }
    this.selectedDailyCustomEventId = event.customEventId ?? '';

    this.dailyDisabledDates = this.buildDisabledDatesForEvent(event);
    this.dailyMinDate = this.computeDailyMinDate(event.type);
    this.dailyDate = null;
    this.clearDailyAttendanceData();
    this.loadCancelledDatesForRange(event.type);
  }

  private computeDailyMinDate(type: AttendanceType | null): Date | null {
    if (!type || type === 'CUSTOM_EVENT') return null;
    const family = this.dailyFamilyParam() || '';
    if (!family) return null;
    const dates = this.scheduleCreatedDates?.[family]?.[type] || {};
    const dateValues = Object.values(dates).filter(Boolean) as string[];
    if (!dateValues.length) return null;
    return dateValues.reduce((min, d) => {
      const dt = new Date(d + 'T00:00:00');
      return dt < min ? dt : min;
    }, new Date(dateValues[0] + 'T00:00:00'));
  }

  private buildDisabledDatesForEvent(event: DailyEventItem): Date[] {
    const disabled: Date[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setFullYear(start.getFullYear() - 1);

    const family = this.dailyFamilyParam() || '';
    const hasAnySchedules = Object.keys(this.scheduleDays || {}).length > 0;
    const scheduleDays = event.type === 'CUSTOM_EVENT'
      ? (event.dayOfWeek != null ? [event.dayOfWeek] : [])
      : this.scheduleDaysForType(event.type, family);

    const allowedDays = scheduleDays.length > 0
      ? scheduleDays
      : (hasAnySchedules ? [] : [event.dayOfWeek]);

    const scheduleCreated = this.scheduleCreatedDates?.[family]?.[event.type] || {};

    const cursor = new Date(start);
    while (cursor <= today) {
      if (!allowedDays.includes(cursor.getDay())) {
        disabled.push(new Date(cursor));
      } else {
        const createdDateStr = scheduleCreated[String(cursor.getDay())];
        if (createdDateStr) {
          const createdDate = new Date(createdDateStr + 'T00:00:00');
          createdDate.setHours(0, 0, 0, 0);
          if (cursor < createdDate) {
            disabled.push(new Date(cursor));
          }
        }
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    const now = new Date();
    const todayDow = today.getDay();
    if (allowedDays.includes(todayDow)) {
      const scheduleTimeStr = this.scheduleTimes?.[family]?.[event.type]?.[String(todayDow)];
      if (scheduleTimeStr) {
        const [h, m] = scheduleTimeStr.split(':').map(Number);
        const scheduleDt = new Date(today);
        scheduleDt.setHours(h, m, 0, 0);
        if (now < scheduleDt) {
          disabled.push(new Date(today));
        }
      }
    }

    return disabled;
  }

  private loadScheduleData(): void {
    this.attendanceSvc.context().subscribe({
      next: (ctx) => {
        this.scheduleDays = ctx.scheduleDays || {};
        this.scheduleTimes = ctx.scheduleTimes || {};
        this.scheduleCreatedDates = ctx.scheduleCreatedDates || {};
        this.dailyMinDate = this.computeDailyMinDate(this.dailyType);
        this.buildDailyEvents();
      },
      error: () => {
        this.scheduleDays = {};
        this.scheduleTimes = {};
        this.scheduleCreatedDates = {};
      }
    });
  }

  private loadCancelledDatesForRange(type: AttendanceType, family?: string): void {
    if (type === 'CUSTOM_EVENT') return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setFullYear(start.getFullYear() - 1);

    const from = this.toIsoDateOnly(start);
    const to = this.toIsoDateOnly(today);

    this.attendanceSvc.getCancelledDatesInRange(from, to, type, family || this.dailyFamilyParam()).subscribe({
      next: (res) => {
        const cancelledDates = (res.dates || []).map((d) => {
          const dt = new Date(d + 'T00:00:00');
          dt.setHours(0, 0, 0, 0);
          return dt;
        });
        const added = cancelledDates.filter(cd => !this.dailyDisabledDates.some(dd => dd.getTime() === cd.getTime()));
        if (added.length) {
          this.dailyDisabledDates = [...this.dailyDisabledDates, ...added];
        }
      },
      error: () => {}
    });
  }

  // ===== Schedule management within daily modal =====
  openDailyScheduleSection(): void {
    this.showDailyScheduleSection = !this.showDailyScheduleSection;
    if (this.showDailyScheduleSection) {
      const family = this.dailyFamilyParam() || '';
      this.scheduleForm.familyBase = family;
      this.scheduleForm.type = 'FRIDAY_LITURGY';
      this.scheduleForm.dayOfWeek = 5;
      this.scheduleForm.time = null;
      this.loadScheduleItems();
    }
  }

  private loadScheduleItems(): void {
    const base = this.scheduleForm.familyBase;
    if (!base) {
      this.scheduleItems = [];
      return;
    }
    this.attendanceSvc.getSchedules(base).subscribe({
      next: (list: any[]) => {
        this.scheduleItems = list || [];
      },
      error: () => {
        this.scheduleItems = [];
      }
    });
  }

  addSchedule(): void {
    const base = this.scheduleForm.familyBase;
    if (!base) return;

    this.scheduleSaving = true;
    const timeStr = this.scheduleForm.time
      ? `${String(this.scheduleForm.time.getHours()).padStart(2, '0')}:${String(this.scheduleForm.time.getMinutes()).padStart(2, '0')}`
      : undefined;
    this.attendanceSvc.createSchedule({
      familyBase: base,
      type: this.scheduleForm.type,
      dayOfWeek: this.scheduleForm.dayOfWeek,
      time: timeStr
    }).subscribe({
      next: () => {
        this.scheduleSaving = false;
        this.loadScheduleItems();
        this.refreshDailyScheduleData();
      },
      error: () => {
        this.scheduleSaving = false;
      }
    });
  }

  deleteSchedule(s: any): void {
    if (!s.id) return;
    this.attendanceSvc.deleteSchedule(s.id).subscribe({
      next: () => {
        this.loadScheduleItems();
        this.refreshDailyScheduleData();
      },
      error: () => {}
    });
  }

  private refreshDailyScheduleData(): void {
    this.attendanceSvc.context().subscribe({
      next: (ctx) => {
        this.scheduleDays = ctx.scheduleDays || {};
        this.scheduleTimes = ctx.scheduleTimes || {};
        this.scheduleCreatedDates = ctx.scheduleCreatedDates || {};
        this.dailyMinDate = this.computeDailyMinDate(this.dailyType);
        this.buildDailyEvents();
      },
      error: () => {}
    });
  }

  scheduleTypeLabel(t: string): string {
    const opt = this.scheduleTypeOptions.find(o => o.value === t);
    return opt ? opt.label : t;
  }

  scheduleDayLabel(day: number): string {
    const opt = this.scheduleDayOptions.find(d => d.value === day);
    return opt ? opt.label : String(day);
  }

  // ===== Edit attendance record date =====
  startEditAttendanceDate(record: AttendanceRow): void {
    this.editingAttendanceId = record.id;
    this.editingAttendanceDate = new Date(record.date + 'T00:00:00');
    this.editingAttendanceSaving = false;
  }

  cancelEditAttendanceDate(): void {
    this.editingAttendanceId = null;
    this.editingAttendanceDate = null;
    this.editingAttendanceSaving = false;
  }

  saveEditAttendanceDate(): void {
    if (!this.editingAttendanceId || !this.editingAttendanceDate) return;
    const newDate = this.toIsoDateOnly(this.editingAttendanceDate);
    if (!newDate) return;
    this.editingAttendanceSaving = true;
    this.attendanceSvc.updateAttendanceDate(this.editingAttendanceId, newDate).subscribe({
      next: () => {
        this.editingAttendanceSaving = false;
        this.cancelEditAttendanceDate();
        this.reloadDetails();
        this.message.add({ severity: 'success', summary: 'تم', detail: 'تم تعديل التاريخ' });
      },
      error: (err) => {
        this.editingAttendanceSaving = false;
        this.message.add({
          severity: 'error',
          summary: 'خطأ',
          detail: err?.error?.error || 'خطأ في تعديل التاريخ'
        });
      }
    });
  }

  openDailyAttendance() {
    this.showDaily = true;
    this.dailyDate = null;
    this.dailyType = null;
    this.dailySelectedEventKey = '';
    this.dailyEvents = [];
    this.dailyDisabledDates = [];
    this.dailyMaxDate = this.buildDailyMaxDate();
    this.clearDailyAttendanceData();
    this.loadScheduleData();
    this.loadFamilyCustomEvents();
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

  private loadFamilyCustomEvents(): void {
    const familyBase = this.dailyFamilyParam();
    if (!familyBase) {
      this.familyCustomEvents = [];
      this.refreshDailyCustomEvents();
      return;
    }

    this.attendanceSvc.listCustomEvents(familyBase).subscribe({
      next: (events) => {
        this.familyCustomEvents = (events || []).filter((event) => this.canManageCustomEvent(event));
        this.refreshDailyCustomEvents();
        this.buildDailyEvents();
      },
      error: () => {
        this.familyCustomEvents = [];
        this.refreshDailyCustomEvents();
        this.buildDailyEvents();
      }
    });
  }

  private canManageCustomEvent(event: AttendanceCustomEvent | null | undefined): boolean {
    if (!event) return false;
    if (this.isAminKhedmaOrDev()) return true;

    const myId = Number(this.me?.['id'] || 0);
    if (Number(event.createdById || 0) === myId) return true;
    if (Number(event.permittedEditorId || 0) === myId) return true;
    if ((event.permittedEditorIds || []).includes(myId)) return true;
    if ((event.permittedEditors || []).some((editor) => Number(editor?.id || 0) === myId)) return true;

    const familyBase = String(event.familyBase || this.dailyFamilyParam() || '').trim();
    return this.hasAminOsraScopeForFamily(familyBase);
  }

  private refreshDailyCustomEvents(): void {
    const selectedDate = this.toDateValue(this.dailyDate);
    const dayOfWeek = selectedDate?.getDay();
    const currentId = Number(this.selectedDailyCustomEventId || 0);

    this.availableDailyCustomEvents = (this.familyCustomEvents || []).filter((event) => {
      if (!event || event.enabled === false) return false;
      if (dayOfWeek === undefined || dayOfWeek === null) return true;
      return Number(event.dayOfWeek) === dayOfWeek;
    });

    const currentStillAvailable = this.availableDailyCustomEvents.some((event) => Number(event.id || 0) === currentId);
    this.selectedDailyCustomEventId = currentStillAvailable ? currentId : (this.availableDailyCustomEvents[0]?.id || '');
  }

  selectedDailyCustomEvent(): AttendanceCustomEvent | null {
    const id = Number(this.selectedDailyCustomEventId || 0);
    if (!id) return null;
    return this.availableDailyCustomEvents.find((event) => Number(event.id || 0) === id) || null;
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
    if (this.availableDailyCustomEvents.length) {
      base.push('CUSTOM_EVENT');
    }
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
    if (t === 'CUSTOM_EVENT') return 'مناسبة مخصصة';
    return t;
  }

  onDailyDateChange() {
    this.reloadDaily();
  }

  reloadDaily() {
    if (!this.showDaily) return;

    const isoDate = this.toIsoDateOnly(this.dailyDate);

    if (!this.dailyDate || !this.dailyType || !isoDate) {
      this.clearDailyAttendanceData();
      return;
    }

    const customTitle = this.dailyType === 'CUSTOM_EVENT'
      ? String(this.selectedDailyCustomEvent()?.title || '').trim()
      : undefined;

    if (this.dailyType === 'CUSTOM_EVENT' && !customTitle) {
      this.clearDailyAttendanceData();
      this.message.add({
        severity: 'warn',
        summary: 'تنبيه',
        detail: 'اختر المناسبة المخصصة أولًا.'
      });
      return;
    }

    this.dailyLoading = true;
    const fam = this.dailyFamilyParam();

    this.attendanceSvc.daily(isoDate, this.dailyType, fam, customTitle).subscribe({
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

        this.loadDailyCancellations(isoDate);
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

  private loadDailyCancellations(isoDate: string) {
    if (!this.dailyType) return;
    this.attendanceSvc.getCancellations(isoDate, this.dailyType).subscribe({
      next: (res) => {
        this.dailyCancelledFamilies = res?.cancellations || [];
      },
      error: () => {
        this.dailyCancelledFamilies = [];
      }
    });
  }

  askDailyMarkAbsent(p: { id: number; fullName: string }) {
    const isoDate = this.toIsoDateOnly(this.dailyDate);
    if (!this.dailyType || !isoDate) return;
    if (!this.canEditDailyAttendance()) return;
    if (this.dailyType === 'CUSTOM_EVENT' && !this.selectedDailyCustomEvent()) return;
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
    const customTitle = this.dailyType === 'CUSTOM_EVENT'
      ? String(this.selectedDailyCustomEvent()?.title || '').trim()
      : undefined;
    this.dailyRemoveSaving = true;
    this.attendanceSvc.markAbsent(this.dailyRemoveTarget.id, isoDate, this.dailyType, fam, customTitle).subscribe({
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

  // ===== Cancel day =====
  onCancelDayClick() {
    const isoDate = this.toIsoDateOnly(this.dailyDate);
    if (!this.dailyType || !isoDate) return;

    const event = this.dailyEvents.find(e => e.key === this.dailySelectedEventKey);
    this.dailyCancelEventLabel = event?.label || this.dailyType;

    const isGlobal = this.isAminKhedmaOrDev();

    if (isGlobal) {
      // Service coordinator: show family list
      this.familySvc.families().subscribe({
        next: (list) => {
          this.dailyCancelFamilies = list;
          this.dailyCancelSelectedFamilies = new Set(list);
          this.dailyCancelAllSelected = true;
          this.showCancelDayConfirm = true;
        },
        error: () => {
          this.message.add({
            severity: 'error',
            summary: 'خطأ',
            detail: 'فشل تحميل قائمة العائلات'
          });
        }
      });
    } else {
      // Family coordinator: just their own family
      const raw = this.assignmentsOf(this.me)[0]?.familyName || '';
      const myFamily = this.mainFamily(raw);
      this.dailyCancelFamilies = myFamily ? [myFamily] : [];
      this.dailyCancelSelectedFamilies = new Set(myFamily ? [myFamily] : []);
      this.dailyCancelAllSelected = true;
      this.showCancelDayConfirm = true;
    }
  }

  onCancelSelectAll(event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    this.dailyCancelAllSelected = checked;
    if (checked) {
      this.dailyCancelSelectedFamilies = new Set(this.dailyCancelFamilies);
    } else {
      this.dailyCancelSelectedFamilies = new Set();
    }
  }

  onCancelFamilyToggle(family: string) {
    if (this.dailyCancelSelectedFamilies.has(family)) {
      this.dailyCancelSelectedFamilies.delete(family);
    } else {
      this.dailyCancelSelectedFamilies.add(family);
    }
    this.dailyCancelAllSelected = this.dailyCancelFamilies.length > 0
      && this.dailyCancelFamilies.every(f => this.dailyCancelSelectedFamilies.has(f));
  }

  cancelCancelDay() {
    this.showCancelDayConfirm = false;
    this.dailyCancelSaving = false;
    this.dailyCancelFamilies = [];
    this.dailyCancelSelectedFamilies = new Set();
    this.dailyCancelAllSelected = false;
    this.dailyCancelledFamilies = [];
  }

  confirmCancelDay() {
    const isoDate = this.toIsoDateOnly(this.dailyDate);
    if (!this.dailyType || !isoDate) return;

    const families = Array.from(this.dailyCancelSelectedFamilies).filter(f => f);
    if (!families.length) {
      this.message.add({ severity: 'warn', summary: 'تنبيه', detail: 'اختر عائلة واحدة على الأقل' });
      return;
    }

    this.dailyCancelSaving = true;
    this.attendanceSvc.cancelDay(isoDate, this.dailyType, families).subscribe({
      next: () => {
        this.dailyCancelSaving = false;
        this.dailyCancelledFamilies = families;
        this.cancelCancelDay();
        this.clearDailyAttendanceData();
        this.message.add({ severity: 'success', summary: 'تم', detail: 'تم إلغاء هذا اليوم بنجاح' });
      },
      error: (err) => {
        this.dailyCancelSaving = false;
        this.message.add({
          severity: 'error',
          summary: 'خطأ',
          detail: err?.error?.error || 'فشل إلغاء هذا اليوم'
        });
      }
    });
  }

  undoCancelDay() {
    const isoDate = this.toIsoDateOnly(this.dailyDate);
    if (!this.dailyType || !isoDate) return;

    this.dailyCancelSaving = true;
    this.attendanceSvc.undoCancelDay(isoDate, this.dailyType, [...this.dailyCancelledFamilies]).subscribe({
      next: () => {
        this.dailyCancelSaving = false;
        this.dailyCancelledFamilies = [];
        this.message.add({ severity: 'success', summary: 'تم', detail: 'تم إلغاء الإلغاء بنجاح' });
        this.reloadDaily();
      },
      error: (err) => {
        this.dailyCancelSaving = false;
        this.message.add({
          severity: 'error',
          summary: 'خطأ',
          detail: err?.error?.error || 'فشل إلغاء الإلغاء'
        });
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

