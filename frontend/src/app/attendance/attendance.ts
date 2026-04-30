import { Component, OnDestroy, OnInit, inject, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
  AttendanceService,
  AttendanceType,
  AttendanceContext,
  AttendanceAccessGrant,
  AttendanceConfig,
  AttendanceCustomEvent
} from '../services/attendance.service';
import { AuthService } from '../services/auth.service';
import { FamilyService } from '../services/family.service';
import { MessageService } from 'primeng/api';
import { assignmentRolesOf, normalizeAssignmentRole, normalizeRole, roleLabel } from '../shared/role-utils';
import { DEFAULT_FAMILY_ORDER, canonicalFamilyName, sortFamiliesByPreferredOrder } from '../shared/family-utils';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

type PickUser = {
  id: number;
  username?: string;
  fullName: string;
  role?: string;
  roleCode?: number;
  familyName?: string;
  deaconFamily?: string;
  familyAssignments?: Array<{ familyId?: number; familyName?: string; roleCode?: number; role?: string; assignmentOrder?: number }>;
};

type GrantAudience = 'SERVANTS' | 'MEMBERS';
type TypeDaysMap = Partial<Record<AttendanceType, number[]>>;
type GrantPopupFilter = 'ALL' | 'SERVANTS_SCOPE' | 'MEMBERS_SCOPE';
type GrantTypeStatus = {
  type: AttendanceType;
  label: string;
  state: 'open' | 'upcoming' | 'ended' | 'closed';
  note: string;
  rangeText: string;
  countdownText: string;
  icon: string;
};
type TypeOption = {
  value: string;
  type: AttendanceType;
  label: string;
  disabled?: boolean;
  customEventId?: number;
};
type GrantOccasionOption = {
  key: string;
  type: AttendanceType;
  label: string;
  days: number[];
  customEventId?: number;
};
type GrantDayWindow = {
  day: number;
  startsAt: Date | null;
  endsAt: Date | null;
};
type GrantSavedSummary = {
  id: string;
  sourceGrant?: AttendanceAccessGrant;
  sourceGrants?: AttendanceAccessGrant[];
  targetNames: string;
  typeLabel: string;
  dayLabel: string;
  windowText: string;
  note?: string | null;
};
type GrantGroup = {
  key: string;
  grants: AttendanceAccessGrant[];
  first: AttendanceAccessGrant;
  targetNames: string;
  notes: string[];
};
type CustomEventForm = Partial<AttendanceCustomEvent> & {
  familyBase: string;
  title: string;
  dayOfWeek: number;
  enabled: boolean;
  alwaysActive: boolean;
  permittedEditorIds: number[];
};

@Component({
  selector: 'app-attendance',
  standalone: false,
  templateUrl: './attendance.html',
  styleUrls: ['./attendance.css'],
  providers: [MessageService]
})
export class AttendanceComponent implements OnInit, OnDestroy {
  private attendance = inject(AttendanceService);
  private auth = inject(AuthService);
  private familySvc = inject(FamilyService);
  private message = inject(MessageService);

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {}

  me: any;
  attendanceContext: AttendanceContext | null = null;

  scanning = false;
  selectedDate: Date | null = null;
  minDate!: Date;
  maxDate!: Date;
  disabledDays: number[] = [0, 1, 2, 3];
  firstDayOfWeek = 1;
  selectedType = 'FRIDAY_LITURGY';
  typeOptions: TypeOption[] = [];
  private readonly weekDays = [0, 1, 2, 3, 4, 5, 6];
  customTitle = '';
  pageBlockedMessage = '';
  runtimeBlockedMessage = '';
  blockedMessage = '';

  families: string[] = [];
  selectedFamily = '';
  private readonly preferredFamilyOrder = DEFAULT_FAMILY_ORDER;

  members: PickUser[] = [];
  membersLoading = false;
  membersLoadError = '';
  globalResults: PickUser[] = [];
  searchText = '';
  private searchTimer: any = null;
  searching = false;
  selected: PickUser[] = [];
  private lastScannedToken = '';
  private lastScannedAt = 0;

  grants: AttendanceAccessGrant[] = [];
  grantsLoading = false;
  grantsFilterFamily = '';
  grantsFilterMenuLocked = false;
  grantPopupVisible = false;
  grantSearchText = '';
  grantPopupFilter: GrantPopupFilter = 'ALL';
  grantDialogVisible = false;
  grantDialogMode: 'create' | 'edit' = 'create';
  grantForm: Partial<AttendanceAccessGrant> = this.defaultGrantForm();
  private editingGrantGroupIds: number[] = [];
  private editingGrantTargetFallbacks: PickUser[] = [];
  grantTargets: PickUser[] = [];
  selectedGrantTargetIds: number[] = [];
  grantTargetSearch = '';
  grantAudience: GrantAudience = 'MEMBERS';
  private lastGrantAudience: GrantAudience = 'MEMBERS';
  grantStartsAtDate: Date | null = null;
  grantEndsAtDate: Date | null = null;
  grantFamilySelections: string[] = [];
  grantCustomEvents: AttendanceCustomEvent[] = [];
  grantSelectedOccasionKey = '';
  grantSelectedWeekday: number | null = null;
  grantDayWindows: GrantDayWindow[] = [];
  grantOccasionOptionList: GrantOccasionOption[] = [];
  grantWeekdayOptionList: number[] = [];
  selectedGrantWindowValue: GrantDayWindow | null = null;
  filteredGrantTargetList: PickUser[] = [];
  selectedGrantTargetList: PickUser[] = [];
  grantSavedSummaries: GrantSavedSummary[] = [];
  readonly grantNoDisabledDays: number[] = [];

  configEditor: AttendanceConfig = this.defaultAttendanceConfig();
  configSaving = false;
  configFamilyOptions: string[] = [];
  selectedConfigFamily = '';
  selectedScheduleConfigType: AttendanceType | '' = '';
  configPanelOpen = false;
  scheduleEditableTypeOptions: { value: AttendanceType; label: string }[] = [];
  configurableTypeOptions: { value: AttendanceType; label: string }[] = [
    { value: 'FRIDAY_LITURGY', label: 'القداس' },
    { value: 'TASBEEHA', label: 'التسبحة' },
    { value: 'FAMILY_MEETING', label: 'اجتماع الأسرة' }
  ];
  attendanceDayOptions = [
    { value: 0, label: 'الأحد' },
    { value: 1, label: 'الاثنين' },
    { value: 2, label: 'الثلاثاء' },
    { value: 3, label: 'الأربعاء' },
    { value: 4, label: 'الخميس' },
    { value: 5, label: 'الجمعة' },
    { value: 6, label: 'السبت' }
  ];

  countdownGrant: AttendanceAccessGrant | null = null;
  countdownText = '';
  countdownTypeText = '';
  countdownFamilyText = '';
  countdownEndsAtText = '';
  countdownLabel = 'هيتقفل على';
  showCountdownClock = false;
  private countdownTimer: any = null;

  customEventDialogMode: 'create' | 'edit' = 'create';
  customEventDialogVisible = false;
  customEventSaving = false;
  customEventForm: CustomEventForm = this.defaultCustomEventForm();
  customEventActiveFromDate: Date | null = null;
  customEventActiveToDate: Date | null = null;
  customEventBlockedDates: Date[] = [];
  familyCustomEvents: AttendanceCustomEvent[] = [];
  availableCustomEvents: AttendanceCustomEvent[] = [];
  selectedCustomEventId: number | '' = '';
  customEventsPopupVisible = false;
  customEventEditorTargets: PickUser[] = [];
  customEventEditorPickerId: number | null = null;
  customEventEditorSearch = '';

  ngOnInit() {
    if (!isPlatformBrowser(this.platformId)) return;

    this.auth.getUserData(true).subscribe((u) => {
      this.me = u;
      this.loadContext();
      this.startCountdownTicker();
    });
  }

  ngOnDestroy(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (this.countdownTimer) clearInterval(this.countdownTimer);
  }

  private loadContext(): void {
    this.attendance.context().subscribe({
      next: (ctx) => {
        this.attendanceContext = { ...ctx, config: this.mergeConfig(ctx?.config) };
        this.configEditor = this.mergeConfig(ctx?.config);
        this.initCalendarRules();
        this.loadFamilies();
        this.refreshRuntimeState();
        if (this.canManageAccessGrants()) this.loadAccessGrants();
      },
      error: () => {
        this.pageBlockedMessage = 'تعذر تحميل إعدادات الحضور';
        this.updateBlockedMessage();
      }
    });
  }

  private hasAnyAminPrivilegeScope(): boolean {
    const roles = assignmentRolesOf(this.me);
    return roles.includes('AMIN_OSRA') || roles.includes('AMIN_KHEDMA');
  }

  private roleNorm(): string {
    return normalizeRole(this.me?.role);
  }

  isKhadim(): boolean {
    return this.roleNorm() === 'KHADIM' && !this.hasAnyAminPrivilegeScope();
  }

  isServantOrAbove(): boolean {
    return ['KHADIM', 'AMIN_OSRA', 'AMIN_KHEDMA', 'DEVELOPER'].includes(this.roleNorm()) || this.hasAnyAminPrivilegeScope();
  }

  private hasVisibleGrantKind(kind: AttendanceAccessGrant['grantKind']): boolean {
    return (this.attendanceContext?.activeGrants || []).some((grant) => grant.grantKind === kind && grant.enabled !== false);
  }

  private hasVisibleTakeAttendanceGrants(): boolean {
    return this.hasVisibleGrantKind('TAKE_ATTENDANCE');
  }

  private hasVisibleSelfCheckinGrants(): boolean {
    return this.hasVisibleGrantKind('SELF_CHECKIN');
  }

  private grantKindForCurrentUser(): AttendanceAccessGrant['grantKind'] {
    return this.isSelfCheckinMode() ? 'SELF_CHECKIN' : 'TAKE_ATTENDANCE';
  }

  isDelegatedAttendanceMode(): boolean {
    return !this.isServantOrAbove() && this.hasVisibleTakeAttendanceGrants();
  }

  isSelfCheckinMode(): boolean {
    return !!this.attendanceContext?.selfCheckinAllowed
      && !this.isServantOrAbove()
      && !this.hasVisibleTakeAttendanceGrants()
      && this.hasVisibleSelfCheckinGrants();
  }

  canSelectFamily(): boolean {
    if (this.isSelfCheckinMode() || this.isDelegatedAttendanceMode()) return this.currentGrantFamilyOptions().length > 1;
    return ['AMIN_KHEDMA', 'DEVELOPER'].includes(this.roleNorm()) || this.isKhadim() || this.hasAnyAminPrivilegeScope();
  }

  hasRestrictedFamilyScope(): boolean {
    return this.currentGrantFamilyOptions().length > 0;
  }

  canUseCustomEvent(): boolean {
    return !!this.attendanceContext?.canUseCustomEvent && !this.isKhadim();
  }

  canManageAccessGrants(): boolean {
    return ['AMIN_OSRA', 'AMIN_KHEDMA', 'DEVELOPER'].includes(this.roleNorm()) || this.hasAnyAminPrivilegeScope();
  }

  canManageAttendanceConfig(): boolean {
    return ['AMIN_OSRA', 'AMIN_KHEDMA', 'DEVELOPER'].includes(this.roleNorm()) || this.hasAnyAminPrivilegeScope();
  }

  canFilterGrantFamilies(): boolean {
    return ['AMIN_KHEDMA', 'DEVELOPER'].includes(this.roleNorm());
  }

  isDeveloper(): boolean {
    return this.roleNorm() === 'DEVELOPER';
  }

  isAminKhedmaOrDeveloper(): boolean {
    return ['AMIN_KHEDMA', 'DEVELOPER'].includes(this.roleNorm());
  }

  canChooseGrantFamily(): boolean {
    return this.isAminKhedmaOrDeveloper();
  }

  private defaultGrantScopeFamily(): string {
    if (this.canChooseGrantFamily()) return '';
    const aminFamily = this.scopedAminOsraFamily();
    if (aminFamily) return aminFamily;
    return canonicalFamilyName(this.primaryFamilyFor(this.me));
  }

  private rawRoleText(): string {
    return String(this.me?.role || '').trim().toUpperCase();
  }

  private servesKhors(code: 'MARMARKOS' | 'ATHANASIUS'): boolean {
    const khors = String(this.me?.khors || '').trim().toUpperCase();
    if (khors === 'BOTH' || khors === code) return true;

    const roleRaw = String(this.me?.role || '').trim();
    const roleUpper = roleRaw.toUpperCase();
    if (roleUpper.includes('KHORS')) {
      if (code === 'MARMARKOS' && (roleUpper.includes('MARMARKOS') || roleRaw.includes('مارمرقس'))) return true;
      if (code === 'ATHANASIUS' && (roleUpper.includes('ATHANASIUS') || roleRaw.includes('اثناسيوس') || roleRaw.includes('أثناسيوس'))) return true;
    }

    return false;
  }

  private isAminAthanasius(): boolean {
    if (this.roleNorm() !== 'AMIN_OSRA' && !this.hasAnyAminPrivilegeScope()) return false;
    return this.assignmentsOf(this.me).some((x) => x.role === 'AMIN_OSRA' && this.isAthanasiusFamilyName(x.familyName))
      || this.isAthanasiusFamilyName(this.me?.deaconFamily)
      || this.isAthanasiusFamilyName(this.me?.familyName);
  }

  private isAthanasiusFamilyName(value?: string | null): boolean {
    const normalized = canonicalFamilyName(String(value || ''));
    return normalized.includes('اثناسيوس') || normalized.includes('أثناسيوس');
  }

  private canAccessAthanasiusKhors(): boolean {
    return this.isAminKhedmaOrDeveloper() || this.isAminAthanasius() || this.servesKhors('ATHANASIUS');
  }

  private defaultAttendanceConfig(): AttendanceConfig {
    return {
      servantEntryOpenDays: [4, 5, 6, 0, 1],
      servantSelectableEventDays: [4, 5, 6],
      allowCustomTitleOnNonDefaultDays: true,
      typeDays: {
        FRIDAY_LITURGY: [5],
        TASBEEHA: [6],
        FAMILY_MEETING: [4],
        MARMARKOS_KHORS: [5],
        ATHANASIUS_KHORS: [5]
      },
      familyTypeDays: {},
      familyAbsenceAllowedDays: {},
      familyAbsenceOpenDays: {},
      typeLabels: {
        FRIDAY_LITURGY: 'قداس',
        TASBEEHA: 'تسبحة',
        FAMILY_MEETING: 'اجتماع الأسرة',
        MARMARKOS_KHORS: 'خورس مارمرقس',
        ATHANASIUS_KHORS: 'خورس البابا أثناسيوس',
        CUSTOM_EVENT: 'مناسبة مخصصة'
      }
    };
  }

  private mergeConfig(cfg?: Partial<AttendanceConfig> | null): AttendanceConfig {
    const defaults = this.defaultAttendanceConfig();
    const familyTypeDays = {
      ...((cfg && cfg.familyTypeDays) || {})
    };
    const familyAbsenceAllowedDays = {
      ...((cfg && cfg.familyAbsenceAllowedDays) || {})
    };
    const familyAbsenceOpenDays = {
      ...((cfg && cfg.familyAbsenceOpenDays) || {})
    };
    return {
      ...defaults,
      ...(cfg || {}),
      servantSelectableEventDays: Array.from(new Set([
        ...(cfg?.servantSelectableEventDays || []),
        ...Object.values(cfg?.typeDays || {}).flatMap((days) => days || []),
        ...Object.values(familyTypeDays).flatMap((map) => Object.values(map || {}).flatMap((days) => days || [])),
        ...Object.values(defaults.typeDays || {}).flatMap((days) => days || [])
      ])).sort((a, b) => a - b),
      typeDays: {
        ...defaults.typeDays,
        ...((cfg && cfg.typeDays) || {})
      },
      familyTypeDays,
      familyAbsenceAllowedDays,
      familyAbsenceOpenDays,
      typeLabels: {
        ...defaults.typeLabels,
        ...((cfg && cfg.typeLabels) || {})
      }
    };
  }

  dayLabel(value: number): string {
    return this.attendanceDayOptions.find(x => x.value === value)?.label || String(value);
  }

  private choirFamilies(): string[] {
    const families: string[] = [];
    if (this.canAccessMarmarkosKhors()) families.push('خورس مارمرقس');
    if (this.canAccessAthanasiusKhors()) families.push('خورس البابا أثناسيوس');
    return families;
  }

  private canAccessMarmarkosKhors(): boolean {
    return this.isAminKhedmaOrDeveloper()
      || this.servesKhors('MARMARKOS')
      || this.assignmentsOf(this.me).some((x) => this.isMarmarkosFamilyName(x.familyName))
      || this.isMarmarkosFamilyName(this.me?.deaconFamily)
      || this.isMarmarkosFamilyName(this.me?.familyName);
  }

  private isMarmarkosFamilyName(value?: string | null): boolean {
    return canonicalFamilyName(String(value || '')) === 'خورس مارمرقس';
  }

  private aminOsraFamilies(): string[] {
    const fromAssignments = this.assignmentsOf(this.me)
      .filter((x) => x.role === 'AMIN_OSRA')
      .map((x) => String(x.familyName || '').trim())
      .filter(Boolean);

    if (fromAssignments.length) {
      return fromAssignments.filter((family, index, arr) =>
        arr.findIndex((item) => canonicalFamilyName(item) === canonicalFamilyName(family)) === index
      );
    }

    const fallback = this.scopedAminOsraFamily();
    return fallback ? [fallback] : [];
  }

