import { Component, OnDestroy, OnInit, inject, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { AuthService } from '../services/auth.service';
import { AttendanceService } from '../services/attendance.service';
import { Router } from '@angular/router';
import { ConfirmationService, MessageService } from 'primeng/api';
import { FamilyService } from '../services/family.service';
import { HttpClient, HttpParams } from '@angular/common/http';
import { normalizeAssignmentRole, normalizeRole } from '../shared/role-utils';
import { AuthUser } from '../services/auth.service';
import { take } from 'rxjs';
import {
  BoardEvent as EventView,
  BoardParticipantGroup as ParticipantGroup,
  BoardService
} from '../services/board.service';

type FamilyAssignmentView = {
  familyName?: string;
  role?: string | number;
  roleCode?: number;
};

type DashboardUser = AuthUser & {
  fullName?: string;
  phoneNumber?: string;
  universityName?: string;
  faculty?: string;
  dateOfBirth?: string;
  attendKhors?: string | null;
  familyAssignments?: FamilyAssignmentView[];
};

type FamilyCatalogItem = {
  id: number;
  nameAr: string;
  baseName?: string;
};

type FamilyOptionRow = {
  id?: number | string;
  nameAr?: string;
  baseName?: string;
};

type EventForm = {
  id: number | null;
  title: string;
  description: string;
  eventAt: Date | null;
  removeAt: Date | null;
  reminderBeforeValue: number | null;
  imageUrl: string | null;
  targetFamily: string;
  targetAudience: string;
};

type ServiceCardView = {
  label: string;
  value: string;
};

type HeroSlide = {
  imageUrl: string;
  eventId: number;
};

type UnpublishForm = {
  event: EventView | null;
  message: string;
  noticeUntil: Date | null;
};

type ScopeSelectHandle = {
  show?: () => void;
  hide?: () => void;
};

type DatePickerHandle = {
  hide?: () => void;
  hideOverlay?: () => void;
  overlayVisible?: boolean | null;
};

@Component({
  selector: 'app-dash-board',
  standalone: false,
  templateUrl: './dash-board.html',
  styleUrls: ['./dash-board.css'],
  providers: [MessageService, ConfirmationService]
})
export class DashBoard implements OnInit, OnDestroy {
  private authService = inject(AuthService);
  private attendanceService = inject(AttendanceService);
  private familyService = inject(FamilyService);
  private boardService = inject(BoardService);
  private router = inject(Router);
  private messageService = inject(MessageService);
  private confirmationService = inject(ConfirmationService);
  private http = inject(HttpClient);

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {}

  user: DashboardUser = {
    fullName: '',
    username: '',
    phoneNumber: '',
    status: '',
    familyAssignments: [],
    universityName: '',
    faculty: '',
    dateOfBirth: '',
    role: '',
    servingScope: '',
    khors: '',
    khorsYear: null,
    attendKhors: ''
  };
  qrData = '';
  showQrDialog = false;
  readonly churchLogoUrl = 'assets/images/church-logo.png';

  heroSlides: HeroSlide[] = [];
  activeHeroSlide = 0;
  private heroAutoTimer: ReturnType<typeof setInterval> | null = null;
  private heroImageVersion = 0;
  readonly todayMinDate: Date = (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  })();
  readonly todayCalendarMinDate: Date = this.todayMinDate;

  // ===== Roles =====
  private normRole(role: unknown): string {
    return normalizeRole(role) || 'MAKHDOM';
  }

  // ✅ Developer/Admin أعلى من أمين خدمة
  private roleRank: Record<string, number> = {
    MAKHDOM: 0,
    KHADIM: 1,
    AMIN_OSRA: 2,
    AMIN_KHEDMA: 3,
    DEVELOPER: 4,
  };

  private assignedRoles(): string[] {
    return this.assignmentsOf(this.user).map((x) => x.role).filter(Boolean);
  }

  isAtLeast(role: 'MAKHDOM' | 'KHADIM' | 'AMIN_OSRA' | 'AMIN_KHEDMA' | 'DEVELOPER'): boolean {
    const requiredRank = this.roleRank[role] ?? 0;
    const current = this.normRole(this.user?.role);
    const directRank = this.roleRank[current] ?? 0;
    const assignedRank = this.assignedRoles()
      .map((x) => this.roleRank[this.normRole(x)] ?? 0)
      .reduce((max, rank) => Math.max(max, rank), 0);

    return Math.max(directRank, assignedRank) >= requiredRank;
  }

  // ===== UI State =====
  scopeOptions: Array<{ label: string; value: string }> = [];
  scopeFamily: string = 'FAMILY_ALL';
  scopeLocked: boolean = true;
  private scopeSelectHideTimer: ReturnType<typeof setTimeout> | null = null;
  private scopePanelHoverBound = false;

  monthCursor: Date = new Date();
  events: EventView[] = [];

  showEventDialog = false;
  showJoinDialog = false;
  showParticipantsDialog = false;
  showUnpublishDialog = false;

  selectedJoinEvent: EventView | null = null;
  participantsGroups: ParticipantGroup[] = [];
  selectedEventImageFile: File | null = null;
  selectedEventImageName = '';
  isSavingEvent = false;
  publishingEventIds = new Set<number>();
  unpublishingEventIds = new Set<number>();
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  countdownNow = new Date();


  unpublishForm: UnpublishForm = {
    event: null,
    message: '',
    noticeUntil: null
  };

  eventForm: EventForm = {
    id: null,
    title: '',
    description: '',
    eventAt: null,
    removeAt: null,
    reminderBeforeValue: null,
    imageUrl: null,
    targetFamily: 'ALL',
    targetAudience: 'EVERYONE'
  };
  eventTargetScope = 'ALL_USERS';

  get eventDialogTitle(): string {
    return this.eventForm?.id ? 'تعديل الموعد' : 'إضافة موعد';
  }

  stats: {
    FRIDAY_LITURGY: number;
    TASBEEHA: number;
    FAMILY_MEETING: number;
    MARMARKOS_KHORS: number;
    ATHANASIUS_KHORS: number;
  } = {
    FRIDAY_LITURGY: 0,
    TASBEEHA: 0,
    FAMILY_MEETING: 0,
    MARMARKOS_KHORS: 0,
    ATHANASIUS_KHORS: 0
  };

  statsTotal: {
    FRIDAY_LITURGY: number | null;
    TASBEEHA: number | null;
    FAMILY_MEETING: number | null;
    MARMARKOS_KHORS: number | null;
    ATHANASIUS_KHORS: number | null;
  } = {
    FRIDAY_LITURGY: null,
    TASBEEHA: null,
    FAMILY_MEETING: null,
    MARMARKOS_KHORS: null,
    ATHANASIUS_KHORS: null
  };

  private familyMeetingByFamily: Record<string, number> = {};
  private familyMeetingTotalByFamily: Record<string, number> = {};
  familyMeetingCards: Array<{ family: string; present: number; total: number | null }> = [];
  private familyCatalog: FamilyCatalogItem[] = [];


  // ===== Helpers =====
  private pad(n: number) { return n < 10 ? `0${n}` : `${n}`; }

  private errMsg(err: { error?: { message?: string; error?: string }; message?: string } | null | undefined, fallback: string): string {
    return err?.error?.message || err?.error?.error || err?.message || fallback;
  }

  private hasText(value: unknown): boolean {
    return String(value || '').trim().length > 0;
  }

  private toNumOrNull(v: unknown): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  attendanceLabel(present: number, total: number | null): string {
    if (total == null) return `${present ?? 0}`;
    return `${present ?? 0}/${total}`;
  }

  absenceLabel(present: number, total: number | null): string {
    if (total == null) return `${present ?? 0}`;
    const absent = Math.max((total || 0) - (present || 0), 0);
    return `${absent}/${total}`;
  }

  get hasHeroSlides(): boolean {
    return this.heroSlides.length > 0;
  }

  get showHeroControls(): boolean {
    return this.heroSlides.length > 1;
  }

  get currentHeroSlide(): string {
    return this.heroSlides[this.activeHeroSlide]?.imageUrl || '';
  }

  private heroImageUrl(event: EventView): string {
    const rawUrl = String(event?.imageUrl || '').trim();
    if (!rawUrl) return '';

    const versionSource = [
      this.heroImageVersion,
      event.id,
      event.publishedAt || '',
      event.createdAt || '',
      event.eventAt || ''
    ].join('|');
    let version = 0;
    for (let i = 0; i < versionSource.length; i++) {
      version = ((version * 31) + versionSource.charCodeAt(i)) >>> 0;
    }

    return `${rawUrl}${rawUrl.includes('?') ? '&' : '?'}v=${version}`;
  }

  private removeCalendarMinSource = NaN;
  private removeCalendarMinDateValue = new Date(this.todayMinDate);

  get removeCalendarMinDate(): Date {
    const base = this.eventForm?.eventAt ? new Date(this.eventForm.eventAt) : new Date(this.todayMinDate);
    const source = Number.isNaN(base.getTime()) ? this.todayMinDate.getTime() : base.getTime();
    if (source !== this.removeCalendarMinSource) {
      const next = Number.isNaN(base.getTime()) ? new Date(this.todayMinDate) : new Date(base);
      next.setHours(0, 0, 0, 0);
      this.removeCalendarMinSource = source;
      this.removeCalendarMinDateValue = next;
    }
    return this.removeCalendarMinDateValue;
  }

  previousHeroSlide(): void {
    if (!this.showHeroControls) return;
    this.activeHeroSlide =
      (this.activeHeroSlide - 1 + this.heroSlides.length) % this.heroSlides.length;
  }

  nextHeroSlide(): void {
    if (!this.showHeroControls) return;
    this.activeHeroSlide = (this.activeHeroSlide + 1) % this.heroSlides.length;
  }

  setHeroSlide(index: number): void {
    if (index < 0 || index >= this.heroSlides.length) return;
    this.activeHeroSlide = index;
    this.restartHeroAutoSlide();
  }

  private rebuildHeroSlides(): void {
    this.heroImageVersion++;
    const seenIds = new Set<number>();
    this.heroSlides = (this.events || []).reduce<HeroSlide[]>((slides, event) => {
      const eventId = Number(event?.id || 0);
      const imageUrl = this.heroImageUrl(event);
      if (!eventId || !imageUrl || seenIds.has(eventId)) return slides;

      seenIds.add(eventId);
      slides.push({ imageUrl, eventId });
      return slides;
    }, []);

    if (this.activeHeroSlide >= this.heroSlides.length) {
      this.activeHeroSlide = 0;
    }
    this.restartHeroAutoSlide();
  }

  private restartHeroAutoSlide(): void {
    this.stopHeroAutoSlide();
    if (!isPlatformBrowser(this.platformId) || this.heroSlides.length <= 1) return;
    this.heroAutoTimer = setInterval(() => this.nextHeroSlide(), 3000);
  }

  private stopHeroAutoSlide(): void {
    if (this.heroAutoTimer) {
      clearInterval(this.heroAutoTimer);
      this.heroAutoTimer = null;
    }
  }

  pauseHeroAutoSlide(): void {
    this.stopHeroAutoSlide();
  }

  resumeHeroAutoSlide(): void {
    this.restartHeroAutoSlide();
  }


  private startCountdownTimer(): void {
    if (!isPlatformBrowser(this.platformId) || this.countdownTimer) return;
    this.countdownTimer = setInterval(() => {
      this.countdownNow = new Date();
      this.pruneExpiredEvents();
    }, 60000);
  }

  private stopCountdownTimer(): void {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  openHeroEvent(): void {
    const slide = this.heroSlides[this.activeHeroSlide];
    if (!slide?.eventId) return;

    const event = this.events.find((e) => Number(e.id) === slide.eventId);
    if (!event) return;

    if (isPlatformBrowser(this.platformId)) {
      document.getElementById(`event-${slide.eventId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    setTimeout(() => this.openEventDetails(event), 320);
  }

  private rebuildFamilyMeetingCards(): void {
    const fams = this.userFamilies();
    this.familyMeetingCards = fams.map((f) => {
      const base = this.mainFamily(f);
      const present = this.familyMeetingByFamily[base] ?? this.familyMeetingByFamily[f] ?? (fams.length === 1 ? (this.stats.FAMILY_MEETING || 0) : 0);
      const totalByFamily = this.toNumOrNull(this.familyMeetingTotalByFamily[base] ?? this.familyMeetingTotalByFamily[f]);
      const total = totalByFamily ?? (fams.length === 1 ? this.statsTotal.FAMILY_MEETING : null);
      return { family: f, present, total };
    });
  }

  private toLocalDateTimePayload(d: string | number | Date | null | undefined): string | null {
    if (!d) return null;
    const dt = (d instanceof Date) ? d : new Date(d);
    if (isNaN(dt.getTime())) return null;

    const yyyy = dt.getFullYear();
    const mm = this.pad(dt.getMonth() + 1);
    const dd = this.pad(dt.getDate());
    const hh = this.pad(dt.getHours());
    const min = this.pad(dt.getMinutes());
    return `${yyyy}-${mm}-${dd}T${hh}:${min}:00`;
  }

  fixDatePickerOverlay(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    setTimeout(() => {
      const panels = document.querySelectorAll<HTMLElement>('.dashboardDatePanel');

      panels.forEach((panel) => {
        panel.style.zIndex = '15000';
        panel.style.pointerEvents = 'auto';
      });
    }, 0);
  }

  private closeDatePicker(picker?: DatePickerHandle | null): void {
    setTimeout(() => {
      picker?.hideOverlay?.();
      picker?.hide?.();
    }, 0);
  }

  onPickerActionClick(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
  }

  onPickerActionPress(
    event: Event,
    action: 'confirm' | 'clear' | 'confirmNotice' | 'clearNotice',
    field: 'eventAt' | 'removeAt' | null,
    picker?: DatePickerHandle | null
  ): void {
    event.preventDefault();
    event.stopPropagation();

    if (action === 'confirm' && field) {
      this.closeDatePicker(picker);
      return;
    }

    if (action === 'clear' && field) {
      this.clearEventDate(field, picker);
      return;
    }

    if (action === 'confirmNotice') {
      this.closeDatePicker(picker);
      return;
    }

    this.clearUnpublishNoticeDate(picker);
  }

  setEventDateNow(field: 'eventAt' | 'removeAt', picker?: DatePickerHandle | null): void {
    const now = new Date();

    if (field === 'eventAt') {
      this.eventForm = { ...this.eventForm, eventAt: now };
      this.closeDatePicker(picker);
      return;
    }

    const minRemoveAt = this.removeCalendarMinDate;
    const removeAt = now <= minRemoveAt ? new Date(minRemoveAt.getTime() + 60 * 60 * 1000) : now;
    this.eventForm = { ...this.eventForm, removeAt };
    this.closeDatePicker(picker);
  }

  clearEventDate(field: 'eventAt' | 'removeAt', picker?: DatePickerHandle | null): void {
    this.eventForm = { ...this.eventForm, [field]: null };
    this.closeDatePicker(picker);
  }

  setUnpublishNoticeNow(picker?: DatePickerHandle | null): void {
    const minUntil = new Date();
    minUntil.setHours(minUntil.getHours() + 1, 0, 0, 0);
    this.unpublishForm = { ...this.unpublishForm, noticeUntil: minUntil };
    this.closeDatePicker(picker);
  }

  clearUnpublishNoticeDate(picker?: DatePickerHandle | null): void {
    this.unpublishForm = { ...this.unpublishForm, noticeUntil: null };
    this.closeDatePicker(picker);
  }

  private monthParam(d: Date): string {
    const yyyy = d.getFullYear();
    const mm = this.pad(d.getMonth() + 1);
    return `${yyyy}-${mm}`;
  }

  private mainFamily(family: string): string {
    const f = String(family || '').trim();
    if (f.endsWith(' أ')) return f.slice(0, -2).trim();
    if (f.endsWith(' ب')) return f.slice(0, -2).trim();
    return f;
  }

  private assignmentsOf(entity: { familyAssignments?: FamilyAssignmentView[]; role?: string | number } | null | undefined): Array<{ familyName: string; role: string }> {
    const assignments = Array.isArray(entity?.familyAssignments) ? entity.familyAssignments : [];
    return assignments
      .map((x) => ({
        familyName: String(x?.familyName || '').trim(),
        role: normalizeAssignmentRole(x, entity?.role)
      }))
      .filter((x) => !!x.familyName);
  }

  private loadFamilyCatalog(): void {
    this.http.get<FamilyOptionRow[]>('/api/auth/family-options?audience=SERVANT', { withCredentials: true }).subscribe({
      next: (rows) => {
        this.familyCatalog = (rows || []).map((x) => ({
          id: Number(x?.id || 0),
          nameAr: String(x?.nameAr || '').trim(),
          baseName: String(x?.baseName || '').trim() || undefined
        })).filter((x) => !!x.id && !!x.nameAr);
        this.loadScopeOptions();
      },
      error: () => {
        this.familyCatalog = [];
        this.loadScopeOptions();
      }
    });
  }

  private familyIdForTarget(targetFamily: unknown): number | null {
    const raw = String(targetFamily || '').trim();
    if (!raw || raw.toUpperCase() === 'ALL') return null;
    const base = this.mainFamily(raw);
    const match = this.familyCatalog.find((x) => String(x.baseName || x.nameAr).trim() === base || x.nameAr === raw);
    return match?.id ?? null;
  }


  get showScopeSelector(): boolean {
    return this.isAtLeast('AMIN_KHEDMA');
  }

  get showTargetPreview(): boolean {
    return this.isAtLeast('AMIN_KHEDMA');
  }

  canUnpublishEvent(e: EventView | null | undefined): boolean {
    return String(e?.status || '').toUpperCase() === 'PUBLISHED'
      && !!(e?.canUnpublish || e?.canEdit || e?.canDelete);
  }

  canSeeEventParticipants(e: EventView | null | undefined): boolean {
    return !!e?.id && !!e?.canSeeParticipants;
  }

  isHotEvent(e: EventView | null | undefined): boolean {
    return !!e?.reminderActive || !!e?.cancelNoticeActive || String(e?.status || '').toUpperCase() === 'CANCELLED';
  }

  isCancelledEvent(e: EventView | null | undefined): boolean {
    return String(e?.status || '').toUpperCase() === 'CANCELLED';
  }

  isPendingEvent(e: EventView | null | undefined): boolean {
    return String(e?.status || '').toUpperCase() === 'PENDING';
  }

  showEventStatusBadge(e: EventView | null | undefined): boolean {
    return !!(e?.canPublish || e?.canUnpublish || e?.canEdit || e?.canDelete);
  }

  isPublishingEvent(e: EventView | null | undefined): boolean {
    return !!e?.id && this.publishingEventIds.has(Number(e.id));
  }

  isUnpublishingEvent(e: EventView | null | undefined): boolean {
    return !!e?.id && this.unpublishingEventIds.has(Number(e.id));
  }

  statusLabel(e: EventView | null | undefined): string {
    const status = String(e?.status || '').toUpperCase();
    if (status === 'CANCELLED') return 'ملغي';
    if (status === 'PUBLISHED') return 'منشور';
    return 'غير منشور';
  }

  reminderLabel(e: EventView | null | undefined): string {
    const minutes = Number(e?.reminderBeforeMinutes || 0);
    if (!minutes) return '';
    const days = Math.max(1, Math.ceil(minutes / 1440));
    return days === 1 ? 'تذكير قبل يوم' : `تذكير قبل ${days} يوم`;
  }

  countdownLabel(e: EventView | null | undefined): string {
    if (!e?.eventAt) return '';
    const target = new Date(e.eventAt);
    if (Number.isNaN(target.getTime())) return '';

    const diffMs = target.getTime() - this.countdownNow.getTime();
    if (diffMs <= 0) return 'وقت الموعد بدأ';

    const totalMinutes = Math.max(1, Math.ceil(diffMs / 60000));
    const days = Math.floor(totalMinutes / 1440);
    const remainingAfterDays = totalMinutes % 1440;
    const hours = Math.floor(remainingAfterDays / 60);
    const minutes = remainingAfterDays % 60;

    const parts: string[] = [];
    if (days > 0) parts.push(`${days} يوم`);
    if (hours > 0) parts.push(`${hours} ساعة`);
    if (minutes > 0 && days === 0) parts.push(`${minutes} دقيقة`);

    return parts.length ? `باقي على الموعد: ${parts.join(' و ')}` : 'باقي أقل من دقيقة';
  }


  private currentBaseFamily(): string {
    const fam = this.mainFamily(this.assignmentsOf(this.user)[0]?.familyName || '');
    return fam && fam.toUpperCase() !== 'SYSTEM' ? fam : '';
  }

  private currentScopeConfig(scopeValue?: string): { targetFamily: string; targetAudience: string; requestFamily?: string; requestAudience?: string } {
    const scope = String(scopeValue || this.scopeFamily || '').trim();
    const myFamily = this.currentBaseFamily();

    if (this.isAtLeast('AMIN_KHEDMA')) {
      if (scope === 'ALL_SERVANTS') {
        return {
          targetFamily: 'ALL',
          targetAudience: 'SERVANTS_ONLY',
          requestFamily: 'ALL',
          requestAudience: 'SERVANTS_ONLY'
        };
      }

      if (scope === 'FAMILY_MEMBERS') {
        return {
          targetFamily: 'ALL',
          targetAudience: 'EVERYONE',
          requestFamily: 'ALL',
          requestAudience: 'EVERYONE'
        };
      }

      if (scope.startsWith('FAMILY::')) {
        const fam = scope.substring('FAMILY::'.length).trim();
        return {
          targetFamily: fam || 'ALL',
          targetAudience: 'EVERYONE',
          requestFamily: fam || undefined,
          requestAudience: undefined
        };
      }

      return {
        targetFamily: 'ALL',
        targetAudience: 'EVERYONE',
        requestFamily: undefined,
        requestAudience: undefined
      };
    }

    if (this.isAtLeast('AMIN_OSRA')) {
      if (scope === 'FAMILY_SERVANTS') {
        return {
          targetFamily: myFamily || 'ALL',
          targetAudience: 'SERVANTS_ONLY',
          requestFamily: myFamily || 'ALL',
          requestAudience: 'SERVANTS_ONLY'
        };
      }

      if (scope === 'FAMILY_MEMBERS') {
        return {
          targetFamily: myFamily || 'ALL',
          targetAudience: 'EVERYONE',
          requestFamily: myFamily || 'ALL',
          requestAudience: 'EVERYONE'
        };
      }

      return {
        targetFamily: myFamily || 'ALL',
        targetAudience: 'EVERYONE',
        requestFamily: myFamily || 'ALL',
        requestAudience: undefined
      };
    }

    return {
      targetFamily: myFamily || 'ALL',
      targetAudience: 'EVERYONE',
      requestFamily: myFamily || 'ALL'
    };
  }

  private syncFormsWithScope(): void {
    const cfg = this.currentScopeConfig();
    this.eventTargetScope = this.scopeFamily;

    this.eventForm = {
      ...this.eventForm,
      targetFamily: cfg.targetFamily,
      targetAudience: cfg.targetAudience
    };
  }

  private scopeValueFromTarget(targetFamily: unknown, targetAudience: unknown): string {
    const family = String(targetFamily || '').trim();
    const audience = String(targetAudience || 'EVERYONE').trim().toUpperCase();

    if (this.isAtLeast('AMIN_KHEDMA')) {
      if (audience === 'SERVANTS_ONLY') return 'ALL_SERVANTS';
      if (!family || family.toUpperCase() === 'ALL') return 'ALL_USERS';
      return `FAMILY::${family}`;
    }

    if (audience === 'SERVANTS_ONLY') return 'FAMILY_SERVANTS';
    if (!family || family.toUpperCase() === 'ALL') return 'FAMILY_ALL';
    return 'FAMILY_MEMBERS';
  }

  private applyTargetScope(): void {
    const cfg = this.currentScopeConfig(this.eventTargetScope);
    this.eventForm = {
      ...this.eventForm,
      targetFamily: cfg.targetFamily,
      targetAudience: cfg.targetAudience
    };
  }

  onEventTargetScopeChange(): void {
    this.applyTargetScope();
  }

  private ensureScopeValue(): void {
    if (!this.scopeOptions.some(x => x.value === this.scopeFamily)) {
      this.scopeFamily = this.scopeOptions[0]?.value || 'FAMILY_ALL';
    }
    this.syncFormsWithScope();
  }

  private loadScopeOptions(): void {
    if (this.isAtLeast('AMIN_KHEDMA')) {
      const seenFamilies = new Set<string>();
      const familyOptions = this.familyCatalog
        .map((family) => {
          const label = String(family.baseName || family.nameAr || '').trim();
          return label ? { label, value: `FAMILY::${label}` } : null;
        })
        .filter((option): option is { label: string; value: string } => {
          if (!option || seenFamilies.has(option.label)) return false;
          seenFamilies.add(option.label);
          return true;
        });

      this.scopeOptions = [
        { label: 'كل الأسر', value: 'ALL_USERS' },
        { label: 'الخدام', value: 'ALL_SERVANTS' },
        ...familyOptions
      ];
      this.ensureScopeValue();
      return;
    }

    if (this.isAtLeast('AMIN_OSRA')) {
      this.scopeOptions = [
        { label: 'كل الاسر', value: 'FAMILY_ALL' },
        { label: 'الخدام', value: 'FAMILY_SERVANTS' },
        { label: 'المخدومين', value: 'FAMILY_MEMBERS' }
      ];
      this.ensureScopeValue();
      return;
    }

    this.scopeOptions = [];
    this.syncFormsWithScope();
  }

  targetLabel(item: { targetFamily?: string; targetAudience?: string } | null | undefined): string {
    return this.targetLabelFromData(item?.targetFamily, item?.targetAudience);
  }

  targetLabelFromData(targetFamily: unknown, targetAudience: unknown): string {
    const family = String(targetFamily || '').trim();
    const audience = String(targetAudience || 'EVERYONE').trim().toUpperCase();

    if (audience === 'SERVANTS_ONLY') {
      return family === 'ALL' ? 'كل الخدام' : `خدام ${family}`;
    }

    return family === 'ALL' ? 'كل الأسر' : family;
  }

  private isChoirBucket(f: string): boolean {
    const x = String(f || '').trim();
    return x === 'خورس مارمرقس' || x === 'خورس البابا اثناسيوس';
  }

  private userFamilies(): string[] {
    const raw = this.assignmentsOf(this.user)
      .map((x) => String(x.familyName || '').trim())
      .filter((x: string) => !!x && x.toUpperCase() !== 'SYSTEM' && !this.isChoirBucket(x));

    const out: string[] = [];
    for (const f of raw) {
      if (!out.includes(f)) out.push(f);
    }
    return out;
  }

  get hasRealFamily(): boolean {
    return this.userFamilies().length > 0;
  }

  get showFamilyMeetingCard(): boolean {
    // ✅ لو خادم في الخورس فقط (وملوش أسرة) ما نظهرش كارت اجتماع الأسرة
    return this.userFamilies().length > 0;
  }

  private arKhorsName(khors: unknown): string {
    const k = String(khors || '').trim().toUpperCase();
    if (k === 'MARMARKOS') return 'خورس مارمرقس';
    if (k === 'ATHANASIUS') return 'خورس البابا اثناسيوس';
    return '';
  }

  private arYearLabel(year?: string | number | null): string {
    const y = Number(year || 0);
    if (!y) return '';
    if (y === 1) return 'سنه اوله';
    if (y === 2) return 'سنه تانيه';
    if (y === 3) return 'سنه تالته';
    if (y === 4) return 'سنه رابعه';
    if (y === 5) return 'سنه خامسه';
    return `سنه ${y}`;
  }

  private servedKhorsLabel(): string {
    const k = String(this.user?.khors || '').trim().toUpperCase();
    const base = this.arKhorsName(k);
    if (!base) return '';
    if (k === 'ATHANASIUS') return base;
    const year = this.arYearLabel(this.user?.khorsYear);
    return year ? `${base} (${year})` : base;
  }

  private attendKhorsLabel(): string {
    const k = String(this.user?.attendKhors || '').trim().toUpperCase();
    return this.arKhorsName(k) || '';
  }

  get currentFamilyLabel(): string {
    const families = this.userFamilies();
    const served = this.servedKhorsLabel();
    const attend = this.attendKhorsLabel();

    const labels: string[] = [];
    labels.push(...families);
    if (served) labels.push(served);
    if (attend && !labels.some(x => x.includes(attend))) labels.push(attend);
    return labels.join(' + ');
  }

  get primaryFamilyLabel(): string {
    return this.userFamilies()[0] || 'الأسرة';
  }

  get serviceCards(): ServiceCardView[] {
    const cards: ServiceCardView[] = [];

    if (this.showFamilyMeetingCard) {
      const familyCards = this.familyMeetingCards.length
        ? this.familyMeetingCards
        : [{
            family: this.primaryFamilyLabel,
            present: this.stats.FAMILY_MEETING,
            total: this.statsTotal.FAMILY_MEETING
          }];

      for (const family of familyCards) {
        cards.push({
          label: family.family,
          value: this.absenceLabel(family.present, family.total)
        });
      }
    }

    cards.push(
      {
        label: 'قداس',
        value: this.absenceLabel(this.stats.FRIDAY_LITURGY, this.statsTotal.FRIDAY_LITURGY)
      },
      {
        label: 'تسبحة',
        value: this.absenceLabel(this.stats.TASBEEHA, this.statsTotal.TASBEEHA)
      }
    );

    for (const khors of this.khorsCards) {
      cards.push({
        label: khors.label,
        value: this.absenceLabel(khors.count, khors.total)
      });
    }

    return cards;
  }

  get khorsCards(): Array<{ code: 'MARMARKOS' | 'ATHANASIUS'; label: string; count: number; total: number | null }> {
    const out: Array<{ code: 'MARMARKOS' | 'ATHANASIUS'; label: string; count: number; total: number | null }> = [];
    const year = this.arYearLabel(this.user?.khorsYear);

    const servedK = String(this.user?.khors || '').trim().toUpperCase();
    const attendK = String(this.user?.attendKhors || '').trim().toUpperCase();

    const add = (code: 'MARMARKOS' | 'ATHANASIUS', withYear: boolean) => {
      const name = this.arKhorsName(code);
      const label = withYear && year && code !== 'ATHANASIUS' ? `${name} (${year})` : name;
      const count = code === 'MARMARKOS' ? (this.stats.MARMARKOS_KHORS || 0) : (this.stats.ATHANASIUS_KHORS || 0);
      const total = code === 'MARMARKOS' ? this.statsTotal.MARMARKOS_KHORS : this.statsTotal.ATHANASIUS_KHORS;
      if (!out.some(x => x.code === code)) out.push({ code, label, count, total });
    };

    if (servedK === 'MARMARKOS') add('MARMARKOS', true);
    if (servedK === 'ATHANASIUS') add('ATHANASIUS', true);
    if (servedK === 'BOTH') { add('MARMARKOS', true); add('ATHANASIUS', true); }

    if (attendK === 'MARMARKOS') add('MARMARKOS', false);
    if (attendK === 'ATHANASIUS') add('ATHANASIUS', false);

    return out;
  }

  get showAnyKhorsCards(): boolean {
    return this.khorsCards.length > 0;
  }

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.startCountdownTimer();
    this.loadUserData();
    this.loadMyStats();
  }

  ngOnDestroy(): void {
    this.stopHeroAutoSlide();
    this.stopCountdownTimer();
  }

  loadUserData(): void {
    this.authService.getUserData().pipe(take(1)).subscribe({
      next: (data) => {
        if (!data) {
          this.router.navigate(['/login']);
          return;
        }
        this.user = data;

        this.scopeLocked = !this.showScopeSelector;

        if (this.isAtLeast('AMIN_KHEDMA')) {
          this.scopeFamily = 'ALL_USERS';
        } else if (this.isAtLeast('AMIN_OSRA')) {
          this.scopeFamily = 'FAMILY_ALL';
        } else {
          this.scopeFamily = 'FAMILY_MEMBERS';
        }

        if (this.isAtLeast('AMIN_KHEDMA')) {
          this.loadFamilyCatalog();
        } else {
          this.loadScopeOptions();
        }
        this.syncFormsWithScope();
        this.rebuildFamilyMeetingCards();
        this.loadMonthBoards();
      },
      error: () => this.router.navigate(['/login'])
    });
  }

  private loadMyQrToken(): void {
    this.authService.getMyQrToken().subscribe({
      next: (res) => {
        this.qrData = res?.token || '';
      },
      error: () => {
        this.qrData = '';
      }
    });
  }

  loadMyStats(): void {
    this.attendanceService.getMyStats().subscribe({
      next: (data) => {
        this.stats = {
          ...this.stats,
          FRIDAY_LITURGY: data?.FRIDAY_LITURGY ?? 0,
          TASBEEHA: data?.TASBEEHA ?? 0,
          FAMILY_MEETING: data?.FAMILY_MEETING ?? 0,
          MARMARKOS_KHORS: data?.MARMARKOS_KHORS ?? 0,
          ATHANASIUS_KHORS: data?.ATHANASIUS_KHORS ?? 0
        };

        this.statsTotal = {
          FRIDAY_LITURGY: this.toNumOrNull(data?.FRIDAY_LITURGY_TOTAL),
          TASBEEHA: this.toNumOrNull(data?.TASBEEHA_TOTAL),
          FAMILY_MEETING: this.toNumOrNull(data?.FAMILY_MEETING_TOTAL),
          MARMARKOS_KHORS: this.toNumOrNull(data?.MARMARKOS_KHORS_TOTAL),
          ATHANASIUS_KHORS: this.toNumOrNull(data?.ATHANASIUS_KHORS_TOTAL)
        };

        this.familyMeetingByFamily = data?.FAMILY_MEETING_BY_FAMILY || {};
        this.familyMeetingTotalByFamily = data?.FAMILY_MEETING_TOTAL_BY_FAMILY || {};
        this.rebuildFamilyMeetingCards();
      },
      error: () => {}
    });
  }

  openQrDialog(): void {
    if (!this.qrData) {
      this.loadMyQrToken();
    }
    this.showQrDialog = true;
  }

  downloadQrCard(): void {
    if (!isPlatformBrowser(this.platformId) || !this.qrData) return;

    const sourceCanvas = document.querySelector<HTMLCanvasElement>('#qrDownloadCard qrcode canvas');
    if (!sourceCanvas) {
      this.messageService.add({ severity: 'warn', summary: 'تنبيه', detail: 'رمز QR لم يجهز بعد.' });
      return;
    }

    const scale = 2;
    const width = 420;
    const height = 560;
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.scale(scale, scale);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    const drawCard = (logo?: HTMLImageElement) => {
      ctx.strokeStyle = '#8d5144';
      ctx.lineWidth = 4;
      ctx.strokeRect(18, 18, width - 36, height - 36);

      ctx.strokeStyle = '#fbf4ef';
      ctx.lineWidth = 10;
      ctx.strokeRect(26, 26, width - 52, height - 52);

      ctx.fillStyle = '#8d5144';
      ctx.fillRect(70, 36, 110, 4);
      ctx.fillRect(width - 180, 36, 110, 4);
      ctx.fillRect(70, height - 40, width - 140, 4);

      ctx.fillStyle = '#8d5144';
      ctx.textAlign = 'center';
      ctx.direction = 'rtl';

      if (logo) {
        const logoSize = 72;
        ctx.drawImage(logo, (width - logoSize) / 2, 24, logoSize, logoSize);
      }

      ctx.font = '700 24px Arial, sans-serif';
      ctx.fillText(String(this.user.fullName || this.user.username || 'مستخدم'), width / 2, 128);

      ctx.font = '600 18px Arial, sans-serif';
      const familyLines = this.wrapCanvasText(ctx, this.currentFamilyLabel || 'أسرة الشمامسة', 340, 3);
      familyLines.forEach((line, index) => ctx.fillText(line, width / 2, 162 + (index * 26)));

      ctx.drawImage(sourceCanvas, 100, 245, 220, 220);

      ctx.font = '700 18px Arial, sans-serif';
      ctx.fillText('أسرة الشمامسة', width / 2, 510);

      const link = document.createElement('a');
      const safeName = String(this.user.fullName || this.user.username || 'qr').trim().replace(/[\\/:*?"<>|]+/g, '-');
      link.href = canvas.toDataURL('image/png');
      link.download = `${safeName || 'qr'}-qr.png`;
      link.click();
    };

    const logo = new Image();
    logo.onload = () => drawCard(logo);
    logo.onerror = () => drawCard();
    logo.src = this.churchLogoUrl;
  }

  private wrapCanvasText(
    ctx: CanvasRenderingContext2D,
    text: string,
    maxWidth: number,
    maxLines = 3
  ): string[] {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = '';

    for (const word of words) {
      const testLine = line ? `${line} ${word}` : word;
      if (ctx.measureText(testLine).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = testLine;
      }
    }
    if (line) lines.push(line);

    return lines.slice(0, maxLines);
  }


  private sortEvents(rows: EventView[]): EventView[] {
    const priority = (e: EventView): number => {
      if (e?.cancelNoticeActive || String(e?.status || '').toUpperCase() === 'CANCELLED') return 0;
      if (e?.reminderActive) return 1;
      if (String(e?.status || '').toUpperCase() === 'PUBLISHED') return 2;
      return 3;
    };

    const time = (e: EventView): number => {
      const d = e?.eventAt ? new Date(e.eventAt) : null;
      return d && !Number.isNaN(d.getTime()) ? d.getTime() : Number.MAX_SAFE_INTEGER;
    };

    return [...(rows || [])].sort((a, b) => {
      const byPriority = priority(a) - priority(b);
      if (byPriority !== 0) return byPriority;
      return time(a) - time(b);
    });
  }

  private eventDateValue(value: string | Date | null | undefined): number | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.getTime();
  }

  private isExpiredEvent(e: EventView | null | undefined, now = Date.now()): boolean {
    const removeAt = this.eventDateValue(e?.removeAt);
    if (removeAt != null && removeAt <= now) return true;

    const cancelNoticeUntil = this.eventDateValue(e?.cancelNoticeUntil);
    return cancelNoticeUntil != null && cancelNoticeUntil <= now;
  }

  private visibleEvents(rows: EventView[]): EventView[] {
    const now = Date.now();
    return (rows || []).filter((event) => !this.isExpiredEvent(event, now));
  }

  private pruneExpiredEvents(): void {
    if (!this.events?.length) return;
    const nextEvents = this.visibleEvents(this.events);
    if (nextEvents.length === this.events.length) return;
    this.events = nextEvents;
    this.rebuildHeroSlides();
  }


  private loadMonthBoards(): void {
    const month = this.monthParam(this.monthCursor);
    const scope = this.currentScopeConfig();

    this.boardService.listEvents(month, scope.requestFamily, scope.requestAudience).subscribe({
      next: (rows) => {
        this.events = this.sortEvents(this.visibleEvents(rows || []));
        this.rebuildHeroSlides();
      },
      error: (err) => {
        this.events = [];
        this.rebuildHeroSlides();
        this.messageService.add({ severity: 'error', summary: 'خطأ', detail: this.errMsg(err, 'حصل خطأ أثناء تحميل جدول الشهر.') });
      }
    });
  }

  private markEventPublishedInView(id: number): void {
    this.events = this.events.map((event) => {
      if (Number(event?.id) !== id) return event;
      return {
        ...event,
        status: 'PUBLISHED',
        canPublish: false,
        canUnpublish: true,
        publishedAt: new Date().toISOString(),
        cancelMessage: null,
        cancelNoticeUntil: null,
        cancelledAt: null,
        cancelNoticeActive: false
      };
    });
    this.rebuildHeroSlides();
  }

  private verifyPublishedAfterError(id: number, err: unknown): void {
    const month = this.monthParam(this.monthCursor);
    const scope = this.currentScopeConfig();

    this.boardService.listEvents(month, scope.requestFamily, scope.requestAudience).subscribe({
      next: (rows) => {
        const nextEvents = this.sortEvents(this.visibleEvents(rows || []));
        this.events = nextEvents;
        this.rebuildHeroSlides();

        const published = nextEvents.some((event) =>
          Number(event?.id) === id && String(event?.status || '').toUpperCase() === 'PUBLISHED'
        );

        if (published) {
          this.messageService.add({ severity: 'success', summary: 'تم', detail: 'تم نشر الموعد.' });
          return;
        }

        this.messageService.add({ severity: 'error', summary: 'خطأ', detail: this.errMsg(err as any, 'فشل نشر الموعد.') });
      },
      error: () => {
        this.messageService.add({ severity: 'error', summary: 'خطأ', detail: this.errMsg(err as any, 'فشل نشر الموعد.') });
      }
    });
  }

  onScopeChange(): void {
    this.syncFormsWithScope();
    this.loadMonthBoards();
  }

  openScopeSelect(select: ScopeSelectHandle | null | undefined): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.cancelScopeSelectHide();
    select?.show?.();

    setTimeout(() => {
      const panel = document.querySelector('.scope-select-panel');
      if (!panel || this.scopePanelHoverBound) return;
      this.scopePanelHoverBound = true;
      panel.addEventListener('mouseenter', () => this.cancelScopeSelectHide());
      panel.addEventListener('mouseleave', () => this.scheduleScopeSelectHide(select));
    }, 0);
  }

  scheduleScopeSelectHide(select: ScopeSelectHandle | null | undefined): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.cancelScopeSelectHide();
    this.scopeSelectHideTimer = setTimeout(() => {
      select?.hide?.();
      this.scopePanelHoverBound = false;
    }, 140);
  }

  private cancelScopeSelectHide(): void {
    if (this.scopeSelectHideTimer) {
      clearTimeout(this.scopeSelectHideTimer);
      this.scopeSelectHideTimer = null;
    }
  }

  onMonthChange(offset: number): void {
    const next = new Date(this.monthCursor);
    next.setMonth(next.getMonth() + Number(offset || 0));
    this.monthCursor = next;
    this.loadMonthBoards();
  }

  openCreateEvent(): void {
    const cfg = this.currentScopeConfig();
    this.eventTargetScope = this.scopeFamily;
    this.eventForm = {
      id: null,
      title: '',
      description: '',
      eventAt: null,
      removeAt: null,
      reminderBeforeValue: null,
      imageUrl: null,
      targetFamily: cfg.targetFamily,
      targetAudience: cfg.targetAudience
    };
    this.selectedEventImageFile = null;
    this.selectedEventImageName = '';
    this.showEventDialog = true;
  }

  openEditEvent(e: EventView): void {
    const cfg = this.currentScopeConfig();
    this.eventTargetScope = this.scopeValueFromTarget(e?.targetFamily || cfg.targetFamily, e?.targetAudience || cfg.targetAudience);
    this.eventForm = {
      id: e?.id ?? null,
      title: e?.title || '',
      description: e?.description || '',
      eventAt: e?.eventAt ? new Date(e.eventAt) : null,
      removeAt: e?.removeAt ? new Date(e.removeAt) : null,
      reminderBeforeValue: this.reminderValueFromMinutes(e?.reminderBeforeMinutes || null).value,
      imageUrl: e?.imageUrl || null,
      targetFamily: e?.targetFamily || cfg.targetFamily,
      targetAudience: e?.targetAudience || cfg.targetAudience
    };
    this.selectedEventImageFile = null;
    this.selectedEventImageName = '';
    this.showEventDialog = true;
  }

  private reminderValueFromMinutes(minutes: number | null): { value: number | null } {
    const n = Number(minutes || 0);
    if (!n) return { value: null };
    return { value: Math.max(1, Math.ceil(n / 1440)) };
  }

  private reminderMinutesFromForm(): number | null {
    const raw = Number(this.eventForm?.reminderBeforeValue || 0);
    if (!Number.isFinite(raw) || raw <= 0) return null;
    return Math.floor(raw) * 1440;
  }

  onEventImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0] || null;
    if (!file) {
      this.selectedEventImageFile = null;
      this.selectedEventImageName = '';
      return;
    }

    if (!String(file.type || '').startsWith('image/')) {
      this.messageService.add({ severity: 'warn', summary: 'تنبيه', detail: 'اختار صورة فقط.' });
      input!.value = '';
      return;
    }

    this.selectedEventImageFile = file;
    this.selectedEventImageName = file.name;
  }

  clearSelectedEventImage(input?: HTMLInputElement | null): void {
    this.selectedEventImageFile = null;
    this.selectedEventImageName = '';
    if (input) input.value = '';
  }

  private uploadEventImageInBackground(eventId: number, file: File): void {
    this.boardService.uploadEventImage(eventId, file).subscribe({
      next: () => this.loadMonthBoards(),
      error: (err) => {
        this.messageService.add({ severity: 'error', summary: 'خطأ', detail: this.errMsg(err, 'تم حفظ الموعد لكن فشل رفع الصورة.') });
      }
    });
  }

  saveEvent(): void {
    this.applyTargetScope();
    const cfg = this.currentScopeConfig();
    const payload = {
      title: String(this.eventForm?.title || '').trim(),
      description: this.eventForm?.description || null,
      eventAt: this.toLocalDateTimePayload(this.eventForm?.eventAt),
      removeAt: this.eventForm?.removeAt ? this.toLocalDateTimePayload(this.eventForm?.removeAt) : null,
      reminderBeforeMinutes: this.reminderMinutesFromForm(),
      targetFamily: String(this.eventForm?.targetFamily || cfg.targetFamily || 'ALL').trim(),
      targetFamilyId: this.familyIdForTarget(this.eventForm?.targetFamily || cfg.targetFamily || 'ALL'),
      targetAudience: String(this.eventForm?.targetAudience || cfg.targetAudience || 'EVERYONE').trim()
    };

    if (!payload.title && !this.hasText(payload.description)) {
      this.messageService.add({ severity: 'warn', summary: 'بيانات ناقصة', detail: 'اكتب عنوان أو وصف للموعد قبل الحفظ.' });
      return;
    }
    if (!payload.title) {
      this.messageService.add({ severity: 'warn', summary: 'بيانات ناقصة', detail: 'اكتب عنوان الموعد.' });
      return;
    }
    if (!payload.eventAt) {
      this.messageService.add({ severity: 'warn', summary: 'بيانات ناقصة', detail: 'اختار تاريخ الموعد.' });
      return;
    }
    if (!payload.removeAt) {
      this.messageService.add({ severity: 'warn', summary: 'بيانات ناقصة', detail: 'اختار وقت الإزالة.' });
      return;
    }
    const eventDate = this.eventForm?.eventAt ? new Date(this.eventForm.eventAt) : null;
    if (eventDate && eventDate < new Date()) {
      this.messageService.add({ severity: 'warn', summary: 'تاريخ غير صحيح', detail: 'لا يمكن اختيار وقت فات.' });
      return;
    }
    const removeDate = this.eventForm?.removeAt ? new Date(this.eventForm.removeAt) : null;
    if (eventDate && removeDate && removeDate <= eventDate) {
      this.messageService.add({ severity: 'warn', summary: 'تاريخ غير صحيح', detail: 'وقت الإزالة لازم يكون بعد وقت المناسبة.' });
      return;
    }

    if (this.isSavingEvent) return;
    this.isSavingEvent = true;

    const id = this.eventForm?.id;
    const req$ = id
      ? this.boardService.updateEvent(id, payload)
      : this.boardService.createEvent(payload);

    req$.subscribe({
      next: (res: unknown) => {
        const savedId = id || Number((res as { id?: number })?.id || 0);
        const imageFile = this.selectedEventImageFile;

        this.isSavingEvent = false;
        this.showEventDialog = false;
        this.selectedEventImageFile = null;
        this.selectedEventImageName = '';
        this.messageService.add({ severity: 'success', summary: 'تم', detail: imageFile ? 'تم حفظ الموعد، وجاري رفع الصورة.' : 'تم الحفظ.' });
        this.loadMonthBoards();

        if (savedId && imageFile) {
          this.uploadEventImageInBackground(savedId, imageFile);
        }
      },
      error: (err) => {
        this.isSavingEvent = false;
        this.messageService.add({ severity: 'error', summary: 'خطأ', detail: this.errMsg(err, 'فشل الحفظ.') });
      }
    });
  }

  publishEvent(e: EventView): void {
    if (!e?.id) {
      this.messageService.add({ severity: 'warn', summary: 'تنبيه', detail: 'لا يمكن نشر الموعد حالياً.' });
      return;
    }
    const id = Number(e.id);
    if (this.publishingEventIds.has(id)) return;
    this.publishingEventIds.add(id);

    this.boardService.publishEvent(id).subscribe({
      next: () => {
        this.publishingEventIds.delete(id);
        this.markEventPublishedInView(id);
        this.messageService.add({ severity: 'success', summary: 'تم', detail: 'تم نشر الموعد.' });
        this.loadMonthBoards();
      },
      error: (err) => {
        this.publishingEventIds.delete(id);
        this.verifyPublishedAfterError(id, err);
      }
    });
  }

  unpublishEvent(e: EventView): void {
    if (!e?.id) {
      this.messageService.add({ severity: 'warn', summary: 'تنبيه', detail: 'لا يمكن إخفاء الموعد حالياً.' });
      return;
    }
    const defaultUntil = e.eventAt ? new Date(e.eventAt) : new Date();
    const minUntil = new Date();
    minUntil.setHours(minUntil.getHours() + 1, 0, 0, 0);
    if (defaultUntil < minUntil) defaultUntil.setTime(minUntil.getTime());
    this.unpublishForm = {
      event: e,
      message: '',
      noticeUntil: defaultUntil
    };
    this.showUnpublishDialog = true;
  }

  confirmUnpublishEvent(): void {
    const e = this.unpublishForm.event;
    if (!e?.id) {
      this.showUnpublishDialog = false;
      return;
    }

    const id = Number(e.id);
    if (this.unpublishingEventIds.has(id)) return;
    this.unpublishingEventIds.add(id);

    this.boardService.unpublishEvent(id, {
      message: String(this.unpublishForm.message || '').trim() || null,
      noticeUntil: this.unpublishForm.noticeUntil ? this.toLocalDateTimePayload(this.unpublishForm.noticeUntil) : null
    }).subscribe({
      next: () => {
        this.unpublishingEventIds.delete(id);
        this.showUnpublishDialog = false;
        this.messageService.add({ severity: 'success', summary: 'تم', detail: 'تم إلغاء نشر الموعد.' });
        this.loadMonthBoards();
      },
      error: (err) => {
        this.unpublishingEventIds.delete(id);
        this.messageService.add({ severity: 'error', summary: 'خطأ', detail: this.errMsg(err, 'فشل إلغاء نشر الموعد.') });
      }
    });
  }

  deleteEvent(e: EventView): void {
    if (!e?.id) {
      this.messageService.add({ severity: 'warn', summary: 'تنبيه', detail: 'لا يمكن مسح الموعد حالياً.' });
      return;
    }

    const title = String(e.title || 'هذا الموعد').trim();
    this.confirmationService.confirm({
      header: 'تأكيد الحذف',
      icon: 'pi pi-exclamation-triangle',
      message: `هل تريد مسح موعد "${title}"؟`,
      acceptLabel: 'حذف',
      rejectLabel: 'إلغاء',
      acceptButtonStyleClass: 'p-button-danger',
      rejectButtonStyleClass: 'p-button-text',
      accept: () => {
        this.boardService.deleteEvent(e.id!).subscribe({
          next: () => {
            this.messageService.add({ severity: 'success', summary: 'تم', detail: 'تم مسح الموعد.' });
            this.loadMonthBoards();
          },
          error: (err) => {
            this.messageService.add({ severity: 'error', summary: 'خطأ', detail: this.errMsg(err, 'فشل مسح الموعد.') });
          }
        });
      }
    });
  }

  openJoin(e: EventView): void {
    this.selectedJoinEvent = e;
    this.showJoinDialog = true;
  }

  openEventDetails(e: EventView): void {
    this.openJoin(e);
  }

  joinFromCard(e: EventView): void {
    this.selectedJoinEvent = e;
    this.confirmJoin();
  }

  confirmJoin(): void {
    if (!this.selectedJoinEvent?.id) {
      this.messageService.add({ severity: 'warn', summary: 'تنبيه', detail: 'الموعد غير متاح للانضمام الآن.' });
      return;
    }
    this.boardService.joinEvent(this.selectedJoinEvent.id).subscribe({
      next: () => {
        this.messageService.add({ severity: 'success', summary: 'تم', detail: 'تم الانضمام.' });
        this.showJoinDialog = false;
        this.loadMonthBoards();
      },
      error: (err) => {
        this.messageService.add({ severity: 'error', summary: 'خطأ', detail: this.errMsg(err, 'فشل الانضمام.') });
      }
    });
  }

  unjoin(e: EventView): void {
    if (!e?.id) {
      this.messageService.add({ severity: 'warn', summary: 'تنبيه', detail: 'لا يمكن إلغاء الانضمام الآن.' });
      return;
    }
    this.boardService.unjoinEvent(e.id).subscribe({
      next: () => {
        this.messageService.add({ severity: 'info', summary: 'تم', detail: 'تم إلغاء الانضمام.' });
        this.loadMonthBoards();
      },
      error: (err) => {
        this.messageService.add({ severity: 'error', summary: 'خطأ', detail: this.errMsg(err, 'فشل إلغاء الانضمام.') });
      }
    });
  }

  openParticipants(e: EventView): void {
    if (!e?.id) return;
    this.boardService.participants(e.id).subscribe({
      next: (groups) => {
        this.participantsGroups = groups || [];
        this.showParticipantsDialog = true;
      },
      error: (err) => {
        this.messageService.add({ severity: 'error', summary: 'خطأ', detail: this.errMsg(err, 'فشل تحميل تفاصيل المنضمين.') });
      }
    });
  }

  pendingEventAlarmLabel(e: EventView | null | undefined): string {
    if (!e || e.status !== 'PENDING') return '';

    const eventDate = e?.eventAt ? new Date(e.eventAt) : null;
    if (eventDate && !Number.isNaN(eventDate.getTime())) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      eventDate.setHours(0, 0, 0, 0);
      const diff = Math.round((eventDate.getTime() - today.getTime()) / 86400000);

      if (diff < 0) return 'الموعد انتهى ولم يتم نشره';
      if (diff === 0) return 'تنبيه: الموعد اليوم ولم يتم نشره';
      if (diff <= 3) return `تنبيه: باقي ${diff} يوم ولم يتم نشره`;
    }

    return 'تنبيه: الموعد ما زال Pending ولم يتم نشره';
  }

  formatDateTime(value: string | number | Date | null | undefined): string {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('ar-EG', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  }

  daysAgo(value: string | number | Date | null | undefined): string {
    if (!value) return '';
    const created = new Date(value);
    if (Number.isNaN(created.getTime())) return '';
    const diff = Math.floor((Date.now() - created.getTime()) / 86400000);
    if (diff <= 0) return 'اليوم';
    if (diff === 1) return 'منذ يوم';
    if (diff === 2) return 'منذ يومين';
    if (diff < 11) return `منذ ${diff} أيام`;
    return `منذ ${diff} يوم`;
  }

}
