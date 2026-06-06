import { Component, OnDestroy, OnInit, inject, Inject, PLATFORM_ID, ViewChild } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ZXingScannerComponent } from '@zxing/ngx-scanner';
import {
  AttendanceService,
  AttendanceType,
  AttendanceContext,
  AttendanceAccessGrant,
  AttendanceConfig,
  AttendanceCustomEvent,
  AttendanceRuleGroup
} from '../services/attendance.service';
import { AuthService } from '../services/auth.service';
import { FamilyService } from '../services/family.service';
import { MessageService } from 'primeng/api';
import { Select } from 'primeng/select';
import { DatePicker } from 'primeng/datepicker';
import { assignmentRolesOf, normalizeAssignmentRole, normalizeRole, roleLabel } from '../shared/role-utils';
import { DEFAULT_FAMILY_ORDER, canonicalFamilyName, sortFamiliesByPreferredOrder } from '../shared/family-utils';
import { forkJoin, from, of } from 'rxjs';
import { catchError, concatMap, switchMap, toArray } from 'rxjs/operators';

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
type GrantScheduleGroup = {
  key: string;
  grants: AttendanceAccessGrant[];
  first: AttendanceAccessGrant;
  editGroup: GrantGroup;
  typeLabel: string;
  dayLabel: string;
  familyLabel: string;
  dateRangeText: string;
  timeRangeText: string;
  notesText: string;
  enabled: boolean;
};
type PersonGrantGroup = {
  key: string;
  grants: AttendanceAccessGrant[];
  first: AttendanceAccessGrant;
  targetName: string;
  kindLabel: string;
  enabled: boolean;
  schedules: GrantScheduleGroup[];
};
type CustomEventForm = Partial<AttendanceCustomEvent> & {
  familyBase: string;
  familyBases: string[];
  title: string;
  dayOfWeek: number;
  dayOfWeeks: number[];
  enabled: boolean;
  alwaysActive: boolean;
  permittedEditorIds: number[];
};
type CustomEventGroup = {
  key: string;
  events: AttendanceCustomEvent[];
  first: AttendanceCustomEvent;
  days: number[];
  enabled: boolean;
};
type CustomEventDialogOption = {
  value: string;
  label: string;
  isNew?: boolean;
};

@Component({
  selector: 'app-attendance',
  standalone: false,
  templateUrl: './attendance.html',
  styleUrls: ['./attendance.css'],
  providers: [MessageService]
})
export class AttendanceComponent implements OnInit, OnDestroy {
  @ViewChild('grantTargetSelect') private grantTargetSelect?: Select;

  private attendance = inject(AttendanceService);
  private auth = inject(AuthService);
  private familySvc = inject(FamilyService);
  private message = inject(MessageService);

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {}

  me: any;
  attendanceContext: AttendanceContext | null = null;

  scannerOverlayVisible = false;
  scannerDevice: any;
  scannerVideoConstraints = {
    facingMode: { exact: 'environment' },
    width: { ideal: 1280 },
    height: { ideal: 720 },
    advanced: [{ zoom: 1 } as MediaTrackConstraintSet]
  } as MediaTrackConstraints;
  @ViewChild('qrScanner') scannerComponent?: ZXingScannerComponent;
  @ViewChild('attendanceDatePicker') attendanceDatePicker?: DatePicker;
  selectedDate: Date | null = null;
  minDate!: Date;
  maxDate!: Date;
  disabledDays: number[] = [0, 1, 2, 3];
  cancelledDisabledDates: Date[] = [];
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
  selectedFamilies: string[] = [];
  private readonly preferredFamilyOrder = DEFAULT_FAMILY_ORDER;

  get allFamiliesSelected(): boolean {
    return this.selectedFamilies.length === this.families.length;
  }

  toggleAllFamilies(): void {
    if (this.allFamiliesSelected) {
      this.selectedFamilies = [];
    } else {
      this.selectedFamilies = [...this.families];
    }
    this.onFamilyChanged();
  }

  get familySelectOptions(): Array<{ label: string; value: string }> {
    return this.families.map((f) => ({ label: f, value: f }));
  }

  members: PickUser[] = [];
  membersLoading = false;
  membersLoadError = '';
  globalResults: PickUser[] = [];
  searchText = '';
  searchTimer: any = null;
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
  selectedGrantPersonKeys: string[] = [];
  expandedDialogGrantPersonKeys: string[] = [];
  grantDialogVisible = false;
  grantDialogMode: 'create' | 'edit' = 'create';
  grantForm: Partial<AttendanceAccessGrant> = this.defaultGrantForm();
  private editingGrantGroupIds: number[] = [];
  private editingGrantTargetFallbacks: PickUser[] = [];
  grantTargets: PickUser[] = [];
  selectedGrantTargetIds: number[] = [];
  grantTargetSearch = '';
  grantAudience: GrantAudience = 'SERVANTS';
  private lastGrantAudience: GrantAudience = 'SERVANTS';
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
  grantTargetDropdownSelection: number | null = null;
  grantTargetSelectVisible = true;
  grantSavedSummaries: GrantSavedSummary[] = [];
  readonly grantNoDisabledDays: number[] = [];
  readonly grantMinDate: Date = this.startOfToday();
  grantPermanentEnabled = false;
  grantPermanentFromDate: Date | null = null;
  grantPermanentToDate: Date | null = null;

  configEditor: AttendanceConfig = this.defaultAttendanceConfig();
  configSaving = false;
  configFamilyOptions: string[] = [];
  selectedConfigFamily = '';
  selectedScheduleConfigType: AttendanceType | '' = '';
  configPanelOpen = false;
  ruleGroupsDialogVisible = false;
  editableRuleGroups: AttendanceRuleGroup[] = [];
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

  // schedule management
  scheduleDialogVisible = false;
  scheduleSaving = false;
  scheduleItems: any[] = [];
  scheduleFamilies: string[] = [];
  selectedScheduleFamilies: string[] = [];
  editingScheduleId: number | null = null;
  editScheduleDialogVisible = false;
  editScheduleItem: any = null;
  editScheduleTime: Date | null = null;
  editScheduleDay: number = 5;
  scheduleForm: { familyBase: string; type: AttendanceType | ''; dayOfWeek: number; time: Date | null } = {
    familyBase: '',
    type: '',
    dayOfWeek: 5,
    time: null
  };

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
  private editingCustomEventGroupIds: number[] = [];
  customEventForm: CustomEventForm = this.defaultCustomEventForm();
  customEventDialogSelection = '__new__';
  customEventDialogEvents: AttendanceCustomEvent[] = [];
  customEventDialogGroups: CustomEventGroup[] = [];
  customEventActiveFromDate: Date | null = null;
  customEventActiveToDate: Date | null = null;
  customEventBlockedDates: Date[] = [];
  readonly customEventMinDate: Date = this.startOfToday();
  familyCustomEvents: AttendanceCustomEvent[] = [];
  familyCustomEventGroups: CustomEventGroup[] = [];
  availableCustomEvents: AttendanceCustomEvent[] = [];
  selectedCustomEventId: number | '' = '';
  customEventsPopupVisible = false;
  customEventDeleteConfirmVisible = false;
  pendingCustomEventDeleteGroup: CustomEventGroup | null = null;
  private pendingEditingCustomEventDelete = false;
  customEventEditorTargets: PickUser[] = [];
  customEventEditorPickerId: number | null = null;
  customEventEditorSearch = '';

  ngOnInit() {
    if (!isPlatformBrowser(this.platformId)) return;

    this.findBackCamera();

    this.auth.getUserData().subscribe((u) => {
      this.me = u;
      this.loadContext();
      this.startCountdownTicker();
    });
  }