  private scopedAminOsraFamily(): string {
    const primaryFamily = canonicalFamilyName(this.primaryFamilyFor(this.me));
    if (primaryFamily) return primaryFamily;

    const fallback = canonicalFamilyName(this.me?.deaconFamily || this.familyLabel(this.me));
    return fallback || '';
  }

  private preferredCustomEventFamily(): string {
    if (this.isAminKhedmaOrDeveloper() && this.selectedFamily) return this.selectedFamily;
    const aminFamilies = this.aminOsraFamilies();
    const selectedFamily = canonicalFamilyName(this.selectedFamily);
    const selectedAllowed = aminFamilies.find((family) => canonicalFamilyName(family) === selectedFamily);
    if (selectedAllowed) return selectedAllowed;
    if (aminFamilies.length) return aminFamilies[0];

    return this.scopedAminOsraFamily();
  }

  private buildConfigFamilyOptions(): string[] {
    if (['AMIN_KHEDMA', 'DEVELOPER'].includes(this.roleNorm())) {
      return Array.from(new Set([...this.families, ...this.choirFamilies()])).filter(Boolean);
    }
    if (this.roleNorm() === 'AMIN_OSRA' || this.hasAnyAminPrivilegeScope()) {
      return this.aminOsraFamilies();
    }
    return [];
  }

  private ensureSelectedConfigFamily(): void {
    this.configFamilyOptions = this.buildConfigFamilyOptions();
    if ((this.roleNorm() === 'AMIN_OSRA' || this.hasAnyAminPrivilegeScope()) && !this.configFamilyOptions.length) {
      this.configFamilyOptions = this.aminOsraFamilies();
    }
    if (!this.configFamilyOptions.length) {
      this.selectedConfigFamily = '';
      this.updateScheduleEditableTypes();
      this.selectedScheduleConfigType = this.scheduleEditableTypeOptions[0]?.value || '';
      return;
    }
    if (!['AMIN_KHEDMA', 'DEVELOPER'].includes(this.roleNorm())) {
      this.selectedConfigFamily = this.configFamilyOptions[0];
      this.updateScheduleEditableTypes();
      this.selectedScheduleConfigType = this.scheduleEditableTypeOptions[0]?.value || '';
      return;
    }
    if (!this.selectedConfigFamily || !this.configFamilyOptions.includes(this.selectedConfigFamily)) {
      this.selectedConfigFamily = this.configFamilyOptions[0];
    }
    this.updateScheduleEditableTypes();
  }

  isConfigFamilyLocked(): boolean {
    return !!this.selectedConfigFamily && !['AMIN_KHEDMA', 'DEVELOPER'].includes(this.roleNorm()) && this.configFamilyOptions.length === 1;
  }

  shouldShowConfigFamilyPicker(): boolean {
    return this.configFamilyOptions.length > 1;
  }

  openGrantsPopup(): void {
    this.grantPopupVisible = true;
  }

  closeGrantsPopup(): void {
    this.grantPopupVisible = false;
  }

  grantPopupFilterOptions(): Array<{ value: GrantPopupFilter; label: string }> {
    const scopeLabel = this.selectedFamily || 'الأسرة الحالية';
    return [
      { value: 'ALL', label: 'كل التخصيصات' },
      { value: 'SERVANTS_SCOPE', label: `خدام ${scopeLabel}` },
      { value: 'MEMBERS_SCOPE', label: `مخدومين ${scopeLabel}` }
    ];
  }

  popupGrantCountLabel(): string {
    return `${this.filteredGrantGroups.length} تخصيص`;
  }

  private grantMatchesPopupFilter(grant: AttendanceAccessGrant): boolean {
    const selected = String(this.selectedFamily || '').trim();
    const grantFamilies = this.grantFamilyList(grant.familyBase);

    switch (this.grantPopupFilter) {
      case 'SERVANTS_SCOPE':
        return grant.grantKind === 'TAKE_ATTENDANCE' && (!!selected ? grantFamilies.includes(selected) : true);
      case 'MEMBERS_SCOPE':
        return grant.grantKind === 'SELF_CHECKIN' && (!!selected ? grantFamilies.includes(selected) : true);
      default:
        return true;
    }
  }

  grantFamilyFilterOptions(): string[] {
    return this.filterAthanasiusVisibility(Array.from(new Set([...this.families, ...this.choirFamilies()])).filter(Boolean));
  }

  grantFilterLabel(): string {
    return this.grantsFilterFamily || 'كل التخصيصات';
  }

  selectGrantFilter(family: string): void {
    this.grantsFilterMenuLocked = true;
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    this.grantsFilterFamily = family;
  }

  unlockGrantFilterMenu(): void {
    this.grantsFilterMenuLocked = false;
  }

  onGrantFilterMenuEnter(): void {
    this.grantsFilterMenuLocked = false;
  }

  get filteredGrants(): AttendanceAccessGrant[] {
    const selected = String(this.grantsFilterFamily || '').trim();
    const q = String(this.grantSearchText || '').trim().toLowerCase();
    return this.grants.filter((grant) => {
      if (selected && !this.grantFamilyList(grant.familyBase).includes(selected)) return false;
      if (!this.grantMatchesPopupFilter(grant)) return false;
      if (!q) return true;

      const haystack = [
        grant.targetUserName,
        this.grantKindFromAudience(this.grantAudienceFromKind(grant.grantKind)),
        this.grantFamilyLabel(grant.familyBase),
        ...(grant.allowedTypes || []).map((type) => this.displayTypeLabel(type)),
        grant.note || ''
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(q);
    });
  }

  get filteredGrantGroups(): GrantGroup[] {
    return this.groupAccessGrants(this.filteredGrants);
  }

  private groupAccessGrants(grants: AttendanceAccessGrant[]): GrantGroup[] {
    const groups = new Map<string, AttendanceAccessGrant[]>();
    for (const grant of grants || []) {
      const key = this.grantGroupingKey(grant);
      groups.set(key, [...(groups.get(key) || []), grant]);
    }
    return Array.from(groups.entries()).map(([key, items]) => {
      const sorted = items.slice().sort((a, b) => String(a.targetUserName || '').localeCompare(String(b.targetUserName || ''), 'ar'));
      const notes = sorted
        .map((grant) => String(grant.note || '').trim())
        .filter((note, index, arr) => !!note && arr.indexOf(note) === index);
      return {
        key,
        grants: sorted,
        first: sorted[0],
        targetNames: sorted.map((grant) => grant.targetUserName || this.grantTargetNameFor(grant.targetUserId)).filter(Boolean).join(' + '),
        notes
      };
    });
  }

  private grantGroupingKey(grant: Partial<AttendanceAccessGrant>): string {
    const familyKey = this.grantFamilyList(grant.familyBase).slice().sort().join(',');
    return [
      grant.grantKind || '',
      familyKey,
      (grant.allowedTypes || []).slice().sort().join(','),
      this.grantDayFromGrant(grant) ?? '',
      this.toDateTimeLocalValue(String(grant.startsAt || '')),
      this.toDateTimeLocalValue(String(grant.endsAt || '')),
      grant.enabled === false ? 'off' : 'on'
    ].join('|');
  }

  grantGroupNotesText(group: GrantGroup): string {
    return group.notes.join(' + ');
  }

  grantGroupDayLabel(group: GrantGroup): string {
    const day = this.grantDayFromGrant(group.first || {});
    return day === null ? '' : this.dayLabel(day);
  }

  grantDayLabel(grant: AttendanceAccessGrant): string {
    const day = this.grantDayFromGrant(grant || {});
    return day === null ? '' : this.dayLabel(day);
  }

  editingGrantGroup(): GrantGroup | null {
    if (this.grantDialogMode !== 'edit' || !this.editingGrantGroupIds.length) return null;
    const editingIds = new Set(this.editingGrantGroupIds.map((id) => Number(id || 0)).filter(Boolean));
    const source = this.knownAccessGrants().filter((grant) => editingIds.has(Number(grant.id || 0)));
    const group = this.groupAccessGrants(source)[0] || null;
    if (!group) return null;
    const selectedIds = new Set((this.selectedGrantTargetIds || []).map((id) => Number(id || 0)).filter(Boolean));
    if (!selectedIds.size) return group;
    const selectedNames = this.selectedGrantTargetList
      .filter((target) => selectedIds.has(target.id))
      .map((target) => target.fullName)
      .filter(Boolean);
    return {
      ...group,
      grants: group.grants.filter((grant) => selectedIds.has(Number(grant.targetUserId || 0))),
      targetNames: selectedNames.length ? selectedNames.join(' + ') : group.targetNames
    };
  }

  dialogExistingGrantGroups(): GrantGroup[] {
    if (!this.grantDialogVisible) return [];
    const editingIds = new Set(this.editingGrantGroupIds.map((id) => Number(id || 0)).filter(Boolean));
    const wantedKind = this.grantKindFromAudience(this.grantAudience);
    const editingKey = this.editingGrantGroup()?.key || '';

    return this.groupAccessGrants(
      this.knownAccessGrants().filter((grant) => {
        const grantId = Number(grant.id || 0);
        if (grantId && editingIds.has(grantId)) return false;
        return grant.grantKind === wantedKind;
      })
    ).filter((group) => !editingKey || group.key !== editingKey);
  }

  dialogExistingGrantTitle(): string {
    return this.grantAudience === 'SERVANTS'
      ? 'تخصيصات الخدام الموجودة'
      : 'تخصيصات المخدومين الموجودة';
  }

  dialogExistingGrantHint(): string {
    return this.grantAudience === 'SERVANTS'
      ? 'لا توجد تخصيصات خدام محفوظة حالياً.'
      : 'لا توجد تخصيصات مخدومين محفوظة حالياً.';
  }

  grantFamilyList(value?: string | null): string[] {
    return String(value || '').split(/[,،;|]+/).map((item) => item.trim()).filter(Boolean);
  }

  grantFamilyLabel(value?: string | null): string {
    const families = this.grantFamilyList(value);
    return families.length ? families.join(' + ') : 'غير محددة';
  }

  private syncGrantFamilySelectionsFromForm(): void {
    this.grantFamilySelections = this.grantFamilyList(this.grantForm.familyBase);
  }

  private syncGrantFamilyFormFromSelections(): void {
    this.grantForm.familyBase = this.grantFamilySelections.length ? this.grantFamilySelections.join(', ') : '';
  }

  toggleGrantFamilySelection(family: string): void {
    const current = new Set(this.grantFamilySelections);
    if (current.has(family)) current.delete(family);
    else current.add(family);
    this.grantFamilySelections = this.families.filter((item) => current.has(item));
    this.syncGrantFamilyFormFromSelections();
    this.loadGrantTargets(this.grantForm.familyBase || this.defaultGrantScopeFamily());
    this.loadGrantCustomEvents();
  }

  hasGrantFamilySelection(family: string): boolean {
    return this.grantFamilySelections.includes(family);
  }

  onConfigFamilyChange(): void {
    this.updateScheduleEditableTypes();
  }

  onScheduleConfigTypeChange(): void {
    if (!this.scheduleEditableTypeOptions.some((item) => item.value === this.selectedScheduleConfigType)) {
      this.selectedScheduleConfigType = this.scheduleEditableTypeOptions[0]?.value || '';
    }
  }

  private updateScheduleEditableTypes(): void {
    if (!this.selectedConfigFamily) {
      this.scheduleEditableTypeOptions = [];
      return;
    }
    this.scheduleEditableTypeOptions = [
      { value: 'FRIDAY_LITURGY', label: this.typeLabel('FRIDAY_LITURGY') },
      { value: 'TASBEEHA', label: this.typeLabel('TASBEEHA') },
      { value: 'FAMILY_MEETING', label: this.typeLabel('FAMILY_MEETING') }
    ];
    if (!this.scheduleEditableTypeOptions.some((item) => item.value === this.selectedScheduleConfigType)) {
      this.selectedScheduleConfigType = this.scheduleEditableTypeOptions[0]?.value || '';
    }
  }

  private typeDaysForEditor(): TypeDaysMap {
    if (!this.selectedConfigFamily) return {};
    return this.configEditor.familyTypeDays?.[this.selectedConfigFamily] || {};
  }

  private absenceAllowedDaysForEditor(): number[] {
    if (!this.selectedConfigFamily) return [];
    return [...(this.configEditor.familyAbsenceAllowedDays?.[this.selectedConfigFamily] || [])].sort((a, b) => a - b);
  }

  private absenceOpenDaysForEditor(): number[] {
    if (!this.selectedConfigFamily) return [];
    return [...(this.configEditor.familyAbsenceOpenDays?.[this.selectedConfigFamily] || [])].sort((a, b) => a - b);
  }

  selectedTypeConfigDays(type: AttendanceType): number[] {
    const current = this.typeDaysForEditor()[type] || [];
    if (current.length) return [...current].sort((a, b) => a - b);
    const fallback = this.configEditor.typeDays?.[type] || [];
    return [...fallback].sort((a, b) => a - b);
  }

  hasTypeConfigDay(type: AttendanceType, day: number): boolean {
    return this.selectedTypeConfigDays(type).includes(day);
  }

  hasAbsenceAllowedDay(day: number): boolean {
    return this.absenceAllowedDaysForEditor().includes(day);
  }

  hasAbsenceOpenDay(day: number): boolean {
    return this.absenceOpenDaysForEditor().includes(day);
  }

  isSingleDayConfigType(type: AttendanceType): boolean {
    return type === 'FAMILY_MEETING';
  }

  toggleTypeConfigDay(type: AttendanceType, day: number): void {
    if (!this.selectedConfigFamily) return;
    const current = new Set(this.selectedTypeConfigDays(type));
    if (this.isSingleDayConfigType(type)) {
      if (current.has(day)) current.clear();
      else {
        current.clear();
        current.add(day);
      }
    } else {
      if (current.has(day)) current.delete(day);
      else current.add(day);
    }
    const nextDays = Array.from(current).sort((a, b) => a - b);
    this.configEditor = {
      ...this.configEditor,
      familyTypeDays: {
        ...(this.configEditor.familyTypeDays || {}),
        [this.selectedConfigFamily]: {
          ...(this.configEditor.familyTypeDays?.[this.selectedConfigFamily] || {}),
          [type]: nextDays
        }
      }
    };
  }

  toggleAbsenceAllowedDay(day: number): void {
    if (!this.selectedConfigFamily) return;
    const current = new Set(this.absenceAllowedDaysForEditor());
    if (current.has(day)) current.delete(day);
    else current.add(day);
    const nextDays = Array.from(current).sort((a, b) => a - b);
    this.configEditor = {
      ...this.configEditor,
      familyAbsenceAllowedDays: {
        ...(this.configEditor.familyAbsenceAllowedDays || {}),
        [this.selectedConfigFamily]: nextDays
      }
    };
  }

  toggleAbsenceOpenDay(day: number): void {
    if (!this.selectedConfigFamily) return;
    const current = new Set(this.absenceOpenDaysForEditor());
    if (current.has(day)) current.delete(day);
    else current.add(day);
    const nextDays = Array.from(current).sort((a, b) => a - b);
    this.configEditor = {
      ...this.configEditor,
      familyAbsenceOpenDays: {
        ...(this.configEditor.familyAbsenceOpenDays || {}),
        [this.selectedConfigFamily]: nextDays
      }
    };
  }

  saveAttendanceConfig(): void {
    if (!this.canManageAttendanceConfig()) return;
    if (!this.selectedConfigFamily) {
      this.message.add({ severity: 'warn', summary: 'تنبيه', detail: 'اختار الأسرة أو الخورس أولاً' });
      return;
    }

    this.configSaving = true;
    const payload = this.scheduleEditableTypeOptions.reduce((acc: Partial<Record<AttendanceType, number[]>>, item) => {
      acc[item.value] = this.selectedTypeConfigDays(item.value);
      return acc;
    }, {} as Partial<Record<AttendanceType, number[]>>);
    const absenceAllowedDays = this.absenceAllowedDaysForEditor();
    const absenceOpenDays = this.absenceOpenDaysForEditor();

    this.attendance.saveFamilyTypeDays(this.selectedConfigFamily, payload, absenceAllowedDays, absenceOpenDays).subscribe({
      next: (cfg) => {
        const merged = this.mergeConfig(cfg);
        this.configEditor = merged;
        this.attendanceContext = {
          ...(this.attendanceContext || {
            todayOpenForServant: true,
            activeGrants: [],
            selfCheckinAllowed: false,
            takeAttendanceGrantActive: false,
            selfAllowedTypes: [],
            takeAllowedTypes: [],
            canUseCustomEvent: false
          }),
          config: merged
        };
        this.initCalendarRules();
        this.refreshRuntimeState();
        this.message.add({ severity: 'success', summary: 'تم', detail: 'تم حفظ مواعيد الأنواع بنجاح' });
        this.configSaving = false;
      },
      error: (err) => {
        this.configSaving = false;
        this.message.add({ severity: 'error', summary: 'خطأ', detail: err?.error?.error || err?.error?.message || 'فشل حفظ مواعيد الأنواع' });
      }
    });
  }

  private updateBlockedMessage(): void {
    this.blockedMessage = this.pageBlockedMessage || this.runtimeBlockedMessage || '';
    if (this.blockedMessage) this.scanning = false;
  }

  private shouldEnforceGrantWindow(): boolean {
    return this.isSelfCheckinMode() || this.relevantScopeGrants().length > 0;
  }

  private shouldRestrictFamilyScopeByGrant(): boolean {
    if (this.canOverrideAbsenceOpenClose()) return false;
    return this.isSelfCheckinMode() || this.relevantScopeGrants().length > 0;
  }

  private relevantScopeGrants(): AttendanceAccessGrant[] {
    const grants = this.attendanceContext?.activeGrants || [];
    const wantedKind = this.grantKindForCurrentUser();
    return grants.filter((grant) => grant.grantKind === wantedKind && grant.enabled !== false);
  }

  private isGrantActive(grant: AttendanceAccessGrant, now = new Date()): boolean {
    const start = new Date(grant.startsAt);
    const end = new Date(grant.endsAt);
    return !Number.isNaN(start.getTime())
      && !Number.isNaN(end.getTime())
      && start <= now
      && now <= end;
  }

  private activeScopeGrants(now = new Date()): AttendanceAccessGrant[] {
    return this.relevantScopeGrants().filter((grant) => this.isGrantActive(grant, now));
  }

  private grantedFamiliesFrom(grants: AttendanceAccessGrant[]): string[] {
    if (grants.some((grant) => this.grantFamilyList(grant.familyBase).length === 0)) return [];
    return Array.from(new Set(grants.flatMap((grant) => this.grantFamilyList(grant.familyBase)).filter(Boolean)));
  }

  private isGroupedMemberFamilyMode(): boolean {
    return this.isDelegatedAttendanceMode() && !this.isServantOrAbove();
  }

  private groupedFamilyLabel(family: string): string {
    return canonicalFamilyName(family);
  }

  private shortFamilyDisplayName(family: string): string {
    const canonical = canonicalFamilyName(family).trim();
    if (!canonical) return '';
    if (canonical.startsWith('خورس ')) return canonical;
    return canonical
      .replace(/^اسرة\s+/i, '')
      .replace(/^القديس\s+/i, '')
      .replace(/^الانبا\s+/i, 'الأنبا ')
      .trim();
  }

  private shortFamilyDisplayList(families: string[]): string {
    return Array.from(new Set(families.map((family) => this.shortFamilyDisplayName(family)).filter(Boolean))).join(' + ');
  }

  displayScopeFamilyLabel(): string {
    const grantedFamilies = this.currentGrantFamilyOptions();
    if (grantedFamilies.length) {
      return this.shortFamilyDisplayList(grantedFamilies);
    }
    if (this.selectedFamily) {
      return this.isGroupedMemberFamilyMode()
        ? this.shortFamilyDisplayName(this.selectedFamily)
        : this.selectedFamily;
    }
    const meFamily = this.familyLabel(this.me);
    return this.isGroupedMemberFamilyMode()
      ? this.shortFamilyDisplayName(meFamily)
      : meFamily;
  }

  private scopeFamiliesForSelection(selected = this.selectedFamily, now = new Date()): string[] {
    const normalizedSelected = canonicalFamilyName(selected);
    const activeFamilies = this.grantedFamiliesFrom(this.activeScopeGrants(now));
    if (!normalizedSelected) return activeFamilies;
    if (!this.isGroupedMemberFamilyMode()) return [selected];
    const matched = activeFamilies.filter((family) => canonicalFamilyName(family) === normalizedSelected);
    return matched.length ? matched : [selected];
  }

  private grantedTypesFrom(grants: AttendanceAccessGrant[], family = this.selectedFamily): AttendanceType[] {
    if (!this.shouldRestrictFamilyScopeByGrant()) {
      return Array.from(new Set(grants.flatMap((grant) => grant.allowedTypes || []).filter(Boolean))) as AttendanceType[];
    }
    const selectedFamilies = family ? this.scopeFamiliesForSelection(family) : [];
    const familyScoped = selectedFamilies.length
      ? grants.filter((grant) => {
          const families = this.grantFamilyList(grant.familyBase);
          return !families.length || selectedFamilies.some((item) => families.includes(item));
        })
      : grants;
    const source = familyScoped.length ? familyScoped : grants;
    return Array.from(new Set(source.flatMap((grant) => grant.allowedTypes || []).filter(Boolean))) as AttendanceType[];
  }

  private currentGrantFamilyOptions(now = new Date()): string[] {
    if (!this.shouldRestrictFamilyScopeByGrant()) return [];
    if (!this.shouldEnforceGrantWindow()) return [];
    const activeFamilies = this.grantedFamiliesFrom(this.activeScopeGrants(now));
    const visibleFamilies = this.grantedFamiliesFrom(this.relevantScopeGrants());
    const orderedFamilies = [
      ...activeFamilies,
      ...visibleFamilies.filter((family) => !activeFamilies.includes(family))
    ];
    if (!this.isGroupedMemberFamilyMode()) return this.filterAthanasiusVisibility(orderedFamilies);
    return this.filterAthanasiusVisibility(sortFamiliesByPreferredOrder(orderedFamilies.map((family) => this.groupedFamilyLabel(family)), this.preferredFamilyOrder));
  }

  private filterFamiliesByGrantScope(allFamilies: string[]): string[] {
    const allowed = this.currentGrantFamilyOptions();
    const visibleFamilies = this.filterAthanasiusVisibility(allFamilies);
    if (!allowed.length) return visibleFamilies;
    if (this.isGroupedMemberFamilyMode()) return this.filterAthanasiusVisibility(allowed);
    return visibleFamilies.filter((family) => allowed.includes(family));
  }

  private filterAthanasiusVisibility(families: string[]): string[] {
    if (this.canAccessAthanasiusKhors()) return families;
    return families.filter((family) => !this.isAthanasiusFamilyName(family));
  }

  private syncSelectedFamilyWithGrantScope(): void {
    const allowed = this.currentGrantFamilyOptions();
    if (!allowed.length) return;
    if (!this.selectedFamily || !allowed.includes(this.selectedFamily)) {
      this.selectedFamily = allowed[0] || '';
    }
  }

  private restrictOptionsByGrantScope(
    options: TypeOption[],
    now = new Date()
  ): TypeOption[] {
    if (!this.shouldEnforceGrantWindow()) return options;
    const allowedTypes = this.grantedTypesFrom(this.activeScopeGrants(now), this.selectedFamily);
    if (!allowedTypes.length) {
      return options.map((option) => ({ ...option, disabled: true }));
    }
    const allowed = new Set(allowedTypes);
    return options.map((option) => allowed.has(option.type)
      ? { ...option, disabled: false }
      : { ...option, disabled: true });
  }

  private matchingWindowGrants(): AttendanceAccessGrant[] {
    return this.relevantScopeGrants().filter((grant) => {
      const selectedFamilies = this.shouldRestrictFamilyScopeByGrant() && this.selectedFamily
        ? this.scopeFamiliesForSelection(this.selectedFamily)
        : [];
      if (selectedFamilies.length && grant.familyBase) {
        const grantFamilies = this.grantFamilyList(grant.familyBase);
        if (!selectedFamilies.some((family) => grantFamilies.includes(family))) return false;
      }
      const selectedType = this.selectedAttendanceType();
      if (selectedType && Array.isArray(grant.allowedTypes) && grant.allowedTypes.length && !grant.allowedTypes.includes(selectedType)) return false;
      return true;
    });
  }

  private pickCountdownGrant(now = new Date()): AttendanceAccessGrant | null {
    const grants = this.matchingWindowGrants();
    const active = grants
      .filter((grant) => this.isGrantActive(grant, now))
      .sort((a, b) => new Date(a.endsAt).getTime() - new Date(b.endsAt).getTime());

    if (active.length) return active[0];

    const upcoming = grants
      .filter((grant) => {
        const start = new Date(grant.startsAt);
        return !Number.isNaN(start.getTime()) && start > now;
      })
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

    if (upcoming.length) return upcoming[0];

    const ended = grants
      .filter((grant) => {
        const end = new Date(grant.endsAt);
        return !Number.isNaN(end.getTime()) && end < now;
      })
      .sort((a, b) => new Date(b.endsAt).getTime() - new Date(a.endsAt).getTime());

    return ended[0] || null;
  }

  private formatDuration(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds].map(x => String(x).padStart(2, '0')).join(':');
  }

