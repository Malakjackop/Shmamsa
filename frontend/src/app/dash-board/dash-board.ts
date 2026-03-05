import { Component, OnInit, inject, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { AuthService } from '../services/auth.service';
import { AttendanceService } from '../services/attendance.service';
import { Router } from '@angular/router';
import { MessageService } from 'primeng/api';
import { FamilyService } from '../services/family.service';
import { HttpClient, HttpParams } from '@angular/common/http';

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
  private router = inject(Router);
  private messageService = inject(MessageService);
  private http = inject(HttpClient);

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {}

  user: any = {
    fullName: '',
    username: '',
    phoneNumber: '',
    status: '',
    deaconFamily: '',
    deaconFamily2: '',
    deaconFamily3: '',
    deaconFamily4: '',
    universityName: '',
    faculty: '',
    dateOfBirth: '',
    role: '',
    servingScope: '',
    khors: '',
    khorsYear: null,
    attendKhors: ''
  };

  // ===== Roles =====
  private normRole(role: any): string {
    const r = String(role || '').trim().toUpperCase();
    if (!r) return 'MAKHDOM';
    if (r.includes('DEVELOPER')) return 'DEVELOPER';
    if (r.includes('ADMIN')) return 'ADMIN';
    if (r.includes('AMIN_KHEDMA')) return 'AMIN_KHEDMA';
    if (r.includes('AMIN_OSRA')) return 'AMIN_OSRA';
    if (r.includes('KHADIM')) return 'KHADIM';
    if (r.includes('MAKHDOM')) return 'MAKHDOM';
    return r;
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
  familyDropdown: Array<{ label: string; value: string }> = [];
  scopeFamily: string = 'ALL';
  scopeLocked: boolean = true;

  monthCursor: Date = new Date();
  events: any[] = [];
  announcements: any[] = [];

  showEventDialog = false;
  showJoinDialog = false;
  showParticipantsDialog = false;
  showAnnDialog = false;
  showAnnDetailsDialog = false;

  selectedJoinEvent: any = null;
  selectedAnn: any = null;
  participantsGroups: Array<{ family: string; members: any[] }> = [];

  eventForm: any = {
    id: null,
    title: '',
    description: '',
    eventAt: null,
    publishAt: null,
    targetFamily: 'ALL'
  };

  annForm: any = {
    id: null,
    title: '',
    description: '',
    targetFamily: 'ALL'
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

  familyMeetingCards: Array<{ family: string; count: number }> = [];


  // ===== Helpers =====
  private pad(n: number) { return n < 10 ? `0${n}` : `${n}`; }

  private errMsg(err: any, fallback: string): string {
    return err?.error?.message || err?.error?.error || err?.message || fallback;
  }

  // ✅ دي اللي كانت ناقصة عندك (LocalDate => YYYY-MM-DD)
  private toYmd(d: any): string | null {
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

  private isChoirBucket(f: string): boolean {
    const x = String(f || '').trim();
    return x === 'خورس مارمرقس' || x === 'خورس البابا اثناسيوس';
  }

  private userFamilies(): string[] {
    const raw = [this.user?.deaconFamily, this.user?.deaconFamily2, this.user?.deaconFamily3, this.user?.deaconFamily4]
      .map((x: any) => String(x || '').trim())
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

  private arKhorsName(khors: any): string {
    const k = String(khors || '').trim().toUpperCase();
    if (k === 'MARMARKOS') return 'خورس مارمرقس';
    if (k === 'ATHANASIUS') return 'خورس البابا اثناسيوس';
    return '';
  }

  private arYearLabel(year?: number): string {
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

  get khorsCards(): Array<{ code: 'MARMARKOS' | 'ATHANASIUS'; label: string; count: number }> {
    const out: Array<{ code: 'MARMARKOS' | 'ATHANASIUS'; label: string; count: number }> = [];
    const year = this.arYearLabel(this.user?.khorsYear);

    const servedK = String(this.user?.khors || '').trim().toUpperCase();
    const attendK = String(this.user?.attendKhors || '').trim().toUpperCase();

    const add = (code: 'MARMARKOS' | 'ATHANASIUS', withYear: boolean) => {
      const name = this.arKhorsName(code);
      const label = withYear && year && code !== 'ATHANASIUS' ? `${name} (${year})` : name;
      const count = code === 'MARMARKOS' ? (this.stats.MARMARKOS_KHORS || 0) : (this.stats.ATHANASIUS_KHORS || 0);
      if (!out.some(x => x.code === code)) out.push({ code, label, count });
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
    this.loadUserData();
    this.loadMyStats();
    this.loadFamilyDropdown();
  }

  loadUserData(): void {
    this.authService.getUserData().subscribe({
      next: (data: any) => {
        if (!data) {
          this.router.navigate(['/login']);
          return;
        }
        this.user = data;

        this.scopeLocked = !this.isAtLeast('AMIN_KHEDMA');

        if (this.scopeLocked) {
          const fam = this.mainFamily(this.user?.deaconFamily || '');
          this.scopeFamily = fam && fam.toUpperCase() !== 'SYSTEM' ? fam : 'ALL';
        } else {
          this.scopeFamily = 'ALL';
        }

        this.eventForm.targetFamily = this.scopeFamily;
        this.annForm.targetFamily = this.scopeFamily;

        this.loadMonthBoards();
        this.loadAnnouncements();
      },
      error: () => this.router.navigate(['/login'])
    });
  }

  loadMyStats(): void {
    this.attendanceService.getMyStats().subscribe({
      next: (data: any) => {
        this.stats = {
  ...this.stats,
  FRIDAY_LITURGY: data?.FRIDAY_LITURGY ?? 0,
  TASBEEHA: data?.TASBEEHA ?? 0,
  FAMILY_MEETING: data?.FAMILY_MEETING ?? 0,
  MARMARKOS_KHORS: data?.MARMARKOS_KHORS ?? 0,
  ATHANASIUS_KHORS: data?.ATHANASIUS_KHORS ?? 0
};

// ✅ If user serves in multiple families, show a separate card (and separate count) per family
const byFam: Record<string, number> = data?.FAMILY_MEETING_BY_FAMILY || {};
const fams = this.userFamilies();
this.familyMeetingCards = fams.map(f => ({
  family: f,
  count: byFam[this.mainFamily(f)] ?? byFam[f] ?? 0
}));

      },
      error: () => {}
    });
  }

  private loadFamilyDropdown(): void {
    this.familyService.families().subscribe({
      next: (families: any) => {
        const opts = (families || []).filter((x: any) => !!x).map((x: any) => ({ label: x, value: x }));
        this.familyDropdown = [{ label: 'كل الأسر (الجميع)', value: 'ALL' }, ...opts];
      },
      error: () => {
        this.familyDropdown = [{ label: 'كل الأسر (الجميع)', value: 'ALL' }];
      }
    });
  }

  private loadMonthBoards(): void {
    const month = this.monthParam(this.monthCursor);
    const family = (this.scopeFamily && this.scopeFamily !== 'ALL') ? this.scopeFamily : '';

    let params = new HttpParams().set('month', month);
    if (family) params = params.set('family', family);

    this.http.get<any[]>('/api/events', { params, withCredentials: true }).subscribe({
      next: (rows: any) => this.events = rows || [],
      error: (err: any) => {
        this.events = [];
        this.messageService.add({ severity: 'error', summary: 'خطأ', detail: this.errMsg(err, 'حصل خطأ أثناء تحميل جدول الشهر.') });
      }
    });
  }

  private loadAnnouncements(): void {
    const family = (this.scopeFamily && this.scopeFamily !== 'ALL') ? this.scopeFamily : 'ALL';
    const params = new HttpParams().set('family', family);

    this.http.get<any[]>('/api/announcements', { params, withCredentials: true }).subscribe({
      next: (rows: any) => this.announcements = rows || [],
      error: (err: any) => {
        this.announcements = [];
        this.messageService.add({ severity: 'error', summary: 'خطأ', detail: this.errMsg(err, 'حصل خطأ أثناء تحميل التنبيهات.') });
      }
    });
  }

  onScopeChange(): void {
    const target = this.scopeFamily || 'ALL';
    this.eventForm.targetFamily = target;
    this.annForm.targetFamily = target;

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
    this.eventForm = {
      id: null,
      title: '',
      description: '',
      eventAt: null,
      publishAt: null,
      targetFamily: this.scopeFamily || 'ALL'
    };
    this.showEventDialog = true;
  }

  openEditEvent(e: any): void {
    this.eventForm = {
      id: e?.id ?? null,
      title: e?.title || '',
      description: e?.description || '',
      eventAt: e?.eventAt ? new Date(e.eventAt) : null,
      publishAt: e?.publishAt ? new Date(e.publishAt) : null,
      targetFamily: e?.targetFamily || this.scopeFamily || 'ALL'
    };
    this.showEventDialog = true;
  }

  saveEvent(): void {
    const payload = {
      title: String(this.eventForm?.title || '').trim(),
      description: this.eventForm?.description || null,
      eventAt: this.toYmd(this.eventForm?.eventAt),
      publishAt: this.eventForm?.publishAt ? this.toYmd(this.eventForm?.publishAt) : null,
      targetFamily: String(this.eventForm?.targetFamily || this.scopeFamily || 'ALL').trim()
    };

    if (!payload.title) {
      this.messageService.add({ severity: 'warn', summary: 'تنبيه', detail: 'اكتب عنوان الموعد.' });
      return;
    }
    if (!payload.eventAt) {
      this.messageService.add({ severity: 'warn', summary: 'تنبيه', detail: 'اختار تاريخ الموعد.' });
      return;
    }

    const id = this.eventForm?.id;
    const req$ = id
      ? this.http.put(`/api/events/${id}`, payload, { withCredentials: true })
      : this.http.post('/api/events', payload, { withCredentials: true });

    req$.subscribe({
      next: () => {
        this.showEventDialog = false;
        this.messageService.add({ severity: 'success', summary: 'تم', detail: 'تم الحفظ.' });
        this.loadMonthBoards();
      },
      error: (err: any) => {
        this.messageService.add({ severity: 'error', summary: 'خطأ', detail: this.errMsg(err, 'فشل الحفظ.') });
      }
    });
  }

  publishEvent(e: any): void {
    if (!e?.id) return;
    this.http.post(`/api/events/${e.id}/publish`, {}, { withCredentials: true }).subscribe({
      next: () => {
        this.messageService.add({ severity: 'success', summary: 'تم', detail: 'تم نشر الموعد.' });
        this.loadMonthBoards();
      },
      error: (err: any) => {
        this.messageService.add({ severity: 'error', summary: 'خطأ', detail: this.errMsg(err, 'فشل نشر الموعد.') });
      }
    });
  }

  deleteEvent(e: any): void {
    if (!e?.id) return;
    this.http.delete(`/api/events/${e.id}`, { withCredentials: true }).subscribe({
      next: () => {
        this.messageService.add({ severity: 'success', summary: 'تم', detail: 'تم مسح الموعد.' });
        this.loadMonthBoards();
      },
      error: (err: any) => {
        this.messageService.add({ severity: 'error', summary: 'خطأ', detail: this.errMsg(err, 'فشل مسح الموعد.') });
      }
    });
  }

  openJoin(e: any): void {
    this.selectedJoinEvent = e;
    this.showJoinDialog = true;
  }

  confirmJoin(): void {
    if (!this.selectedJoinEvent?.id) return;
    this.http.post(`/api/events/${this.selectedJoinEvent.id}/join`, {}, { withCredentials: true }).subscribe({
      next: () => {
        this.messageService.add({ severity: 'success', summary: 'تم', detail: 'تم الانضمام.' });
        this.showJoinDialog = false;
        this.loadMonthBoards();
      },
      error: (err: any) => {
        this.messageService.add({ severity: 'error', summary: 'خطأ', detail: this.errMsg(err, 'فشل الانضمام.') });
      }
    });
  }

  unjoin(e: any): void {
    if (!e?.id) return;
    this.http.delete(`/api/events/${e.id}/join`, { withCredentials: true }).subscribe({
      next: () => {
        this.messageService.add({ severity: 'info', summary: 'تم', detail: 'تم إلغاء الانضمام.' });
        this.loadMonthBoards();
      },
      error: (err: any) => {
        this.messageService.add({ severity: 'error', summary: 'خطأ', detail: this.errMsg(err, 'فشل إلغاء الانضمام.') });
      }
    });
  }

  openParticipants(e: any): void {
    if (!e?.id) return;
    this.http.get<any[]>(`/api/events/${e.id}/participants`, { withCredentials: true }).subscribe({
      next: (groups: any) => {
        this.participantsGroups = groups || [];
        this.showParticipantsDialog = true;
      },
      error: (err: any) => {
        this.messageService.add({ severity: 'error', summary: 'خطأ', detail: this.errMsg(err, 'فشل تحميل تفاصيل المنضمين.') });
      }
    });
  }

  openCreateAnnouncement(): void {
    this.annForm = { id: null, title: '', description: '', targetFamily: this.scopeFamily || 'ALL' };
    this.showAnnDialog = true;
  }

  openEditAnnouncement(a: any): void {
    this.annForm = { id: a?.id ?? null, title: a?.title || '', description: a?.description || '', targetFamily: a?.targetFamily || this.scopeFamily || 'ALL' };
    this.showAnnDialog = true;
  }

  saveAnnouncement(): void {
    const payload = {
      title: String(this.annForm?.title || '').trim(),
      description: this.annForm?.description || null,
      targetFamily: String(this.annForm?.targetFamily || this.scopeFamily || 'ALL').trim()
    };

    if (!payload.title) {
      this.messageService.add({ severity: 'warn', summary: 'تنبيه', detail: 'اكتب عنوان التنبيه.' });
      return;
    }

    const id = this.annForm?.id;
    const req$ = id
      ? this.http.put(`/api/announcements/${id}`, payload, { withCredentials: true })
      : this.http.post('/api/announcements', payload, { withCredentials: true });

    req$.subscribe({
      next: () => {
        this.showAnnDialog = false;
        this.messageService.add({ severity: 'success', summary: 'تم', detail: 'تم حفظ التنبيه.' });
        this.loadAnnouncements();
      },
      error: (err: any) => {
        this.messageService.add({ severity: 'error', summary: 'خطأ', detail: this.errMsg(err, 'فشل حفظ التنبيه.') });
      }
    });
  }

  publishAnnouncement(a: any): void {
    if (!a?.id) return;
    this.http.post(`/api/announcements/${a.id}/publish`, {}, { withCredentials: true }).subscribe({
      next: () => {
        this.messageService.add({ severity: 'success', summary: 'تم', detail: 'تم نشر التنبيه.' });
        this.loadAnnouncements();
      },
      error: (err: any) => {
        this.messageService.add({ severity: 'error', summary: 'خطأ', detail: this.errMsg(err, 'فشل نشر التنبيه.') });
      }
    });
  }

  deleteAnnouncement(a: any): void {
    if (!a?.id) return;
    this.http.delete(`/api/announcements/${a.id}`, { withCredentials: true }).subscribe({
      next: () => {
        this.messageService.add({ severity: 'success', summary: 'تم', detail: 'تم مسح التنبيه.' });
        this.loadAnnouncements();
      },
      error: (err: any) => {
        this.messageService.add({ severity: 'error', summary: 'خطأ', detail: this.errMsg(err, 'فشل مسح التنبيه.') });
      }
    });
  }

  openAnnDetails(a: any): void {
    this.selectedAnn = a;
    this.showAnnDetailsDialog = true;
  }

  formatDateTime(value: any): string {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  daysAgo(value: any): string {
    const created = new Date(value);
    if (Number.isNaN(created.getTime())) return '';
    const diff = Math.floor((Date.now() - created.getTime()) / 86400000);
    if (diff <= 0) return 'اليوم';
    if (diff === 1) return 'منذ يوم';
    if (diff === 2) return 'منذ يومين';
    if (diff < 11) return `منذ ${diff} أيام`;
    return `منذ ${diff} يوم`;
  }

  annDaysLabel(a: any): string {
    const ref = a?.publishedAt || a?.createdAt;
    return this.daysAgo(ref);
  }
}