  private async findBackCamera(): Promise<void> {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const devices = await navigator.mediaDevices.enumerateDevices();
      const pick = this.pickNormalBackCamera(devices);
      if (pick) this.scannerDevice = pick;
    } catch {}
  }

  private pickNormalBackCamera(devices: MediaDeviceInfo[]): MediaDeviceInfo | undefined {
    const videoInputs = devices.filter(d => d.kind === 'videoinput');
    const scored = videoInputs
      .map((device, index) => ({
        device,
        index,
        score: this.normalBackCameraScore(device),
        label: (device.label || '').toLowerCase()
      }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index);

    return scored[0]?.device || videoInputs[0];
  }

  private normalBackCameraScore(device: MediaDeviceInfo): number {
    const label = (device.label || '').toLowerCase();
    if (!label) return 0;

    const isBack = /back|rear|environment|traseira|arrière|hatsó|hátsó|背面/i.test(label);
    if (!isBack) return 0;

    const isUltraWide = /ultra\s*wide|ultrawide|0\.5x?|wide.?angle/i.test(label);
    const isTelephoto = /telephoto|tele\s*photo|2x|3x|5x/i.test(label);
    const isMacro = /macro/i.test(label);
    if (isUltraWide || isTelephoto || isMacro) return 0;

    let score = 100;
    if (/main|standard|normal|default|1x/i.test(label)) score += 40;
    if (/back camera|rear camera|environment camera/i.test(label)) score += 20;
    const genericCameraNumber = label.match(/camera\s*(\d+)/i);
    if (genericCameraNumber) {
      const cameraNumber = Number(genericCameraNumber[1]);
      if (cameraNumber === 0) score += 35;
      else if (!Number.isNaN(cameraNumber)) score += Math.max(0, 20 - cameraNumber * 5);
    }
    return score;
  }

  private async ensureCameraPermission(): Promise<void> {
    try {
      const tempStream = await navigator.mediaDevices.getUserMedia({
        video: this.scannerVideoConstraints
      });
      tempStream.getTracks().forEach(t => t.stop());
    } catch {}
  }

  private async prepareScannerCamera(): Promise<void> {
    await this.ensureCameraPermission();

    try {
      if (!navigator.mediaDevices?.enumerateDevices) {
        this.scannerDevice = undefined;
        return;
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const pick = this.pickNormalBackCamera(devices);
      this.scannerDevice = pick;
    } catch {
      this.scannerDevice = undefined;
    }
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
      && !this.hasVisibleTakeAttendanceGrants();
  }

  canSelectFamily(): boolean {
    if (this.isSelfCheckinMode() || this.isDelegatedAttendanceMode()) return this.currentGrantFamilyOptions().length > 1;
    return this.isAminKhedmaOrDeveloper() || this.isKhadim() || this.hasAnyAminPrivilegeScope();
  }

  hasRestrictedFamilyScope(): boolean {
    return this.currentGrantFamilyOptions().length > 0;
  }

  canUseCustomEvent(): boolean {
    return !!this.attendanceContext?.canUseCustomEvent && !this.isKhadim();
  }

  private hasVisibleCustomEventAttendanceGrant(): boolean {
    return this.relevantScopeGrants().some((grant) =>
      grant.grantKind === 'TAKE_ATTENDANCE'
      && grant.enabled !== false
      && (grant.allowedTypes || []).includes('CUSTOM_EVENT')
    );
  }

  private canSelectCustomEventForAttendance(): boolean {
    return this.canUseCustomEvent() || this.hasVisibleCustomEventAttendanceGrant();
  }

  canManageAccessGrants(): boolean {
    return ['AMIN_OSRA', 'AMIN_KHEDMA', 'DEVELOPER'].includes(this.roleNorm()) || this.hasAnyAminPrivilegeScope();
  }

  canManageAttendanceConfig(): boolean {
    return ['AMIN_OSRA', 'AMIN_KHEDMA', 'DEVELOPER'].includes(this.roleNorm()) || this.hasAnyAminPrivilegeScope();
  }

  canFilterGrantFamilies(): boolean {
    return this.isAminKhedmaOrDeveloper();
  }

  isDeveloper(): boolean {
    return this.roleNorm() === 'DEVELOPER';
  }

  private hasScopedAssignmentRole(role: 'AMIN_OSRA' | 'AMIN_KHEDMA'): boolean {
    return this.assignmentsOf(this.me).some((assignment) => assignment.role === role);
  }

  private hasAminOsraPrivilege(): boolean {
    return this.roleNorm() === 'AMIN_OSRA' || this.hasScopedAssignmentRole('AMIN_OSRA');
  }

  private hasAminKhedmaPrivilege(): boolean {
    return this.roleNorm() === 'AMIN_KHEDMA' || this.hasScopedAssignmentRole('AMIN_KHEDMA');
  }

  isAminKhedmaOrDeveloper(): boolean {
    return this.isDeveloper() || this.hasAminKhedmaPrivilege();
  }

  private isScopedAminOsraAttendanceManager(): boolean {
    return !this.isAminKhedmaOrDeveloper() && this.hasAminOsraPrivilege();
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
    if (!this.hasAminOsraPrivilege()) return [];

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
    if (this.isAminKhedmaOrDeveloper()) {
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
    if (!this.isAminKhedmaOrDeveloper()) {
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
    return !!this.selectedConfigFamily && !this.isAminKhedmaOrDeveloper() && this.configFamilyOptions.length === 1;
  }

  shouldShowConfigFamilyPicker(): boolean {
    return this.configFamilyOptions.length > 1;
  }

  openGrantsPopup(): void {
    this.grantSearchText = '';
    this.grantsFilterFamily = '';
    this.grantPopupFilter = 'ALL';
    this.grantPopupVisible = true;
    setTimeout(() => {
      if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    }, 50);
  }

  closeGrantsPopup(): void {
    this.grantPopupVisible = false;
    this.selectedGrantPersonKeys = [];
  }

  grantPopupFilterOptions(): Array<{ value: GrantPopupFilter; label: string }> {
    if (!this.canFilterGrantFamilies()) {
      return [
        { value: 'ALL', label: 'كل التخصيصات' },
        { value: 'SERVANTS_SCOPE', label: 'الخدام' },
        { value: 'MEMBERS_SCOPE', label: 'المخدومين' }
      ];
    }

    const scopeLabel = this.selectedFamily || 'الأسرة الحالية';
    return [
      { value: 'ALL', label: 'كل التخصيصات' },
      { value: 'SERVANTS_SCOPE', label: `خدام ${scopeLabel}` },
      { value: 'MEMBERS_SCOPE', label: `مخدومين ${scopeLabel}` }
    ];
  }

  popupGrantCountLabel(): string {
    return `${this.filteredPersonGrantGroups.length} تخصيص`;
  }

  personGrantGroupCount(): number {
    return this.groupGrantsByPerson(this.visibleGrantsForCurrentManager(this.grants)).length;
  }

  private grantMatchesPopupFilter(grant: AttendanceAccessGrant): boolean {
    const selected = this.canFilterGrantFamilies() ? String(this.selectedFamily || '').trim() : '';
    const grantFamilies = this.grantFamilyList(grant.familyBase);
    const targetAudience = this.grantTargetAudience(grant);

    switch (this.grantPopupFilter) {
      case 'SERVANTS_SCOPE':
        return targetAudience === 'SERVANTS' && (!!selected ? grantFamilies.includes(selected) : true);
      case 'MEMBERS_SCOPE':
        return targetAudience === 'MEMBERS' && (!!selected ? grantFamilies.includes(selected) : true);
      default:
        return true;
    }
  }

  private managerGrantScopeFamilies(): string[] {
    if (this.canFilterGrantFamilies()) return [];
    const families = this.aminOsraFamilies();
    if (families.length) return families;
    return [this.defaultGrantScopeFamily()].filter(Boolean);
  }

  private grantBelongsToManagerScope(grant: AttendanceAccessGrant): boolean {
    const scopeFamilies = this.managerGrantScopeFamilies();
    if (!scopeFamilies.length) return true;
    const grantFamilies = this.grantFamilyList(grant.familyBase);
    return this.grantFamiliesOverlap(grantFamilies, scopeFamilies);
  }

  private visibleGrantsForCurrentManager(grants: AttendanceAccessGrant[]): AttendanceAccessGrant[] {
    return (grants || []).filter((grant) => this.grantBelongsToManagerScope(grant));
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
    const selected = this.canFilterGrantFamilies() ? String(this.grantsFilterFamily || '').trim() : '';
    const q = String(this.grantSearchText || '').trim().toLowerCase();
    return this.visibleGrantsForCurrentManager(this.grants).filter((grant) => {
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

  get filteredPersonGrantGroups(): PersonGrantGroup[] {
    return this.groupGrantsByPerson(this.filteredGrants);
  }

  selectedGrantPersonCount(): number {
    return this.selectedGrantPersonGroups().length;
  }

  selectedGrantPersonGroups(): PersonGrantGroup[] {
    const selectedKeys = new Set(this.selectedGrantPersonKeys || []);
    if (!selectedKeys.size) return [];
    return this.filteredPersonGrantGroups.filter((group) => selectedKeys.has(group.key));
  }

  isGrantPersonSelected(group: PersonGrantGroup): boolean {
    return (this.selectedGrantPersonKeys || []).includes(group.key);
  }

  isDialogGrantPersonExpanded(group: PersonGrantGroup): boolean {
    return (this.expandedDialogGrantPersonKeys || []).includes(group.key);
  }

  toggleDialogGrantPerson(group: PersonGrantGroup): void {
    if (this.isDialogGrantPersonExpanded(group)) {
      this.expandedDialogGrantPersonKeys = this.expandedDialogGrantPersonKeys.filter((key) => key !== group.key);
      return;
    }
    this.expandedDialogGrantPersonKeys = [group.key];
  }

  dialogExpandedGrantPersonGroup(groups: PersonGrantGroup[]): PersonGrantGroup | null {
    const key = this.expandedDialogGrantPersonKeys[0];
    return groups.find((group) => group.key === key) || null;
  }

  toggleGrantPersonSelection(group: PersonGrantGroup, checked: boolean): void {
    const selected = new Set(this.selectedGrantPersonKeys || []);
    if (checked) selected.add(group.key);
    else selected.delete(group.key);
    this.selectedGrantPersonKeys = Array.from(selected);
  }

  allVisibleGrantPeopleSelected(): boolean {
    const groups = this.filteredPersonGrantGroups;
    return !!groups.length && groups.every((group) => this.isGrantPersonSelected(group));
  }

  toggleAllVisibleGrantPeople(checked: boolean): void {
    const selected = new Set(this.selectedGrantPersonKeys || []);
    for (const group of this.filteredPersonGrantGroups) {
      if (checked) selected.add(group.key);
      else selected.delete(group.key);
    }
    this.selectedGrantPersonKeys = Array.from(selected);
  }

  clearGrantPersonSelection(): void {
    this.selectedGrantPersonKeys = [];
  }

  editSelectedGrantPeople(): void {
    const groups = this.selectedGrantPersonGroups();
    if (!groups.length) return;

    const audiences = new Set(groups.map((group) => this.grantTargetAudience(group.first)));
    if (audiences.size > 1) {
      this.message.add({ severity: 'warn', summary: 'تنبيه', detail: 'اختار خدام فقط أو مخدومين فقط للتعديل الجماعي.' });
      return;
    }

    const grants = groups.flatMap((group) => group.grants);
    const first = grants[0];
    if (!first) return;
    this.openEditGrantGroup({
      key: `bulk-${groups.map((group) => group.key).join('__')}`,
      grants,
      first,
      targetNames: groups.map((group) => group.targetName).filter(Boolean).join(' + '),
      notes: Array.from(new Set(grants.map((grant) => String(grant.note || '').trim()).filter(Boolean)))
    });
    this.grantPopupVisible = false;
  }

  deleteSelectedGrantPeople(): void {
    if (!this.canManageAccessGrants()) return;
    const groups = this.selectedGrantPersonGroups();
    const ids = Array.from(new Set(groups.flatMap((group) => group.grants.map((grant) => Number(grant.id || 0))).filter(Boolean)));
    if (!ids.length) return;

    forkJoin(ids.map((id) => this.attendance.deleteAccessGrant(id))).subscribe({
      next: () => {
        this.message.add({ severity: 'success', summary: 'تم', detail: `تم حذف تخصيصات ${groups.length} شخص` });
        const idSet = new Set(ids);
        this.grantSavedSummaries = this.grantSavedSummaries.filter((item) =>
          !(item.sourceGrants || (item.sourceGrant ? [item.sourceGrant] : []))
            .some((grant) => idSet.has(Number(grant.id || 0)))
        );
        this.selectedGrantPersonKeys = [];
        this.loadAccessGrants();
      },
      error: (err) => {
        this.message.add({ severity: 'error', summary: 'خطأ', detail: err?.error?.error || err?.error?.message || 'فشل حذف التخصيصات' });
      }
    });
  }

  private groupGrantsByPerson(grants: AttendanceAccessGrant[]): PersonGrantGroup[] {
    const people = new Map<string, AttendanceAccessGrant[]>();
    for (const grant of grants || []) {
      const key = this.personGrantGroupingKey(grant);
      people.set(key, [...(people.get(key) || []), grant]);
    }

    return Array.from(people.entries())
      .map(([key, items]) => {
        const sorted = items.slice().sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
        const first = sorted[0];
        return {
          key,
          grants: sorted,
          first,
          targetName: first.targetUserName || this.grantTargetNameFor(first.targetUserId),
          kindLabel: this.grantTargetAudience(first) === 'MEMBERS' ? 'مخدوم' : 'خادم',
          enabled: sorted.some((grant) => grant.enabled !== false),
          schedules: this.groupPersonGrantSchedules(sorted)
        };
      })
      .sort((a, b) => a.targetName.localeCompare(b.targetName, 'ar'));
  }

  private personGrantGroupingKey(grant: AttendanceAccessGrant): string {
    return [
      this.grantTargetAudience(grant),
      Number(grant.targetUserId || 0) || String(grant.targetUserName || '').trim()
    ].join('|');
  }

  private grantTargetAudience(grant: Partial<AttendanceAccessGrant>): GrantAudience {
    const role = normalizeRole(grant.targetUserRole);
    if (role === 'MAKHDOM') return 'MEMBERS';
    if (role === 'KHADIM' || role === 'AMIN_OSRA' || role === 'AMIN_KHEDMA' || role === 'DEVELOPER') return 'SERVANTS';

    const roleText = String(grant.targetUserRole || '').trim();
    if (roleText.includes('مخدوم')) return 'MEMBERS';
    if (roleText.includes('خادم') || roleText.includes('امين') || roleText.includes('أمين')) return 'SERVANTS';

    const name = String(grant.targetUserName || '').trim();
    if (name.startsWith('مخدوم')) return 'MEMBERS';
    if (name.startsWith('خادم')) return 'SERVANTS';

    return this.grantAudienceFromKind(grant.grantKind);
  }

  private groupPersonGrantSchedules(grants: AttendanceAccessGrant[]): GrantScheduleGroup[] {
    const schedules = new Map<string, AttendanceAccessGrant[]>();
    for (const grant of grants || []) {
      const key = this.grantScheduleGroupingKey(grant);
      schedules.set(key, [...(schedules.get(key) || []), grant]);
    }

    return Array.from(schedules.entries())
      .map(([key, items]) => {
        const sorted = items.slice().sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
        const first = sorted[0];
        const notes = sorted
          .map((grant) => String(grant.note || '').trim())
          .filter((note, index, arr) => !!note && arr.indexOf(note) === index);
        return {
          key,
          grants: sorted,
          first,
          editGroup: this.makeScheduleEditGroup(sorted, key),
          typeLabel: this.grantTypeLabelFor(first),
          dayLabel: this.grantDayLabel(first),
          familyLabel: this.grantFamilyLabel(first.familyBase),
          dateRangeText: this.grantScheduleDateRangeText(sorted),
          timeRangeText: this.grantScheduleTimeRangeText(first),
          notesText: notes.join(' + '),
          enabled: sorted.some((grant) => grant.enabled !== false)
        };
      })
      .sort((a, b) => new Date(a.first.startsAt).getTime() - new Date(b.first.startsAt).getTime());
  }

  private grantScheduleGroupingKey(grant: AttendanceAccessGrant): string {
    const start = new Date(grant.startsAt);
    const end = new Date(grant.endsAt);
    const startTime = Number.isNaN(start.getTime()) ? '' : `${start.getHours()}:${start.getMinutes()}`;
    const endTime = Number.isNaN(end.getTime()) ? '' : `${end.getHours()}:${end.getMinutes()}`;
    return [
      this.grantFamilyList(grant.familyBase).slice().sort().join(','),
      (grant.allowedTypes || []).slice().sort().join(','),
      this.grantDayFromGrant(grant) ?? '',
      startTime,
      endTime,
      grant.enabled === false ? 'off' : 'on'
    ].join('|');
  }

  private makeSingleGrantEditGroup(grant: AttendanceAccessGrant): GrantGroup {
    return {
      key: this.grantGroupingKey(grant),
      grants: [grant],
      first: grant,
      targetNames: grant.targetUserName || this.grantTargetNameFor(grant.targetUserId),
      notes: String(grant.note || '').trim() ? [String(grant.note || '').trim()] : []
    };
  }

  private makeScheduleEditGroup(grants: AttendanceAccessGrant[], key: string): GrantGroup {
    const sorted = grants.slice().sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    const first = sorted[0];
    const notes = sorted
      .map((grant) => String(grant.note || '').trim())
      .filter((note, index, arr) => !!note && arr.indexOf(note) === index);
    const targetNames = sorted
      .map((grant) => grant.targetUserName || this.grantTargetNameFor(grant.targetUserId))
      .filter((name, index, arr) => !!name && arr.indexOf(name) === index)
      .join(' + ');
    return {
      key,
      grants: sorted,
      first,
      targetNames,
      notes
    };
  }

  private grantScheduleDateRangeText(grants: AttendanceAccessGrant[]): string {
    const starts = grants
      .map((grant) => new Date(grant.startsAt))
      .filter((date) => !Number.isNaN(date.getTime()))
      .sort((a, b) => a.getTime() - b.getTime());
    const ends = grants
      .map((grant) => new Date(grant.endsAt))
      .filter((date) => !Number.isNaN(date.getTime()))
      .sort((a, b) => a.getTime() - b.getTime());
    const first = starts[0];
    const last = ends[ends.length - 1] || starts[starts.length - 1];
    if (!first || !last) return '';
    const from = this.formatDateOnly(first);
    const to = this.formatDateOnly(last);
    return from === to ? from : `من ${from} إلى ${to}`;
  }

  private grantScheduleTimeRangeText(grant: AttendanceAccessGrant): string {
    const start = this.formatTimeOnly(grant.startsAt);
    const end = this.formatTimeOnly(grant.endsAt);
    if (start && end) return `${start} إلى ${end}`;
    return start || end || '';
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
    const selectedTargetIds = new Set((this.selectedGrantTargetIds || []).map((id) => Number(id || 0)).filter(Boolean));
    const wantedAudience = this.grantAudience;
    const editingKey = this.editingGrantGroup()?.key || '';
    const scopeFamilies = this.currentGrantDialogScopeFamilies();

    return this.groupAccessGrants(
      this.visibleGrantsForCurrentManager(this.knownAccessGrants()).filter((grant) => {
        const grantId = Number(grant.id || 0);
        if (grantId && editingIds.has(grantId)) return false;
        if (selectedTargetIds.size && !selectedTargetIds.has(Number(grant.targetUserId || 0))) return false;
        if (scopeFamilies.length && !this.grantFamiliesOverlap(this.grantFamilyList(grant.familyBase), scopeFamilies)) return false;
        if (!this.grantMatchesCurrentConfiguredDays(grant)) return false;
        return this.grantTargetAudience(grant) === wantedAudience;
      })
    ).filter((group) => !editingKey || group.key !== editingKey);
  }

  dialogExistingPersonGrantGroups(): PersonGrantGroup[] {
    if (!this.grantDialogVisible) return [];
    const editingIds = new Set(this.editingGrantGroupIds.map((id) => Number(id || 0)).filter(Boolean));
    const selectedTargetIds = new Set((this.selectedGrantTargetIds || []).map((id) => Number(id || 0)).filter(Boolean));
    const wantedAudience = this.grantAudience;
    const scopeFamilies = this.currentGrantDialogScopeFamilies();

    return this.groupGrantsByPerson(
      this.visibleGrantsForCurrentManager(this.knownAccessGrants()).filter((grant) => {
        const grantId = Number(grant.id || 0);
        if (grantId && editingIds.has(grantId)) return false;
        if (selectedTargetIds.size && !selectedTargetIds.has(Number(grant.targetUserId || 0))) return false;
        if (scopeFamilies.length && !this.grantFamiliesOverlap(this.grantFamilyList(grant.familyBase), scopeFamilies)) return false;
        if (!this.grantMatchesCurrentConfiguredDays(grant)) return false;
        return this.grantTargetAudience(grant) === wantedAudience;
      })
    );
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

  private sameGrantFamily(a?: string | null, b?: string | null): boolean {
    const left = canonicalFamilyName(a || '').trim();
    const right = canonicalFamilyName(b || '').trim();
    return !!left && !!right && left === right;
  }

  private grantFamiliesOverlap(grantFamilies: string[], selectedFamilies: string[]): boolean {
    if (!grantFamilies.length || !selectedFamilies.length) return true;
    return selectedFamilies.some((selected) => grantFamilies.some((grantFamily) => this.sameGrantFamily(grantFamily, selected)));
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

  private currentGrantDialogScopeFamilies(): string[] {
    const fromForm = this.grantFamilyList(this.grantForm.familyBase);
    if (fromForm.length) return fromForm;
    if (this.grantFamilySelections.length) return this.grantFamilySelections.filter(Boolean);
    return [this.selectedFamily || this.defaultGrantScopeFamily()].filter(Boolean);
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
        this.cleanupAccessGrantsForTypeDays([this.selectedConfigFamily], payload);
        this.message.add({ severity: 'success', summary: 'تم', detail: 'تم حفظ مواعيد الأنواع بنجاح' });
        this.configSaving = false;
      },
      error: (err) => {
        this.configSaving = false;
        this.message.add({ severity: 'error', summary: 'خطأ', detail: err?.error?.error || err?.error?.message || 'فشل حفظ مواعيد الأنواع' });
      }
    });
  }

  openRuleGroupsDialog(): void {
    this.editableRuleGroups = this.configEditor.attendanceRuleGroups
      ? this.configEditor.attendanceRuleGroups.map(g => ({ ...g, types: [...g.types] }))
      : [];
    this.ruleGroupsDialogVisible = true;
  }

  addRuleGroup(): void {
    this.editableRuleGroups.push({ name: '', types: [], allRequired: false, bonusAllowed: false });
  }

  removeRuleGroup(index: number): void {
    this.editableRuleGroups.splice(index, 1);
  }

  availableTypesForRuleGroup(): { value: AttendanceType; label: string }[] {
    return this.configurableTypeOptions;
  }

  toggleRuleGroupType(group: AttendanceRuleGroup, type: AttendanceType): void {
    const idx = group.types.indexOf(type);
    if (idx >= 0) {
      group.types.splice(idx, 1);
    } else {
      group.types.push(type);
    }
  }

  saveRuleGroups(): void {
    this.configSaving = true;
    const updated = { ...this.configEditor, attendanceRuleGroups: this.editableRuleGroups.map(g => ({ ...g, types: [...g.types] })) };
    this.attendance.saveFullAttendanceConfig(updated).subscribe({
      next: (cfg) => {
        const merged = this.mergeConfig(cfg);
        this.configEditor = merged;
        if (this.attendanceContext) {
          this.attendanceContext = { ...this.attendanceContext, config: merged };
        }
        this.configSaving = false;
        this.ruleGroupsDialogVisible = false;
        this.message.add({ severity: 'success', summary: 'تم', detail: 'تم حفظ قواعد الحضور بنجاح' });
      },
      error: (err) => {
        this.configSaving = false;
        this.message.add({ severity: 'error', summary: 'خطأ', detail: err?.error?.error || err?.error?.message || 'فشل حفظ قواعد الحضور' });
      }
    });
  }

  cancelRuleGroups(): void {
    this.ruleGroupsDialogVisible = false;
    this.editableRuleGroups = [];
  }

  private updateBlockedMessage(): void {
    this.blockedMessage = this.pageBlockedMessage || this.runtimeBlockedMessage || '';
    if (this.blockedMessage) this.scannerOverlayVisible = false;
  }

  private shouldEnforceGrantWindow(): boolean {
    if (this.canOverrideAbsenceOpenClose()) return false;
    return this.isSelfCheckinMode() || this.relevantScopeGrants().length > 0;
  }

  private shouldRestrictFamilyScopeByGrant(): boolean {
    if (this.canOverrideAbsenceOpenClose()) return false;
    return this.isSelfCheckinMode() || this.relevantScopeGrants().length > 0;
  }

  private relevantScopeGrants(): AttendanceAccessGrant[] {
    const grants = this.attendanceContext?.activeGrants || [];
    const wantedKind = this.grantKindForCurrentUser();

    // Backward compatibility for old MAKHDOM assignments:
    // Some standard attendance grants were saved as SELF_CHECKIN.
    // When the same MAKHDOM also has a TAKE_ATTENDANCE grant, keep the old
    // SELF_CHECKIN standard grants visible/usable as attendance-taking grants.
    // Without this, adding a custom-event grant makes قداس/تسبحة/اجتماع الأسرة look locked.
    const includeLegacySelfCheckinAsTakeAttendance = wantedKind === 'TAKE_ATTENDANCE'
      && !this.isServantOrAbove()
      && grants.some((grant) => grant.grantKind === 'TAKE_ATTENDANCE' && grant.enabled !== false);

    return grants.filter((grant) => {
      if (grant.enabled === false) return false;
      if (grant.grantKind === wantedKind) return true;
      return includeLegacySelfCheckinAsTakeAttendance && grant.grantKind === 'SELF_CHECKIN';
    });
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
    return Array.from(new Set(
      grants
        .flatMap((grant) => this.grantFamilyList(grant.familyBase))
        .map((family) => canonicalFamilyName(family))
        .filter(Boolean)
    ));
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
    const allValues = this.families;
    if (this.selectedFamilies.length === 0) {
      return '';
    }
    if (this.selectedFamilies.length === allValues.length) {
      return 'كل الأسر';
    }
    return this.selectedFamilies
      .map((f) => this.isGroupedMemberFamilyMode() ? this.shortFamilyDisplayName(f) : f)
      .join('، ');
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
          return this.grantFamiliesOverlap(families, selectedFamilies);
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
        if (!this.grantFamiliesOverlap(grantFamilies, selectedFamilies)) return false;
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
      return this.grantFamiliesOverlap(grantFamilies, selectedFamilies);
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

  currentSelectedGrantNote(): string {
    const selectedType = this.selectedAttendanceType();
    const selectedDate = this.selectedDate ? new Date(this.selectedDate) : null;
    const selectedFamilies = this.shouldRestrictFamilyScopeByGrant() && this.selectedFamily
      ? this.scopeFamiliesForSelection(this.selectedFamily)
      : [];

    const notes = this.activeScopeGrants()
      .filter((grant) => {
        const grantTypes = grant.allowedTypes || [];
        if (grantTypes.length && !grantTypes.includes(selectedType)) return false;

        if (selectedFamilies.length && grant.familyBase) {
          const grantFamilies = this.grantFamilyList(grant.familyBase);
          if (!this.grantFamiliesOverlap(grantFamilies, selectedFamilies)) return false;
        }

        return !selectedDate || this.selectedDateMatchesGrantOccasion(grant, selectedDate);
      })
      .map((grant) => String(grant.note || '').trim())
      .filter((note, index, arr) => !!note && arr.indexOf(note) === index);

    return notes.join(' + ');
  }

  private selectedDateMatchesGrantOccasion(grant: AttendanceAccessGrant, selectedDate: Date): boolean {
    const day = Number(grant.dayOfWeek);
    if (this.weekDays.includes(day) && day !== selectedDate.getDay()) return false;

    const selected = new Date(selectedDate);
    selected.setHours(0, 0, 0, 0);

    const start = new Date(grant.startsAt);
    if (!Number.isNaN(start.getTime())) {
      start.setHours(0, 0, 0, 0);
      if (selected < start) return false;
    }

    const end = new Date(grant.endsAt);
    if (!Number.isNaN(end.getTime())) {
      end.setHours(0, 0, 0, 0);
      if (selected > end) return false;
    }

    return true;
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
    const scheduleDays = this.attendanceContext?.scheduleDays?.[family]?.[type];
    if (scheduleDays && scheduleDays.length > 0) return true;
    if (!family) {
      return (this.configDaysForType(type) || []).length > 0;
    }
    return false;
  }

  private customEventsForCurrentFamily(): AttendanceCustomEvent[] {
    const family = this.selectedFamily;
    return this.familyCustomEvents.filter((event) => {
      if (event.enabled === false) return false;
      if (!this.isCustomEventStillCurrent(event)) return false;
      if (!family) return true;
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

    if (this.canSelectCustomEventForAttendance() && this.selectableCustomEvents().length) {
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

    let family = this.selectedFamily;
    if (this.selectedType === 'MARMARKOS_KHORS') family = 'خورس مارمرقس';
    if (this.selectedType === 'ATHANASIUS_KHORS') family = 'خورس البابا أثناسيوس';

    const scheduleDays = this.attendanceContext?.scheduleDays?.[family]?.[selectedType];
    if (scheduleDays && scheduleDays.length > 0) return scheduleDays;

    if (!this.attendanceContext?.scheduleDays || Object.keys(this.attendanceContext.scheduleDays).length === 0) {
      return this.configDaysForType(selectedType, family);
    }
    return [];
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

  private customEventSelectableDateBounds(): { min?: Date; max?: Date } {
    if (!this.isSelectedCustomEventType()) return {};
    const selected = this.selectedCustomEvent();
    if (!selected || selected.alwaysActive !== false) return {};

    const bounds: { min?: Date; max?: Date } = {};
    if (selected.activeFrom) {
      const min = new Date(selected.activeFrom);
      if (!Number.isNaN(min.getTime())) {
        min.setHours(0, 0, 0, 0);
        bounds.min = min;
      }
    }
    if (selected.activeTo) {
      const max = new Date(selected.activeTo);
      if (!Number.isNaN(max.getTime())) {
        max.setHours(0, 0, 0, 0);
        bounds.max = max;
      }
    }
    return bounds;
  }

  private loadCancelledDates(): void {
    const selectedType = this.selectedAttendanceType();
    if (!selectedType || selectedType === 'CUSTOM_EVENT' || this.isSelfCheckinMode()) {
      this.cancelledDisabledDates = [];
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setFullYear(start.getFullYear() - 1);

    const from = this.toIsoDate(start);
    const to = this.toIsoDate(today);

    const family = this.selectedFamily;

    const scheduleCreated = this.attendanceContext?.scheduleCreatedDates?.[family || '']?.[selectedType];
    const scheduleCreatedDatesMap = scheduleCreated || {};

    this.attendance.getCancelledDatesInRange(from, to, selectedType, family).subscribe({
      next: (res) => {
        const disabled = (res.dates || []).map((d) => {
          const dt = new Date(d + 'T00:00:00');
          dt.setHours(0, 0, 0, 0);
          return dt;
        });

        const now = new Date();
        const todayDow = today.getDay();

        const cursor = new Date(start);
        while (cursor <= today) {
          const dow = String(cursor.getDay());
          const createdDateStr = scheduleCreatedDatesMap[dow];
          if (createdDateStr) {
            const createdDate = new Date(createdDateStr + 'T00:00:00');
            createdDate.setHours(0, 0, 0, 0);
            if (cursor < createdDate) {
              disabled.push(new Date(cursor));
            }
          }
          cursor.setDate(cursor.getDate() + 1);
        }

        if (family) {
          const scheduleTimeStr = this.attendanceContext?.scheduleTimes?.[family]?.[selectedType]?.[String(todayDow)];
          if (scheduleTimeStr) {
            const [h, m] = scheduleTimeStr.split(':').map(Number);
            const scheduleDt = new Date(today);
            scheduleDt.setHours(h, m, 0, 0);
            if (now < scheduleDt) {
              disabled.push(new Date(today));
            }
          }
        }

        this.cancelledDisabledDates = disabled;
      },
      error: () => (this.cancelledDisabledDates = [])
    });
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
    // Custom events must be selectable on the event's configured day, even if that
    // day is not one of the normal weekly attendance/absence days.
    const allowedAbsenceDays = this.isSelectedCustomEventType()
      ? this.weekDays
      : (this.canOverrideAbsenceOpenClose() ? this.weekDays : this.configAbsenceAllowedDays());
    const allowedDays = typeDays.filter((day) => allowedAbsenceDays.includes(day));
    this.disabledDays = this.weekDays.filter((day) => !allowedDays.includes(day));

    const bounds = this.customEventSelectableDateBounds();
    let maxDate = this.maxDate || today;
    let minDate = this.minDate || new Date(2000, 0, 1);
    if (bounds.min && bounds.min > minDate) minDate = bounds.min;
    if (bounds.max && bounds.max < maxDate) maxDate = bounds.max;
    this.minDate = minDate;
    this.maxDate = maxDate;

    this.loadCancelledDates();

    if (keepCurrentDate && current && current >= minDate && current <= maxDate && this.dateMatchesSelectedType(current)) {
      this.refreshAvailableCustomEvents();
      return;
    }

    this.selectedDate = null;
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

    if (!this.canOverrideAbsenceOpenClose() && !this.shouldEnforceGrantWindow() && !this.configAbsenceOpenDays().includes(today.getDay())) {
      this.pageBlockedMessage = 'تسجيل الغياب مقفول اليوم حسب الإعدادات الحالية لهذه الأسرة.';
    }

    this.minDate = today;

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

  private startOfToday(): Date {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  }

  private isBeforeToday(value: Date | null | undefined): boolean {
    if (!value || Number.isNaN(value.getTime())) return false;
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date.getTime() < this.startOfToday().getTime();
  }

  async toggleScan() {
    if (this.isSelfCheckinMode() || !!this.blockedMessage) return;
    await this.prepareScannerCamera();
    this.scannerOverlayVisible = true;
    setTimeout(() => this.startScanner(), 0);
  }

  private async startScanner(): Promise<void> {
    if (!this.scannerComponent) return;

    try {
      await this.scannerComponent.askForPermission();
      if (this.scannerDevice) {
        this.scannerComponent.device = this.scannerDevice;
      }
      setTimeout(() => this.applyNormalCameraConstraints(), 250);
      setTimeout(() => this.applyNormalCameraConstraints(), 750);
    } catch {
      this.message.add({ severity: 'error', summary: 'خطأ', detail: 'تعذر تشغيل الكاميرا' });
    }
  }

  private applyNormalCameraConstraints(): void {
    try {
      if (!this.scannerComponent) return;
      this.scannerComponent.videoConstraints = this.scannerVideoConstraints;
    } catch {}
  }

  onScannerResult(resultString: string): void {
    this.scannerOverlayVisible = false;
    this.onCodeResult(resultString);
  }

  closeScanner(): void {
    this.scannerOverlayVisible = false;
  }

  private syncSelectedFamilyFromMultiselect(): void {
    const allValues = this.families;
    if (this.selectedFamilies.length === 0 || this.selectedFamilies.length === allValues.length) {
      this.selectedFamily = '';
    } else {
      this.selectedFamily = this.selectedFamilies[0];
    }
  }

  onFamilyChanged() {
    this.syncSelectedFamilyFromMultiselect();
    this.syncSelectedFamilyWithGrantScope();
    this.members = [];
    this.membersLoadError = '';
    this.globalResults = [];
    this.familyCustomEvents = [];
    this.availableCustomEvents = [];
    this.customTitle = '';
    this.refreshTypeOptions();
    this.loadMembersForFamily();
    this.loadCustomEventsForFamily();
    this.loadScheduleItemsForFamily();
    this.initCalendarRules();
    this.refreshRuntimeState();
    if (!this.selectedDate && this.attendanceDatePicker) {
      this.attendanceDatePicker.overlayVisible = true;
    }
  }

  onSearchChange(v: string) {
    this.searchText = v;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.runSearch(), 250);
  }

  private shouldSearchAllFamilies(): boolean {
    return this.selectedFamilies.length === this.families.length;
  }

  private runSearch() {
    const q = (this.searchText || '').trim();
    if (!q) {
      this.globalResults = [];
      this.searching = false;
      this.loadMembersForFamily();
      return;
    }

    const searchFamilies = this.shouldSearchAllFamilies()
      ? this.families
      : this.selectedFamilies;

    this.searching = true;
    this.membersLoading = true;
    const requests = searchFamilies.map((family) =>
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
        this.members = unique.map(this.toPickUser);
        this.membersLoading = false;
        this.searching = false;
      },
      error: () => {
        this.membersLoading = false;
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
      this.selectedFamilies = this.selectedFamily ? [this.selectedFamily] : [];
      this.selected = [];
      if (this.selectedFamily) this.loadMembersForFamily();
      this.initCalendarRules();
      this.refreshRuntimeState();
      return;
    }

    this.familySvc.families('attendance').subscribe({
      next: (f) => {
        const allFamilies = sortFamiliesByPreferredOrder(Array.from(new Set([...(f || []), ...this.choirFamilies()])), this.preferredFamilyOrder);
        this.families = this.filterFamiliesByGrantScope(allFamilies);
        this.ensureSelectedConfigFamily();
        this.syncSelectedFamilyWithGrantScope();
        if (!this.selectedFamily && this.families.length) {
          this.selectedFamily = this.families[0];
        }
        this.selectedFamilies = [];
        this.loadMembersForFamily();
        this.loadCustomEventsForFamily();
        this.initCalendarRules();
        this.refreshRuntimeState();
      },
      error: () => (this.families = [])
    });
  }

  private loadMembersForFamily() {
    this.membersLoading = true;
    this.membersLoadError = '';

    const allFamilyValues = this.families;
    let requestedFamilies: string[];

    if (this.selectedFamilies.length === 0) {
      requestedFamilies = [];
    } else if (this.selectedFamilies.length === allFamilyValues.length) {
      requestedFamilies = this.families;
    } else {
      requestedFamilies = Array.from(new Set(
        this.selectedFamilies.flatMap((f) => this.scopeFamiliesForSelection(f)).filter(Boolean)
      ));
    }

    if (!requestedFamilies.length) {
      this.members = this.includeSelfInList([]);
      this.membersLoading = false;
      return;
    }

    const requests = requestedFamilies.map((family) =>
      this.familySvc.members(family, true, 'attendance').pipe(
        catchError((err) => {
          console.error('Failed to load attendance family members', family, err);
          return of([] as any[]);
        })
      )
    );

    forkJoin(requests).subscribe({
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
    if (!q) return this.members;
    return this.members.filter((m) => {
      const text = [m.fullName, m.username, m.familyName, m.deaconFamily]
        .map((value) => String(value || '').toLowerCase())
        .join(' ');
      return text.includes(q);
    });
  }

  isSelected(id: number): boolean {
    return this.selected.some((x) => x.id === id);
  }

  canPickDisplayedUser(u: PickUser): boolean {
    if (this.isDelegatedAttendanceMode() || this.hasVisibleCustomEventAttendanceGrant()) return true;
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
    if (this.isSelfCheckinMode()) return;
    const token = (resultString || '').trim();
    if (!token) return;

    const now = Date.now();
    if (token === this.lastScannedToken && now - this.lastScannedAt < 1500) return;
    this.lastScannedToken = token;
    this.lastScannedAt = now;

    const iso = this.selectedDate ? this.toIsoDate(this.selectedDate) : undefined;
    const requestedFamily = this.selectedFamily || undefined;
    const selectedType = this.selectedAttendanceType();
    const customEventFamily = selectedType === 'CUSTOM_EVENT'
      ? String(this.selectedCustomEvent()?.familyBase || '').trim() || undefined
      : undefined;
    const family = ((this.shouldEnforceGrantWindow() || this.isScopedAminOsraAttendanceManager()) && requestedFamily)
      ? requestedFamily
      : (['FAMILY_MEETING', 'CUSTOM_EVENT', 'MARMARKOS_KHORS', 'ATHANASIUS_KHORS'].includes(selectedType)
        ? (requestedFamily || customEventFamily)
        : undefined);

    const customTitle = selectedType === 'CUSTOM_EVENT' ? this.customTitle.trim() || undefined : undefined;

    this.attendance.scanToken(token, iso, selectedType, family, customTitle).subscribe({
      next: (u) => {
        const pu = this.toPickUser(u);
        if (!pu?.id) return;

        const effectiveFamily = String((u as any)?.effectiveFamilyBase || this.familyLabel(u) || '').trim();
        if (effectiveFamily && effectiveFamily !== this.selectedFamily) {
          this.selectedFamily = effectiveFamily;
          this.loadMembersForFamily();
          this.initCalendarRules();
          this.refreshRuntimeState();
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

    const selectedCustomEventFamily = selectedType === 'CUSTOM_EVENT'
      ? String(this.selectedCustomEvent()?.familyBase || '').trim()
      : '';
    const submitFamily = this.selectedFamily || selectedCustomEventFamily || undefined;

    if (['FAMILY_MEETING', 'MARMARKOS_KHORS', 'ATHANASIUS_KHORS'].includes(selectedType) && !this.selectedFamily) {
      this.message.add({ severity: 'warn', summary: 'No family', detail: 'اختار الأسرة قبل التسجيل' });
      return;
    }

    if (selectedType === 'CUSTOM_EVENT' && !this.customTitle.trim()) {
      this.message.add({ severity: 'warn', summary: 'العنوان مطلوب', detail: 'اختار المناسبة المخصصة أولاً' });
      return;
    }

    this.attendance.submit(users, selectedType, iso, submitFamily, this.customTitle.trim() || undefined).subscribe({
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
      grantKind: 'TAKE_ATTENDANCE',
      allowedTypes: ['FRIDAY_LITURGY'],
      dayOfWeek: new Date().getDay(),
      startsAt: this.nowPlusHours(0),
      endsAt: this.nowPlusHours(2),
      enabled: true,
      familyBase: this.canChooseGrantFamily() ? '' : this.defaultGrantScopeFamily()
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

  private isMemberGrantTarget(user?: PickUser | null): boolean {
    const role = normalizeRole(user?.role, user?.roleCode);
    const assignmentRoles = this.assignmentsOf(user).map((x) => x.role);
    const effectiveRoles = new Set([role, ...assignmentRoles].filter(Boolean));

    if (user?.id && Number(user.id) === Number(this.me?.id || 0)) {
      return false;
    }

    return effectiveRoles.has('MAKHDOM');
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
    const selectedTypes = new Set(this.grantForm.allowedTypes || []);
    // A custom event is always a delegation to take attendance for a family,
    // never personal self check-in. This prevents the backend error and keeps
    // the Add buttons enabled for all people in the assigned osra.
    if (selectedTypes.has('CUSTOM_EVENT')) return 'TAKE_ATTENDANCE';
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
      const familyScope = this.grantForm.familyBase
        || this.selectedFamily
        || this.defaultGrantScopeFamily()
        || this.grantFamilyFilterOptions()[0]
        || '';
      this.grantFamilySelections = familyScope ? [familyScope] : [];
      this.grantForm.familyBase = familyScope;
      this.loadGrantTargets(this.grantForm.familyBase || this.defaultGrantScopeFamily());
    }
    this.loadGrantCustomEvents();
    this.lastGrantAudience = this.grantAudience;
  }

  selectGrantAudience(audience: GrantAudience): void {
    if (this.grantAudience === audience) return;
    this.grantAudience = audience;
    this.onGrantAudienceChange();
  }

  onGrantFamilyBaseChange(): void {
    this.grantForm.targetUserId = undefined;
    this.selectedGrantTargetIds = [];
    this.clearGrantTargetDropdownSelection();
    this.grantTargetSearch = '';
    this.grantFamilySelections = this.grantForm.familyBase ? [this.grantForm.familyBase] : [];
    if (this.grantAudience === 'SERVANTS') this.syncGrantFamilyFormFromSelections();
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
    const scheduleDays = this.attendanceContext?.scheduleDays?.[family]?.[type];
    if (scheduleDays && scheduleDays.length > 0) return scheduleDays;
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
    const currentEndOffset = this.grantWindowEndOffset(target);
    target.endsAt = !this.grantPermanentEnabled && nextValue
      ? this.dateForRelativeOffset(target.startsAt || this.nextMatchingWeekday(day, new Date()), currentEndOffset, nextValue)
      : nextValue;
    if (this.grantSelectedWeekday === day) {
      this.grantEndsAtDate = target.endsAt;
      this.grantForm.endsAt = target.endsAt ? this.toDateTimeLocalValue(target.endsAt) : '';
    }
  }

  grantWindowEndDay(window: GrantDayWindow): number {
    const end = window.endsAt && !Number.isNaN(window.endsAt.getTime()) ? window.endsAt : null;
    return end ? end.getDay() : window.day;
  }

  grantWindowEndOffset(window: GrantDayWindow): number {
    const start = window.startsAt && !Number.isNaN(window.startsAt.getTime()) ? window.startsAt : null;
    const end = window.endsAt && !Number.isNaN(window.endsAt.getTime()) ? window.endsAt : null;
    if (!start || !end) return 0;
    const startDay = new Date(start);
    startDay.setHours(0, 0, 0, 0);
    const endDay = new Date(end);
    endDay.setHours(0, 0, 0, 0);
    const diff = Math.round((endDay.getTime() - startDay.getTime()) / 86400000);
    return Math.min(7, Math.max(0, diff));
  }

  grantWindowEndDayOptions(startDay: number): Array<{ offset: number; label: string }> {
    return Array.from({ length: 8 }, (_, offset) => ({
      offset,
      label: offset === 0 ? `${this.dayLabel(startDay)} (نفس اليوم)` : this.dayLabel((startDay + offset) % 7)
    }));
  }

  onGrantWindowEndDayChange(startDay: number, endDay: number): void {
    const target = this.grantDayWindows.find((item) => item.day === startDay);
    if (!target) return;
    const start = target.startsAt || this.nextMatchingWeekday(startDay, new Date());
    target.endsAt = this.dateForRelativeWeekday(start, Number(endDay), target.endsAt || start);
    if (this.grantSelectedWeekday === startDay) {
      this.grantEndsAtDate = target.endsAt;
      this.grantForm.endsAt = target.endsAt ? this.toDateTimeLocalValue(target.endsAt) : '';
    }
  }

  onGrantWindowEndOffsetChange(startDay: number, offset: number): void {
    const target = this.grantDayWindows.find((item) => item.day === startDay);
    if (!target) return;
    const start = target.startsAt || this.nextMatchingWeekday(startDay, new Date());
    const timeSource = target.endsAt || start;
    const end = new Date(start);
    end.setDate(end.getDate() + Math.min(7, Math.max(0, Number(offset) || 0)));
    end.setHours(timeSource.getHours(), timeSource.getMinutes(), 0, 0);
    target.endsAt = end;
    if (this.grantSelectedWeekday === startDay) {
      this.grantEndsAtDate = target.endsAt;
      this.grantForm.endsAt = this.toDateTimeLocalValue(target.endsAt);
    }
  }

  setGrantWindowStartNow(day: number): void {
    const target = this.grantDayWindows.find((item) => item.day === day);
    if (!target) return;
    const now = new Date();
    const base = target.startsAt || this.nextMatchingWeekday(day, now);
    const next = new Date(base);
    next.setHours(now.getHours(), now.getMinutes(), 0, 0);
    this.onGrantWindowStartChange(day, !this.grantPermanentEnabled ? next : now);
  }

  setGrantWindowEndNow(day: number): void {
    const target = this.grantDayWindows.find((item) => item.day === day);
    if (!target) return;
    const now = new Date();
    const base = target.endsAt || target.startsAt || this.nextMatchingWeekday(day, now);
    const next = new Date(base);
    next.setHours(now.getHours(), now.getMinutes(), 0, 0);
    this.onGrantWindowEndChange(day, !this.grantPermanentEnabled ? next : now);
  }

  private dateForRelativeWeekday(start: Date, targetDay: number, timeSource: Date): Date {
    const out = new Date(start);
    const diff = (targetDay - start.getDay() + 7) % 7;
    out.setDate(out.getDate() + diff);
    out.setHours(timeSource.getHours(), timeSource.getMinutes(), 0, 0);
    return out;
  }

  private dateForRelativeOffset(start: Date, offset: number, timeSource: Date): Date {
    const out = new Date(start);
    out.setDate(out.getDate() + Math.min(7, Math.max(0, Number(offset) || 0)));
    out.setHours(timeSource.getHours(), timeSource.getMinutes(), 0, 0);
    return out;
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
    this.grantForm.grantKind = this.grantKindFromAudience(option.type === 'CUSTOM_EVENT' ? 'SERVANTS' : this.grantAudience);
    if (option.type === 'CUSTOM_EVENT' && this.grantAudience !== 'SERVANTS') {
      this.grantAudience = 'SERVANTS';
      this.lastGrantAudience = 'SERVANTS';
      this.grantForm.grantKind = 'TAKE_ATTENDANCE';
      this.selectedGrantTargetIds = [];
      this.grantTargetSearch = '';
      this.loadGrantTargets(this.grantForm.familyBase || this.defaultGrantScopeFamily());
    }
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

    const family = this.grantPrimaryScopeFamily();
    const selectedType = (this.grantForm.allowedTypes || [])[0] || 'FRIDAY_LITURGY';
    const scheduleTimeStr = this.attendanceContext?.scheduleTimes?.[family]?.[selectedType]?.[String(selectedDay)];

    if (!this.grantStartsAtDate && scheduleTimeStr) {
      const [h, m] = scheduleTimeStr.split(':').map(Number);
      const sz = this.nextMatchingWeekday(selectedDay, new Date());
      sz.setHours(h, m, 0, 0);
      this.onGrantStartDateChange(sz);
    } else if (!this.grantStartsAtDate) {
      const anchor = this.nextMatchingWeekday(selectedDay, new Date());
      this.onGrantStartDateChange(this.withDatePart(null, anchor));
    }

    if (!this.grantEndsAtDate) {
      const endBase = new Date(this.grantStartsAtDate || this.nextMatchingWeekday(selectedDay, new Date()));
      endBase.setHours(endBase.getHours() + 2);
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
    if (this.grantDialogMode === 'edit') this.applyGrantEditDatesToWindows();
    this.refreshGrantDialogViewModels();
  }

  private applyGrantEditDatesToWindows(): void {
    if (this.grantDialogMode !== 'edit') return;
    const startsAt = this.grantForm.startsAt ? new Date(this.grantForm.startsAt) : null;
    const endsAt = this.grantForm.endsAt ? new Date(this.grantForm.endsAt) : null;
    if (!startsAt || !endsAt || Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return;

    const day = this.weekDays.includes(Number(this.grantForm.dayOfWeek))
      ? Number(this.grantForm.dayOfWeek)
      : startsAt.getDay();

    this.grantSelectedWeekday = day;
    this.grantForm.dayOfWeek = day;
    this.grantStartsAtDate = startsAt;
    this.grantEndsAtDate = endsAt;

    const otherWindows = (this.grantDayWindows || []).filter((window) => window.day !== day);
    const editWindow = this.buildGrantWindow(day, startsAt, endsAt);
    this.grantDayWindows = [editWindow, ...otherWindows];
    this.refreshSelectedGrantWindow();
  }

  private cachedAllCustomEvents: AttendanceCustomEvent[] | null = null;

  private updateGrantsAfterSave(addedOrUpdated: AttendanceAccessGrant[], deletedIds: number[] = []): void {
    if (deletedIds.length) {
      const delSet = new Set(deletedIds);
      this.grants = this.grants.filter((g) => !delSet.has(Number(g.id)));
    }
    if (addedOrUpdated.length) {
      const ids = new Set(addedOrUpdated.map((g) => Number(g.id)).filter(Boolean));
      this.grants = [...this.grants.filter((g) => !ids.has(Number(g.id))), ...addedOrUpdated];
    }
  }

  private loadGrantCustomEvents(): void {
    if (!this.canUseCustomEvent()) {
      this.grantCustomEvents = [];
      this.syncGrantOccasionFromForm();
      return;
    }
    if (this.cachedAllCustomEvents) {
      this.grantCustomEvents = this.filterAthanasiusVisibilityForEvents(this.cachedAllCustomEvents);
      this.syncGrantOccasionFromForm();
      return;
    }
    this.attendance.listCustomEvents().subscribe({
      next: (events) => {
        this.cachedAllCustomEvents = events || [];
        this.grantCustomEvents = this.filterAthanasiusVisibilityForEvents(this.cachedAllCustomEvents);
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

  private grantTargetScopeFamily(scopeFamily = ''): string {
    const families = this.grantFamilyList(scopeFamily);
    return families[0]
      || this.grantFamilySelections[0]
      || this.selectedFamily
      || this.defaultGrantScopeFamily()
      || this.grantFamilyFilterOptions()[0]
      || '';
  }

  private loadGrantTargets(scopeFamily = this.grantForm.familyBase || this.defaultGrantScopeFamily()): void {
    if (!this.canManageAccessGrants()) {
      this.grantTargets = [];
      this.syncSelectedGrantTargets();
      this.refreshGrantTargetLists();
      return;
    }
    const targetScopeFamily = this.grantTargetScopeFamily(scopeFamily);
    if (!targetScopeFamily) {
      this.grantTargets = [];
      this.syncSelectedGrantTargets();
      this.refreshGrantTargetLists();
      return;
    }

    if (this.isAminKhedmaOrDeveloper() && canonicalFamilyName(targetScopeFamily) === canonicalFamilyName(this.selectedFamily)) {
      this.grantTargets = this.members.filter((user) =>
        this.belongsToFamilyScope(user, targetScopeFamily)
        && (this.grantAudience === 'SERVANTS'
          ? this.isServantGrantTarget(user)
          : this.isMemberGrantTarget(user))
      );
      this.syncSelectedGrantTargets();
      this.refreshGrantTargetLists();
      return;
    }

    if (this.grantAudience === 'SERVANTS') {
      this.familySvc.members(targetScopeFamily, true, 'attendance').subscribe({
        next: (members) => {
          this.grantTargets = (members || [])
            .map((x: any) => this.toPickUser(x))
            .filter((user) =>
              this.isServantGrantTarget(user) && this.belongsToFamilyScope(user, targetScopeFamily)
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
    this.familySvc.members(targetScopeFamily, true, 'attendance').subscribe({
      next: (m) => {
        const allTargets = (m || []).map((x: any) => this.toPickUser(x));
        this.grantTargets = allTargets.filter((user) =>
          this.belongsToFamilyScope(user, targetScopeFamily)
          && (this.grantAudience === 'SERVANTS'
            ? this.isServantGrantTarget(user)
            : this.isMemberGrantTarget(user))
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

  get grantTargetDropdownOptions(): any[] {
    return this.filteredGrantTargetList.map((u) => ({
      label: `${u.fullName}`,
      value: u.id
    }));
  }

  onGrantTargetDropdownChange(value: number | null): void {
    this.grantTargetDropdownSelection = value;
    if (value) {
      this.addGrantTarget(value);
      this.clearGrantTargetDropdownSelection();
    }
  }

  clearGrantTargetDropdownSelection(): void {
    this.grantTargetDropdownSelection = null;
    this.grantTargetSelect?.clear();
    this.grantTargetSelectVisible = false;
    setTimeout(() => {
      this.grantTargetDropdownSelection = null;
      this.grantTargetSelect?.clear();
      this.grantTargetSelectVisible = true;
    });
  }

  private grantTargetSelectionIds(): number[] {
    const ids = [
      ...this.grantTargets.map((user) => Number(user.id || 0)),
      ...this.selectedGrantTargetList.map((user) => Number(user.id || 0))
    ].filter(Boolean);
    return Array.from(new Set(ids));
  }

  grantTargetSelectionTotal(): number {
    return this.grantTargetSelectionIds().length;
  }

  areAllGrantTargetsSelected(): boolean {
    const total = this.grantTargetSelectionTotal();
    return total > 0 && this.selectedGrantTargetList.length === total;
  }

  selectAllGrantTargets(): void {
    const ids = this.grantTargetSelectionIds();
    this.selectedGrantTargetIds = Array.from(new Set(ids));
    this.grantForm.targetUserId = this.selectedGrantTargetIds[0];
    this.clearGrantTargetDropdownSelection();
    this.grantTargetSearch = '';
    this.refreshGrantTargetLists();
  }

  clearGrantTargets(): void {
    this.selectedGrantTargetIds = [];
    this.grantForm.targetUserId = undefined;
    this.clearGrantTargetDropdownSelection();
    this.grantTargetSearch = '';
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
    this.clearGrantTargetDropdownSelection();
    this.refreshGrantTargetLists();
  }

  private resetPermanentGrantOptions(permanentByDefault = false): void {
    this.grantPermanentEnabled = permanentByDefault;
    this.grantPermanentFromDate = null;
    this.grantPermanentToDate = null;
  }

  private isEditingRecurringGrant(): boolean {
    return this.grantDialogMode === 'edit' && this.editingGrantGroupIds.length > 1;
  }

  private minGrantStartDate(grants: AttendanceAccessGrant[]): Date | null {
    const dates = (grants || [])
      .map((grant) => new Date(grant.startsAt))
      .filter((date) => !Number.isNaN(date.getTime()))
      .sort((a, b) => a.getTime() - b.getTime());
    return dates[0] || null;
  }

  private maxGrantEndDate(grants: AttendanceAccessGrant[]): Date | null {
    const dates = (grants || [])
      .map((grant) => new Date(grant.endsAt))
      .filter((date) => !Number.isNaN(date.getTime()))
      .sort((a, b) => a.getTime() - b.getTime());
    return dates[dates.length - 1] || null;
  }

  selectGrantPermanentMode(mode: boolean): void {
    this.grantPermanentEnabled = mode;
    if (mode) {
      this.grantPermanentFromDate = null;
      this.grantPermanentToDate = null;
      this.grantDayWindows = [];
      this.grantSelectedWeekday = null;
      this.grantStartsAtDate = null;
      this.grantEndsAtDate = null;
    } else {
      this.syncGrantDatesForSelection(true);
    }
  }

  private combineDateWithTime(datePart: Date, timeSource: Date | null | undefined): Date {
    const out = new Date(datePart);
    const source = timeSource && !Number.isNaN(timeSource.getTime()) ? timeSource : null;
    if (source) {
      out.setHours(source.getHours(), source.getMinutes(), 0, 0);
    } else {
      out.setHours(0, 0, 0, 0);
    }
    return out;
  }

  private buildPermanentGrantWindows(baseWindow: GrantDayWindow): GrantDayWindow[] {
    if (this.grantPermanentEnabled) return [baseWindow];
    const rangeStart = this.normalizeGrantDateValue(this.grantPermanentFromDate);
    const rangeEnd = this.normalizeGrantDateValue(this.grantPermanentToDate);
    if (!rangeStart || !rangeEnd) return [];
    rangeStart.setHours(0, 0, 0, 0);
    rangeEnd.setHours(23, 59, 59, 999);
    if (rangeEnd.getTime() <= rangeStart.getTime()) return [];

    const templateStart = this.normalizeGrantDateValue(baseWindow.startsAt || null);
    const templateEnd = this.normalizeGrantDateValue(baseWindow.endsAt || null);
    if (!templateStart || !templateEnd) return [];
    const templateStartDay = new Date(templateStart);
    templateStartDay.setHours(0, 0, 0, 0);
    const templateEndDay = new Date(templateEnd);
    templateEndDay.setHours(0, 0, 0, 0);
    const endDayOffset = Math.min(7, Math.max(0, Math.round((templateEndDay.getTime() - templateStartDay.getTime()) / 86400000)));

    const out: GrantDayWindow[] = [];
    let occurrence = this.nextMatchingWeekday(baseWindow.day, rangeStart);

    while (occurrence.getTime() <= rangeEnd.getTime()) {
      const start = this.combineDateWithTime(occurrence, templateStart);
      let end = this.combineDateWithTime(occurrence, templateEnd);
      end.setDate(end.getDate() + endDayOffset);
      if (end.getTime() <= start.getTime()) {
        end.setDate(end.getDate() + 1);
      }
      if (start.getTime() >= rangeStart.getTime() && start.getTime() <= rangeEnd.getTime()) {
        out.push({ day: baseWindow.day, startsAt: start, endsAt: end });
      }
      occurrence = new Date(occurrence);
      occurrence.setDate(occurrence.getDate() + 7);
    }

    return out;
  }

  private permanentGrantSummaryText(windows: GrantDayWindow[], targetCount: number): string {
    if (!windows.length) return 'لم يتم إنشاء أي تخصيص.';
    return `تم حفظ ${windows.length} ميعاد متكرر لـ ${targetCount} شخص`;
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

    if (grant.startsAt) {
      const start = new Date(grant.startsAt);
      if (!Number.isNaN(start.getTime())) return start.getDay();
    }

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

  private cleanupAccessGrantsForTypeDays(
    targetFamilies: string[],
    typeDays: Partial<Record<AttendanceType, number[]>>
  ): void {
    const families = targetFamilies.map((family) => String(family || '').trim()).filter(Boolean);
    if (!families.length) return;

    const configured = new Map<AttendanceType, Set<number>>();
    (Object.entries(typeDays || {}) as Array<[AttendanceType, number[]]>).forEach(([type, days]) => {
      configured.set(type, new Set((days || []).map((day) => Number(day)).filter((day) => this.weekDays.includes(day))));
    });
    if (!configured.size) return;

    const deleteIds = this.knownAccessGrants()
      .filter((grant) => {
        const id = Number(grant.id || 0);
        if (!id) return false;
        if (!this.grantFamiliesOverlap(this.grantFamilyList(grant.familyBase), families)) return false;

        const day = this.grantDayFromGrant(grant);
        if (day === null) return false;

        return (grant.allowedTypes || []).some((type) => {
          const allowedDays = configured.get(type);
          return !!allowedDays && !allowedDays.has(day);
        });
      })
      .map((grant) => Number(grant.id || 0))
      .filter((id, index, arr) => !!id && arr.indexOf(id) === index);

    if (!deleteIds.length) return;

    forkJoin(deleteIds.map((id) => this.attendance.deleteAccessGrant(id).pipe(catchError(() => of(null))))).subscribe({
      next: () => {
        const deleted = new Set(deleteIds);
        this.grants = this.grants.filter((grant) => !deleted.has(Number(grant.id || 0)));
        this.grantSavedSummaries = this.grantSavedSummaries.filter((item) => {
          const grants = item.sourceGrants || (item.sourceGrant ? [item.sourceGrant] : []);
          return !grants.some((grant) => deleted.has(Number(grant.id || 0)));
        });
        if (this.canManageAccessGrants()) this.loadAccessGrants();
        this.message.add({
          severity: 'info',
          summary: 'تم تحديث التخصيصات',
          detail: `تم حذف ${deleteIds.length} تخصيص مرتبط بأيام تم إلغاؤها.`,
          life: 4500
        });
      }
    });
  }

  private grantMatchesCurrentConfiguredDays(grant: AttendanceAccessGrant): boolean {
    const day = this.grantDayFromGrant(grant);
    if (day === null) return true;

    const families = this.grantFamilyList(grant.familyBase);
    const scopeFamilies = families.length ? families : [''];

    return (grant.allowedTypes || []).every((type) => {
      if (type === 'CUSTOM_EVENT') return true;
      return scopeFamilies.every((family) => this.configDaysForType(type, family).includes(day));
    });
  }

  private cleanupStaleAccessGrantsForCurrentConfig(): void {
    const deleteIds = this.knownAccessGrants()
      .filter((grant) => Number(grant.id || 0) && !this.grantMatchesCurrentConfiguredDays(grant))
      .map((grant) => Number(grant.id || 0))
      .filter((id, index, arr) => !!id && arr.indexOf(id) === index);

    if (!deleteIds.length) return;

    forkJoin(deleteIds.map((id) => this.attendance.deleteAccessGrant(id).pipe(catchError(() => of(null))))).subscribe({
      next: () => {
        const deleted = new Set(deleteIds);
        this.grants = this.grants.filter((grant) => !deleted.has(Number(grant.id || 0)));
        this.grantSavedSummaries = this.grantSavedSummaries.filter((item) => {
          const grants = item.sourceGrants || (item.sourceGrant ? [item.sourceGrant] : []);
          return !grants.some((grant) => deleted.has(Number(grant.id || 0)));
        });
        if (this.canManageAccessGrants()) this.loadAccessGrants();
      }
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

  private grantReplacementSlotKey(
    targetUserId: number,
    day: number,
    payload: Partial<AttendanceAccessGrant>
  ): string {
    return [
      Number(targetUserId || 0),
      payload.grantKind || '',
      this.grantFamilyList(payload.familyBase).map((family) => canonicalFamilyName(family)).sort().join(','),
      (payload.allowedTypes || []).slice().sort().join(','),
      day
    ].join('|');
  }

  private existingGrantsForReplacement(
    targetUserId: number,
    day: number,
    payload: Partial<AttendanceAccessGrant>
  ): AttendanceAccessGrant[] {
    const replacementKey = this.grantReplacementSlotKey(targetUserId, day, payload);
    return this.knownAccessGrants().filter((grant) =>
      Number(grant.id || 0)
      && this.grantReplacementSlotKey(Number(grant.targetUserId || 0), this.grantDayFromGrant(grant) ?? -1, grant) === replacementKey
    );
  }

  openCreateGrant(): void {
    if (!this.canManageAccessGrants()) return;
    this.grantDialogMode = 'create';
    this.editingGrantGroupIds = [];
    this.editingGrantTargetFallbacks = [];
    this.grantForm = this.defaultGrantForm();
    this.expandedDialogGrantPersonKeys = [];
    if (this.canChooseGrantFamily() && !this.grantForm.familyBase) {
      const familyOptions = this.grantFamilyFilterOptions();
      this.grantForm.familyBase = (this.selectedFamily && familyOptions.includes(this.selectedFamily))
        ? this.selectedFamily
        : (familyOptions[0] || '');
    }
    this.grantAudience = this.grantAudienceFromKind(this.grantForm.grantKind);
    this.lastGrantAudience = this.grantAudience;
    this.selectedGrantTargetIds = [];
    this.grantTargetSearch = '';
    this.grantSavedSummaries = [];
    this.resetPermanentGrantOptions(false);
    this.refreshGrantTargetLists();
    this.grantFamilySelections = this.grantForm.familyBase ? [this.grantForm.familyBase] : [];
    this.syncGrantFamilyFormFromSelections();
    this.syncGrantDateControls();
    this.loadGrantTargets(this.grantForm.familyBase || this.defaultGrantScopeFamily());
    this.loadGrantCustomEvents();
    this.grantDialogVisible = true;
    this.cleanupStaleAccessGrantsForCurrentConfig();
  }

  cancelGrantEdit(): void {
    if (!this.canManageAccessGrants()) return;
    this.grantDialogMode = 'create';
    this.editingGrantGroupIds = [];
    this.editingGrantTargetFallbacks = [];
    this.grantForm = this.defaultGrantForm();
    this.expandedDialogGrantPersonKeys = [];
    this.grantAudience = this.grantAudienceFromKind(this.grantForm.grantKind);
    this.lastGrantAudience = this.grantAudience;
    this.selectedGrantTargetIds = [];
    this.grantTargetSearch = '';
    this.resetPermanentGrantOptions(false);
    this.refreshGrantTargetLists();
    this.grantFamilySelections = this.grantForm.familyBase ? [this.grantForm.familyBase] : [];
    this.syncGrantFamilyFormFromSelections();
    this.syncGrantDateControls();
    this.loadGrantTargets(this.grantForm.familyBase || this.defaultGrantScopeFamily());
    this.loadGrantCustomEvents();
  }

  openEditGrant(grant: AttendanceAccessGrant): void {
    this.openEditGrantGroup({ key: this.grantGroupingKey(grant), grants: [grant], first: grant, targetNames: grant.targetUserName || 'بدون اسم', notes: String(grant.note || '').trim() ? [String(grant.note || '').trim()] : [] });
  }

  openEditGrantGroup(group: GrantGroup): void {
    if (!this.canManageAccessGrants()) return;
    const grant = group.first;
    this.grantDialogMode = 'edit';
    this.editingGrantGroupIds = group.grants.map((item) => Number(item.id || 0)).filter(Boolean);
    const fallbackByTarget = new Map<number, PickUser>();
    group.grants
      .map((item) => ({
        id: Number(item.targetUserId || 0),
        fullName: item.targetUserName || 'بدون اسم',
        role: item.targetUserRole,
        familyName: item.familyBase || undefined,
        deaconFamily: item.familyBase || undefined
      }))
      .filter((item) => !!item.id)
      .forEach((item) => fallbackByTarget.set(item.id, item));
    this.editingGrantTargetFallbacks = Array.from(fallbackByTarget.values());
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
    this.selectedGrantTargetIds = Array.from(new Set(group.grants.map((item) => Number(item.targetUserId || 0)).filter(Boolean)));
    this.grantTargetSearch = '';
    this.grantSavedSummaries = [];
    const hasWideRange = group.grants.some((g) => {
      const s = new Date(g.startsAt);
      const e = new Date(g.endsAt);
      return !Number.isNaN(s.getTime()) && s.getFullYear() <= 2000 && !Number.isNaN(e.getTime()) && e.getFullYear() >= 2080;
    });
    this.resetPermanentGrantOptions(hasWideRange);
    if (group.grants.length > 1 && !hasWideRange) {
      this.grantPermanentFromDate = this.minGrantStartDate(group.grants);
      this.grantPermanentToDate = this.maxGrantEndDate(group.grants);
    }
    this.refreshGrantTargetLists();
    this.syncGrantFamilySelectionsFromForm();
    this.syncGrantDateControls();
    this.applyGrantEditDatesToWindows();
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

    const basePayload = {
      ...this.grantForm,
      grantKind: this.grantKindFromAudience((this.grantForm.allowedTypes || []).includes('CUSTOM_EVENT') ? 'SERVANTS' : this.grantAudience),
      familyBase: this.canChooseGrantFamily()
        ? (this.grantForm.familyBase || undefined)
        : (this.defaultGrantScopeFamily() || undefined)
    };

    const editingRecurringGrant = this.isEditingRecurringGrant();

    // ---- PERMANENT MODE ----
    if (this.grantPermanentEnabled) {
      const permanentStartsAt = '2000-01-01T00:00';
      const permanentEndsAt = '2099-12-31T23:59';

      if (this.grantDialogMode === 'edit') {
        const selectedIds = new Set(this.selectedGrantTargetIds.map((id) => Number(id || 0)).filter(Boolean));
        const requests = this.knownAccessGrants()
          .filter((grant) => this.editingGrantGroupIds.includes(Number(grant.id || 0)))
          .map((grant) => this.attendance.updateAccessGrant(Number(grant.id), {
            ...basePayload,
            targetUserId: Number(grant.targetUserId || 0),
            dayOfWeek: this.grantSelectedWeekday ?? 5,
            note: basePayload.note || '',
            startsAt: permanentStartsAt,
            endsAt: permanentEndsAt
          }));
        forkJoin(requests).subscribe({
          next: (updatedGrants) => {
            this.message.add({ severity: 'success', summary: 'تم', detail: 'تم حفظ التعديلات' });
            this.updateGrantsAfterSave(updatedGrants || []);
            this.cancelGrantEdit();
            if (closeAfterSave) this.grantDialogVisible = false;
          },
          error: (err) => this.message.add({ severity: 'error', summary: 'خطأ', detail: err?.error?.error || err?.error?.message || 'فشل الحفظ' })
        });
        return;
      }

      const createRequests = this.selectedGrantTargetIds.map((targetUserId) => {
        const payload = {
          ...basePayload,
          targetUserId,
          dayOfWeek: this.grantSelectedWeekday ?? 5,
          note: basePayload.note || '',
          startsAt: permanentStartsAt,
          endsAt: permanentEndsAt
        };
        return this.attendance.createAccessGrant(payload);
      });

      forkJoin(createRequests).subscribe({
        next: (savedGrants) => {
          this.message.add({
            severity: 'success',
            summary: 'تم',
            detail: `تم حفظ التخصيص الدائم لـ ${this.selectedGrantTargetIds.length} شخص`
          });
          this.grantForm.note = '';
          this.selectedGrantTargetIds = [];
          this.refreshGrantTargetLists();
          this.updateGrantsAfterSave(savedGrants || []);
          if (closeAfterSave) this.grantDialogVisible = false;
        },
        error: (err) => {
          this.message.add({ severity: 'error', summary: 'خطأ', detail: err?.error?.error || err?.error?.message || 'فشل الحفظ' });
        }
      });
      return;
    }

    // ---- TEMPORARY MODE ----
    const selectedWindow = this.selectedGrantWindowValue
      || (this.grantSelectedWeekday !== null ? this.buildGrantWindow(this.grantSelectedWeekday, this.grantStartsAtDate, this.grantEndsAtDate) : null);
    const baseWindows = selectedWindow && selectedWindow.startsAt && selectedWindow.endsAt ? [selectedWindow] : [];

    if (!baseWindows.length) {
      this.message.add({ severity: 'warn', summary: 'تنبيه', detail: 'حدد وقت البداية والنهاية لليوم المختار' });
      return;
    }

    if (this.grantDialogMode === 'create' && (!this.grantPermanentFromDate || !this.grantPermanentToDate)) {
      this.message.add({ severity: 'warn', summary: 'تنبيه', detail: 'حدد فترة تشغيل التخصيص المؤقت من وإلى.' });
      return;
    }

    if (this.grantDialogMode === 'create' && (this.isBeforeToday(this.grantPermanentFromDate) || this.isBeforeToday(this.grantPermanentToDate))) {
      this.message.add({ severity: 'warn', summary: 'تنبيه', detail: 'لا يمكن اختيار أيام سابقة في فترة التخصيص.' });
      return;
    }

    const windows = this.grantDialogMode === 'create'
      ? this.buildPermanentGrantWindows(baseWindows[0])
      : baseWindows;

    if (!windows.length) {
      this.message.add({ severity: 'warn', summary: 'تنبيه', detail: 'لا يوجد مواعيد متكررة داخل فترة التشغيل المحددة.' });
      return;
    }

    const invalidWindow = windows.find((item) => !item.startsAt || !item.endsAt || item.endsAt.getTime() <= item.startsAt.getTime());
    if (invalidWindow) {
      this.message.add({ severity: 'warn', summary: 'تنبيه', detail: `وقت النهاية لازم يكون بعد البداية في ${this.dayLabel(invalidWindow.day)}` });
      return;
    }

    const family = this.grantPrimaryScopeFamily();
    const selectedType = (this.grantForm.allowedTypes || [])[0] || 'FRIDAY_LITURGY';
    const beforeSchedule = windows.find((item) => {
      const schedTime = this.attendanceContext?.scheduleTimes?.[family]?.[selectedType]?.[String(item.day)];
      if (!schedTime || !item.startsAt) return false;
      const [h, m] = schedTime.split(':').map(Number);
      const schedDt = new Date(item.startsAt);
      schedDt.setHours(h, m, 0, 0);
      return item.startsAt.getTime() < schedDt.getTime();
    });
    if (beforeSchedule) {
      this.message.add({ severity: 'warn', summary: 'تنبيه', detail: `لا يمكن ان يكون التخصيص قبل ميعاد المناسبة يوم ${this.dayLabel(beforeSchedule.day)}` });
      return;
    }

    const pastWindow = this.grantDialogMode === 'create'
      ? windows.find((item) => this.isBeforeToday(item.startsAt) || this.isBeforeToday(item.endsAt))
      : null;
    if (pastWindow) {
      this.message.add({ severity: 'warn', summary: 'تنبيه', detail: 'لا يمكن حفظ تخصيص على يوم سابق.' });
      return;
    }

    const replacementIds = new Set<number>();
    if (this.grantDialogMode === 'create') {
      for (const targetUserId of this.selectedGrantTargetIds) {
        for (const day of Array.from(new Set(windows.map((window) => window.day)))) {
          this.existingGrantsForReplacement(targetUserId, day, basePayload)
            .forEach((grant) => replacementIds.add(Number(grant.id || 0)));
        }
      }
    }

    const handleSuccess = (savedGrants: AttendanceAccessGrant[] = []) => {
      this.message.add({
        severity: 'success',
        summary: 'تم',
        detail: this.permanentGrantSummaryText(windows, this.selectedGrantTargetIds.length)
      });
      this.recordSavedGrantSummaries(windows, savedGrants);
      this.updateGrantsAfterSave(savedGrants, Array.from(replacementIds));
      if (this.grantDialogMode === 'edit') {
        this.cancelGrantEdit();
      } else {
        this.grantForm.note = '';
        this.selectedGrantTargetIds = [];
        this.refreshGrantTargetLists();
      }
      if (closeAfterSave) {
        this.grantDialogVisible = false;
      }
    };
    const handleError = (err: any) => {
      this.message.add({ severity: 'error', summary: 'خطأ', detail: err?.error?.error || err?.error?.message || 'فشل الحفظ' });
    };

    if (this.grantDialogMode === 'create') {
      const deleteRequests = Array.from(replacementIds).map((id) => this.attendance.deleteAccessGrant(id));
      const createRequests = this.selectedGrantTargetIds.flatMap((targetUserId) =>
        windows.map((window) => {
          const payload = {
            ...basePayload,
            targetUserId,
            dayOfWeek: window.day,
            note: basePayload.note,
            startsAt: this.toDateTimeLocalValue(window.startsAt as Date),
            endsAt: this.toDateTimeLocalValue(window.endsAt as Date)
          };
          return this.attendance.createAccessGrant(payload);
        })
      );

      (deleteRequests.length ? forkJoin(deleteRequests) : of([])).pipe(
        switchMap(() => forkJoin(createRequests))
      ).subscribe({
        next: (savedGrants) => handleSuccess(savedGrants || []),
        error: handleError
      });
      return;
    }

    const editWindow = windows[0];
    const selectedIds = new Set(this.selectedGrantTargetIds.map((id) => Number(id || 0)).filter(Boolean));
    const existingByTarget = new Map<number, AttendanceAccessGrant[]>();
    for (const grant of this.knownAccessGrants().filter((item) => this.editingGrantGroupIds.includes(Number(item.id || 0)))) {
      const targetId = Number(grant.targetUserId || 0);
      existingByTarget.set(targetId, [...(existingByTarget.get(targetId) || []), grant]);
    }

    const buildEditedWindowForExisting = (existing: AttendanceAccessGrant, index: number, count: number): GrantDayWindow => {
      if (count <= 1) return editWindow;
      const existingStart = new Date(existing.startsAt);
      const start = this.combineDateWithTime(
        Number.isNaN(existingStart.getTime()) ? (editWindow.startsAt as Date) : existingStart,
        editWindow.startsAt
      );
      const endOffset = this.grantWindowEndOffset(editWindow);
      let end = this.dateForRelativeOffset(start, endOffset, editWindow.endsAt as Date);
      if (end.getTime() <= start.getTime()) {
        end = new Date(end);
        end.setDate(end.getDate() + 1);
      }
      return {
        day: this.grantDayFromGrant(existing) ?? editWindow.day,
        startsAt: start,
        endsAt: end
      };
    };

    const requests = [
      ...Array.from(selectedIds).map((targetUserId) => {
        const existingItems = existingByTarget.get(targetUserId) || [];
        if (!existingItems.length) {
          const payload = {
            ...basePayload,
            targetUserId,
            dayOfWeek: editWindow.day,
            startsAt: this.toDateTimeLocalValue(editWindow.startsAt as Date),
            endsAt: this.toDateTimeLocalValue(editWindow.endsAt as Date)
          };
          return [this.attendance.createAccessGrant(payload)];
        }
        return existingItems.map((existing, index) => {
          const windowForExisting = buildEditedWindowForExisting(existing, index, existingItems.length);
          const payload = {
            ...basePayload,
            targetUserId,
            dayOfWeek: windowForExisting.day,
            startsAt: this.toDateTimeLocalValue(windowForExisting.startsAt as Date),
            endsAt: this.toDateTimeLocalValue(windowForExisting.endsAt as Date)
          };
          return this.attendance.updateAccessGrant(Number(existing.id), payload);
        });
      }).flat(),
      ...Array.from(existingByTarget.entries())
        .filter(([targetUserId]) => !selectedIds.has(targetUserId))
        .flatMap(([, grants]) => grants.map((grant) => this.attendance.deleteAccessGrant(Number(grant.id))))
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

  deleteGrantSchedule(schedule: GrantScheduleGroup): void {
    const group: GrantGroup = {
      key: schedule.key,
      grants: schedule.grants,
      first: schedule.first,
      targetNames: schedule.first.targetUserName || this.grantTargetNameFor(schedule.first.targetUserId),
      notes: schedule.notesText ? [schedule.notesText] : []
    };
    this.deleteGrantGroup(group);
  }

  editGrantSchedule(schedule: GrantScheduleGroup): void {
    if (!this.canManageAccessGrants()) return;
    this.grantPopupVisible = false;
    this.openEditGrantGroup(schedule.editGroup);
  }

  editGrantScheduleFromEvent(event: Event, schedule: GrantScheduleGroup): void {
    event.preventDefault();
    event.stopPropagation();
    this.editGrantSchedule(schedule);
  }

  deleteGrantScheduleFromEvent(event: Event, schedule: GrantScheduleGroup): void {
    event.preventDefault();
    event.stopPropagation();
    this.deleteGrantSchedule(schedule);
  }

  deletePersonGrantGroup(personGroup: PersonGrantGroup): void {
    const ids = personGroup.grants
      .map((grant) => Number(grant.id || 0))
      .filter(Boolean);
    if (!ids.length) return;
    forkJoin(ids.map((id) => this.attendance.deleteAccessGrant(id))).subscribe({
      next: () => {
        this.message.add({ severity: 'success', summary: 'تم', detail: 'تم حذف التخصيصات' });
        this.selectedGrantPersonKeys = this.selectedGrantPersonKeys.filter((k) => k !== personGroup.key);
        this.loadAccessGrants();
      },
      error: (err) => {
        this.message.add({ severity: 'error', summary: 'خطأ', detail: err?.error?.error || err?.error?.message || 'فشل حذف التخصيصات' });
      }
    });
  }

  editPersonGrantGroup(personGroup: PersonGrantGroup): void {
    const schedule = personGroup.schedules[0];
    if (!schedule) return;
    this.grantPopupVisible = false;
    this.openEditGrantGroup(schedule.editGroup);
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
    const day = this.selectedDate?.getDay() ?? 5;
    const preferred = this.preferredCustomEventFamily();
    return {
      familyBase: preferred,
      familyBases: preferred ? [preferred] : [],
      title: '',
      dayOfWeek: day,
      dayOfWeeks: [day],
      enabled: true,
      alwaysActive: true,
      permittedEditorIds: []
    };
  }

  get visibleCustomEvents(): AttendanceCustomEvent[] {
    return this.displayCustomEventPreviewGroups.map((group) => group.first);
  }

  get currentFamilyCustomEvents(): AttendanceCustomEvent[] {
    return this.familyCustomEvents;
  }

  get extraCustomEventsCount(): number {
    return Math.max(0, this.displayCustomEventGroups.length - this.displayCustomEventPreviewGroups.length);
  }

  get displayCustomEventGroups(): CustomEventGroup[] {
    // المناسبات الافتراضية
    const defaultTypes: { type: AttendanceType; label: string }[] = [
      { type: 'FRIDAY_LITURGY', label: this.typeLabel('FRIDAY_LITURGY') },
      { type: 'TASBEEHA', label: this.typeLabel('TASBEEHA') },
      { type: 'FAMILY_MEETING', label: this.typeLabel('FAMILY_MEETING') }
    ];
    const defaultGroups: CustomEventGroup[] = defaultTypes
      .filter(({ type }) => this.configuredTypeHasDays(type))
      .map(({ type, label }) => {
        const days = this.configDaysForType(type);
        return {
          key: `DEFAULT:${type}`,
          events: days.map(day => ({
            id: undefined,
            familyBase: this.selectedFamily || '',
            title: label,
            dayOfWeek: day,
            enabled: true,
            alwaysActive: true,
            type,
            // خصائص إضافية افتراضية
          } as AttendanceCustomEvent)),
          first: {
            id: undefined,
            familyBase: this.selectedFamily || '',
            title: label,
            dayOfWeek: days[0],
            enabled: true,
            alwaysActive: true,
            type,
          } as AttendanceCustomEvent,
          days,
          enabled: true
        };
      });
    // المناسبات المخصصة
    const customGroups = this.familyCustomEventGroups;
    // دمجهم معًا
    return [...defaultGroups, ...customGroups];
  }

  get displayCustomEventPreviewGroups(): CustomEventGroup[] {
    return this.familyCustomEventGroups.slice(0, 2);
  }

  trackCustomEventGroup(_: number, group: CustomEventGroup): string {
    return group.key;
  }

  private groupCustomEvents(events: AttendanceCustomEvent[]): CustomEventGroup[] {
    const groups = new Map<string, AttendanceCustomEvent[]>();
    for (const event of (events || []).filter((item) => this.isCustomEventStillCurrent(item))) {
      const key = this.customEventGroupKey(event);
      groups.set(key, [...(groups.get(key) || []), event]);
    }

    return Array.from(groups.entries())
      .map(([key, items]) => {
        const sorted = items.slice().sort((a, b) => Number(a.dayOfWeek ?? 0) - Number(b.dayOfWeek ?? 0));
        return {
          key,
          events: sorted,
          first: sorted[0],
          days: Array.from(new Set(sorted.map((event) => Number(event.dayOfWeek)).filter((day) => this.weekDays.includes(day)))),
          enabled: sorted.some((event) => event.enabled !== false)
        };
      })
      .sort((a, b) => String(a.first.title || '').localeCompare(String(b.first.title || ''), 'ar'));
  }

  private customEventGroupKey(event: AttendanceCustomEvent): string {
    return this.buildCustomEventGroupKey(event.title, event.familyBase);
  }

  private buildCustomEventGroupKey(title?: string | null, familyBase?: string | null): string {
    return `${this.normalizeCustomEventScopeKey(familyBase)}|${this.normalizeCustomEventTitleKey(title)}`;
  }

  private normalizeCustomEventScopeKey(value?: string | null): string {
    const family = canonicalFamilyName(String(value || '')).trim();
    if (!family) return '__all__';
    return this.normalizeCustomEventTitleKey(family);
  }

  private normalizeCustomEventTitleKey(value?: string | null): string {
    return String(value || '')
      .normalize('NFKC')
      .replace(/[\u064B-\u065F\u0670\u0640\u200B-\u200F\uFEFF]/g, '')
      .replace(/[إأآا]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/\s+/g, '')
      .trim()
      .toLowerCase();
  }

  isCustomEventFamilyLocked(): boolean {
    return false;
  }

  customEventDialogHeader(): string {
    return this.isCreatingNewCustomEventSelection() ? 'إضافة مناسبة' : 'تعديل مناسبة';
  }

  customEventFamilyLabel(): string {
    const bases = this.customEventForm.familyBases?.filter(Boolean) || [];
    if (!bases.length) return 'كل الأسر';
    if (bases.length === 1) return bases[0];
    return `${bases.length} أسر`;
  }

  canManageCustomEventEditors(): boolean {
    return this.isAminKhedmaOrDeveloper();
  }

  get allCustomEventFamiliesSelected(): boolean {
    const familyValues = this.customEventFamilyOptions().map(o => o.value).filter(Boolean);
    if (!familyValues.length) return false;
    const selected = this.customEventForm.familyBases || [];
    return familyValues.every(f => selected.includes(f));
  }

  toggleAllCustomEventFamilies(): void {
    const familyValues = this.customEventFamilyOptions().map(o => o.value).filter(Boolean);
    if (this.allCustomEventFamiliesSelected) {
      this.customEventForm.familyBases = [];
    } else {
      this.customEventForm.familyBases = [...familyValues];
    }
    this.onCustomEventFamilyChange();
  }

  customEventFamilyOptions(): Array<{ label: string; value: string }> {
    const options = this.isAminKhedmaOrDeveloper()
      ? this.filterAthanasiusVisibility(this.families).map((family) => ({ label: family, value: family }))
      : this.filterAthanasiusVisibility(this.aminOsraFamilies()).filter(Boolean).map((family) => ({ label: family, value: family }));
    return options;
  }

  customEventDialogOptions(): CustomEventDialogOption[] {
    const defaultOptions: CustomEventDialogOption[] = [
      ...this.grantTypeOptions().map((opt: { value: AttendanceType; label: string }) => ({
        value: `DEFAULT:${opt.value}`,
        label: opt.label
      }))
    ].filter((option) => this.canEditDefaultCustomEventOption(option.value.replace('DEFAULT:', '') as AttendanceType));
    const existing = this.customEventDialogGroups
      .filter((group) => group.events.some((event) => this.canEditCustomEvent(event)))
      .map((group) => ({
      value: group.key,
      label: group.first.title || 'بدون اسم'
      }));
    return [
      ...defaultOptions,
      ...existing,
      { value: '__new__', label: 'إضافة مناسبة جديدة', isNew: true }
    ];
  }

  isCreatingNewCustomEventSelection(): boolean {
    return this.customEventDialogSelection === '__new__';
  }

  shouldShowCustomEventAdvancedFields(): boolean {
    return this.isCreatingNewCustomEventSelection()
      || (!!this.customEventDialogSelection && !this.customEventDialogSelection.startsWith('DEFAULT:'));
  }

  private loadCustomEventsForFamily(): void {
    if (!this.canSelectCustomEventForAttendance()) {
      this.familyCustomEvents = [];
      this.familyCustomEventGroups = [];
      this.availableCustomEvents = [];
      return;
    }
    this.attendance.listCustomEvents().subscribe({
      next: (events) => this.applyCustomEventsToView(events || []),
      error: () => {
        this.familyCustomEvents = [];
        this.familyCustomEventGroups = [];
        this.availableCustomEvents = [];
    this.refreshTypeOptions();
  }
    });
  }

  private applyCustomEventsToView(events: AttendanceCustomEvent[]): void {
    this.cachedAllCustomEvents = events || [];
    const familyBase = this.isAminKhedmaOrDeveloper() ? (this.selectedFamily || undefined) : (this.preferredCustomEventFamily() || undefined);
    const relevant = familyBase
      ? this.cachedAllCustomEvents.filter((event) => this.isCustomEventRelevantToFamily(event, familyBase))
      : this.cachedAllCustomEvents;
    this.familyCustomEvents = this.filterAthanasiusVisibilityForEvents(this.uniqueCustomEvents(relevant));
    this.familyCustomEventGroups = this.groupCustomEvents(this.familyCustomEvents);
    this.refreshTypeOptions();
    this.refreshAvailableCustomEvents();
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
    if (!this.customEventForm.dayOfWeeks?.length) {
      this.customEventForm.dayOfWeeks = [Number(this.customEventForm.dayOfWeek)];
    }
  }

  customEventSelectedDays(): number[] {
    const days = (this.customEventForm.dayOfWeeks || [])
      .map((day) => Number(day))
      .filter((day) => this.weekDays.includes(day));
    return Array.from(new Set(days));
  }

  hasCustomEventDay(day: number): boolean {
    return this.customEventSelectedDays().includes(Number(day));
  }

  toggleCustomEventDay(day: number): void {
    const value = Number(day);
    if (!this.weekDays.includes(value)) return;
    const current = new Set(this.customEventSelectedDays());
    if (current.has(value)) {
      if (current.size === 1) {
        this.message.add({ severity: 'warn', summary: 'تنبيه', detail: 'اختار يوم واحد على الأقل للمناسبة' });
        return;
      }
      current.delete(value);
    } else {
      current.add(value);
    }
    const ordered = this.weekDays.filter((item) => current.has(item));
    this.customEventForm.dayOfWeeks = ordered;
    this.customEventForm.dayOfWeek = ordered[0] ?? (this.selectedDate?.getDay() ?? 5);
  }

  customEventSelectedDaysLabel(): string {
    return this.customEventSelectedDays().map((day) => this.dayLabel(day)).join(' + ');
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
    if (this.isBeforeToday(val)) val = null;
    this.customEventActiveFromDate = val;
    this.customEventForm.activeFrom = val ? this.toIsoDate(val) : null;
    if (val && this.customEventActiveToDate && this.customEventActiveToDate < val) {
      this.customEventActiveToDate = null;
      this.customEventForm.activeTo = null;
    }
  }

  onCustomEventActiveToChange(val: Date | null): void {
    const minDate = this.customEventActiveFromDate || this.customEventMinDate;
    if (this.isBeforeToday(val) || (val && val < minDate)) val = null;
    this.customEventActiveToDate = val;
    this.customEventForm.activeTo = val ? this.toIsoDate(val) : null;
  }

  onCustomEventFamilyChange(): void {
    this.customEventForm.familyBase = this.customEventForm.familyBases[0] || '';
    this.customEventForm.permittedEditorIds = [];
    this.customEventEditorPickerId = null;
    this.customEventEditorSearch = '';
    const wasDefault = this.customEventDialogSelection.startsWith('DEFAULT:');
    if (this.isCreatingNewCustomEventSelection() || wasDefault) {
      this.onCustomEventDialogSelectionChange();
    }
    this.loadCustomEventDialogScopeEvents(true);
    if (!this.customEventDialogSelection.startsWith('DEFAULT:') && !this.isCreatingNewCustomEventSelection()) {
      this.loadCustomEventEditorTargets();
    }
  }

  onCustomEventDialogSelectionChange(): void {
    if (
      this.customEventDialogSelection
      && this.customEventDialogSelection !== '__new__'
      && !this.customEventDialogOptions().some((option) => option.value === this.customEventDialogSelection)
    ) {
      this.selectFirstCustomEventOption();
      return;
    }

    if (this.isCreatingNewCustomEventSelection()) {
      this.customEventDialogMode = 'create';
      this.editingCustomEventGroupIds = [];
      const familyBases = [...(this.customEventForm.familyBases || [])].filter(Boolean);
      const form = this.defaultCustomEventForm();
      this.customEventForm = {
        ...form,
        familyBases,
        familyBase: familyBases[0] || '',
        permittedEditorIds: []
      };
      this.customEventActiveFromDate = null;
      this.customEventActiveToDate = null;
      this.loadCustomEventEditorTargets();
      return;
    }

    if (this.customEventDialogSelection.startsWith('DEFAULT:')) {
      const type = this.customEventDialogSelection.replace('DEFAULT:', '') as AttendanceType;
      const familyBases = [...(this.customEventForm.familyBases || [])].filter(Boolean);
      const familyBase = familyBases[0] || this.customEventForm.familyBase || '';
      const days = this.configDaysForType(type, familyBase);
      this.customEventDialogMode = 'edit';
      this.editingCustomEventGroupIds = [];
      this.customEventForm = {
        familyBase,
        familyBases,
        title: this.typeLabel(type),
        dayOfWeek: days[0] ?? 5,
        dayOfWeeks: days.length ? [...days] : [5],
        enabled: true,
        alwaysActive: true,
        permittedEditorIds: []
      };
      this.customEventActiveFromDate = null;
      this.customEventActiveToDate = null;
      this.customEventEditorPickerId = null;
      this.customEventEditorSearch = '';
      return;
    }

    const group = this.customEventDialogGroups.find((item) => item.key === this.customEventDialogSelection);
    if (!group) return;
    this.applyCustomEventGroupToForm(group);
  }

  private loadCustomEventEditorTargets(): void {
    if (!this.canManageCustomEventEditors()) {
      this.customEventEditorTargets = [];
      this.customEventForm.permittedEditorIds = [];
      return;
    }

    const family = String(this.customEventForm.familyBase || this.customEventForm.familyBases?.[0] || '').trim();

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

    if (this.isAminKhedmaOrDeveloper()) {
      this.familySvc.members(family, true, 'attendance').subscribe({
        next: (members) => applyTargets(members || []),
        error: () => this.customEventEditorTargets = []
      });
    } else {
      forkJoin([
        this.familySvc.members(family, true, 'attendance'),
        this.familySvc.members(family, true)
      ]).subscribe({
        next: ([attendanceMembers, familyMembers]) => applyTargets([...(attendanceMembers || []), ...(familyMembers || [])]),
        error: () => this.customEventEditorTargets = []
      });
    }
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

  customEventEditorEmptyMessage(): string {
    if (!this.customEventEditorTargets.length) {
      return 'لا يوجد خدام متاحين للإضافة في النطاق الحالي.';
    }
    if (!this.remainingCustomEventEditorTargets().length) {
      return 'تم اختيار كل الخدام المتاحين للتعديل.';
    }
    return 'لا توجد نتائج مطابقة للبحث الحالي.';
  }

  addCustomEventEditor(id: number): void {
    this.onCustomEventPermittedEditorPick(id);
    this.customEventEditorSearch = '';
  }

  private allCustomEventConfigFamilies(): string[] {
    return this.customEventFamilyOptions()
      .map((option) => String(option.value || '').trim())
      .filter(Boolean);
  }

  customEventPermittedEditorsSummary(event: AttendanceCustomEvent): string {
    const names = (event.permittedEditors || [])
      .map((editor) => String(editor?.fullName || '').trim())
      .filter(Boolean);
    if (names.length) return names.join(' + ');
    const legacyName = String(event.permittedEditorName || '').trim();
    return legacyName || 'بدون خدام محددين';
  }

  customEventGroupDaysLabel(group: CustomEventGroup): string {
    const days = Array.from(new Set(
      this.customEventGroupEvents(group)
        .map((event) => Number(event.dayOfWeek))
        .filter((day) => this.weekDays.includes(day))
    ));
    return days.map((day) => this.dayLabel(day)).join(' + ');
  }

  canEditCustomEventGroup(group: CustomEventGroup): boolean {
    if (group.key && group.key.startsWith('DEFAULT:')) {
      return this.canEditCustomEvent(group.first);
    }
    return this.customEventGroupEvents(group).some((event) => this.canEditCustomEvent(event));
  }

  private canEditDefaultCustomEventOption(type: AttendanceType): boolean {
    return this.canEditCustomEvent({
      familyBase: this.customEventForm.familyBase || this.selectedFamily || '',
      title: this.typeLabel(type),
      dayOfWeek: this.configDaysForType(type, this.customEventForm.familyBase || this.selectedFamily)[0] ?? 5,
      enabled: true,
      alwaysActive: true,
      type
    } as AttendanceCustomEvent);
  }

  private customEventGroupEvents(group: CustomEventGroup): AttendanceCustomEvent[] {
    const key = group.key || this.customEventGroupKey(group.first);
    const fromCurrent = this.currentFamilyCustomEvents.filter((event) => this.customEventGroupKey(event) === key);
    return fromCurrent.length ? fromCurrent : (group.events || []);
  }

  private filterCustomEventsForDialogScope(events: AttendanceCustomEvent[], familyBase: string): AttendanceCustomEvent[] {
    return (events || []).filter((event) => {
      const eventFamily = String(event.familyBase || '').trim();
      if (!familyBase) return true;
      const bases = this.customEventForm.familyBases?.filter(Boolean) || [];
      if (bases.length) {
        return bases.some((b) => canonicalFamilyName(b) === canonicalFamilyName(eventFamily));
      }
      return canonicalFamilyName(eventFamily) === canonicalFamilyName(familyBase);
    });
  }

  private loadCustomEventDialogScopeEvents(forceNewSelection = false, preferredKey = ''): void {
    const familyBase = String(this.customEventForm.familyBase || '').trim();
    const events = this.cachedAllCustomEvents || [];
    this.useDialogEvents(events, familyBase, forceNewSelection, preferredKey);
  }

  private useDialogEvents(events: AttendanceCustomEvent[], familyBase: string, forceNewSelection: boolean, preferredKey: string): void {
    const filtered = this.filterAthanasiusVisibilityForEvents(
      this.uniqueCustomEvents(this.filterCustomEventsForDialogScope(events || [], familyBase))
    );
    this.customEventDialogEvents = filtered;
    this.customEventDialogGroups = this.groupCustomEvents(filtered);

    const wantedKey = preferredKey || this.customEventDialogSelection;
    if (wantedKey.startsWith('DEFAULT:')) return;
    const matched = this.customEventDialogGroups.find((group) => group.key === wantedKey);
    if (!forceNewSelection && matched) {
      this.customEventDialogSelection = matched.key;
      this.applyCustomEventGroupToForm(matched);
      return;
    }

    this.selectFirstCustomEventOption();
  }

  private selectFirstCustomEventOption(): void {
    const options = this.customEventDialogOptions();
    const firstNonNew = options.find((opt) => !opt.isNew);
    if (firstNonNew) {
      this.customEventDialogSelection = firstNonNew.value;
      this.onCustomEventDialogSelectionChange();
    } else {
      this.customEventDialogSelection = '__new__';
      this.onCustomEventDialogSelectionChange();
    }
  }

  private applyCustomEventGroupToForm(group: CustomEventGroup): void {
    const groupEvents = this.customEventGroupEvents(group);
    const editableEvents = groupEvents.filter((event) => this.canEditCustomEvent(event));
    if (!editableEvents.length) return;

    const event = editableEvents[0];
    this.customEventDialogMode = 'edit';
    this.editingCustomEventGroupIds = groupEvents.map((item) => Number(item.id || 0)).filter(Boolean);
    this.customEventForm = {
      ...event,
      id: event.id,
      familyBase: event.familyBase || '',
      familyBases: event.familyBase ? [event.familyBase] : [],
      title: event.title || '',
      dayOfWeek: Number(event.dayOfWeek ?? 5),
      dayOfWeeks: Array.from(new Set(groupEvents.map((item) => Number(item.dayOfWeek)).filter((day) => this.weekDays.includes(day)))),
      enabled: event.enabled !== false,
      alwaysActive: event.alwaysActive !== false,
      permittedEditorIds: [...(event.permittedEditorIds || []), ...(event.permittedEditorId ? [event.permittedEditorId] : [])]
        .filter((id, index, arr) => !!id && arr.indexOf(id) === index)
    };
    this.customEventDialogSelection = group.key;
    this.customEventActiveFromDate = event.activeFrom ? new Date(event.activeFrom) : null;
    this.customEventActiveToDate = event.activeTo ? new Date(event.activeTo) : null;
    this.customEventEditorPickerId = null;
    this.customEventEditorSearch = '';
    this.loadCustomEventEditorTargets();
  }

  openCreateCustomEvent(): void {
    if (!this.canUseCustomEvent()) return;
    this.customEventDialogMode = 'create';
    this.editingCustomEventGroupIds = [];
    const options = this.customEventFamilyOptions();
    const firstValue = options[0]?.value || '';
    this.customEventForm = {
      ...this.defaultCustomEventForm(),
      familyBase: firstValue,
      familyBases: firstValue ? [firstValue] : []
    };
    this.customEventDialogEvents = [];
    this.customEventDialogGroups = [];
    this.customEventActiveFromDate = null;
    this.customEventActiveToDate = null;
    this.customEventEditorPickerId = null;
    this.customEventEditorSearch = '';
    this.customEventDialogSelection = 'DEFAULT:FRIDAY_LITURGY';
    this.onCustomEventDialogSelectionChange();
    this.customEventDialogVisible = true;
    this.loadCustomEventDialogScopeEvents(true);
  }

  openEditCustomEvent(event: AttendanceCustomEvent): void {
    if (!this.canEditCustomEvent(event)) return;
    const group = this.groupCustomEvents(this.currentFamilyCustomEvents)
      .find((item) => item.events.some((candidate) => Number(candidate.id || 0) === Number(event.id || 0)));
    this.openEditCustomEventGroup(group || {
      key: this.customEventGroupKey(event),
      events: [event],
      first: event,
      days: this.weekDays.includes(Number(event.dayOfWeek)) ? [Number(event.dayOfWeek)] : [],
      enabled: event.enabled !== false
    });
  }

  openEditCustomEventGroup(group: CustomEventGroup): void {
    // إذا كانت المناسبة افتراضية (قداس/تسبحة/اجتماع)
    if (group.key && group.key.startsWith('DEFAULT:')) {
      if (!this.canEditCustomEvent(group.first)) return;
      const event = group.first;
      this.customEventDialogMode = 'edit';
      const familyBase = event.familyBase || '';
      this.customEventForm = {
        familyBase,
        familyBases: familyBase ? [familyBase] : [],
        title: event.title,
        dayOfWeek: event.dayOfWeek,
        dayOfWeeks: group.days,
        enabled: event.enabled,
        alwaysActive: event.alwaysActive,
        permittedEditorIds: []
      };
      this.customEventDialogSelection = group.key;
      this.customEventDialogEvents = [];
      this.customEventDialogGroups = [];
      this.customEventActiveFromDate = null;
      this.customEventActiveToDate = null;
      this.customEventEditorPickerId = null;
      this.customEventEditorSearch = '';
      this.customEventDialogVisible = true;
      return;
    }
    // المناسبات المخصصة
    const groupEvents = this.customEventGroupEvents(group);
    const editableEvents = groupEvents.filter((event) => this.canEditCustomEvent(event));
    if (!editableEvents.length) return;
    const event = editableEvents[0];
    this.customEventDialogMode = 'edit';
    this.customEventForm = {
      ...this.defaultCustomEventForm(),
      familyBase: event.familyBase || ''
    };
    this.customEventDialogSelection = group.key;
    this.customEventDialogEvents = [];
    this.customEventDialogGroups = [];
    this.customEventActiveFromDate = event.activeFrom ? new Date(event.activeFrom) : null;
    this.customEventActiveToDate = event.activeTo ? new Date(event.activeTo) : null;
    this.customEventEditorPickerId = null;
    this.customEventEditorSearch = '';
    this.loadCustomEventDialogScopeEvents(false, group.key);
    this.customEventDialogVisible = true;
  }

  private buildCustomEventPayload(dayOfWeek = Number(this.customEventForm.dayOfWeek), familyOverride?: string): Partial<AttendanceCustomEvent> {
    const requestedFamily = familyOverride || String(this.customEventForm.familyBase || '').trim();
    const allowedFamilies = this.customEventFamilyOptions().map((option) => option.value);
    const matchedFamily = allowedFamilies.find((family) => canonicalFamilyName(family) === canonicalFamilyName(requestedFamily));
    const scopedFamily = this.isAminKhedmaOrDeveloper()
      ? requestedFamily
      : (matchedFamily || this.preferredCustomEventFamily());
    return {
      familyBase: scopedFamily || null,
      title: this.customEventForm.title.trim(),
      dayOfWeek: Number(dayOfWeek),
      enabled: this.customEventForm.enabled !== false,
      alwaysActive: this.customEventForm.alwaysActive !== false,
      activeFrom: this.customEventForm.alwaysActive === false ? (this.customEventForm.activeFrom || null) : null,
      activeTo: this.customEventForm.alwaysActive === false ? (this.customEventForm.activeTo || null) : null,
      permittedEditorIds: [...new Set((this.customEventForm.permittedEditorIds || []).filter(Boolean))]
    };
  }

  saveCustomEvent(): void {
    if (!this.canUseCustomEvent()) return;
    if (this.customEventDialogSelection.startsWith('DEFAULT:')) {
      const type = this.customEventDialogSelection.replace('DEFAULT:', '') as AttendanceType;
      const selectedDays = this.customEventSelectedDays();
      if (!selectedDays.length) {
        this.message.add({ severity: 'warn', summary: 'تنبيه', detail: 'اختار يوم واحد على الأقل للمناسبة' });
        return;
      }
      const familyBases = (this.customEventForm.familyBases || []).filter(Boolean);
      const targetFamilies = familyBases.length ? familyBases : this.allCustomEventConfigFamilies();
      if (!targetFamilies.length) {
        this.message.add({ severity: 'warn', summary: 'تنبيه', detail: 'لا توجد أسر متاحة لتطبيق الأيام عليها' });
        return;
      }
      this.customEventSaving = true;
      const payload = { [type]: selectedDays } as Partial<Record<AttendanceType, number[]>>;
      from(targetFamilies).pipe(
        concatMap((targetFamily) => {
          const existingAllowedDays = this.attendanceContext?.config?.familyAbsenceAllowedDays?.[targetFamily];
          const existingOpenDays = this.attendanceContext?.config?.familyAbsenceOpenDays?.[targetFamily];
          return this.attendance.saveFamilyTypeDays(targetFamily, payload, existingAllowedDays, existingOpenDays);
        }),
        toArray()
      ).subscribe({
        next: (configs) => {
          this.customEventSaving = false;
          this.customEventDialogVisible = false;
          const merged = this.mergeConfig(configs[configs.length - 1]);
          this.configEditor = merged;
          this.attendanceContext = {
            ...(this.attendanceContext || {
              todayOpenForServant: true, activeGrants: [], selfCheckinAllowed: false,
              takeAttendanceGrantActive: false, selfAllowedTypes: [], takeAllowedTypes: [], canUseCustomEvent: false
            }),
            config: merged
          };
          this.initCalendarRules();
          this.refreshRuntimeState();
          this.cleanupAccessGrantsForTypeDays(targetFamilies, payload);
          this.loadCustomEventsForFamily();
          this.message.add({
            severity: 'success',
            summary: 'تم',
            detail: targetFamilies.length ? 'تم حفظ أيام المناسبة بنجاح' : 'تم حفظ أيام المناسبة لكل الأسر'
          });
        },
        error: (err) => {
          this.customEventSaving = false;
          this.message.add({ severity: 'error', summary: 'خطأ', detail: err?.error?.error || err?.error?.message || 'فشل حفظ أيام المناسبة' });
        }
      });
      return;
    }
    if (this.isCreatingNewCustomEventSelection() && !this.customEventForm.title?.trim()) {
      this.message.add({ severity: 'warn', summary: 'تنبيه', detail: 'اكتب اسم المناسبة أولاً' });
      return;
    }
    const selectedDays = this.customEventSelectedDays();
    if (!selectedDays.length) {
      this.message.add({ severity: 'warn', summary: 'تنبيه', detail: 'اختار يوم واحد على الأقل للمناسبة' });
      return;
    }
    const requiresFamilySelection = this.customEventDialogMode === 'create' && !this.isAminKhedmaOrDeveloper();
    if (requiresFamilySelection && !this.preferredCustomEventFamily()) {
      this.message.add({ severity: 'warn', summary: 'تنبيه', detail: 'لا توجد أسرة مسموح لك بإضافة مناسبة لها' });
      return;
    }
    if (!this.isAminKhedmaOrDeveloper()) {
      const allowedFamilies = this.customEventFamilyOptions().map((option) => option.value);
      const requestedFamilies = (this.customEventForm.familyBases?.filter(Boolean).length
        ? this.customEventForm.familyBases
        : [this.customEventForm.familyBase || this.preferredCustomEventFamily()]
      ).filter(Boolean);
      const allAllowed = requestedFamilies.every((fam) =>
        allowedFamilies.some((af) => canonicalFamilyName(af) === canonicalFamilyName(fam))
      );
      if (!allAllowed) {
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

    const familyBases = (this.customEventForm.familyBases || []).filter(Boolean);
    const eventFamilies = familyBases.length ? familyBases : [this.customEventForm.familyBase || ''];

    this.customEventSaving = true;
    const editingTitleKey = this.buildCustomEventGroupKey(this.customEventForm.title, this.customEventForm.familyBase);
    const editingSource = this.customEventDialogEvents.length ? this.customEventDialogEvents : this.currentFamilyCustomEvents;
    const editingEvents = this.customEventDialogMode === 'edit'
      ? editingSource.filter((event) =>
          this.editingCustomEventGroupIds.includes(Number(event.id || 0))
          || eventFamilies.some((f) => this.customEventGroupKey(event) === this.buildCustomEventGroupKey(this.customEventForm.title, f))
        )
      : [];
    const eventByDayFamilyKey = new Map(editingEvents.map((event) => [`${event.dayOfWeek}_${event.familyBase}`, event] as const));
    const selectedDaySet = new Set(selectedDays);
    const updateOrCreateRequests = eventFamilies.flatMap((family) =>
      selectedDays.map((day) => {
        const payload = this.buildCustomEventPayload(day, family);
        const existing = eventByDayFamilyKey.get(`${day}_${family}`);
        if (existing?.id) {
          return this.attendance.updateCustomEvent(Number(existing.id), payload);
        }
        return this.attendance.createCustomEvent(payload);
      })
    );
    const removedEvents = editingEvents
      .filter((event) => event.id && !selectedDaySet.has(Number(event.dayOfWeek)));
    const deleteRemovedRequests = removedEvents.map((event) => this.attendance.deleteCustomEvent(Number(event.id)));
    const removeIds = new Set(removedEvents.map((e) => Number(e.id)));
    const requests = [...updateOrCreateRequests, ...deleteRemovedRequests];

    forkJoin(requests).subscribe({
      next: (responses: any[]) => {
        this.customEventSaving = false;
        this.customEventDialogVisible = false;
        this.message.add({
          severity: 'success',
          summary: 'تم',
          detail: selectedDays.length > 1
            ? `تم حفظ المناسبة لأيام: ${this.customEventSelectedDaysLabel()}`
            : 'تم حفظ المناسبة بنجاح'
        });
        this.loadCustomEventsForFamily();
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

  deleteCustomEventGroup(group: CustomEventGroup): void {
    const ids = this.customEventGroupEvents(group)
      .filter((event) => event.id && this.canEditCustomEvent(event))
      .map((event) => Number(event.id));
    if (!ids.length) return;
    forkJoin(ids.map((id) => this.attendance.deleteCustomEvent(id))).subscribe({
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

  requestDeleteCustomEventGroup(group: CustomEventGroup): void {
    const ids = this.customEventGroupEvents(group)
      .filter((event) => event.id && this.canEditCustomEvent(event))
      .map((event) => Number(event.id));
    if (!ids.length) return;
    this.pendingCustomEventDeleteGroup = group;
    this.pendingEditingCustomEventDelete = false;
    this.customEventDeleteConfirmVisible = true;
  }

  confirmDeleteCustomEventGroup(): void {
    if (this.pendingEditingCustomEventDelete) {
      this.customEventDeleteConfirmVisible = false;
      this.pendingEditingCustomEventDelete = false;
      this.deleteEditingCustomEvent();
      return;
    }

    const group = this.pendingCustomEventDeleteGroup;
    if (!group) return;
    this.customEventDeleteConfirmVisible = false;
    this.pendingCustomEventDeleteGroup = null;
    this.deleteCustomEventGroup(group);
  }

  cancelCustomEventDeleteConfirm(): void {
    this.customEventDeleteConfirmVisible = false;
    this.pendingCustomEventDeleteGroup = null;
    this.pendingEditingCustomEventDelete = false;
  }

  canDeleteEditingCustomEvent(): boolean {
    return this.customEventDialogMode === 'edit'
      && !this.customEventDialogSelection.startsWith('DEFAULT:')
      && this.editingCustomEventGroupIds.some((id) => !!id);
  }

  requestDeleteEditingCustomEvent(): void {
    if (!this.canDeleteEditingCustomEvent()) return;
    this.pendingCustomEventDeleteGroup = null;
    this.pendingEditingCustomEventDelete = true;
    this.customEventDeleteConfirmVisible = true;
  }

  deleteEditingCustomEvent(): void {
    const ids = this.editingCustomEventGroupIds
      .filter((id) => !!id)
      .map((id) => Number(id));
    if (!ids.length) return;
    forkJoin(ids.map((id) => this.attendance.deleteCustomEvent(id))).subscribe({
      next: () => {
        this.customEventDialogVisible = false;
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

  private isCustomEventStillCurrent(event: AttendanceCustomEvent): boolean {
    if (!event || event.enabled === false) return false;
    if (event.alwaysActive !== false || !event.activeTo) return true;
    const to = new Date(event.activeTo);
    if (Number.isNaN(to.getTime())) return true;
    to.setHours(23, 59, 59, 999);
    return new Date().getTime() <= to.getTime();
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

  private formatTimeOnly(value?: string | Date | null): string {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    }).format(date);
  }

  // ===== Schedule management =====

  canManageSchedules(): boolean {
    return this.canManageAccessGrants() || this.canUseCustomEvent() || this.isAminKhedmaOrDeveloper();
  }

  loadScheduleItemsForFamily(): void {
    if (!this.selectedFamily) {
      this.scheduleItems = [];
      return;
    }
    this.attendance.getSchedules(this.selectedFamily).subscribe({
      next: (list: any[]) => {
        this.scheduleItems = list || [];
      },
      error: () => {
        this.scheduleItems = [];
      }
    });
  }

  get scheduleTypeOptions(): { value: AttendanceType; label: string }[] {
    return this.configurableTypeOptions;
  }

  get scheduleDayOptions(): { value: number; label: string }[] {
    return this.attendanceDayOptions;
  }

  get scheduleAvailableDayOptions(): { value: number; label: string }[] {
    const type = this.scheduleForm.type;
    if (!type) return this.scheduleDayOptions;
    const base = this.selectedScheduleFamilies[0];
    const validDays = this.configDaysForType(type as AttendanceType, base || undefined);
    if (!validDays || !validDays.length) return this.scheduleDayOptions;
    return this.scheduleDayOptions.filter(d => validDays.includes(d.value));
  }

  get editScheduleDayOptions(): { value: number; label: string }[] {
    const item = this.editScheduleItem;
    if (!item?.type) return this.scheduleDayOptions;
    const validDays = this.configDaysForType(item.type as AttendanceType, item.familyBase || this.selectedFamily || undefined);
    if (!validDays || !validDays.length) return this.scheduleDayOptions;
    return this.scheduleDayOptions.filter(d => validDays.includes(d.value));
  }

  scheduleTypeLabel(type: string): string {
    const opt = this.scheduleTypeOptions.find(t => t.value === type);
    return opt?.label || type;
  }

  scheduleDayLabel(day: number): string {
    const opt = this.scheduleDayOptions.find(d => d.value === day);
    return opt?.label || String(day);
  }

  scheduleTimeLabel(time: string): string {
    if (!time) return '';
    const parts = time.split(':');
    if (parts.length < 2) return time;
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (isNaN(h) || isNaN(m)) return time;
    const period = h >= 12 ? 'م' : 'ص';
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, '0')} ${period}`;
  }

  onScheduleFamilyChange(): void {
    this.loadScheduleItems();
  }

  onScheduleTypeChange(): void {
    const options = this.scheduleAvailableDayOptions;
    if (options.length && !options.some(d => d.value === this.scheduleForm.dayOfWeek)) {
      this.scheduleForm.dayOfWeek = options[0].value;
    }
  }

  confirmScheduleTime(picker: any): void {
    picker.overlayVisible = false;
  }

  cancelScheduleTime(picker: any): void {
    this.scheduleForm.time = null;
    picker.overlayVisible = false;
  }

  get allScheduleFamiliesSelected(): boolean {
    return this.selectedScheduleFamilies.length === this.scheduleFamilies.length;
  }

  toggleAllScheduleFamilies(): void {
    if (this.allScheduleFamiliesSelected) {
      this.selectedScheduleFamilies = [];
    } else {
      this.selectedScheduleFamilies = [...this.scheduleFamilies];
    }
    this.onScheduleFamilyChange();
  }

  get scheduleFamilySelectOptions(): Array<{ label: string; value: string }> {
    return this.scheduleFamilies.map((f) => ({ label: f, value: f }));
  }

  openScheduleDialog(): void {
    this.scheduleForm = { familyBase: '', type: '', dayOfWeek: 5, time: null };
    this.scheduleItems = [];
    this.scheduleSaving = false;
    this.editingScheduleId = null;

    if (this.isAminKhedmaOrDeveloper()) {
      this.scheduleFamilies = [...this.families];
      if (this.scheduleFamilies.length) {
        this.selectedScheduleFamilies = (this.selectedFamily && this.scheduleFamilies.includes(this.selectedFamily))
          ? [this.selectedFamily]
          : [this.scheduleFamilies[0]];
        this.loadScheduleItems();
      }
      this.scheduleDialogVisible = true;
    } else {
      const myFamily = this.assignmentsOf(this.me)[0]?.familyName || '';
      const base = String(myFamily).replace(/ [أب]$/, '').trim();
      this.scheduleFamilies = base ? [base] : [];
      this.selectedScheduleFamilies = base ? [base] : [];
      if (base) this.scheduleForm.familyBase = base;
      this.loadScheduleItems();
      this.scheduleDialogVisible = true;
    }
  }

  closeScheduleDialog(): void {
    this.scheduleDialogVisible = false;
    this.scheduleItems = [];
    this.scheduleFamilies = [];
    this.selectedScheduleFamilies = [];
    this.editingScheduleId = null;
  }

  private loadScheduleItems(): void {
    const bases = this.selectedScheduleFamilies;
    if (!bases.length) {
      this.scheduleItems = [];
      return;
    }
    forkJoin(bases.map((base) => this.attendance.getSchedules(base))).subscribe({
      next: (results: any[][]) => {
        this.scheduleItems = results.flat().filter((item, index, arr) =>
          arr.findIndex((s: any) => s.id === item.id) === index
        );
      },
      error: () => {
        this.scheduleItems = [];
      }
    });
  }

  private refreshFromScheduleChanges(): void {
    this.attendance.context().subscribe({
      next: (ctx) => {
        this.attendanceContext = { ...this.attendanceContext!, ...ctx, config: this.mergeConfig(ctx?.config) };
        this.configEditor = this.mergeConfig(ctx?.config);
        this.initCalendarRules();
        this.loadCancelledDates();
        this.refreshRuntimeState();
      },
      error: () => {}
    });
  }

  addSchedule(): void {
    const bases = this.selectedScheduleFamilies;
    const type = this.scheduleForm.type;
    if (!bases.length || !type) return;

    this.scheduleSaving = true;
    const timeStr = this.scheduleForm.time
      ? `${String(this.scheduleForm.time.getHours()).padStart(2, '0')}:${String(this.scheduleForm.time.getMinutes()).padStart(2, '0')}`
      : undefined;

    const createAll = () => {
      const requests = bases.map((base) =>
        this.attendance.createSchedule({
          familyBase: base,
          type: type as AttendanceType,
          dayOfWeek: this.scheduleForm.dayOfWeek,
          time: timeStr
        })
      );
      forkJoin(requests).subscribe({
        next: () => {
          this.scheduleSaving = false;
          this.editingScheduleId = null;
          this.loadScheduleItems();
          this.refreshFromScheduleChanges();
        },
        error: (err: any) => {
          this.scheduleSaving = false;
          console.error('Failed to create schedule', err);
        }
      });
    };

    if (this.editingScheduleId) {
      this.attendance.deleteSchedule(this.editingScheduleId).subscribe({
        next: () => createAll(),
        error: (err: any) => {
          this.scheduleSaving = false;
          console.error('Failed to delete old schedule', err);
        }
      });
    } else {
      createAll();
    }
  }

  editSchedule(s: any): void {
    this.editScheduleItem = s;
    this.editScheduleDay = s.dayOfWeek;
    if (s.time) {
      const [h, m] = s.time.split(':').map(Number);
      const d = new Date();
      d.setHours(h, m, 0, 0);
      this.editScheduleTime = d;
    } else {
      this.editScheduleTime = null;
    }
    this.editScheduleDialogVisible = true;
  }

  confirmEditScheduleTime(picker: any): void {
    picker.overlayVisible = false;
  }

  cancelEditScheduleTime(picker: any): void {
    this.editScheduleTime = null;
    picker.overlayVisible = false;
  }

  closeEditScheduleDialog(): void {
    this.editScheduleDialogVisible = false;
    this.editScheduleItem = null;
    this.editScheduleTime = null;
    this.editScheduleDay = 5;
  }

  saveEditedSchedule(): void {
    const s = this.editScheduleItem;
    if (!s || !s.id) return;
    this.scheduleSaving = true;
    const timeStr = this.editScheduleTime
      ? `${String(this.editScheduleTime.getHours()).padStart(2, '0')}:${String(this.editScheduleTime.getMinutes()).padStart(2, '0')}`
      : undefined;
    this.attendance.deleteSchedule(s.id).subscribe({
      next: () => {
        this.attendance.createSchedule({
          familyBase: s.familyBase,
          type: s.type as AttendanceType,
          dayOfWeek: this.editScheduleDay,
          time: timeStr
        }).subscribe({
          next: () => {
            this.scheduleSaving = false;
            this.closeEditScheduleDialog();
            this.loadScheduleItems();
            this.refreshFromScheduleChanges();
          },
          error: (err: any) => {
            this.scheduleSaving = false;
            console.error('Failed to create edited schedule', err);
          }
        });
      },
      error: (err: any) => {
        this.scheduleSaving = false;
        console.error('Failed to delete old schedule for edit', err);
      }
    });
  }

  trackScheduleItem(_: number, item: any): number {
    return item.id || _;
  }

  toggleSchedule(s: any): void {
    this.attendance.createSchedule({
      familyBase: s.familyBase,
      type: s.type as AttendanceType,
      dayOfWeek: s.dayOfWeek,
      time: s.time,
      enabled: !s.enabled
    }).subscribe({
      next: () => {
        this.loadScheduleItems();
        this.refreshFromScheduleChanges();
      },
      error: (err: any) => {
        console.error('Failed to toggle schedule', err);
      }
    });
  }

  deleteSchedule(s: any): void {
    if (!s.id) return;
    this.attendance.deleteSchedule(s.id).subscribe({
      next: () => {
        this.loadScheduleItems();
        this.refreshFromScheduleChanges();
      },
      error: (err: any) => {
        console.error('Failed to delete schedule', err);
      }
    });
  }
}