  private countdownTypesText(grant: AttendanceAccessGrant): string {
    const types = (grant.allowedTypes || []).map(type => this.displayTypeLabel(type)).filter(Boolean);
    return types.join(' + ') || 'الحضور';
  }

  private grantOccasionDaysForType(type: AttendanceType): number[] {
    return Array.from(new Set(
      this.grantsForTypeStatus(type)
        .map((grant) => Number(grant.dayOfWeek))
        .filter((day) => this.weekDays.includes(day))
    ));
  }

  private nearestMatchingDate(reference: Date, allowedDays: number[]): Date | null {
    if (!allowedDays.length) return null;
    const base = new Date(reference);
    base.setHours(0, 0, 0, 0);

    let best: { date: Date; distance: number; futureBias: number } | null = null;
    for (let offset = -7; offset <= 7; offset++) {
      const candidate = new Date(base);
      candidate.setDate(base.getDate() + offset);
      if (!allowedDays.includes(candidate.getDay())) continue;
      if (!this.dateMatchesSelectedType(candidate)) continue;
      const distance = Math.abs(offset);
      const futureBias = offset < 0 ? 1 : 0;
      if (!best || distance < best.distance || (distance === best.distance && futureBias < best.futureBias)) {
        best = { date: candidate, distance, futureBias };
      }
    }

    return best ? best.date : null;
  }

  private formatDateTime(value?: string | Date | null): string {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  }

  private grantsForTypeStatus(type: AttendanceType): AttendanceAccessGrant[] {
    return this.relevantScopeGrants().filter((grant) => {
      const grantTypes = grant.allowedTypes || [];
      if (grantTypes.length && !grantTypes.includes(type)) return false;
      if (!this.shouldRestrictFamilyScopeByGrant() || !this.selectedFamily) return true;
      const selectedFamilies = this.scopeFamiliesForSelection(this.selectedFamily);
      const grantFamilies = this.grantFamilyList(grant.familyBase);
      return !grantFamilies.length || !selectedFamilies.length || selectedFamilies.some((family) => grantFamilies.includes(family));
    });
  }

  private grantStatusForType(type: AttendanceType, now = new Date()): { state: 'open' | 'upcoming' | 'ended' | 'closed'; rangeText: string; countdownText: string; note: string; icon: string } {
    const grants = this.grantsForTypeStatus(type);
    const active = grants
      .filter((grant) => this.isGrantActive(grant, now))
      .sort((a, b) => new Date(a.endsAt).getTime() - new Date(b.endsAt).getTime());
    const upcoming = grants
      .filter((grant) => new Date(grant.startsAt).getTime() > now.getTime())
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    const ended = grants
      .filter((grant) => new Date(grant.endsAt).getTime() < now.getTime())
      .sort((a, b) => new Date(b.endsAt).getTime() - new Date(a.endsAt).getTime());

    const selectedGrant = active[0] || upcoming[0] || ended[0];
    if (!selectedGrant) {
      return { state: 'closed', rangeText: 'لا يوجد تخصيص متاح لهذا النوع الآن', countdownText: '', note: 'مقفول', icon: '🔒' };
    }

    const startMs = new Date(selectedGrant.startsAt).getTime();
    const endMs = new Date(selectedGrant.endsAt).getTime();
    const rangeText = `متاح من ${this.formatDateTime(selectedGrant.startsAt)} إلى ${this.formatDateTime(selectedGrant.endsAt)}`;

    if (active[0]) {
      const remaining = endMs - now.getTime();
      return {
        state: 'open',
        rangeText,
        countdownText: remaining > 0 && remaining <= 5 * 60 * 60 * 1000 ? this.formatDuration(remaining) : '',
        note: 'مفتوح الآن',
        icon: '✅'
      };
    }

    if (upcoming[0]) {
      const remaining = startMs - now.getTime();
      return {
        state: 'upcoming',
        rangeText,
        countdownText: remaining > 0 && remaining <= 5 * 60 * 60 * 1000 ? this.formatDuration(remaining) : '',
        note: 'لسه مبدأش',
        icon: '🔒'
      };
    }

    return {
      state: 'ended',
      rangeText,
      countdownText: '',
      note: 'انتهى الوقت',
      icon: '🔒'
    };
  }

  typeOptionLabel(option: TypeOption): string {
    return option.disabled ? `🔒 ${option.label}` : option.label;
  }

  shouldShowGrantTypeStatuses(): boolean {
    return this.shouldEnforceGrantWindow() && this.typeOptions.length > 0;
  }

