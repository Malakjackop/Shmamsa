import { Component, OnInit, inject, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { AuthService } from '../services/auth.service';
import { AttendanceService } from '../services/attendance.service';
import { Router } from '@angular/router';
import { MessageService } from 'primeng/api';
import { FamilyService } from '../services/family.service';
import { HttpClient, HttpParams } from '@angular/common/http';
import { normalizeAssignmentRole, normalizeRole } from '../shared/role-utils';
import { AuthUser } from '../services/auth.service';
import {
  BoardAnnouncement as AnnouncementView,
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
  targetFamily: string;
  targetAudience: string;
};

type AnnouncementForm = {
  id: number | null;
  title: string;
  description: string;
  targetFamily: string;
  targetAudience: string;
};

@Component({
  selector: 'app-dash-board',
  standalone: false,
  templateUrl: './dash-board.html',
  styleUrls: ['./dash-board.css'],
  providers: [MessageService]
})
export class DashBoard implements OnInit {
  private authService = inject(AuthService);
  private attendanceService = inject(AttendanceService);
  private familyService = inject(FamilyService);
  private boardService = inject(BoardService);
  private router = inject(Router);
  private messageService = inject(MessageService);
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
    ADMIN: 5
  };

  isAtLeast(role: 'MAKHDOM' | 'KHADIM' | 'AMIN_OSRA' | 'AMIN_KHEDMA' | 'DEVELOPER' | 'ADMIN'): boolean {
    const current = this.normRole(this.user?.role);
    const currentRank = this.roleRank[current] ?? 0;
    return currentRank >= (this.roleRank[role] ?? 0);
  }

  // ===== UI State =====
  scopeOptions: Array<{ label: string; value: string }> = [];
  scopeFamily: string = 'FAMILY_ALL';
  scopeLocked: boolean = true;

  monthCursor: Date = new Date();
  events: EventView[] = [];
  announcements: AnnouncementView[] = [];

  showEventDialog = false;
  showJoinDialog = false;
  showParticipantsDialog = false;
  showAnnDialog = false;
  showAnnDetailsDialog = false;

  selectedJoinEvent: EventView | null = null;
  selectedAnn: AnnouncementView | null = null;
  participantsGroups: ParticipantGroup[] = [];

  eventForm: EventForm = {
    id: null,
    title: '',
    description: '',
    eventAt: null,
    removeAt: null,
    targetFamily: 'ALL',
    targetAudience: 'EVERYONE'
  };

  annForm: AnnouncementForm = {
    id: null,
    title: '',
    description: '',
    targetFamily: 'ALL',
    targetAudience: 'EVERYONE'
  };

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

  // ✅ دي اللي كانت ناقصة عندك (LocalDate => YYYY-MM-DD)
  private toYmd(d: string | number | Date | null | undefined): string | null {
    if (!d) return null;
    const dt = (d instanceof Date) ? d : new Date(d);
    if (isNaN(dt.getTime())) return null;

    const yyyy = dt.getFullYear();
    const mm = this.pad(dt.getMonth() + 1);
    const dd = this.pad(dt.getDate());
    return `${yyyy}-${mm}-${dd}`;
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
      },
      error: () => {
        this.familyCatalog = [];
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
    return this.isAtLeast('AMIN_OSRA');
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

    this.eventForm = {
      ...this.eventForm,
      targetFamily: cfg.targetFamily,
      targetAudience: cfg.targetAudience
    };

    this.annForm = {
      ...this.annForm,
      targetFamily: cfg.targetFamily,
      targetAudience: cfg.targetAudience
    };
  }

  private ensureScopeValue(): void {
    if (!this.scopeOptions.some(x => x.value === this.scopeFamily)) {
      this.scopeFamily = this.scopeOptions[0]?.value || 'FAMILY_ALL';
    }
    this.syncFormsWithScope();
  }

  private loadScopeOptions(): void {
    if (this.isAtLeast('AMIN_KHEDMA')) {
      this.familyService.families().subscribe({
        next: (families) => {
          const familyOptions = (families || [])
            .filter((x) => !!x)
            .map((x) => ({ label: x, value: `FAMILY::${x}` }));

          this.scopeOptions = [
            { label: 'كل الأسر (الجميع)', value: 'ALL_USERS' },
            { label: 'الخدام فقط', value: 'ALL_SERVANTS' },
            ...familyOptions
          ];

          this.ensureScopeValue();
        },
        error: () => {
          this.scopeOptions = [
            { label: 'كل الأسر (الجميع)', value: 'ALL_USERS' },
            { label: 'الخدام فقط', value: 'ALL_SERVANTS' }
          ];
          this.ensureScopeValue();
        }
      });
      return;
    }

    if (this.isAtLeast('AMIN_OSRA')) {
      this.scopeOptions = [
        { label: 'الكل', value: 'FAMILY_ALL' },
        { label: 'المخدومين', value: 'FAMILY_MEMBERS' },
        { label: 'الخدام', value: 'FAMILY_SERVANTS' }
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

    return family === 'ALL' ? 'كل الأسر (الجميع)' : family;
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
    this.loadFamilyCatalog();
    this.loadUserData();
    this.loadMyStats();
  }

  loadUserData(): void {
    this.authService.getUserData().subscribe({
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

        this.loadScopeOptions();
        this.syncFormsWithScope();
        this.rebuildFamilyMeetingCards();
        this.loadMyQrToken();
        this.loadMonthBoards();
        this.loadAnnouncements();
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


  private loadMonthBoards(): void {
    const month = this.monthParam(this.monthCursor);
    const scope = this.currentScopeConfig();

    this.boardService.listEvents(month, scope.requestFamily, scope.requestAudience).subscribe({
      next: (rows) => this.events = rows || [],
      error: (err) => {
        this.events = [];
        this.messageService.add({ severity: 'error', summary: 'خطأ', detail: this.errMsg(err, 'حصل خطأ أثناء تحميل جدول الشهر.') });
      }
    });
  }

  private loadAnnouncements(): void {
    const scope = this.currentScopeConfig();
    this.boardService.listAnnouncements(scope.requestFamily, scope.requestAudience).subscribe({
      next: (rows) => this.announcements = rows || [],
      error: (err) => {
        this.announcements = [];
        this.messageService.add({ severity: 'error', summary: 'خطأ', detail: this.errMsg(err, 'حصل خطأ أثناء تحميل التنبيهات.') });
      }
    });
  }

  onScopeChange(): void {
    this.syncFormsWithScope();
    this.loadMonthBoards();
    this.loadAnnouncements();
  }

  onMonthChange(offset: number): void {
    const next = new Date(this.monthCursor);
    next.setMonth(next.getMonth() + Number(offset || 0));
    this.monthCursor = next;
    this.loadMonthBoards();
  }

  openCreateEvent(): void {
    const cfg = this.currentScopeConfig();
    this.eventForm = {
      id: null,
      title: '',
      description: '',
      eventAt: null,
      removeAt: null,
      targetFamily: cfg.targetFamily,
      targetAudience: cfg.targetAudience
    };
    this.showEventDialog = true;
  }

  openEditEvent(e: EventView): void {
    const cfg = this.currentScopeConfig();
    this.eventForm = {
      id: e?.id ?? null,
      title: e?.title || '',
      description: e?.description || '',
      eventAt: e?.eventAt ? new Date(e.eventAt) : null,
      removeAt: e?.removeAt ? new Date(e.removeAt) : null,
      targetFamily: e?.targetFamily || cfg.targetFamily,
      targetAudience: e?.targetAudience || cfg.targetAudience
    };
    this.showEventDialog = true;
  }

  saveEvent(): void {
    const cfg = this.currentScopeConfig();
    const payload = {
      title: String(this.eventForm?.title || '').trim(),
      description: this.eventForm?.description || null,
      eventAt: this.toYmd(this.eventForm?.eventAt),
      removeAt: this.eventForm?.removeAt ? this.toYmd(this.eventForm?.removeAt) : null,
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

    const id = this.eventForm?.id;
    const req$ = id
      ? this.boardService.updateEvent(id, payload)
      : this.boardService.createEvent(payload);

    req$.subscribe({
      next: () => {
        this.showEventDialog = false;
        this.messageService.add({ severity: 'success', summary: 'تم', detail: 'تم الحفظ.' });
        this.loadMonthBoards();
      },
      error: (err) => {
        this.messageService.add({ severity: 'error', summary: 'خطأ', detail: this.errMsg(err, 'فشل الحفظ.') });
      }
    });
  }

  publishEvent(e: EventView): void {
    if (!e?.id) {
      this.messageService.add({ severity: 'warn', summary: 'تنبيه', detail: 'لا يمكن نشر الموعد حالياً.' });
      return;
    }
    this.boardService.publishEvent(e.id).subscribe({
      next: () => {
        this.messageService.add({ severity: 'success', summary: 'تم', detail: 'تم نشر الموعد.' });
        this.loadMonthBoards();
      },
      error: (err) => {
        this.messageService.add({ severity: 'error', summary: 'خطأ', detail: this.errMsg(err, 'فشل نشر الموعد.') });
      }
    });
  }

  deleteEvent(e: EventView): void {
    if (!e?.id) {
      this.messageService.add({ severity: 'warn', summary: 'تنبيه', detail: 'لا يمكن مسح الموعد حالياً.' });
      return;
    }
    this.boardService.deleteEvent(e.id).subscribe({
      next: () => {
        this.messageService.add({ severity: 'success', summary: 'تم', detail: 'تم مسح الموعد.' });
        this.loadMonthBoards();
      },
      error: (err) => {
        this.messageService.add({ severity: 'error', summary: 'خطأ', detail: this.errMsg(err, 'فشل مسح الموعد.') });
      }
    });
  }

  openJoin(e: EventView): void {
    this.selectedJoinEvent = e;
    this.showJoinDialog = true;
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

  openCreateAnnouncement(): void {
    const cfg = this.currentScopeConfig();
    this.annForm = {
      id: null,
      title: '',
      description: '',
      targetFamily: cfg.targetFamily,
      targetAudience: cfg.targetAudience
    };
    this.showAnnDialog = true;
  }

  openEditAnnouncement(a: AnnouncementView): void {
    const cfg = this.currentScopeConfig();
    this.annForm = {
      id: a?.id ?? null,
      title: a?.title || '',
      description: a?.description || '',
      targetFamily: a?.targetFamily || cfg.targetFamily,
      targetAudience: a?.targetAudience || cfg.targetAudience
    };
    this.showAnnDialog = true;
  }

  saveAnnouncement(): void {
    const cfg = this.currentScopeConfig();
    const payload = {
      title: String(this.annForm?.title || '').trim(),
      description: this.annForm?.description || null,
      targetFamily: String(this.annForm?.targetFamily || cfg.targetFamily || 'ALL').trim(),
      targetFamilyId: this.familyIdForTarget(this.annForm?.targetFamily || cfg.targetFamily || 'ALL'),
      targetAudience: String(this.annForm?.targetAudience || cfg.targetAudience || 'EVERYONE').trim()
    };

    if (!payload.title && !this.hasText(payload.description)) {
      this.messageService.add({ severity: 'warn', summary: 'بيانات ناقصة', detail: 'اكتب عنوان أو وصف للتنبيه قبل الحفظ.' });
      return;
    }
    if (!payload.title) {
      this.messageService.add({ severity: 'warn', summary: 'بيانات ناقصة', detail: 'اكتب عنوان التنبيه.' });
      return;
    }

    const id = this.annForm?.id;
    const req$ = id
      ? this.boardService.updateAnnouncement(id, payload)
      : this.boardService.createAnnouncement(payload);

    req$.subscribe({
      next: () => {
        this.showAnnDialog = false;
        this.messageService.add({ severity: 'success', summary: 'تم', detail: 'تم حفظ التنبيه.' });
        this.loadAnnouncements();
      },
      error: (err) => {
        this.messageService.add({ severity: 'error', summary: 'خطأ', detail: this.errMsg(err, 'فشل حفظ التنبيه.') });
      }
    });
  }

  publishAnnouncement(a: AnnouncementView): void {
    if (!a?.id) {
      this.messageService.add({ severity: 'warn', summary: 'تنبيه', detail: 'لا يمكن نشر التنبيه حالياً.' });
      return;
    }
    this.boardService.publishAnnouncement(a.id).subscribe({
      next: () => {
        this.messageService.add({ severity: 'success', summary: 'تم', detail: 'تم نشر التنبيه.' });
        this.loadAnnouncements();
      },
      error: (err) => {
        this.messageService.add({ severity: 'error', summary: 'خطأ', detail: this.errMsg(err, 'فشل نشر التنبيه.') });
      }
    });
  }

  deleteAnnouncement(a: AnnouncementView): void {
    if (!a?.id) {
      this.messageService.add({ severity: 'warn', summary: 'تنبيه', detail: 'لا يمكن مسح التنبيه حالياً.' });
      return;
    }
    this.boardService.deleteAnnouncement(a.id).subscribe({
      next: () => {
        this.messageService.add({ severity: 'success', summary: 'تم', detail: 'تم مسح التنبيه.' });
        this.loadAnnouncements();
      },
      error: (err) => {
        this.messageService.add({ severity: 'error', summary: 'خطأ', detail: this.errMsg(err, 'فشل مسح التنبيه.') });
      }
    });
  }

  openAnnDetails(a: AnnouncementView): void {
    this.selectedAnn = a;
    this.showAnnDetailsDialog = true;
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
    return date.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
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

  annDaysLabel(a: AnnouncementView | null | undefined): string {
    const ref = a?.publishedAt || a?.createdAt;
    return this.daysAgo(ref);
  }
}



