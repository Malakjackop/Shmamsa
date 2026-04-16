import { Component, OnDestroy, OnInit, inject, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
  AttendanceService,
  AttendanceType,
  AttendanceContext,
  AttendanceAccessGrant,
  AttendanceConfig
} from '../services/attendance.service';
import { AuthService } from '../services/auth.service';
import { FamilyService } from '../services/family.service';
import { MessageService } from 'primeng/api';
import { assignmentRolesOf, normalizeAssignmentRole, normalizeRole, roleLabel } from '../shared/role-utils';
import { DEFAULT_FAMILY_ORDER, canonicalFamilyName, sortFamiliesByPreferredOrder } from '../shared/family-utils';
import { forkJoin } from 'rxjs';

type PickUser = {
  id: number;
  username?: string;
  fullName: string;
  role?: string;
  familyName?: string;
  deaconFamily?: string;
  familyAssignments?: Array<{ familyId?: number; familyName?: string; roleCode?: number; role?: string; assignmentOrder?: number }>;
};

type GrantAudience = 'SERVANTS' | 'MEMBERS';
type TypeDaysMap = Partial<Record<AttendanceType, number[]>>;
type GrantPopupFilter = 'ALL' | 'SERVANTS_SCOPE' | 'MEMBERS_SCOPE' | 'SERVANTS_ALL';

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
  selectedType: AttendanceType = 'FRIDAY_LITURGY';
  typeOptions: { value: AttendanceType; label: string }[] = [];
  customTitle = '';
  pageBlockedMessage = '';
  runtimeBlockedMessage = '';
  blockedMessage = '';

  families: string[] = [];
  selectedFamily = '';
  private readonly preferredFamilyOrder = DEFAULT_FAMILY_ORDER;

  members: PickUser[] = [];
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
  grantTargets: PickUser[] = [];
  grantAudience: GrantAudience = 'MEMBERS';
  grantStartsAtDate: Date | null = null;
  grantEndsAtDate: Date | null = null;
  grantFamilySelections: string[] = [];

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
    { value: 'FAMILY_MEETING', label: 'اجتماع الأسرة' },
    { value: 'MARMARKOS_KHORS', label: 'خورس مارمرقس' },
    { value: 'ATHANASIUS_KHORS', label: 'خورس البابا أثناسيوس' }
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
  showCountdownClock = false;
  private countdownTimer: any = null;

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

  private grantKindForCurrentUser(): AttendanceAccessGrant['grantKind'] {
    return this.isServantOrAbove() ? 'TAKE_ATTENDANCE' : 'SELF_CHECKIN';
  }

  isDelegatedAttendanceMode(): boolean {
    return !this.isServantOrAbove() && (this.attendanceContext?.activeGrants || []).some((grant) => {
      if (grant.grantKind !== this.grantKindForCurrentUser()) return false;
      if (grant.enabled === false) return false;
      return this.isGrantActive(grant);
    });
  }

  isSelfCheckinMode(): boolean {
    return !!this.attendanceContext?.selfCheckinAllowed && !this.isServantOrAbove() && !this.isDelegatedAttendanceMode();
  }

  canSelectFamily(): boolean {
    if (this.isSelfCheckinMode()) return false;
    if (this.isDelegatedAttendanceMode()) return this.currentGrantFamilyOptions().length > 1;
    return ['AMIN_KHEDMA', 'DEVELOPER'].includes(this.roleNorm()) || this.isKhadim() || this.hasAnyAminPrivilegeScope();
  }

  hasRestrictedFamilyScope(): boolean {
    return this.currentGrantFamilyOptions().length > 0;
  }

  canUseCustomEvent(): boolean {
    return !!this.attendanceContext?.canUseCustomEvent && !this.isSelfCheckinMode();
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
    return ['خورس مارمرقس', 'خورس البابا أثناسيوس'];
  }

  private aminOsraFamilies(): string[] {
    const fromAssignments = this.assignmentsOf(this.me)
      .filter((x) => x.role === 'AMIN_OSRA')
      .map((x) => canonicalFamilyName(x.familyName))
      .filter(Boolean);

    if (fromAssignments.length) {
      return Array.from(new Set(fromAssignments));
    }

    const fallback = canonicalFamilyName(
      this.selectedFamily
      || this.me?.deaconFamily
      || this.familyLabel(this.me)
    );
    return fallback ? [fallback] : [];
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
      { value: 'MEMBERS_SCOPE', label: `مخدومين ${scopeLabel}` },
      { value: 'SERVANTS_ALL', label: 'خدام كل الأسر' }
    ];
  }

  popupGrantCountLabel(): string {
    return `${this.filteredGrants.length} تخصيص`;
  }

  private grantMatchesPopupFilter(grant: AttendanceAccessGrant): boolean {
    const selected = String(this.selectedFamily || '').trim();
    const grantFamilies = this.grantFamilyList(grant.familyBase);

    switch (this.grantPopupFilter) {
      case 'SERVANTS_SCOPE':
        return grant.grantKind === 'TAKE_ATTENDANCE' && (!!selected ? grantFamilies.includes(selected) : true);
      case 'MEMBERS_SCOPE':
        return grant.grantKind === 'SELF_CHECKIN' && (!!selected ? grantFamilies.includes(selected) : true);
      case 'SERVANTS_ALL':
        return grant.grantKind === 'TAKE_ATTENDANCE';
      default:
        return true;
    }
  }

  grantFamilyFilterOptions(): string[] {
    return Array.from(new Set([...this.families, ...this.choirFamilies()])).filter(Boolean);
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

  grantFamilyList(value?: string | null): string[] {
    return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
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
    if (this.selectedConfigFamily === 'خورس مارمرقس') {
      this.scheduleEditableTypeOptions = [{ value: 'MARMARKOS_KHORS', label: this.typeLabel('MARMARKOS_KHORS') }];
      this.selectedScheduleConfigType = '';
      return;
    }
    if (this.selectedConfigFamily === 'خورس البابا أثناسيوس') {
      this.scheduleEditableTypeOptions = [{ value: 'ATHANASIUS_KHORS', label: this.typeLabel('ATHANASIUS_KHORS') }];
      return;
    }
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
        this.message.add({ severity: 'error', summary: 'خطأ', detail: err?.error?.message || 'فشل حفظ مواعيد الأنواع' });
      }
    });
  }

  private updateBlockedMessage(): void {
    this.blockedMessage = this.pageBlockedMessage || this.runtimeBlockedMessage || '';
    if (this.blockedMessage) this.scanning = false;
  }

  private shouldEnforceGrantWindow(): boolean {
    return this.isSelfCheckinMode()
      || this.isDelegatedAttendanceMode()
      || (!!this.attendanceContext?.takeAttendanceGrantActive && !this.canManageAccessGrants());
  }

  private relevantScopeGrants(): AttendanceAccessGrant[] {
    const grants = this.attendanceContext?.activeGrants || [];
    const wantedKind = this.grantKindForCurrentUser();
    return grants.filter((grant) => grant.grantKind === wantedKind && grant.enabled !== false);
  }

  private isGrantActive(grant: AttendanceAccessGrant, now = new Date()): boolean {
    const start = new Date(grant.startsAt);
    const end = new Date(grant.endsAt);
    return !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && start <= now && now <= end;
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
    if (!this.shouldEnforceGrantWindow()) return [];
    const activeFamilies = this.grantedFamiliesFrom(this.activeScopeGrants(now));
    if (!this.isGroupedMemberFamilyMode()) return activeFamilies;
    return sortFamiliesByPreferredOrder(activeFamilies.map((family) => this.groupedFamilyLabel(family)), this.preferredFamilyOrder);
  }

  private filterFamiliesByGrantScope(allFamilies: string[]): string[] {
    const allowed = this.currentGrantFamilyOptions();
    if (!allowed.length) return allFamilies;
    if (this.isGroupedMemberFamilyMode()) return allowed;
    return allFamilies.filter((family) => allowed.includes(family));
  }

  private syncSelectedFamilyWithGrantScope(): void {
    const allowed = this.currentGrantFamilyOptions();
    if (!allowed.length) return;
    if (!this.selectedFamily || !allowed.includes(this.selectedFamily)) {
      this.selectedFamily = allowed[0] || '';
    }
  }

  private restrictOptionsByGrantScope(
    options: { value: AttendanceType; label: string }[],
    now = new Date()
  ): { value: AttendanceType; label: string }[] {
    if (this.isSelfCheckinMode() || !this.shouldEnforceGrantWindow()) return options;
    const allowedTypes = this.grantedTypesFrom(this.activeScopeGrants(now), this.selectedFamily);
    if (!allowedTypes.length) return options;
    const allowed = new Set(allowedTypes);
    return options.filter((option) => allowed.has(option.value));
  }

  private matchingWindowGrants(): AttendanceAccessGrant[] {
    const selectedFamilies = this.selectedFamily ? this.scopeFamiliesForSelection(this.selectedFamily) : [];
    return this.relevantScopeGrants().filter((grant) => {
      if (selectedFamilies.length && grant.familyBase) {
        const grantFamilies = this.grantFamilyList(grant.familyBase);
        if (!selectedFamilies.some((family) => grantFamilies.includes(family))) return false;
      }
      if (this.selectedType && Array.isArray(grant.allowedTypes) && grant.allowedTypes.length && !grant.allowedTypes.includes(this.selectedType)) return false;
      return true;
    });
  }

  private pickCountdownGrant(now = new Date()): AttendanceAccessGrant | null {
    const grants = this.matchingWindowGrants();
    const active = grants
      .filter((grant) => {
        const start = new Date(grant.startsAt);
        const end = new Date(grant.endsAt);
        return !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && start <= now && now <= end;
      })
      .sort((a, b) => new Date(a.endsAt).getTime() - new Date(b.endsAt).getTime());

    if (active.length) return active[0];

    const ended = grants
      .filter((grant) => {
        const start = new Date(grant.startsAt);
        const end = new Date(grant.endsAt);
        return !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && start <= now && end < now;
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

  private refreshRuntimeState(): void {
    const now = new Date();
    const grant = this.pickCountdownGrant(now);
    const activeGrants = this.activeScopeGrants(now);
    this.countdownGrant = grant;
    this.countdownText = '';
    this.countdownTypeText = '';
    this.countdownFamilyText = '';
    this.countdownEndsAtText = '';
    this.showCountdownClock = false;
    this.runtimeBlockedMessage = '';

    if (grant) {
      const endsAt = new Date(grant.endsAt).getTime();
      const remaining = endsAt - now.getTime();
      const grantedTypes = this.grantedTypesFrom(activeGrants, this.selectedFamily);
      const grantedFamilies = this.grantedFamiliesFrom(activeGrants);
      this.countdownTypeText = grantedTypes.map((type) => this.displayTypeLabel(type)).filter(Boolean).join(' + ') || this.countdownTypesText(grant);
      this.countdownFamilyText = grantedFamilies.length
        ? this.shortFamilyDisplayList(grantedFamilies)
        : this.shortFamilyDisplayName(String(grant.familyBase || this.selectedFamily || ''));
      this.countdownEndsAtText = this.formatDateTime(grant.endsAt);

      if (remaining > 0) {
        this.showCountdownClock = remaining <= 24 * 60 * 60 * 1000;
        this.countdownText = this.showCountdownClock ? this.formatDuration(remaining) : '';
      } else {
        this.countdownText = '00:00:00';
        if (this.shouldEnforceGrantWindow()) {
          const forWhat = this.countdownTypeText ? ` لتسجيل ${this.countdownTypeText}` : '';
          this.runtimeBlockedMessage = `انتهى الوقت المسموح${forWhat}.`;
        }
      }
    }

    this.updateBlockedMessage();
  }

  private startCountdownTicker(): void {
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    this.countdownTimer = setInterval(() => this.refreshRuntimeState(), 1000);
  }

  hasActiveCountdownCard(): boolean {
    return !!this.countdownGrant && this.isGrantActive(this.countdownGrant) && !this.blockedMessage;
  }

  private configOpenDays(): number[] {
    return this.attendanceContext?.config?.servantEntryOpenDays || [4, 5, 6, 0, 1];
  }

  private configSelectableEventDays(): number[] {
    return this.attendanceContext?.config?.servantSelectableEventDays || [4, 5, 6];
  }

  private configDaysForType(type: AttendanceType, family = this.selectedFamily): number[] {
    const familyDays = family ? this.attendanceContext?.config?.familyTypeDays?.[family]?.[type] : undefined;
    return familyDays || this.attendanceContext?.config?.typeDays?.[type] || this.defaultAttendanceConfig().typeDays[type] || [];
  }

  private configAbsenceAllowedDays(family = this.selectedFamily): number[] {
    const familyDays = family ? this.attendanceContext?.config?.familyAbsenceAllowedDays?.[family] : undefined;
    return (familyDays && familyDays.length ? familyDays : this.attendanceContext?.config?.servantSelectableEventDays) || [4, 5, 6];
  }

  private configAbsenceOpenDays(family = this.selectedFamily): number[] {
    const familyDays = family ? this.attendanceContext?.config?.familyAbsenceOpenDays?.[family] : undefined;
    return (familyDays && familyDays.length ? familyDays : this.attendanceContext?.config?.servantEntryOpenDays) || [4, 5, 6, 0, 1];
  }

  private allowedWeekdaysForCurrentUser(): number[] {
    const days = new Set<number>();
    const scopeNorm = String(this.me?.servingScope || '').trim().toUpperCase().replace(/[-\s]+/g, '_');
    const myKhors = String(this.me?.khors || '').trim().toUpperCase();
    const isAminKhedmaOrDev = ['AMIN_KHEDMA', 'DEVELOPER'].includes(this.roleNorm());

    ['FRIDAY_LITURGY', 'TASBEEHA', 'FAMILY_MEETING'].forEach((type) => {
      this.configDaysForType(type as AttendanceType).forEach((day) => days.add(day));
    });

    const canChoir = isAminKhedmaOrDev || scopeNorm === 'KHORS_ONLY' || scopeNorm === 'BOTH';
    if (canChoir) {
      if (isAminKhedmaOrDev || myKhors === 'BOTH' || myKhors === 'MARMARKOS') {
        this.configDaysForType('MARMARKOS_KHORS', 'خورس مارمرقس').forEach((day) => days.add(day));
      }
      if (isAminKhedmaOrDev || myKhors === 'BOTH' || myKhors === 'ATHANASIUS') {
        this.configDaysForType('ATHANASIUS_KHORS', 'خورس البابا أثناسيوس').forEach((day) => days.add(day));
      }
    }

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
    this.disabledDays = this.isSelfCheckinMode() ? [0, 1, 2, 3, 4, 5, 6].filter(x => x !== today.getDay()) : [];

    if (this.isSelfCheckinMode()) {
      this.minDate = today;
      this.maxDate = today;
      this.selectedDate = today;
      this.selected = [this.selfPickUser()];
      this.onDateChange();
      return;
    }

    const roleNorm = this.roleNorm();
    const canOverrideWeekClose = ['AMIN_OSRA', 'AMIN_KHEDMA', 'DEVELOPER'].includes(roleNorm) || this.hasAnyAminPrivilegeScope();

    if (!canOverrideWeekClose && !this.configAbsenceOpenDays().includes(today.getDay())) {
      this.pageBlockedMessage = 'تسجيل الغياب مقفول اليوم حسب الإعدادات الحالية لهذه الأسرة.';
    }

    const todayDay = today.getDay();
    const diffToMonday = (todayDay + 6) % 7;
    const monday = new Date(today);
    monday.setDate(today.getDate() - diffToMonday);

    this.minDate = canOverrideWeekClose ? new Date(2000, 0, 1) : monday;

    const allowedAbsenceDays = this.configAbsenceAllowedDays();

    if (canOverrideWeekClose) {
      this.disabledDays = [];
      this.selectedDate = today;
      this.onDateChange();
      this.updateBlockedMessage();
      return;
    }

    if (this.isKhadim()) {
      this.minDate = new Date(2000, 0, 1);
      const allowedWeekdays = this.allowedWeekdaysForCurrentUser();
      const allowedDays = allowedWeekdays.filter((day) => allowedAbsenceDays.includes(day));
      this.disabledDays = [0, 1, 2, 3, 4, 5, 6].filter(d => !allowedDays.includes(d));
      this.selectedDate = this.findLatestAllowedDate(today, allowedDays, this.minDate) || today;
    } else {
      this.disabledDays = [0, 1, 2, 3, 4, 5, 6].filter(d => !allowedAbsenceDays.includes(d));
      this.selectedDate = this.findLatestAllowedDate(today, allowedAbsenceDays, this.minDate) || today;
    }

    this.onDateChange();
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

  onDateChange() {
    if (!this.selectedDate) {
      this.typeOptions = [];
      this.refreshRuntimeState();
      return;
    }

    const d = new Date(this.selectedDate);
    d.setHours(0, 0, 0, 0);
    const dow = d.getDay();
    this.customTitle = '';

    if (this.isSelfCheckinMode()) {
      this.typeOptions = (this.attendanceContext?.selfAllowedTypes || []).map(type => ({ value: type, label: this.typeLabel(type) }));
      this.selectedType = this.typeOptions[0]?.value || 'FRIDAY_LITURGY';
      this.refreshRuntimeState();
      return;
    }

    const scopeNorm = String(this.me?.servingScope || '').trim().toUpperCase().replace(/[-\s]+/g, '_');
    const myKhors = String(this.me?.khors || '').trim().toUpperCase();
    const opts: { value: AttendanceType; label: string }[] = [];

    if (this.configDaysForType('FAMILY_MEETING').includes(dow)) opts.push({ value: 'FAMILY_MEETING', label: this.typeLabel('FAMILY_MEETING') });
    if (this.configDaysForType('FRIDAY_LITURGY').includes(dow)) opts.push({ value: 'FRIDAY_LITURGY', label: this.typeLabel('FRIDAY_LITURGY') });
    if (this.configDaysForType('TASBEEHA').includes(dow)) opts.push({ value: 'TASBEEHA', label: this.typeLabel('TASBEEHA') });

    const isAminKhedmaOrDev = ['AMIN_KHEDMA', 'DEVELOPER'].includes(this.roleNorm());
    const canChoir = isAminKhedmaOrDev || scopeNorm === 'KHORS_ONLY' || scopeNorm === 'BOTH';

    if (canChoir) {
      if (isAminKhedmaOrDev || myKhors === 'BOTH') {
        if (this.configDaysForType('MARMARKOS_KHORS', 'خورس مارمرقس').includes(dow)) {
          opts.push({ value: 'MARMARKOS_KHORS', label: this.typeLabel('MARMARKOS_KHORS') });
        }
        if (this.configDaysForType('ATHANASIUS_KHORS', 'خورس البابا أثناسيوس').includes(dow)) {
          opts.push({ value: 'ATHANASIUS_KHORS', label: this.typeLabel('ATHANASIUS_KHORS') });
        }
      } else if (myKhors === 'MARMARKOS') {
        if (this.configDaysForType('MARMARKOS_KHORS', 'خورس مارمرقس').includes(dow)) {
          opts.push({ value: 'MARMARKOS_KHORS', label: this.typeLabel('MARMARKOS_KHORS') });
        }
      } else if (myKhors === 'ATHANASIUS') {
        if (this.configDaysForType('ATHANASIUS_KHORS', 'خورس البابا أثناسيوس').includes(dow)) {
          opts.push({ value: 'ATHANASIUS_KHORS', label: this.typeLabel('ATHANASIUS_KHORS') });
        }
      }
    }

    const scopedOptions = this.restrictOptionsByGrantScope(opts);

    if (!scopedOptions.length) {
      if (this.canUseCustomEvent() && this.attendanceContext?.config?.allowCustomTitleOnNonDefaultDays) {
        this.typeOptions = [{ value: 'CUSTOM_EVENT', label: this.typeLabel('CUSTOM_EVENT') }];
        this.selectedType = 'CUSTOM_EVENT';
      } else {
        this.typeOptions = [];
      }
      this.refreshRuntimeState();
      return;
    }

    this.typeOptions = scopedOptions;
    if (!scopedOptions.some(x => x.value === this.selectedType)) {
      this.selectedType = scopedOptions[0]?.value || 'FRIDAY_LITURGY';
    }
    this.syncFamilyWithType();
    this.refreshRuntimeState();
  }

  onTypeChange() {
    this.syncFamilyWithType();
    this.refreshRuntimeState();
  }

  private syncFamilyWithType() {
    if (this.isSelfCheckinMode()) return;
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
    if (this.isSelfCheckinMode() || this.selectedType === 'CUSTOM_EVENT' || !!this.blockedMessage) return;
    this.scanning = !this.scanning;
  }

  onFamilyChange() {
    if (this.isSelfCheckinMode()) return;
    this.syncSelectedFamilyWithGrantScope();
    this.members = [];
    this.globalResults = [];
    if (this.selectedFamily) this.loadMembersForFamily();
    else if (this.searchText.trim()) this.runSearch();
    if (this.canManageAccessGrants()) this.loadGrantTargets();
    this.initCalendarRules();
    this.refreshRuntimeState();
  }

  onSearchChange(v: string) {
    if (this.isSelfCheckinMode()) return;
    this.searchText = v;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.runSearch(), 250);
  }

  private runSearch() {
    const q = (this.searchText || '').trim();
    if (this.selectedFamily || !q || this.isSelfCheckinMode()) {
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
      this.members = [this.selfPickUser()];
      this.selected = [this.selfPickUser()];
      this.refreshRuntimeState();
      return;
    }

    this.familySvc.families('attendance').subscribe({
      next: (f) => {
        const allFamilies = sortFamiliesByPreferredOrder(f || [], this.preferredFamilyOrder);
        this.families = this.filterFamiliesByGrantScope(allFamilies);
        this.ensureSelectedConfigFamily();
        this.syncSelectedFamilyWithGrantScope();
        if ((!this.selectedFamily || !this.families.includes(this.selectedFamily)) && this.families.length) {
          this.selectedFamily = this.families[0];
          this.loadMembersForFamily();
        } else if (this.selectedFamily) {
          this.loadMembersForFamily();
        }
        this.initCalendarRules();
        this.refreshRuntimeState();
        if (this.canManageAccessGrants()) this.loadGrantTargets();
      },
      error: () => (this.families = [])
    });
  }

  private loadMembersForFamily() {
    if (!this.selectedFamily || this.isSelfCheckinMode()) return;
    const familiesToLoad = this.scopeFamiliesForSelection(this.selectedFamily);
    const requests = (familiesToLoad.length ? familiesToLoad : [this.selectedFamily]).map((family) =>
      this.familySvc.members(family, true, 'attendance')
    );

    forkJoin(requests).subscribe({
      next: (groups) => {
        const merged = groups.flatMap((group: any) => Array.isArray(group) ? group : []);
        const unique = Array.from(new Map(merged.map((user: any) => [Number(user?.id), user])).values());
        this.members = unique.map(this.toPickUser);
        if (this.canManageAccessGrants()) this.loadGrantTargets();
      },
      error: (err) => {
        this.members = [];
        this.message.add({ severity: 'error', summary: 'Error', detail: err?.error?.error || 'Failed to load' });
      }
    });
  }

  private toPickUser = (u: any): PickUser => ({
    id: Number(u?.id),
    username: u?.username,
    fullName: u?.fullName,
    role: u?.role,
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
    if (this.isSelfCheckinMode()) return [this.selfPickUser()];
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

  toggleSelect(u: PickUser) {
    if (this.isSelfCheckinMode() || !u?.id || this.isSelected(u.id)) return;
    this.selected = [...this.selected, u];
  }

  remove(id: number) {
    if (this.isSelfCheckinMode()) return;
    this.selected = this.selected.filter((x) => x.id !== id);
  }

  onCodeResult(resultString: string) {
    if (this.isSelfCheckinMode() || this.selectedType === 'CUSTOM_EVENT') return;
    const token = (resultString || '').trim();
    if (!token) return;

    const now = Date.now();
    if (token === this.lastScannedToken && now - this.lastScannedAt < 1500) return;
    this.lastScannedToken = token;
    this.lastScannedAt = now;

    const iso = this.selectedDate ? this.toIsoDate(this.selectedDate) : undefined;
    const requestedFamily = this.selectedFamily || undefined;
    const family = ['FAMILY_MEETING', 'CUSTOM_EVENT', 'MARMARKOS_KHORS', 'ATHANASIUS_KHORS'].includes(this.selectedType)
      ? requestedFamily
      : undefined;

    this.attendance.scanToken(token, iso, this.selectedType, family).subscribe({
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

    if (this.isSelfCheckinMode()) {
      if (!this.selectedType) {
        this.message.add({ severity: 'warn', summary: 'تنبيه', detail: 'اختار النوع أولاً' });
        return;
      }
      this.attendance.selfCheckin(this.selectedType, iso).subscribe({
        next: () => {
          this.message.add({ severity: 'success', summary: 'تم', detail: 'تم تسجيل حضورك بنجاح' });
        },
        error: (err) => {
          this.message.add({ severity: 'error', summary: 'خطأ', detail: err?.error?.error || err?.error?.message || 'Failed' });
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

    if (allowedTypes.length && !allowedTypes.includes(this.selectedType)) {
      this.message.add({ severity: 'warn', summary: 'غير مسموح', detail: 'التخصيص الحالي لا يسمح لك بالتسجيل لهذا النوع.' });
      return;
    }

    if (users.length === 0 && !canOverrideWeekClose) {
      this.message.add({ severity: 'warn', summary: 'No users', detail: 'اختار اسم واحد على الأقل أو اعمل Scan للـ QR' });
      return;
    }

    if (['FAMILY_MEETING', 'CUSTOM_EVENT', 'MARMARKOS_KHORS', 'ATHANASIUS_KHORS'].includes(this.selectedType) && !this.selectedFamily) {
      this.message.add({ severity: 'warn', summary: 'No family', detail: 'اختار الأسرة قبل التسجيل' });
      return;
    }

    if (this.selectedType === 'CUSTOM_EVENT' && !this.customTitle.trim()) {
      this.message.add({ severity: 'warn', summary: 'العنوان مطلوب', detail: 'اكتب عنوان المناسبة المخصصة أولاً' });
      return;
    }

    this.attendance.submit(users, this.selectedType, iso, this.selectedFamily || undefined, this.customTitle.trim() || undefined).subscribe({
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
      startsAt: this.nowPlusHours(0),
      endsAt: this.nowPlusHours(2),
      enabled: true,
      familyBase: this.selectedFamily || ''
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

  private isServantGrantTarget(user?: PickUser | null): boolean {
    const role = normalizeRole(user?.role);
    return role === 'KHADIM' || role === 'AMIN_OSRA' || role === 'AMIN_KHEDMA';
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
    this.grantForm.grantKind = this.grantKindFromAudience(this.grantAudience);
    this.grantForm.targetUserId = undefined;
    if (this.grantAudience === 'SERVANTS') {
      this.grantFamilySelections = this.selectedFamily ? [this.selectedFamily] : [];
      this.syncGrantFamilyFormFromSelections();
      this.loadGrantTargets(this.selectedFamily || '');
    } else {
      this.grantFamilySelections = [];
      this.grantForm.familyBase = '';
      this.loadGrantTargets(this.selectedFamily || '');
    }
  }

  onGrantFamilyBaseChange(): void {
    if (this.grantAudience !== 'SERVANTS') {
      this.grantForm.targetUserId = undefined;
    }
  }

  onGrantTargetChange(): void {
    const target = this.grantTargets.find((u) => u.id === this.grantForm.targetUserId);
    if (!target) return;
    if (this.grantAudience === 'MEMBERS') {
      this.grantForm.familyBase = this.pairedMemberFamiliesFor(target).join(', ');
    } else if (!this.grantForm.familyBase) {
      this.grantFamilySelections = this.selectedFamily ? [this.selectedFamily] : [this.primaryFamilyFor(target)];
      this.syncGrantFamilyFormFromSelections();
    }
  }

  onGrantStartDateChange(value: Date | null): void {
    this.grantStartsAtDate = value;
    this.grantForm.startsAt = value ? this.toDateTimeLocalValue(value) : '';
  }

  onGrantEndDateChange(value: Date | null): void {
    this.grantEndsAtDate = value;
    this.grantForm.endsAt = value ? this.toDateTimeLocalValue(value) : '';
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
    const base: AttendanceType[] = ['FRIDAY_LITURGY', 'TASBEEHA', 'FAMILY_MEETING', 'MARMARKOS_KHORS', 'ATHANASIUS_KHORS'];
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

  private loadGrantTargets(scopeFamily = this.selectedFamily): void {
    if (!this.canManageAccessGrants()) {
      this.grantTargets = [];
      return;
    }
    if (this.grantAudience === 'SERVANTS' && !scopeFamily) {
      const allFamilies = this.families.filter(Boolean);
      if (!allFamilies.length) {
        this.grantTargets = [];
        return;
      }
      forkJoin(allFamilies.map((family) => this.familySvc.members(family, true, 'attendance'))).subscribe({
        next: (groups) => {
          const merged = groups.flatMap((group: any) => (group || []).map((x: any) => this.toPickUser(x)));
          const unique = merged.filter((user, index, arr) => arr.findIndex((x) => x.id === user.id) === index);
          this.grantTargets = unique.filter((user) => this.isServantGrantTarget(user));
        },
        error: () => this.grantTargets = []
      });
      return;
    }
    if (!scopeFamily) {
      this.grantTargets = [];
      return;
    }
    this.familySvc.members(scopeFamily, true, 'attendance').subscribe({
      next: (m) => {
        const allTargets = (m || []).map((x: any) => this.toPickUser(x));
        this.grantTargets = allTargets.filter((user) =>
          this.grantAudience === 'SERVANTS' ? this.isServantGrantTarget(user) : !this.isServantGrantTarget(user)
        );
      },
      error: () => this.grantTargets = []
    });
  }

  openCreateGrant(): void {
    this.grantDialogMode = 'create';
    this.grantForm = this.defaultGrantForm();
    this.grantAudience = this.grantAudienceFromKind(this.grantForm.grantKind);
    this.grantFamilySelections = this.selectedFamily ? [this.selectedFamily] : [];
    this.syncGrantFamilyFormFromSelections();
    this.syncGrantDateControls();
    this.loadGrantTargets(this.selectedFamily || '');
    this.grantDialogVisible = true;
  }

  openEditGrant(grant: AttendanceAccessGrant): void {
    this.grantDialogMode = 'edit';
    this.grantForm = {
      ...grant,
      familyBase: this.grantAudienceFromKind(grant.grantKind) === 'SERVANTS' ? (grant.familyBase || '') : grant.familyBase,
      startsAt: this.toDateTimeLocalValue(grant.startsAt),
      endsAt: this.toDateTimeLocalValue(grant.endsAt),
      allowedTypes: [...(grant.allowedTypes || [])]
    };
    this.grantAudience = this.grantAudienceFromKind(grant.grantKind);
    this.syncGrantFamilySelectionsFromForm();
    this.syncGrantDateControls();
    this.loadGrantTargets(this.selectedFamily || this.grantForm.familyBase || '');
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

  saveGrant(): void {
    if (!this.grantForm.targetUserId) {
      this.message.add({ severity: 'warn', summary: 'تنبيه', detail: 'اختر الشخص أولاً' });
      return;
    }
    if (!this.grantForm.allowedTypes?.length) {
      this.message.add({ severity: 'warn', summary: 'تنبيه', detail: 'اختر مناسبة واحدة على الأقل' });
      return;
    }
    if (!this.grantForm.startsAt || !this.grantForm.endsAt) {
      this.message.add({ severity: 'warn', summary: 'تنبيه', detail: 'حدد وقت البداية والنهاية' });
      return;
    }
    if (new Date(this.grantForm.endsAt).getTime() <= new Date(this.grantForm.startsAt).getTime()) {
      this.message.add({ severity: 'warn', summary: 'تنبيه', detail: 'وقت النهاية لازم يكون بعد وقت البداية' });
      return;
    }
    const payload = {
      ...this.grantForm,
      grantKind: this.grantKindFromAudience(this.grantAudience),
      familyBase: this.grantAudience === 'MEMBERS'
        ? (this.grantForm.familyBase || undefined)
        : (this.grantForm.familyBase || undefined),
      startsAt: this.grantForm.startsAt,
      endsAt: this.grantForm.endsAt
    };

    const req = this.grantDialogMode === 'create'
      ? this.attendance.createAccessGrant(payload)
      : this.attendance.updateAccessGrant(Number(this.grantForm.id), payload);

    req.subscribe({
      next: () => {
        this.message.add({ severity: 'success', summary: 'تم', detail: 'تم حفظ التخصيص بنجاح' });
        this.grantDialogVisible = false;
        this.loadAccessGrants();
      },
      error: (err) => {
        this.message.add({ severity: 'error', summary: 'خطأ', detail: err?.error?.error || err?.error?.message || 'فشل الحفظ' });
      }
    });
  }

  deleteGrant(grant: AttendanceAccessGrant): void {
    if (!grant.id) return;
    this.attendance.deleteAccessGrant(grant.id).subscribe({
      next: () => {
        this.message.add({ severity: 'success', summary: 'تم', detail: 'تم حذف التخصيص' });
        this.loadAccessGrants();
      },
      error: () => {
        this.message.add({ severity: 'error', summary: 'خطأ', detail: 'فشل حذف التخصيص' });
      }
    });
  }
}