  grantTypeStatuses(): GrantTypeStatus[] {
    const seen = new Set<string>();
    return this.typeOptions
      .filter((option) => {
        const key = option.type === 'CUSTOM_EVENT' ? option.value : option.type;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((option) => {
        const status = this.grantStatusForType(option.type);
        return { type: option.type, label: option.label, ...status };
      });
  }

  currentSelectedTypeLabel(): string {
    const selected = this.typeOptions.find((option) => option.value === this.selectedType);
    return selected?.label || this.displayTypeLabel(this.selectedAttendanceType()) || 'غير محدد';
  }

  currentSelectedTypeStatus(): GrantTypeStatus {
    const status = this.grantStatusForType(this.selectedAttendanceType());
    return {
      type: this.selectedAttendanceType(),
      label: this.currentSelectedTypeLabel(),
      ...status
    };
  }

  private hasAnyOpenGrantNow(now = new Date()): boolean {
    if (!this.shouldEnforceGrantWindow()) return true;
    return this.relevantScopeGrants().some((grant) => this.isGrantActive(grant, now));
  }

  grantClosedScheduleTitle(): string {
    if (this.isSelfCheckinMode()) return 'مواعيد تسجيل حضورك';
    return 'مواعيد أخذ الحضور المتاحة لك';
  }

  private refreshRuntimeState(): void {
    const now = new Date();
    const grant = this.pickCountdownGrant(now);
    const activeGrants = this.activeScopeGrants(now);
    this.countdownGrant = grant;
    this.countdownText = '';
    this.countdownTypeText = '';
    this.countdownFamilyText = '';
    this.countdownEndsAtText = '';
    this.countdownLabel = 'هيتقفل على';
    this.showCountdownClock = false;
    this.runtimeBlockedMessage = '';

    if (grant) {
      const startsAt = new Date(grant.startsAt).getTime();
      const endsAt = new Date(grant.endsAt).getTime();
      const grantedTypes = this.grantedTypesFrom(activeGrants, this.selectedFamily);
      const grantedFamilies = this.grantedFamiliesFrom(this.relevantScopeGrants());
      const active = !Number.isNaN(startsAt) && !Number.isNaN(endsAt) && startsAt <= now.getTime() && now.getTime() <= endsAt;
      const upcoming = !Number.isNaN(startsAt) && now.getTime() < startsAt;
      const targetTime = upcoming ? startsAt : endsAt;
      const remaining = targetTime - now.getTime();
      this.countdownTypeText = grantedTypes.map((type) => this.displayTypeLabel(type)).filter(Boolean).join(' + ') || this.countdownTypesText(grant);
      this.countdownFamilyText = grantedFamilies.length
        ? this.shortFamilyDisplayList(grantedFamilies)
        : this.shortFamilyDisplayName(String(grant.familyBase || this.selectedFamily || ''));
      this.countdownLabel = upcoming ? 'هيبدأ' : (active ? 'هيتقفل على' : 'انتهى من');
      this.countdownEndsAtText = this.formatDateTime(upcoming ? grant.startsAt : grant.endsAt);

      if (remaining > 0) {
        this.showCountdownClock = remaining <= 5 * 60 * 60 * 1000;
        this.countdownText = this.showCountdownClock ? this.formatDuration(remaining) : '';
      } else {
        this.countdownText = '00:00:00';
      }
    }

    if (this.shouldEnforceGrantWindow() && !this.hasAnyOpenGrantNow(now)) {
      this.runtimeBlockedMessage = 'مفيش أي نوع حضور مفتوح دلوقتي لهذا الحساب. راجع المواعيد الظاهرة تحت.';
    }

    this.updateBlockedMessage();
  }

  private startCountdownTicker(): void {
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    this.countdownTimer = setInterval(() => this.refreshRuntimeState(), 1000);
  }

  hasActiveCountdownCard(): boolean {
    return !!this.countdownGrant && !this.blockedMessage && (!!this.countdownEndsAtText || this.showCountdownClock);
  }

  private configOpenDays(): number[] {
    return this.attendanceContext?.config?.servantEntryOpenDays || [4, 5, 6, 0, 1];
  }

  private configSelectableEventDays(): number[] {
    return this.attendanceContext?.config?.servantSelectableEventDays || [4, 5, 6];
  }

  private configDaysForType(type: AttendanceType, family = this.selectedFamily): number[] {
    const familyDays = family ? this.attendanceContext?.config?.familyTypeDays?.[family]?.[type] : undefined;
    return (familyDays && familyDays.length ? familyDays : this.attendanceContext?.config?.typeDays?.[type]) || this.defaultAttendanceConfig().typeDays[type] || [];
  }

  private configAbsenceAllowedDays(family = this.selectedFamily): number[] {
    const familyDays = family ? this.attendanceContext?.config?.familyAbsenceAllowedDays?.[family] : undefined;
    return (familyDays && familyDays.length ? familyDays : this.attendanceContext?.config?.servantSelectableEventDays) || [4, 5, 6];
  }

  private configAbsenceOpenDays(family = this.selectedFamily): number[] {
    const familyDays = family ? this.attendanceContext?.config?.familyAbsenceOpenDays?.[family] : undefined;
    return (familyDays && familyDays.length ? familyDays : this.attendanceContext?.config?.servantEntryOpenDays) || [4, 5, 6, 0, 1];
  }

  private configuredTypeHasDays(type: AttendanceType, family = this.selectedFamily): boolean {
    return this.configDaysForType(type, family).length > 0;
  }

  private customEventsForCurrentFamily(): AttendanceCustomEvent[] {
    const family = this.selectedFamily;
    return this.familyCustomEvents.filter((event) => {
      if (event.enabled === false) return false;
      if (!family) return this.isGlobalCustomEvent(event);
      return this.isCustomEventRelevantToFamily(event, family);
    });
  }

  private selectableCustomEvents(): AttendanceCustomEvent[] {
    return this.customEventsForCurrentFamily();
  }

  private customEventOptionValue(event: AttendanceCustomEvent): string {
    return `CUSTOM_EVENT:${Number(event.id || 0)}`;
  }

  isSelectedCustomEventType(): boolean {
    return this.selectedType === 'CUSTOM_EVENT' || this.selectedType.startsWith('CUSTOM_EVENT:');
  }

  private selectedAttendanceType(): AttendanceType {
    return this.isSelectedCustomEventType() ? 'CUSTOM_EVENT' : this.selectedType as AttendanceType;
  }

  private selectedCustomEventIdFromType(): number {
    if (!this.selectedType.startsWith('CUSTOM_EVENT:')) return 0;
    return Number(this.selectedType.split(':')[1] || 0);
  }

  private buildTypeOptionsForCurrentScope(): TypeOption[] {
    if (this.isSelfCheckinMode()) {
      const options = (this.attendanceContext?.selfAllowedTypes || []).map(type => ({ value: type, type, label: this.typeLabel(type) }));
      return this.restrictOptionsByGrantScope(options);
    }

    const opts: TypeOption[] = [];

    if (this.configuredTypeHasDays('FAMILY_MEETING')) opts.push({ value: 'FAMILY_MEETING', type: 'FAMILY_MEETING', label: this.typeLabel('FAMILY_MEETING') });
    if (this.configuredTypeHasDays('FRIDAY_LITURGY')) opts.push({ value: 'FRIDAY_LITURGY', type: 'FRIDAY_LITURGY', label: this.typeLabel('FRIDAY_LITURGY') });
    if (this.configuredTypeHasDays('TASBEEHA')) opts.push({ value: 'TASBEEHA', type: 'TASBEEHA', label: this.typeLabel('TASBEEHA') });

    if (this.canUseCustomEvent() && this.selectableCustomEvents().length) {
      this.selectableCustomEvents().forEach((event) => {
        if (!event.id) return;
        opts.push({
          value: this.customEventOptionValue(event),
          type: 'CUSTOM_EVENT',
          customEventId: Number(event.id),
          label: `${event.title || this.typeLabel('CUSTOM_EVENT')} — ${this.dayLabel(Number(event.dayOfWeek))}`
        });
      });
    }

    return this.restrictOptionsByGrantScope(opts);
  }

  private refreshTypeOptions(): void {
    const current = this.selectedType;
    this.typeOptions = this.buildTypeOptionsForCurrentScope();
    const currentOption = this.typeOptions.find((option) => option.value === current);
    if (!currentOption || currentOption.disabled) {
      this.selectedType = this.typeOptions.find((option) => !option.disabled)?.value || this.typeOptions[0]?.value || 'FRIDAY_LITURGY';
    }
    this.ensureCustomEventSelection();
  }

  enabledTypeOptionsCount(): number {
    return this.typeOptions.filter((option) => !option.disabled).length;
  }

  selectedTypeOptionDisabled(): boolean {
    return !!this.typeOptions.find((option) => option.value === this.selectedType)?.disabled;
  }

  private ensureCustomEventSelection(): void {
    if (!this.isSelectedCustomEventType()) {
      this.selectedCustomEventId = '';
      this.customTitle = '';
      return;
    }

    const events = this.selectableCustomEvents();
    const idFromType = this.selectedCustomEventIdFromType();
    if (idFromType) this.selectedCustomEventId = idFromType;
    const selectedStillExists = events.some((event) => Number(event.id) === Number(this.selectedCustomEventId || 0));
    const selected = selectedStillExists ? this.selectedCustomEvent() : events[0];
    this.selectedCustomEventId = selected?.id || '';
    if (selected?.id && this.selectedType === 'CUSTOM_EVENT') {
      this.selectedType = this.customEventOptionValue(selected);
    }
    this.customTitle = selected?.title || '';
  }

  private weekdaysForSelectedType(): number[] {
    if (this.isSelectedCustomEventType()) {
      const selected = this.selectedCustomEvent();
      const events = selected ? [selected] : this.selectableCustomEvents();
      return Array.from(new Set(events.map((event) => Number(event.dayOfWeek)).filter((day) => this.weekDays.includes(day))));
    }

    const selectedType = this.selectedAttendanceType();
    const grantDays = this.shouldEnforceGrantWindow() ? this.grantOccasionDaysForType(selectedType) : [];
    if (grantDays.length) return grantDays;

    if (this.selectedType === 'MARMARKOS_KHORS') return this.configDaysForType('MARMARKOS_KHORS', 'خورس مارمرقس');
    if (this.selectedType === 'ATHANASIUS_KHORS') return this.configDaysForType('ATHANASIUS_KHORS', 'خورس البابا أثناسيوس');
    return this.configDaysForType(selectedType);
  }

  private canOverrideAbsenceOpenClose(): boolean {
    const roleNorm = this.roleNorm();
    return ['AMIN_OSRA', 'AMIN_KHEDMA', 'DEVELOPER'].includes(roleNorm) || this.hasAnyAminPrivilegeScope();
  }

  private dateMatchesSelectedType(date: Date): boolean {
    const days = this.weekdaysForSelectedType();
    if (!days.includes(date.getDay())) return false;
    if (!this.isSelectedCustomEventType()) return true;
    const selected = this.selectedCustomEvent();
    if (selected) return this.isCustomEventAvailableForDate(selected, date);
    return this.selectableCustomEvents().some((event) => this.isCustomEventAvailableForDate(event, date));
  }

  private findLatestAllowedTypeDate(from: Date, minDate: Date, maxDate: Date): Date | null {
    const start = new Date(Math.min(from.getTime(), maxDate.getTime()));
    start.setHours(0, 0, 0, 0);
    for (let i = 0; i < 370; i++) {
      const candidate = new Date(start);
      candidate.setDate(start.getDate() - i);
      if (candidate < minDate) break;
      if (this.dateMatchesSelectedType(candidate)) return candidate;
    }
    return null;
  }

  private updateCalendarForSelectedType(keepCurrentDate = false): void {
    if (!this.typeOptions.length) {
      this.disabledDays = [...this.weekDays];
      this.selectedDate = null;
      return;
    }

    const current = this.selectedDate ? new Date(this.selectedDate) : null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (this.isSelfCheckinMode()) {
      const allowedDays = this.weekdaysForSelectedType();
      const nearestDate = this.nearestMatchingDate(today, allowedDays);
      if (!nearestDate) {
        this.disabledDays = [...this.weekDays];
        this.minDate = today;
        this.maxDate = today;
        this.selectedDate = null;
        this.refreshAvailableCustomEvents();
        return;
      }

      this.disabledDays = [];
      this.minDate = new Date(nearestDate);
      this.maxDate = new Date(nearestDate);
      const keepSameDate = keepCurrentDate
        && current
        && current.toDateString() === nearestDate.toDateString();
      this.selectedDate = keepSameDate ? current : new Date(nearestDate);
      this.refreshAvailableCustomEvents();
      return;
    }

    const typeDays = this.weekdaysForSelectedType();
    const allowedAbsenceDays = this.canOverrideAbsenceOpenClose() ? this.weekDays : this.configAbsenceAllowedDays();
    const allowedDays = typeDays.filter((day) => allowedAbsenceDays.includes(day));
    this.disabledDays = this.weekDays.filter((day) => !allowedDays.includes(day));

    const maxDate = this.maxDate || today;
    const minDate = this.minDate || new Date(2000, 0, 1);
    if (keepCurrentDate && current && current >= minDate && current <= maxDate && this.dateMatchesSelectedType(current)) {
      this.refreshAvailableCustomEvents();
      return;
    }

    this.selectedDate = this.findLatestAllowedTypeDate(today, minDate, maxDate);
    this.refreshAvailableCustomEvents();
  }

  private allowedWeekdaysForCurrentUser(): number[] {
    const days = new Set<number>();
    ['FRIDAY_LITURGY', 'TASBEEHA', 'FAMILY_MEETING'].forEach((type) => {
      this.configDaysForType(type as AttendanceType).forEach((day) => days.add(day));
    });

    return [...days].sort((a, b) => a - b);
  }

  private typeLabel(type: AttendanceType): string {
    return this.attendanceContext?.config?.typeLabels?.[type] || type;
  }

  displayTypeLabel(type?: AttendanceType | string | null): string {
    const key = String(type || '').trim();
    if (!key) return '';
    return this.attendanceContext?.config?.typeLabels?.[key] || key;
  }

  private initCalendarRules(): void {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    this.maxDate = today;
    this.pageBlockedMessage = '';
    this.disabledDays = this.isSelfCheckinMode() ? this.weekDays.filter(x => x !== today.getDay()) : [];
    this.refreshTypeOptions();

    if (this.isSelfCheckinMode()) {
      this.selected = [this.selfPickUser()];
      this.updateCalendarForSelectedType(false);
      this.updateBlockedMessage();
      return;
    }

    const canOverrideWeekClose = this.canOverrideAbsenceOpenClose();

    if (!canOverrideWeekClose && !this.shouldEnforceGrantWindow() && !this.configAbsenceOpenDays().includes(today.getDay())) {
      this.pageBlockedMessage = 'تسجيل الغياب مقفول اليوم حسب الإعدادات الحالية لهذه الأسرة.';
    }

    const todayDay = today.getDay();
    const diffToMonday = (todayDay + 6) % 7;
    const monday = new Date(today);
    monday.setDate(today.getDate() - diffToMonday);

    this.minDate = canOverrideWeekClose ? new Date(2000, 0, 1) : monday;

    if (this.isKhadim()) {
      this.minDate = new Date(2000, 0, 1);
    }

    this.updateCalendarForSelectedType(false);
    this.updateBlockedMessage();
  }

  private findLatestAllowedDate(from: Date, allowed: number[], minDate: Date): Date | null {
    for (let i = 0; i < 14; i++) {
      const x = new Date(from);
      x.setDate(from.getDate() - i);
      if (x < minDate) break;
      if (allowed.includes(x.getDay())) return x;
    }
    return null;
  }

  private selfPickUser(): PickUser {
    return {
      id: Number(this.me?.id || 0),
      username: String(this.me?.username || ''),
      fullName: String(this.me?.fullName || this.me?.username || 'أنا'),
      role: String(this.me?.role || ''),
      deaconFamily: String(this.me?.deaconFamily || ''),
      familyAssignments: Array.isArray(this.me?.familyAssignments) ? this.me.familyAssignments : []
    };
  }

  private includeSelfInList(list: PickUser[]): PickUser[] {
    const self = this.selfPickUser();
    if (!self.id || String(self.role || '').toUpperCase() === 'DEVELOPER') return list || [];
    const current = Array.isArray(list) ? list : [];
    if (current.some((user) => Number(user?.id) === Number(self.id))) return current;
    return [self, ...current];
  }

  onDateChange() {
    if (!this.selectedDate) {
      this.refreshRuntimeState();
      return;
    }

    const d = new Date(this.selectedDate);
    d.setHours(0, 0, 0, 0);
    if (this.typeOptions.length && !this.dateMatchesSelectedType(d)) {
      this.updateCalendarForSelectedType(false);
      this.refreshRuntimeState();
      return;
    }

    this.refreshAvailableCustomEvents();
    this.refreshRuntimeState();
  }

  onTypeChange() {
    this.ensureCustomEventSelection();
    this.syncFamilyWithType();
    this.updateCalendarForSelectedType(false);
    this.refreshRuntimeState();
  }

  private syncFamilyWithType() {
    if (this.selectedType === 'MARMARKOS_KHORS') {
      this.selectedFamily = 'خورس مارمرقس';
      this.loadMembersForFamily();
    } else if (this.selectedType === 'ATHANASIUS_KHORS') {
      this.selectedFamily = 'خورس البابا أثناسيوس';
      this.loadMembersForFamily();
    }
  }

  private toIsoDate(d: Date): string {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  toggleScan() {
    if (this.isSelfCheckinMode() || this.isSelectedCustomEventType() || !!this.blockedMessage) return;
    this.scanning = !this.scanning;
  }

  onFamilyChange() {
    this.syncSelectedFamilyWithGrantScope();
    this.members = [];
    this.membersLoadError = '';
    this.globalResults = [];
    this.familyCustomEvents = [];
    this.availableCustomEvents = [];
    this.selectedCustomEventId = '';
    this.customTitle = '';
    this.refreshTypeOptions();
    if (this.selectedFamily) this.loadMembersForFamily();
    else if (this.searchText.trim()) this.runSearch();
    if (this.canManageAccessGrants()) this.loadGrantTargets();
    this.loadCustomEventsForFamily();
    this.initCalendarRules();
    this.refreshRuntimeState();
  }

  onSearchChange(v: string) {
    this.searchText = v;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.runSearch(), 250);
  }

  private runSearch() {
    const q = (this.searchText || '').trim();
    if (this.selectedFamily || !q) {
      if (!q) this.globalResults = [];
      return;
    }

    this.searching = true;
    this.familySvc.search(q).subscribe({
      next: (list) => {
        this.globalResults = (list as any[])?.map(this.toPickUser) || [];
        this.searching = false;
      },
      error: () => {
        this.globalResults = [];
        this.searching = false;
      }
    });
  }

  private loadFamilies() {
    if (this.isSelfCheckinMode()) {
      const grantedFamilies = this.currentGrantFamilyOptions();
      const familyFromGrant = grantedFamilies[0]
        || this.grantFamilyList(this.attendanceContext?.activeGrants?.find(g => g.grantKind === 'SELF_CHECKIN' && g.familyBase)?.familyBase)[0]
        || '';
      this.selectedFamily = familyFromGrant || String(this.me?.deaconFamily || '');
      this.selected = [];
      if (this.selectedFamily) this.loadMembersForFamily();
      this.refreshRuntimeState();
      return;
    }

    this.familySvc.families('attendance').subscribe({
      next: (f) => {
        const allFamilies = sortFamiliesByPreferredOrder(Array.from(new Set([...(f || []), ...this.choirFamilies()])), this.preferredFamilyOrder);
        this.families = this.filterFamiliesByGrantScope(allFamilies);
        this.ensureSelectedConfigFamily();
        this.syncSelectedFamilyWithGrantScope();
        if ((!this.selectedFamily || !this.families.includes(this.selectedFamily)) && this.families.length) {
          this.selectedFamily = this.families[0];
          this.loadMembersForFamily();
        } else if (this.selectedFamily) {
          this.loadMembersForFamily();
        }
        this.loadCustomEventsForFamily();
        this.initCalendarRules();
        this.refreshRuntimeState();
        if (this.canManageAccessGrants()) this.loadGrantTargets();
      },
      error: () => (this.families = [])
    });
  }

  private loadMembersForFamily() {
    if (!this.selectedFamily) return;
    this.membersLoading = true;
    this.membersLoadError = '';

    const familiesToLoad = this.scopeFamiliesForSelection(this.selectedFamily);
    const requestedFamilies = Array.from(new Set((familiesToLoad.length ? familiesToLoad : [this.selectedFamily]).filter(Boolean)));

    const requests = requestedFamilies.map((family) =>
      this.familySvc.members(family, true, 'attendance').pipe(
        catchError((err) => {
          console.error('Failed to load attendance family members', family, err);
          return of([] as any[]);
        })
      )
    );

    forkJoin(requests.length ? requests : [of([] as any[])]).subscribe({
      next: (groups) => {
        const merged = groups.flatMap((group: any) => Array.isArray(group) ? group : []);
        const unique = Array.from(new Map(merged.map((user: any) => [Number(user?.id), user])).values());
        this.members = this.includeSelfInList(unique.map(this.toPickUser));
        this.membersLoading = false;

        if (this.members.length <= 1 && requestedFamilies.length) {
          this.membersLoadError = 'لم يتم العثور على أسماء أخرى داخل نطاق الأسرة المفتوح لهذا التخصيص';
        }

        if (this.canManageAccessGrants()) this.loadGrantTargets();
      },
      error: () => {
        this.members = this.includeSelfInList([]);
        this.membersLoading = false;
        this.membersLoadError = 'تعذر تحميل أسماء الأسرة لهذا التخصيص';
      }
    });
  }

  private toPickUser = (u: any): PickUser => ({
    id: Number(u?.id),
    username: u?.username,
    fullName: u?.fullName,
    role: u?.role,
    roleCode: Number.isFinite(Number(u?.roleCode)) ? Number(u.roleCode) : undefined,
    familyName: this.familyLabel(u),
    deaconFamily: u?.deaconFamily,
    familyAssignments: u?.familyAssignments
  });

  familyLabel(entity: any): string {
    const assignments = Array.isArray(entity?.familyAssignments) ? entity.familyAssignments : [];
    return assignments
      .map((x: any) => String(x?.familyName || '').trim())
      .filter(Boolean)
      .join(' + ') || String(entity?.deaconFamily || '').trim();
  }

  prettyRole(role?: string): string {
    return roleLabel(role);
  }

  get displayedMembers(): PickUser[] {
    const q = (this.searchText || '').trim().toLowerCase();
    if (this.selectedFamily) {
      if (!q) return this.members;
      return this.members.filter((m) => (m.fullName || '').toLowerCase().includes(q));
    }
    return this.globalResults;
  }

  isSelected(id: number): boolean {
    return this.selected.some((x) => x.id === id);
  }

  canPickDisplayedUser(u: PickUser): boolean {
    return !this.isSelfCheckinMode() || Number(u?.id) === Number(this.me?.id);
  }

  toggleSelect(u: PickUser) {
    if (!u?.id || this.isSelected(u.id)) return;
    if (!this.canPickDisplayedUser(u)) {
      this.message.add({ severity: 'warn', summary: 'غير مسموح', detail: 'هذا التخصيص لتسجيل حضورك أنت فقط.' });
      return;
    }
    this.selected = [...this.selected, u];
  }

  remove(id: number) {
    this.selected = this.selected.filter((x) => x.id !== id);
  }

  onCodeResult(resultString: string) {
    if (this.isSelfCheckinMode() || this.isSelectedCustomEventType()) return;
    const token = (resultString || '').trim();
    if (!token) return;

    const now = Date.now();
    if (token === this.lastScannedToken && now - this.lastScannedAt < 1500) return;
    this.lastScannedToken = token;
    this.lastScannedAt = now;

    const iso = this.selectedDate ? this.toIsoDate(this.selectedDate) : undefined;
    const requestedFamily = this.selectedFamily || undefined;
    const selectedType = this.selectedAttendanceType();
    const family = (this.shouldEnforceGrantWindow() && requestedFamily)
      ? requestedFamily
      : (['FAMILY_MEETING', 'CUSTOM_EVENT', 'MARMARKOS_KHORS', 'ATHANASIUS_KHORS'].includes(selectedType)
        ? requestedFamily
        : undefined);

    this.attendance.scanToken(token, iso, selectedType, family).subscribe({
      next: (u) => {
        const pu = this.toPickUser(u);
        if (!pu?.id) return;

        const effectiveFamily = String((u as any)?.effectiveFamilyBase || this.familyLabel(u) || '').trim();
        if (effectiveFamily && effectiveFamily !== this.selectedFamily) {
          this.selectedFamily = effectiveFamily;
          this.loadMembersForFamily();
          this.initCalendarRules();
          this.refreshRuntimeState();
          this.message.add({
            severity: 'info',
            summary: 'تم تغيير الأسرة تلقائياً',
            detail: `تم تحويل التسجيل إلى ${effectiveFamily} لأن العضو يتبع هذه الأسرة.`,
            life: 3500
          });
        }

        if (u?.alreadyPresent) {
          this.message.add({ severity: 'warn', summary: 'تم تسجيله بالفعل', detail: `${pu.fullName} متسجل بالفعل في نفس اليوم.`, life: 3500 });
          return;
        }

        if (this.isSelected(pu.id)) {
          this.message.add({ severity: 'warn', summary: 'الاسم موجود بالفعل', detail: `${pu.fullName} موجود بالفعل في قائمة التسجيل.`, life: 3000 });
          return;
        }

        this.selected = [...this.selected, pu];
        this.message.add({ severity: 'success', summary: 'تم السكان بنجاح', detail: `${pu.fullName} اتضاف في قائمة التسجيل.`, life: 3000 });
      },
      error: (err) => {
        const detail = err?.error?.error || err?.error?.message || 'الكود غير صحيح أو العضو غير موجود.';
        this.message.add({ severity: 'warn', summary: 'تعذر قراءة الـ QR', detail, life: 4000 });
      }
    });
  }

  submit() {
    if (this.blockedMessage) {
      this.message.add({ severity: 'warn', summary: 'مغلق', detail: this.blockedMessage });
      return;
    }
    if (!this.selectedDate) {
      this.message.add({ severity: 'warn', summary: 'No date', detail: 'اختار اليوم أولاً' });
      return;
    }
    const iso = this.toIsoDate(this.selectedDate);
    const selectedType = this.selectedAttendanceType();

    if (this.isSelfCheckinMode()) {
      this.attendance.selfCheckin(selectedType, iso).subscribe({
        next: (res) => {
          this.message.add({
            severity: 'success',
            summary: 'تم حفظ حضورك',
            detail: `تم تسجيل حضورك ليوم ${res?.date || iso}.`,
            life: 4000
          });
        },
        error: (err) => {
          this.message.add({ severity: 'error', summary: 'خطأ', detail: err?.error?.error || err?.error?.message || 'فشل تسجيل حضورك' });
        }
      });
      return;
    }

    const users = this.selected.map((x) => ({ id: x.id, username: x.username }));
    const canOverrideWeekClose = ['AMIN_OSRA', 'AMIN_KHEDMA', 'DEVELOPER'].includes(this.roleNorm()) || this.hasAnyAminPrivilegeScope();
    const allowedFamilies = this.currentGrantFamilyOptions();
    const allowedTypes = this.grantedTypesFrom(this.activeScopeGrants(), this.selectedFamily);

    if (allowedFamilies.length && this.selectedFamily && !allowedFamilies.includes(this.selectedFamily)) {
      this.message.add({ severity: 'warn', summary: 'غير مسموح', detail: 'التخصيص الحالي لا يسمح لك بالتسجيل لهذه الأسرة.' });
      return;
    }

    if (this.shouldEnforceGrantWindow() && !allowedTypes.length) {
      this.message.add({ severity: 'warn', summary: 'غير متاح الآن', detail: 'وقت التخصيص المحدد غير مفتوح الآن. راجع ميعاد النوع.' });
      return;
    }

    if (allowedTypes.length && !allowedTypes.includes(selectedType)) {
      this.message.add({ severity: 'warn', summary: 'غير مسموح', detail: 'التخصيص الحالي لا يسمح لك بالتسجيل لهذا النوع.' });
      return;
    }

    if (users.length === 0 && !canOverrideWeekClose) {
      this.message.add({ severity: 'warn', summary: 'No users', detail: 'اختار اسم واحد على الأقل أو اعمل Scan للـ QR' });
      return;
    }

    if (['FAMILY_MEETING', 'CUSTOM_EVENT', 'MARMARKOS_KHORS', 'ATHANASIUS_KHORS'].includes(selectedType) && !this.selectedFamily) {
      this.message.add({ severity: 'warn', summary: 'No family', detail: 'اختار الأسرة قبل التسجيل' });
      return;
    }

    if (selectedType === 'CUSTOM_EVENT' && !this.customTitle.trim()) {
      this.message.add({ severity: 'warn', summary: 'العنوان مطلوب', detail: 'اختار المناسبة المخصصة أولاً' });
      return;
    }

    this.attendance.submit(users, selectedType, iso, this.selectedFamily || undefined, this.customTitle.trim() || undefined).subscribe({
      next: (res) => {
        const created = res?.presentCreated ?? res?.created ?? 0;
        const updated = res?.presentUpdated ?? res?.updated ?? 0;
        const skipped = res?.skipped ?? 0;
        const totalPresent = created + updated;

        if (totalPresent === 0 && skipped > 0) {
          this.message.add({ severity: 'warn', summary: 'لم يتم تسجيل حضور جديد', detail: 'قد تم تسجيل هذا الاسم من قبل', life: 4000 });
          this.selected = [];
          return;
        }

        if (skipped > 0) {
          this.message.add({ severity: 'warn', summary: 'تم الحفظ مع تجاهل مكرر', detail: `تم تسجيل حضور ${totalPresent}، وفيه ${skipped} متسجلين بالفعل.`, life: 4000 });
          this.selected = [];
          return;
        }

        this.message.add({ severity: 'success', summary: 'تم حفظ تسجيل الحضور', detail: `تم حفظ الحضور بنجاح ليوم ${res?.date || iso} — الحضور: ${totalPresent}`, life: 4000 });
        this.selected = [];
      },
      error: (err) => {
        this.message.add({ severity: 'error', summary: 'Error', detail: err?.error?.error || err?.error?.message || 'Failed' });
      }
    });
  }

  // ===== Grants management =====
  private defaultGrantForm(): Partial<AttendanceAccessGrant> {
    return {
      grantKind: 'SELF_CHECKIN',
      allowedTypes: ['FRIDAY_LITURGY'],
      dayOfWeek: new Date().getDay(),
      startsAt: this.nowPlusHours(0),
      endsAt: this.nowPlusHours(2),
      enabled: true,
      familyBase: this.canChooseGrantFamily() ? this.selectedFamily : this.defaultGrantScopeFamily()
    };
  }

  private assignmentsOf(entity: any): Array<{ familyName: string; role: string; assignmentOrder: number }> {
    const raw = Array.isArray(entity?.familyAssignments) ? entity.familyAssignments : [];
    return raw
      .map((x: any) => ({
        familyName: String(x?.familyName || '').trim(),
        role: normalizeAssignmentRole(x, entity?.role),
        assignmentOrder: Number.isFinite(Number(x?.assignmentOrder)) ? Number(x.assignmentOrder) : Number.MAX_SAFE_INTEGER
      }))
      .filter((x: { familyName: string }) => !!x.familyName);
  }

  private isServantGrantTarget(user?: PickUser | null, includeMembersForTakingAttendance = false): boolean {
    const role = normalizeRole(user?.role, user?.roleCode);
    const assignmentRoles = this.assignmentsOf(user).map((x) => x.role);
    const effectiveRoles = new Set([role, ...assignmentRoles].filter(Boolean));

    if (user?.id && Number(user.id) === Number(this.me?.id || 0)) {
      return false;
    }

    if (includeMembersForTakingAttendance && effectiveRoles.has('MAKHDOM')) {
      return true;
    }

    if (this.isAminKhedmaOrDeveloper()) {
      return effectiveRoles.has('KHADIM') || effectiveRoles.has('AMIN_OSRA') || effectiveRoles.has('AMIN_KHEDMA');
    }

    return effectiveRoles.has('KHADIM');
  }

  private primaryFamilyFor(user?: PickUser | null): string {
    const assignments = this.assignmentsOf(user)
      .filter((x) => !String(x.familyName || '').includes('خورس'))
      .sort((a, b) => a.assignmentOrder - b.assignmentOrder);
    return assignments[0]?.familyName || String(user?.deaconFamily || user?.familyName || '').trim();
  }

  private pairedMemberFamiliesFor(user?: PickUser | null): string[] {
    const assignments = this.assignmentsOf(user)
      .map((x) => canonicalFamilyName(x.familyName, { keepSubFamilies: true }))
      .filter((name) => !!name && !name.includes('خورس'));

    const current = assignments[0] || canonicalFamilyName(user?.deaconFamily || user?.familyName || '', { keepSubFamilies: true });
    if (!current) return [];

    if (current === 'اسرة القديس البابا كيرلس أ' || current === 'اسرة القديس البابا كيرلس ب') {
      return ['اسرة القديس البابا كيرلس أ', 'اسرة القديس البابا كيرلس ب'];
    }

    if (current === 'اسرة القديس الانبا ابرام أ' || current === 'اسرة القديس الانبا ابرام ب') {
      return ['اسرة القديس الانبا ابرام أ', 'اسرة القديس الانبا ابرام ب'];
    }

    return [current];
  }

  private belongsToFamilyScope(user: PickUser | null | undefined, family: string): boolean {
    const scopedFamily = canonicalFamilyName(family);
    if (!scopedFamily) return true;

    const userFamilies = [
      user?.deaconFamily,
      this.primaryFamilyFor(user),
      ...this.assignmentsOf(user).map((x) => x.familyName)
    ]
      .map((name) => canonicalFamilyName(name))
      .filter(Boolean);

    return userFamilies.includes(scopedFamily);
  }

  private grantAudienceFromKind(kind?: AttendanceAccessGrant['grantKind']): GrantAudience {
    return kind === 'TAKE_ATTENDANCE' ? 'SERVANTS' : 'MEMBERS';
  }

  private grantKindFromAudience(audience: GrantAudience): AttendanceAccessGrant['grantKind'] {
    return audience === 'SERVANTS' ? 'TAKE_ATTENDANCE' : 'SELF_CHECKIN';
  }

  private syncGrantDateControls(): void {
    this.grantStartsAtDate = this.grantForm.startsAt ? new Date(this.grantForm.startsAt) : null;
    this.grantEndsAtDate = this.grantForm.endsAt ? new Date(this.grantForm.endsAt) : null;
  }

  onGrantAudienceChange(): void {
    if (this.selectedGrantTargetIds.length && this.grantAudience !== this.lastGrantAudience) {
      this.message.add({
        severity: 'warn',
        summary: 'تنبيه',
        detail: 'احفظ التخصيص أولًا أو امسح الأسماء المختارة قبل تغيير الفئة.'
      });
      this.grantAudience = this.lastGrantAudience;
      return;
    }

    this.grantForm.grantKind = this.grantKindFromAudience(this.grantAudience);
    this.grantForm.targetUserId = undefined;
    this.selectedGrantTargetIds = [];
    this.grantTargetSearch = '';
    this.grantTargets = [];
    this.selectedGrantTargetList = [];
    this.filteredGrantTargetList = [];
    if (this.grantAudience === 'SERVANTS') {
      this.grantFamilySelections = this.grantForm.familyBase ? [this.grantForm.familyBase] : [];
      this.syncGrantFamilyFormFromSelections();
      this.loadGrantTargets(this.grantForm.familyBase || this.defaultGrantScopeFamily());
    } else {
      this.grantFamilySelections = this.canChooseGrantFamily() ? [] : (this.defaultGrantScopeFamily() ? [this.defaultGrantScopeFamily()] : []);
      this.grantForm.familyBase = this.canChooseGrantFamily() ? '' : this.defaultGrantScopeFamily();
      this.loadGrantTargets(this.grantForm.familyBase || this.defaultGrantScopeFamily());
    }
    this.loadGrantCustomEvents();
    this.lastGrantAudience = this.grantAudience;
  }

  onGrantFamilyBaseChange(): void {
    this.grantForm.targetUserId = undefined;
    this.selectedGrantTargetIds = [];
    this.grantTargetSearch = '';
    if (this.grantAudience === 'SERVANTS') {
      this.grantFamilySelections = this.grantForm.familyBase ? [this.grantForm.familyBase] : [];
      this.syncGrantFamilyFormFromSelections();
    }
    this.loadGrantTargets(this.grantForm.familyBase || this.defaultGrantScopeFamily());
    this.loadGrantCustomEvents();
  }

  onGrantTargetChange(): void {
    const target = this.grantTargets.find((u) => u.id === this.grantForm.targetUserId);
    if (!target) return;
    if (this.grantAudience === 'MEMBERS') {
      this.grantForm.familyBase = this.pairedMemberFamiliesFor(target).join(', ');
    } else if (!this.grantForm.familyBase) {
      this.grantFamilySelections = [this.primaryFamilyFor(target)];
      this.syncGrantFamilyFormFromSelections();
    }
  }

  onGrantStartDateChange(value: Date | null): void {
    this.grantStartsAtDate = value;
    this.grantForm.startsAt = value ? this.toDateTimeLocalValue(value) : '';
    if (this.grantSelectedWeekday !== null) {
      this.onGrantWindowStartChange(this.grantSelectedWeekday, value);
    }
  }

  onGrantEndDateChange(value: Date | null): void {
    this.grantEndsAtDate = value;
    this.grantForm.endsAt = value ? this.toDateTimeLocalValue(value) : '';
    if (this.grantSelectedWeekday !== null) {
      this.onGrantWindowEndChange(this.grantSelectedWeekday, value);
    }
  }

  private grantScopeFamilies(): string[] {
    if (this.grantAudience === 'SERVANTS') {
      if (this.canChooseGrantFamily()) return this.grantFamilySelections.filter(Boolean);
      return [this.defaultGrantScopeFamily()].filter(Boolean);
    }
    return this.grantFamilyList(this.grantForm.familyBase).filter(Boolean);
  }

  private grantPrimaryScopeFamily(): string {
    return this.grantScopeFamilies()[0] || this.defaultGrantScopeFamily();
  }

  private grantDaysForType(type: AttendanceType): number[] {
    if (type === 'CUSTOM_EVENT') return [];
    const family = this.grantPrimaryScopeFamily();
    return this.configDaysForType(type, family);
  }

  private rebuildGrantOccasionOptions(): void {
    const base = this.grantTypeOptions()
      .map((opt) => ({
        key: `TYPE:${opt.value}`,
        type: opt.value,
        label: opt.label,
        days: this.grantDaysForType(opt.value)
      }))
      .filter((opt) => opt.days.length);

    const custom = (this.grantCustomEvents || []).map((event) => ({
      key: `CUSTOM:${Number(event.id || 0)}`,
      type: 'CUSTOM_EVENT' as AttendanceType,
      label: event.title || 'مناسبة مخصصة',
      days: this.weekDays.includes(Number(event.dayOfWeek)) ? [Number(event.dayOfWeek)] : [],
      customEventId: Number(event.id || 0)
    })).filter((opt) => opt.days.length);

    this.grantOccasionOptionList = [...base, ...custom];
  }

  private selectedGrantOccasion(): GrantOccasionOption | null {
    return this.grantOccasionOptionList.find((option) => option.key === this.grantSelectedOccasionKey) || null;
  }

  private refreshGrantWeekdayOptions(): void {
    const selected = this.selectedGrantOccasion();
    const days = [...(selected?.days || [])];
    const savedDay = this.weekDays.includes(Number(this.grantForm.dayOfWeek)) ? Number(this.grantForm.dayOfWeek) : null;
    if (this.grantDialogMode === 'edit' && savedDay !== null && !days.includes(savedDay)) {
      days.push(savedDay);
    }
    this.grantWeekdayOptionList = Array.from(new Set(days));
  }

  grantWindowList(): GrantDayWindow[] {
    return this.grantDayWindows || [];
  }

  private refreshSelectedGrantWindow(): void {
    this.selectedGrantWindowValue = this.grantSelectedWeekday === null
      ? null
      : this.grantDayWindows.find((item) => item.day === this.grantSelectedWeekday) || null;
  }

  private refreshGrantDialogViewModels(): void {
    this.rebuildGrantOccasionOptions();
    this.refreshGrantWeekdayOptions();
    this.refreshSelectedGrantWindow();
  }

  onGrantWindowStartChange(day: number, value: Date | null): void {
    const target = this.grantDayWindows.find((item) => item.day === day);
    if (!target) return;
    const nextValue = this.normalizeGrantDateValue(value);
    target.startsAt = nextValue;
    if (this.grantSelectedWeekday === day) {
      this.grantStartsAtDate = nextValue;
      this.grantForm.startsAt = nextValue ? this.toDateTimeLocalValue(nextValue) : '';
    }
  }

  onGrantWindowEndChange(day: number, value: Date | null): void {
    const target = this.grantDayWindows.find((item) => item.day === day);
    if (!target) return;
    const nextValue = this.normalizeGrantDateValue(value);
    target.endsAt = nextValue;
    if (this.grantSelectedWeekday === day) {
      this.grantEndsAtDate = nextValue;
      this.grantForm.endsAt = nextValue ? this.toDateTimeLocalValue(nextValue) : '';
    }
  }

  private normalizeGrantDateValue(value: Date | null): Date | null {
    if (!value) return null;
    const date = value instanceof Date ? new Date(value) : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    date.setSeconds(0, 0);
    return date;
  }

  grantWindowDateValue(value: Date | null): string {
    return value ? this.toIsoDate(value) : '';
  }

  grantWindowTimeValue(value: Date | null): string {
    if (!value) return '';
    return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
  }

  private mergeGrantDatePart(current: Date | null, dateValue: string): Date | null {
    if (!dateValue) return null;
    const [year, month, day] = dateValue.split('-').map((part) => Number(part));
    if (!year || !month || !day) return current;
    const out = current && !Number.isNaN(current.getTime()) ? new Date(current) : new Date();
    out.setFullYear(year, month - 1, day);
    out.setSeconds(0, 0);
    return out;
  }

  private mergeGrantTimePart(current: Date | null, timeValue: string): Date | null {
    if (!timeValue) return current;
    const [hour, minute] = timeValue.split(':').map((part) => Number(part));
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return current;
    const out = current && !Number.isNaN(current.getTime()) ? new Date(current) : new Date();
    out.setHours(hour, minute, 0, 0);
    return out;
  }

  onGrantWindowStartDateInput(day: number, value: string): void {
    const target = this.grantDayWindows.find((item) => item.day === day);
    this.onGrantWindowStartChange(day, this.mergeGrantDatePart(target?.startsAt || null, value));
  }

  onGrantWindowStartTimeInput(day: number, value: string): void {
    const target = this.grantDayWindows.find((item) => item.day === day);
    this.onGrantWindowStartChange(day, this.mergeGrantTimePart(target?.startsAt || null, value));
  }

  onGrantWindowEndDateInput(day: number, value: string): void {
    const target = this.grantDayWindows.find((item) => item.day === day);
    this.onGrantWindowEndChange(day, this.mergeGrantDatePart(target?.endsAt || null, value));
  }

  onGrantWindowEndTimeInput(day: number, value: string): void {
    const target = this.grantDayWindows.find((item) => item.day === day);
    this.onGrantWindowEndChange(day, this.mergeGrantTimePart(target?.endsAt || null, value));
  }

  grantWindowDisabledDays(day: number): number[] {
    return [];
  }

  grantDateDisabledDays(): number[] {
    return [];
  }

  selectGrantOccasion(option: GrantOccasionOption): void {
    this.grantSelectedOccasionKey = option.key;
    this.grantForm.allowedTypes = [option.type];
    this.grantSelectedWeekday = option.days[0] ?? null;
    this.grantForm.dayOfWeek = this.grantSelectedWeekday;
    this.syncGrantDatesForSelection(true);
    this.refreshGrantDialogViewModels();
  }

  selectGrantWeekday(day: number): void {
    this.grantSelectedWeekday = day;
    this.grantForm.dayOfWeek = day;
    this.syncGrantDatesForSelection(true);
    this.refreshSelectedGrantWindow();
  }

  private nextMatchingWeekday(day: number, from?: Date | null): Date {
    const base = from ? new Date(from) : new Date();
    if (Number.isNaN(base.getTime())) return new Date();
    const candidate = new Date(base);
    const diff = (day - candidate.getDay() + 7) % 7;
    candidate.setDate(candidate.getDate() + diff);
    return candidate;
  }

  private withDatePart(source: Date | null, datePart: Date): Date {
    const out = new Date(datePart);
    if (source && !Number.isNaN(source.getTime())) {
      out.setHours(source.getHours(), source.getMinutes(), 0, 0);
    }
    return out;
  }

  private buildGrantWindow(day: number, startSource?: Date | null, endSource?: Date | null): GrantDayWindow {
    const anchor = this.nextMatchingWeekday(day, new Date());
    const startsAt = startSource && !Number.isNaN(startSource.getTime())
      ? new Date(startSource)
      : this.withDatePart(null, anchor);
    const endsAt = endSource && !Number.isNaN(endSource.getTime())
      ? new Date(endSource)
      : this.withDatePart(null, startsAt);
    if (endsAt.getTime() <= startsAt.getTime()) {
      endsAt.setHours(startsAt.getHours() + 2);
    }
    return { day, startsAt, endsAt };
  }

  private syncGrantDatesForSelection(forceMove = false): void {
    this.refreshGrantWeekdayOptions();
    const weekdays = this.grantWeekdayOptionList;
    if (!weekdays.length) {
      this.grantSelectedWeekday = null;
      this.grantDayWindows = [];
      this.refreshSelectedGrantWindow();
      return;
    }

    const selectedDay = this.grantSelectedWeekday !== null && weekdays.includes(this.grantSelectedWeekday)
      ? this.grantSelectedWeekday
      : weekdays[0];

    this.grantSelectedWeekday = selectedDay;
    this.grantForm.dayOfWeek = selectedDay;

    const anchor = this.nextMatchingWeekday(selectedDay, this.grantStartsAtDate || new Date());

    if (!this.grantStartsAtDate) {
      this.onGrantStartDateChange(this.withDatePart(null, anchor));
    }
    if (!this.grantEndsAtDate) {
      const endBase = this.withDatePart(null, this.grantStartsAtDate || anchor);
      if (!this.grantStartsAtDate || endBase.getTime() <= this.grantStartsAtDate.getTime()) {
        endBase.setHours(endBase.getHours() + 2);
      }
      this.onGrantEndDateChange(endBase);
    }

    const currentByDay = new Map((this.grantDayWindows || []).map((item) => [item.day, item] as const));
    this.grantDayWindows = weekdays.map((day) => {
      const current = currentByDay.get(day);
      if (!forceMove && current) {
        return this.buildGrantWindow(day, current.startsAt, current.endsAt);
      }
      if (day === selectedDay) {
        return this.buildGrantWindow(day, this.grantStartsAtDate, this.grantEndsAtDate);
      }
      return this.buildGrantWindow(day, this.grantStartsAtDate, this.grantEndsAtDate);
    });
    this.refreshSelectedGrantWindow();
  }

  private syncGrantOccasionFromForm(): void {
    this.rebuildGrantOccasionOptions();
    const allowedType = (this.grantForm.allowedTypes || [])[0] || 'FRIDAY_LITURGY';
    if (allowedType === 'CUSTOM_EVENT') {
      const custom = this.grantCustomEvents[0];
      this.grantSelectedOccasionKey = custom ? `CUSTOM:${Number(custom.id || 0)}` : '';
    } else {
      this.grantSelectedOccasionKey = `TYPE:${allowedType}`;
    }

    const selected = this.selectedGrantOccasion();
    const savedDay = this.weekDays.includes(Number(this.grantForm.dayOfWeek)) ? Number(this.grantForm.dayOfWeek) : null;
    this.grantSelectedWeekday = savedDay !== null && (selected?.days || []).includes(savedDay)
      ? savedDay
      : (selected?.days[0] ?? savedDay ?? null);
    this.syncGrantDatesForSelection(false);
    this.refreshGrantDialogViewModels();
  }

  private loadGrantCustomEvents(): void {
    this.syncGrantOccasionFromForm();

    if (!this.canUseCustomEvent()) {
      this.grantCustomEvents = [];
      this.syncGrantOccasionFromForm();
      return;
    }

    const families = Array.from(new Set(this.grantScopeFamilies().filter(Boolean)));
    if (!families.length) {
      this.grantCustomEvents = [];
      this.syncGrantOccasionFromForm();
      return;
    }

    forkJoin([
      this.attendance.listCustomEvents(),
      ...families.map((family) => this.attendance.listCustomEvents(family))
    ]).subscribe({
      next: (groups) => {
        const merged = groups.flatMap((group) => group || []);
        const relevant = merged.filter((event) => this.isGlobalCustomEvent(event)
          || families.some((family) => this.isCustomEventRelevantToFamily(event, family)));
        this.grantCustomEvents = this.filterAthanasiusVisibilityForEvents(this.uniqueCustomEvents(relevant));
        this.syncGrantOccasionFromForm();
      },
      error: () => {
        this.grantCustomEvents = [];
        this.syncGrantOccasionFromForm();
      }
    });
  }

  private nowPlusHours(hours: number): string {
    const d = new Date();
    d.setHours(d.getHours() + hours);
    return this.toDateTimeLocalValue(d);
  }

  private toDateTimeLocalValue(value: string | Date): string {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
  }

  grantTypeOptions(): { value: AttendanceType; label: string }[] {
    const base: AttendanceType[] = ['FRIDAY_LITURGY', 'TASBEEHA', 'FAMILY_MEETING'];
    return base.map(type => ({ value: type, label: this.typeLabel(type) }));
  }

  loadAccessGrants(): void {
    if (!this.canManageAccessGrants()) return;
    this.grantsLoading = true;
    this.attendance.listAccessGrants().subscribe({
      next: (data) => {
        this.grants = data || [];
        this.grantsLoading = false;
      },
      error: () => {
        this.grants = [];
        this.grantsLoading = false;
      }
    });
  }

  private loadGrantTargets(scopeFamily = this.grantForm.familyBase || this.defaultGrantScopeFamily()): void {
    if (!this.canManageAccessGrants()) {
      this.grantTargets = [];
      this.syncSelectedGrantTargets();
      this.refreshGrantTargetLists();
      return;
    }
    if (this.grantAudience === 'SERVANTS' && !scopeFamily) {
      const allFamilies = this.families.filter(Boolean);
      if (!allFamilies.length) {
        this.grantTargets = [];
        this.syncSelectedGrantTargets();
        this.refreshGrantTargetLists();
        return;
      }
      forkJoin(allFamilies.map((family) => forkJoin([
        this.familySvc.members(family, true, 'attendance'),
        this.familySvc.members(family, true)
      ]))).subscribe({
        next: (groups) => {
          const merged = groups
            .flatMap((pair: any) => [...(pair?.[0] || []), ...(pair?.[1] || [])])
            .map((x: any) => this.toPickUser(x));
          const unique = merged.filter((user, index, arr) => arr.findIndex((x) => x.id === user.id) === index);
          this.grantTargets = unique.filter((user) => this.isServantGrantTarget(user));
          this.syncSelectedGrantTargets();
          this.refreshGrantTargetLists();
        },
        error: () => {
          this.grantTargets = [];
          this.syncSelectedGrantTargets();
          this.refreshGrantTargetLists();
        }
      });
      return;
    }
    if (!scopeFamily) {
      this.grantTargets = [];
      this.syncSelectedGrantTargets();
      this.refreshGrantTargetLists();
      return;
    }
    if (this.grantAudience === 'SERVANTS') {
      const requestFamily = this.canChooseGrantFamily() ? scopeFamily : undefined;
      forkJoin([
        this.familySvc.members(requestFamily, true, 'attendance'),
        this.familySvc.members(requestFamily, true)
      ]).subscribe({
        next: ([attendanceMembers, familyMembers]) => {
          const allTargets = [...(attendanceMembers || []), ...(familyMembers || [])]
            .map((x: any) => this.toPickUser(x));
          const unique = allTargets.filter((user, index, arr) => arr.findIndex((x) => x.id === user.id) === index);
          this.grantTargets = unique.filter((user) =>
            this.isServantGrantTarget(user) && this.belongsToFamilyScope(user, scopeFamily)
          );
          this.syncSelectedGrantTargets();
          this.refreshGrantTargetLists();
        },
        error: () => {
          this.grantTargets = [];
          this.syncSelectedGrantTargets();
          this.refreshGrantTargetLists();
        }
      });
      return;
    }
    this.familySvc.members(scopeFamily, true, 'attendance').subscribe({
      next: (m) => {
        const allTargets = (m || []).map((x: any) => this.toPickUser(x));
        this.grantTargets = allTargets.filter((user) =>
          this.grantAudience === 'SERVANTS'
            ? this.isServantGrantTarget(user)
            : !this.isServantGrantTarget(user)
        );
        this.syncSelectedGrantTargets();
        this.refreshGrantTargetLists();
      },
      error: () => {
        this.grantTargets = [];
        this.syncSelectedGrantTargets();
        this.refreshGrantTargetLists();
      }
    });
  }

  private syncSelectedGrantTargets(): void {
    const validIds = new Set(this.grantTargets.map((user) => user.id));
    const fallbackIds = new Set(this.editingGrantTargetFallbacks.map((user) => user.id));
    this.selectedGrantTargetIds = (this.selectedGrantTargetIds || []).filter((id) =>
      validIds.has(id) || (this.grantDialogMode === 'edit' && fallbackIds.has(id))
    );
    this.grantForm.targetUserId = this.selectedGrantTargetIds[0];
  }

  private refreshGrantTargetLists(): void {
    const ids = new Set(this.selectedGrantTargetIds || []);
    const selectedFromTargets = this.grantTargets.filter((user) => ids.has(user.id));
    const selectedKnownIds = new Set(selectedFromTargets.map((user) => user.id));
    const selectedFallbacks = this.editingGrantTargetFallbacks.filter((user) => ids.has(user.id) && !selectedKnownIds.has(user.id));
    this.selectedGrantTargetList = [...selectedFromTargets, ...selectedFallbacks];
    const term = String(this.grantTargetSearch || '').trim().toLowerCase();
    const remaining = this.grantTargets.filter((user) => !ids.has(user.id));
    this.filteredGrantTargetList = !term ? remaining : remaining.filter((user) => {
      const text = [user.fullName, user.username, user.familyName, user.deaconFamily]
        .map((value) => String(value || '').toLowerCase())
        .join(' ');
      return text.includes(term);
    });
  }

  onGrantTargetSearchChange(): void {
    this.refreshGrantTargetLists();
  }

  addGrantTarget(id: number): void {
    const current = new Set(this.selectedGrantTargetIds || []);
    current.add(id);
    this.selectedGrantTargetIds = Array.from(current);
    this.grantForm.targetUserId = this.selectedGrantTargetIds[0];
    this.grantTargetSearch = '';
    this.refreshGrantTargetLists();
  }

  removeGrantTarget(id: number): void {
    this.selectedGrantTargetIds = (this.selectedGrantTargetIds || []).filter((item) => item !== id);
    this.grantForm.targetUserId = this.selectedGrantTargetIds[0];
    this.refreshGrantTargetLists();
  }

  private grantDayLabelFromValue(value?: string | Date | null): string {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return this.dayLabel(date.getDay());
  }

  private grantDayFromGrant(grant: Partial<AttendanceAccessGrant>): number | null {
    const day = Number(grant.dayOfWeek);
    if (this.weekDays.includes(day)) return day;

    const firstType = (grant.allowedTypes || [])[0];
    if (firstType && firstType !== 'CUSTOM_EVENT') {
      const configuredDays = this.configDaysForType(firstType, String(grant.familyBase || this.selectedFamily || ''));
      const configuredDay = Number(configuredDays[0]);
      if (this.weekDays.includes(configuredDay)) return configuredDay;
    }

    return null;
  }

  private grantTargetNameFor(id?: number | null): string {
    const targetId = Number(id || 0);
    if (!targetId) return 'بدون اسم';
    return this.selectedGrantTargetList.find((target) => target.id === targetId)?.fullName
      || this.grantTargets.find((target) => target.id === targetId)?.fullName
      || 'بدون اسم';
  }

  private grantTypeLabelFor(grant: Partial<AttendanceAccessGrant>, fallback?: string): string {
    const types = (grant.allowedTypes || []).map((type) => this.displayTypeLabel(type)).filter(Boolean);
    return fallback || types.join(' + ') || 'الحضور';
  }

  private makeSavedGrantSummary(grant: AttendanceAccessGrant, fallbackTypeLabel?: string): GrantSavedSummary {
    return {
      id: `grant-${grant.id || Date.now()}-${Math.random().toString(16).slice(2)}`,
      sourceGrant: grant,
      sourceGrants: [grant],
      targetNames: grant.targetUserName || this.grantTargetNameFor(grant.targetUserId),
      typeLabel: this.grantTypeLabelFor(grant, fallbackTypeLabel),
      dayLabel: this.grantDayFromGrant(grant) === null ? 'غير محدد' : this.dayLabel(this.grantDayFromGrant(grant) as number),
      windowText: `${this.formatDateTime(grant.startsAt)} → ${this.formatDateTime(grant.endsAt)}`,
      note: String(grant.note || '').trim() || null
    };
  }

  private makeSavedGrantGroupSummary(group: GrantGroup, fallbackTypeLabel?: string): GrantSavedSummary {
    const first = group.first;
    return {
      id: `grant-group-${group.key}-${Date.now()}`,
      sourceGrant: first,
      sourceGrants: group.grants,
      targetNames: group.targetNames,
      typeLabel: this.grantTypeLabelFor(first, fallbackTypeLabel),
      dayLabel: this.grantDayFromGrant(first) === null ? 'غير محدد' : this.dayLabel(this.grantDayFromGrant(first) as number),
      windowText: `${this.formatDateTime(first.startsAt)} → ${this.formatDateTime(first.endsAt)}`,
      note: this.grantGroupNotesText(group) || null
    };
  }

  private recordSavedGrantSummaries(windows: GrantDayWindow[], savedGrants: AttendanceAccessGrant[] = []): void {
    const selectedOccasion = this.selectedGrantOccasion();
    const typeLabel = selectedOccasion?.label || (this.grantForm.allowedTypes || []).map((type) => this.displayTypeLabel(type)).join(' + ') || 'الحضور';
    if (savedGrants.length) {
      const newSummaries = this.groupAccessGrants(savedGrants).map((group) => this.makeSavedGrantGroupSummary(group, typeLabel));
      const newKeys = new Set(newSummaries.map((item) => this.grantGroupingKey(item.sourceGrant || {})));
      const remaining = this.grantSavedSummaries.filter((item) => !item.sourceGrant || !newKeys.has(this.grantGroupingKey(item.sourceGrant)));
      this.grantSavedSummaries = [...newSummaries, ...remaining].slice(0, 8);
      return;
    }

    const targetNames = this.selectedGrantTargetList.length
      ? this.selectedGrantTargetList.map((target) => target.fullName).join(' + ')
      : `${this.selectedGrantTargetIds.length} شخص`;
    const note = String(this.grantForm.note || '').trim() || null;
    const newSummaries = windows.map((window) => ({
      id: `${Date.now()}-${window.day}-${Math.random().toString(16).slice(2)}`,
      targetNames,
      typeLabel,
      dayLabel: this.dayLabel(window.day),
      windowText: `${this.formatDateTime(window.startsAt)} → ${this.formatDateTime(window.endsAt)}`,
      note
    }));
    this.grantSavedSummaries = [...newSummaries, ...this.grantSavedSummaries].slice(0, 8);
  }

  private knownAccessGrants(): AttendanceAccessGrant[] {
    const fromSummaries = this.grantSavedSummaries
      .flatMap((item) => item.sourceGrants || (item.sourceGrant ? [item.sourceGrant] : []));
    return [...this.grants, ...fromSummaries].filter((grant, index, arr) => {
      const id = Number(grant.id || 0);
      if (!id) return arr.indexOf(grant) === index;
      return arr.findIndex((item) => Number(item.id || 0) === id) === index;
    });
  }

  private appendGrantNote(oldNote?: string | null, newNote?: string | null): string | null {
    const oldText = String(oldNote || '').trim();
    const newText = String(newNote || '').trim();
    if (!newText) return oldText || null;
    if (!oldText) return newText;
    const parts = oldText.split(/\s*\+\s*|\r?\n/).map((part) => part.trim()).filter(Boolean);
    if (parts.includes(newText)) return oldText;
    return `${oldText} + ${newText}`;
  }

  private findExactGrantForSave(
    targetUserId: number,
    window: GrantDayWindow,
    payload: Partial<AttendanceAccessGrant>
  ): AttendanceAccessGrant | null {
    const editingIds = new Set(this.editingGrantGroupIds.map((id) => Number(id || 0)).filter(Boolean));
    return this.knownAccessGrants().find((grant) => {
      if (editingIds.has(Number(grant.id || 0))) return false;
      return Number(grant.targetUserId || 0) === Number(targetUserId || 0)
        && this.grantGroupingKey(grant) === this.grantGroupingKey({
          ...payload,
          targetUserId,
          dayOfWeek: window.day,
          startsAt: this.toDateTimeLocalValue(window.startsAt as Date),
          endsAt: this.toDateTimeLocalValue(window.endsAt as Date)
        });
    }) || null;
  }

  private warnDuplicateGrant(grant: AttendanceAccessGrant): void {
    const targetName = grant.targetUserName || this.grantTargetNameFor(grant.targetUserId);
    const typeLabel = this.grantTypeLabelFor(grant);
    this.message.add({
      severity: 'warn',
      summary: 'تخصيص موجود',
      detail: `${targetName} معمول له تخصيص بالفعل لنفس النوع: ${typeLabel}`,
      life: 5000
    });
  }

  openCreateGrant(): void {
    if (!this.canManageAccessGrants()) return;
    this.grantDialogMode = 'create';
    this.editingGrantGroupIds = [];
    this.editingGrantTargetFallbacks = [];
    this.grantForm = this.defaultGrantForm();
    this.grantAudience = this.grantAudienceFromKind(this.grantForm.grantKind);
    this.lastGrantAudience = this.grantAudience;
    this.selectedGrantTargetIds = [];
    this.grantTargetSearch = '';
    this.grantSavedSummaries = [];
    this.refreshGrantTargetLists();
    this.grantFamilySelections = this.grantForm.familyBase ? [this.grantForm.familyBase] : [];
    this.syncGrantFamilyFormFromSelections();
    this.syncGrantDateControls();
    this.loadGrantTargets(this.grantForm.familyBase || this.defaultGrantScopeFamily());
    this.loadGrantCustomEvents();
    this.grantDialogVisible = true;
  }

  openEditGrant(grant: AttendanceAccessGrant): void {
    this.openEditGrantGroup({ key: this.grantGroupingKey(grant), grants: [grant], first: grant, targetNames: grant.targetUserName || 'بدون اسم', notes: String(grant.note || '').trim() ? [String(grant.note || '').trim()] : [] });
  }

  openEditGrantGroup(group: GrantGroup): void {
    if (!this.canManageAccessGrants()) return;
    const grant = group.first;
    this.grantDialogMode = 'edit';
    this.editingGrantGroupIds = group.grants.map((item) => Number(item.id || 0)).filter(Boolean);
    this.editingGrantTargetFallbacks = group.grants
      .map((item) => ({
        id: Number(item.targetUserId || 0),
        fullName: item.targetUserName || 'بدون اسم',
        role: item.targetUserRole,
        familyName: item.familyBase || undefined,
        deaconFamily: item.familyBase || undefined
      }))
      .filter((item) => !!item.id);
    this.grantForm = {
      ...grant,
      familyBase: this.grantAudienceFromKind(grant.grantKind) === 'SERVANTS' ? (grant.familyBase || '') : grant.familyBase,
      startsAt: this.toDateTimeLocalValue(grant.startsAt),
      endsAt: this.toDateTimeLocalValue(grant.endsAt),
      allowedTypes: [...(grant.allowedTypes || [])],
      note: group.notes.join(' + ')
    };
    this.grantAudience = this.grantAudienceFromKind(grant.grantKind);
    this.lastGrantAudience = this.grantAudience;
    this.selectedGrantTargetIds = group.grants.map((item) => Number(item.targetUserId || 0)).filter(Boolean);
    this.grantTargetSearch = '';
    this.grantSavedSummaries = [];
    this.refreshGrantTargetLists();
    this.syncGrantFamilySelectionsFromForm();
    this.syncGrantDateControls();
    this.loadGrantTargets(this.grantForm.familyBase || this.defaultGrantScopeFamily());
    this.loadGrantCustomEvents();
    this.grantDialogVisible = true;
  }

  toggleGrantType(type: AttendanceType): void {
    const current = new Set(this.grantForm.allowedTypes || []);
    if (current.has(type)) current.delete(type);
    else current.add(type);
    this.grantForm.allowedTypes = [...current] as AttendanceType[];
  }

  hasGrantType(type: AttendanceType): boolean {
    return (this.grantForm.allowedTypes || []).includes(type);
  }

  saveGrant(closeAfterSave = false): void {
    if (!this.canManageAccessGrants()) return;
    if (!this.selectedGrantTargetIds.length) {
      this.message.add({ severity: 'warn', summary: 'تنبيه', detail: 'اختر الشخص أولاً' });
      return;
    }
    if (!this.grantForm.allowedTypes?.length) {
      this.message.add({ severity: 'warn', summary: 'تنبيه', detail: 'اختر مناسبة واحدة على الأقل' });
      return;
    }
    const selectedWindow = this.selectedGrantWindowValue
      || (this.grantSelectedWeekday !== null ? this.buildGrantWindow(this.grantSelectedWeekday, this.grantStartsAtDate, this.grantEndsAtDate) : null);
    const windows = selectedWindow && selectedWindow.startsAt && selectedWindow.endsAt ? [selectedWindow] : [];

    if (!windows.length) {
      this.message.add({ severity: 'warn', summary: 'تنبيه', detail: 'حدد وقت البداية والنهاية لليوم المختار' });
      return;
    }

    const invalidWindow = windows.find((item) => !item.startsAt || !item.endsAt || item.endsAt.getTime() <= item.startsAt.getTime());
    if (invalidWindow) {
      this.message.add({ severity: 'warn', summary: 'تنبيه', detail: `وقت النهاية لازم يكون بعد البداية في ${this.dayLabel(invalidWindow.day)}` });
      return;
    }

    const basePayload = {
      ...this.grantForm,
      grantKind: this.grantKindFromAudience(this.grantAudience),
      familyBase: this.canChooseGrantFamily()
        ? (this.grantForm.familyBase || undefined)
        : (this.defaultGrantScopeFamily() || undefined)
    };

    const handleSuccess = (savedGrants: AttendanceAccessGrant[] = []) => {
      this.message.add({
        severity: 'success',
        summary: 'تم',
        detail: `تم حفظ التخصيص بنجاح ليوم ${this.dayLabel(windows[0].day)}`
      });
      this.recordSavedGrantSummaries(windows, savedGrants);
      this.grantForm.note = '';
      this.loadAccessGrants();
      if (closeAfterSave) {
        this.grantDialogVisible = false;
      }
    };
    const handleError = (err: any) => {
      this.message.add({ severity: 'error', summary: 'خطأ', detail: err?.error?.error || err?.error?.message || 'فشل الحفظ' });
    };

    if (this.grantDialogMode === 'create') {
      forkJoin(this.selectedGrantTargetIds.flatMap((targetUserId) =>
        windows.map((window) => {
          const exactGrant = this.findExactGrantForSave(targetUserId, window, basePayload);
          const payload = {
            ...basePayload,
            targetUserId,
            dayOfWeek: window.day,
            note: exactGrant ? this.appendGrantNote(exactGrant.note, basePayload.note) : basePayload.note,
            startsAt: this.toDateTimeLocalValue(window.startsAt as Date),
            endsAt: this.toDateTimeLocalValue(window.endsAt as Date)
          };
          return exactGrant?.id
            ? this.attendance.updateAccessGrant(Number(exactGrant.id), payload)
            : this.attendance.createAccessGrant(payload);
        })
      )).subscribe({
        next: (savedGrants) => handleSuccess(savedGrants || []),
        error: handleError
      });
      return;
    }

    const editWindow = windows[0];
    const selectedIds = new Set(this.selectedGrantTargetIds.map((id) => Number(id || 0)).filter(Boolean));
    const existingByTarget = new Map<number, AttendanceAccessGrant>();
    for (const grant of this.knownAccessGrants().filter((item) => this.editingGrantGroupIds.includes(Number(item.id || 0)))) {
      existingByTarget.set(Number(grant.targetUserId || 0), grant);
    }
    const requests = [
      ...Array.from(selectedIds).map((targetUserId) => {
        const existing = existingByTarget.get(targetUserId);
        const payload = {
          ...basePayload,
          targetUserId,
          dayOfWeek: editWindow.day,
          startsAt: this.toDateTimeLocalValue(editWindow.startsAt as Date),
          endsAt: this.toDateTimeLocalValue(editWindow.endsAt as Date)
        };
        return existing?.id
          ? this.attendance.updateAccessGrant(Number(existing.id), payload)
          : this.attendance.createAccessGrant(payload);
      }),
      ...Array.from(existingByTarget.entries())
        .filter(([targetUserId]) => !selectedIds.has(targetUserId))
        .map(([, grant]) => this.attendance.deleteAccessGrant(Number(grant.id)))
    ];
    forkJoin(requests).subscribe({
      next: (results) => {
        const savedGrants = (results || []).filter((item: any) => item && !('ok' in item)) as AttendanceAccessGrant[];
        handleSuccess(savedGrants);
      },
      error: handleError
    });
  }

  finishGrantDialog(): void {
    this.grantDialogVisible = false;
    this.loadAccessGrants();
  }

  deleteGrant(grant: AttendanceAccessGrant): void {
    if (!this.canManageAccessGrants()) return;
    if (!grant.id) return;
    this.attendance.deleteAccessGrant(grant.id).subscribe({
      next: () => {
        this.message.add({ severity: 'success', summary: 'تم', detail: 'تم حذف التخصيص' });
        this.grantSavedSummaries = this.grantSavedSummaries.filter((item) => Number(item.sourceGrant?.id || 0) !== Number(grant.id || 0));
        this.loadAccessGrants();
      },
      error: (err) => {
        this.message.add({ severity: 'error', summary: 'خطأ', detail: err?.error?.error || err?.error?.message || 'فشل حذف التخصيص' });
      }
    });
  }

  deleteGrantGroup(group: GrantGroup): void {
    if (!this.canManageAccessGrants()) return;
    const ids = group.grants.map((grant) => Number(grant.id || 0)).filter(Boolean);
    if (!ids.length) return;
    forkJoin(ids.map((id) => this.attendance.deleteAccessGrant(id))).subscribe({
      next: () => {
        this.message.add({ severity: 'success', summary: 'تم', detail: 'تم حذف التخصيص' });
        const idSet = new Set(ids);
        this.grantSavedSummaries = this.grantSavedSummaries.filter((item) =>
          !(item.sourceGrants || (item.sourceGrant ? [item.sourceGrant] : []))
            .some((grant) => idSet.has(Number(grant.id || 0)))
        );
        this.loadAccessGrants();
      },
      error: (err) => {
        this.message.add({ severity: 'error', summary: 'خطأ', detail: err?.error?.error || err?.error?.message || 'فشل حذف التخصيص' });
      }
    });
  }

  editSavedGrant(item: GrantSavedSummary): void {
    const grants = item.sourceGrants || (item.sourceGrant ? [item.sourceGrant] : []);
    if (!grants.length) return;
    const group = this.groupAccessGrants(grants)[0];
    if (group) this.openEditGrantGroup(group);
  }

  deleteSavedGrant(item: GrantSavedSummary): void {
    const grants = item.sourceGrants || (item.sourceGrant ? [item.sourceGrant] : []);
    if (!grants.length) return;
    const group = this.groupAccessGrants(grants)[0];
    if (group) this.deleteGrantGroup(group);
  }

  // ===== Custom Events =====
  private defaultCustomEventForm(): CustomEventForm {
    return {
      familyBase: this.preferredCustomEventFamily(),
      title: '',
      dayOfWeek: this.selectedDate?.getDay() ?? 5,
      enabled: true,
      alwaysActive: true,
      permittedEditorIds: []
    };
  }

  get visibleCustomEvents(): AttendanceCustomEvent[] {
    return this.familyCustomEvents.slice(0, 2);
  }

  get currentFamilyCustomEvents(): AttendanceCustomEvent[] {
    return this.familyCustomEvents;
  }

  get extraCustomEventsCount(): number {
    return Math.max(0, this.currentFamilyCustomEvents.length - this.visibleCustomEvents.length);
  }

  isCustomEventFamilyLocked(): boolean {
    return this.customEventDialogMode === 'edit' || (!this.isAminKhedmaOrDeveloper() && this.customEventFamilyOptions().length <= 1);
  }

  customEventFamilyLabel(): string {
    return String(this.customEventForm.familyBase || '').trim() || 'كل الأسر';
  }

  canManageCustomEventEditors(): boolean {
    return this.isAminKhedmaOrDeveloper() && !!String(this.customEventForm.familyBase || '').trim();
  }

  customEventFamilyOptions(): Array<{ label: string; value: string }> {
    const options = this.isAminKhedmaOrDeveloper()
      ? [{ label: 'كل الأسر', value: '' }, ...this.filterAthanasiusVisibility(this.families).map((family) => ({ label: family, value: family }))]
      : this.filterAthanasiusVisibility(this.aminOsraFamilies()).filter(Boolean).map((family) => ({ label: family, value: family }));
    return options;
  }

  private loadCustomEventsForFamily(): void {
    if (!this.canUseCustomEvent()) {
      this.familyCustomEvents = [];
      this.availableCustomEvents = [];
      return;
    }
    const familyBase = this.isAminKhedmaOrDeveloper() ? (this.selectedFamily || undefined) : (this.preferredCustomEventFamily() || undefined);
    const requests = familyBase
      ? [this.attendance.listCustomEvents(), this.attendance.listCustomEvents(familyBase)]
      : [this.attendance.listCustomEvents()];
    forkJoin(requests).subscribe({
      next: (groups) => {
        const merged = groups.flatMap((group) => group || []);
        const relevant = familyBase
          ? merged.filter((event) => this.isCustomEventRelevantToFamily(event, familyBase))
          : merged.filter((event) => this.isGlobalCustomEvent(event));
        this.familyCustomEvents = this.filterAthanasiusVisibilityForEvents(this.uniqueCustomEvents(relevant));
        this.refreshTypeOptions();
        this.updateCalendarForSelectedType(true);
        this.refreshAvailableCustomEvents();
      },
      error: () => {
        this.familyCustomEvents = [];
        this.availableCustomEvents = [];
        this.refreshTypeOptions();
        this.updateCalendarForSelectedType(true);
      }
    });
  }

  private uniqueCustomEvents(events: AttendanceCustomEvent[]): AttendanceCustomEvent[] {
    return (events || []).filter((event, index, arr) => {
      const id = Number(event.id || 0);
      if (id) return arr.findIndex((item) => Number(item.id || 0) === id) === index;
      return arr.indexOf(event) === index;
    });
  }

  private isGlobalCustomEvent(event: AttendanceCustomEvent): boolean {
    return !String(event.familyBase || '').trim();
  }

  private isCustomEventRelevantToFamily(event: AttendanceCustomEvent, family: string): boolean {
    if (this.isGlobalCustomEvent(event)) return true;
    return canonicalFamilyName(event.familyBase) === canonicalFamilyName(family);
  }

  private filterAthanasiusVisibilityForEvents(events: AttendanceCustomEvent[]): AttendanceCustomEvent[] {
    if (this.canAccessAthanasiusKhors()) return events;
    return events.filter((event) => !this.isAthanasiusFamilyName(event.familyBase));
  }

  private refreshAvailableCustomEvents(): void {
    const date = this.selectedDate ? new Date(this.selectedDate) : new Date();
    const selectable = this.selectableCustomEvents();
    this.availableCustomEvents = this.isSelectedCustomEventType()
      ? selectable
      : selectable.filter((event) => this.isCustomEventAvailableForDate(event, date));
    if (this.isSelectedCustomEventType()) {
      const idFromType = this.selectedCustomEventIdFromType();
      if (idFromType) this.selectedCustomEventId = idFromType;
      const currentStillAvailable = this.availableCustomEvents.some((event) => Number(event.id) === Number(this.selectedCustomEventId || 0));
      const next = currentStillAvailable ? this.selectedCustomEvent() : this.availableCustomEvents[0];
      this.selectedCustomEventId = next?.id || '';
      this.customTitle = next?.title || '';
    }
  }

  private isCustomEventAvailableForDate(event: AttendanceCustomEvent, date: Date): boolean {
    if (!event || event.enabled === false) return false;
    if (Number(event.dayOfWeek) !== date.getDay()) return false;
    if (event.alwaysActive !== false) return true;
    const current = new Date(date);
    current.setHours(0, 0, 0, 0);
    if (event.activeFrom) {
      const from = new Date(event.activeFrom);
      from.setHours(0, 0, 0, 0);
      if (!Number.isNaN(from.getTime()) && current < from) return false;
    }
    if (event.activeTo) {
      const to = new Date(event.activeTo);
      to.setHours(23, 59, 59, 999);
      if (!Number.isNaN(to.getTime()) && current > to) return false;
    }
    return true;
  }

  onCustomEventDayChange(): void {
    if (this.customEventForm.dayOfWeek === undefined || this.customEventForm.dayOfWeek === null) {
      this.customEventForm.dayOfWeek = this.selectedDate?.getDay() ?? 5;
    }
  }

  onCustomEventAlwaysActiveChange(): void {
    if (this.customEventForm.alwaysActive) {
      this.customEventActiveFromDate = null;
      this.customEventActiveToDate = null;
      this.customEventForm.activeFrom = null;
      this.customEventForm.activeTo = null;
    }
  }

  onCustomEventActiveFromChange(val: Date | null): void {
    this.customEventActiveFromDate = val;
    this.customEventForm.activeFrom = val ? this.toIsoDate(val) : null;
  }

  onCustomEventActiveToChange(val: Date | null): void {
    this.customEventActiveToDate = val;
    this.customEventForm.activeTo = val ? this.toIsoDate(val) : null;
  }

  onCustomEventFamilyChange(): void {
    this.customEventForm.permittedEditorIds = [];
    this.customEventEditorPickerId = null;
    this.customEventEditorSearch = '';
    if (!this.canManageCustomEventEditors()) {
      this.customEventEditorTargets = [];
      return;
    }
    this.loadCustomEventEditorTargets();
  }

  private loadCustomEventEditorTargets(): void {
    if (!this.canManageCustomEventEditors()) {
      this.customEventEditorTargets = [];
      this.customEventForm.permittedEditorIds = [];
      return;
    }

    const family = String(this.customEventForm.familyBase || '').trim();

    const applyTargets = (members: any[]) => {
      const mapped = (members || [])
        .map((member: any) => this.toPickUser(member))
        .filter((member) => this.isServantGrantTarget(member));
      this.customEventEditorTargets = mapped.filter((member, index, arr) => arr.findIndex((x) => x.id === member.id) === index);
      this.customEventForm.permittedEditorIds = (this.customEventForm.permittedEditorIds || [])
        .filter((id) => this.customEventEditorTargets.some((member) => member.id === id));
    };

    if (!family) {
      this.customEventEditorTargets = [];
      return;
    }

    forkJoin([
      this.familySvc.members(family, true, 'attendance'),
      this.familySvc.members(family, true)
    ]).subscribe({
      next: ([attendanceMembers, familyMembers]) => applyTargets([...(attendanceMembers || []), ...(familyMembers || [])]),
      error: () => this.customEventEditorTargets = []
    });
  }

  onCustomEventPermittedEditorPick(value: number | null): void {
    const id = Number(value || 0);
    if (!id) {
      this.customEventEditorPickerId = null;
      return;
    }
    const current = new Set(this.customEventForm.permittedEditorIds || []);
    current.add(id);
    this.customEventForm.permittedEditorIds = Array.from(current);
    this.customEventEditorPickerId = null;
  }

  removeCustomEventPermittedEditor(id: number): void {
    this.customEventForm.permittedEditorIds = (this.customEventForm.permittedEditorIds || []).filter((item) => item !== id);
  }

  selectedCustomEventEditors(): PickUser[] {
    const ids = new Set(this.customEventForm.permittedEditorIds || []);
    return this.customEventEditorTargets.filter((member) => ids.has(member.id));
  }

  remainingCustomEventEditorTargets(): PickUser[] {
    const ids = new Set(this.customEventForm.permittedEditorIds || []);
    return this.customEventEditorTargets.filter((member) => !ids.has(member.id));
  }

  filteredCustomEventEditorTargets(): PickUser[] {
    const term = this.customEventEditorSearch.trim().toLowerCase();
    const remaining = this.remainingCustomEventEditorTargets();
    if (!term) return remaining;
    return remaining.filter((member) => {
      const text = [member.fullName, member.username, member.familyName, member.deaconFamily]
        .map((value) => String(value || '').toLowerCase())
        .join(' ');
      return text.includes(term);
    });
  }

  addCustomEventEditor(id: number): void {
    this.onCustomEventPermittedEditorPick(id);
    this.customEventEditorSearch = '';
  }

  customEventPermittedEditorsSummary(event: AttendanceCustomEvent): string {
    const names = (event.permittedEditors || [])
      .map((editor) => String(editor?.fullName || '').trim())
      .filter(Boolean);
    if (names.length) return names.join(' + ');
    const legacyName = String(event.permittedEditorName || '').trim();
    return legacyName || 'بدون خدام محددين';
  }

  openCreateCustomEvent(): void {
    if (!this.canUseCustomEvent()) return;
    this.customEventDialogMode = 'create';
    const options = this.customEventFamilyOptions();
    const preferredFamily = this.preferredCustomEventFamily();
    this.customEventForm = {
      ...this.defaultCustomEventForm(),
      familyBase: preferredFamily || options[0]?.value || ''
    };
    this.customEventActiveFromDate = null;
    this.customEventActiveToDate = null;
    this.customEventEditorPickerId = null;
    this.customEventEditorSearch = '';
    this.loadCustomEventEditorTargets();
    this.customEventDialogVisible = true;
  }

  openEditCustomEvent(event: AttendanceCustomEvent): void {
    if (!this.canEditCustomEvent(event)) return;
    this.customEventDialogMode = 'edit';
    this.customEventForm = {
      ...event,
      id: event.id,
      familyBase: event.familyBase || '',
      title: event.title || '',
      dayOfWeek: Number(event.dayOfWeek ?? 5),
      enabled: event.enabled !== false,
      alwaysActive: event.alwaysActive !== false,
      permittedEditorIds: [...(event.permittedEditorIds || []), ...(event.permittedEditorId ? [event.permittedEditorId] : [])]
        .filter((id, index, arr) => !!id && arr.indexOf(id) === index)
    };
    this.customEventActiveFromDate = event.activeFrom ? new Date(event.activeFrom) : null;
    this.customEventActiveToDate = event.activeTo ? new Date(event.activeTo) : null;
    this.customEventEditorPickerId = null;
    this.customEventEditorSearch = '';
    this.loadCustomEventEditorTargets();
    this.customEventDialogVisible = true;
  }

  private buildCustomEventPayload(): Partial<AttendanceCustomEvent> {
    const requestedFamily = String(this.customEventForm.familyBase || '').trim();
    const allowedFamilies = this.customEventFamilyOptions().map((option) => option.value);
    const matchedFamily = allowedFamilies.find((family) => canonicalFamilyName(family) === canonicalFamilyName(requestedFamily));
    const scopedFamily = this.isAminKhedmaOrDeveloper()
      ? requestedFamily
      : (matchedFamily || this.preferredCustomEventFamily());
    return {
      familyBase: scopedFamily || null,
      title: this.customEventForm.title.trim(),
      dayOfWeek: Number(this.customEventForm.dayOfWeek),
      enabled: this.customEventForm.enabled !== false,
      alwaysActive: this.customEventForm.alwaysActive !== false,
      activeFrom: this.customEventForm.alwaysActive === false ? (this.customEventForm.activeFrom || null) : null,
      activeTo: this.customEventForm.alwaysActive === false ? (this.customEventForm.activeTo || null) : null,
      permittedEditorIds: scopedFamily
        ? [...new Set((this.customEventForm.permittedEditorIds || []).filter(Boolean))]
        : []
    };
  }

  saveCustomEvent(): void {
    if (!this.canUseCustomEvent()) return;
    if (!this.customEventForm.title?.trim()) {
      this.message.add({ severity: 'warn', summary: 'تنبيه', detail: 'اكتب اسم المناسبة أولاً' });
      return;
    }
    const requiresFamilySelection = this.customEventDialogMode === 'create' && !this.isAminKhedmaOrDeveloper();
    if (requiresFamilySelection && !this.preferredCustomEventFamily()) {
      this.message.add({ severity: 'warn', summary: 'تنبيه', detail: 'لا توجد أسرة مسموح لك بإضافة مناسبة لها' });
      return;
    }
    if (!this.isAminKhedmaOrDeveloper()) {
      const allowedFamilies = this.customEventFamilyOptions().map((option) => option.value);
      const requestedFamily = String(this.customEventForm.familyBase || this.preferredCustomEventFamily()).trim();
      const isAllowed = allowedFamilies.some((family) => canonicalFamilyName(family) === canonicalFamilyName(requestedFamily));
      if (!isAllowed) {
        this.message.add({ severity: 'warn', summary: 'تنبيه', detail: 'المناسبة لازم تكون لأسرة أنت أمين عليها' });
        return;
      }
    }
    if (this.customEventForm.alwaysActive === false && this.customEventForm.activeFrom && this.customEventForm.activeTo) {
      const from = new Date(this.customEventForm.activeFrom).getTime();
      const to = new Date(this.customEventForm.activeTo).getTime();
      if (!Number.isNaN(from) && !Number.isNaN(to) && to < from) {
        this.message.add({ severity: 'warn', summary: 'تنبيه', detail: 'آخر تاريخ لازم يكون بعد أول تاريخ' });
        return;
      }
    }

    this.customEventSaving = true;
    const payload = this.buildCustomEventPayload();
    const req = this.customEventDialogMode === 'edit' && this.customEventForm.id
      ? this.attendance.updateCustomEvent(Number(this.customEventForm.id), payload)
      : this.attendance.createCustomEvent(payload);

    req.subscribe({
      next: () => {
        this.customEventSaving = false;
        this.customEventDialogVisible = false;
        this.message.add({ severity: 'success', summary: 'تم', detail: 'تم حفظ المناسبة بنجاح' });
        this.loadCustomEventsForFamily();
        this.onDateChange();
      },
      error: (err) => {
        this.customEventSaving = false;
        this.message.add({ severity: 'error', summary: 'خطأ', detail: err?.error?.error || err?.error?.message || 'فشل حفظ المناسبة' });
      }
    });
  }

  deleteCustomEvent(event: AttendanceCustomEvent): void {
    if (!event.id || !this.canEditCustomEvent(event)) return;
    this.attendance.deleteCustomEvent(event.id).subscribe({
      next: () => {
        this.message.add({ severity: 'success', summary: 'تم', detail: 'تم حذف المناسبة' });
        this.loadCustomEventsForFamily();
        this.onDateChange();
      },
      error: (err) => this.message.add({
        severity: 'error',
        summary: 'خطأ',
        detail: err?.error?.error || err?.error?.message || 'فشل حذف المناسبة'
      })
    });
  }

  onCustomEventSelectionChange(): void {
    const selected = this.selectedCustomEvent();
    this.customTitle = selected?.title || '';
    this.updateCalendarForSelectedType(false);
    this.refreshRuntimeState();
  }

  selectedCustomEvent(): AttendanceCustomEvent | null {
    const id = Number(this.selectedCustomEventId || 0);
    return this.currentFamilyCustomEvents.find((event) => Number(event.id) === id)
      || this.availableCustomEvents.find((event) => Number(event.id) === id)
      || null;
  }

  customEventDisplayRange(event: AttendanceCustomEvent): string {
    if (event.alwaysActive !== false) return 'مستمرة على طول';
    const from = event.activeFrom ? this.formatDateOnly(event.activeFrom) : '';
    const to = event.activeTo ? this.formatDateOnly(event.activeTo) : '';
    if (from && to) return `${from} ← ${to}`;
    if (from) return `من ${from}`;
    if (to) return `إلى ${to}`;
    return 'بدون تاريخ محدد';
  }

  customEventScopeLabel(event: AttendanceCustomEvent): string {
    return event.familyBase ? String(event.familyBase) : 'كل الأسر';
  }

  customEventStatusLabel(event: AttendanceCustomEvent): string {
    return event.enabled === false ? 'pending' : 'مفعلة';
  }

  canEditCustomEvent(event: AttendanceCustomEvent): boolean {
    if (!event) return false;
    const myId = Number(this.me?.id || 0);
    const eventFamily = String(event.familyBase || '').trim();
    const aminFamilyMatch = !!eventFamily && this.aminOsraFamilies()
      .some((family) => canonicalFamilyName(family) === canonicalFamilyName(eventFamily));

    return !!event.canEdit
      || aminFamilyMatch
      || this.isAminKhedmaOrDeveloper()
      || Number(event.createdById || 0) === myId
      || Number(event.permittedEditorId || 0) === myId
      || (event.permittedEditorIds || []).includes(myId)
      || (event.permittedEditors || []).some((editor) => Number(editor?.id || 0) === myId);
  }

  private formatDateOnly(value?: string | Date | null): string {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(date);
  }
}
