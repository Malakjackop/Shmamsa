import { Component, OnInit, inject, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { AuthService } from '../services/auth.service';
import { AttendanceService } from '../services/attendance.service';
import { FamilyService } from '../services/family.service';
import { EventsService, EventItem, ParticipantsGroup } from '../services/events.service';
import { AnnouncementsService, AnnouncementItem } from '../services/announcements.service';
import { Router } from '@angular/router';
import { MessageService } from 'primeng/api';

@Component({
  selector: 'app-dash-board',
  standalone: false,
  templateUrl: './dash-board.html',
  styleUrls: ['./dash-board.css']
})
export class DashBoard implements OnInit {

  private authService = inject(AuthService);
  private attendanceService = inject(AttendanceService);
  private familyService = inject(FamilyService);
  private eventsService = inject(EventsService);
  private announcementsService = inject(AnnouncementsService);
  private router = inject(Router);
  private messageService = inject(MessageService);

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {}

  // ====== Existing user/stats (كما هو عندك) ======
  user: any = {
    fullName: '',
    username: '',
    phoneNumber: '',
    status: '',
    deaconFamily: '',
    universityName: '',
    faculty: '',
    dateOfBirth: ''
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

  private arKhorsName(khors: any): string {
    const k = String(khors || '').trim().toUpperCase();
    if (k === 'MARMARKOS') return 'خورس مارمرقس';
    if (k === 'ATHANASIUS') return 'خورس الانبا اثناسيوس';
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

  // ====== Helpers for roles ======
  private roleLevel(role: string): number {
    const order = ['MAKHDOM', 'KHADIM', 'AMIN_OSRA', 'AMIN_KHEDMA', 'DEVELOPER'];
    const idx = order.indexOf(String(role || '').toUpperCase());
    return idx >= 0 ? idx : 0;
  }
  isAtLeast(required: string): boolean {
    return this.roleLevel(this.user?.role) >= this.roleLevel(required);
  }

  private mainFamily(family: string): string {
    const f = String(family || '').trim();
    if (f.endsWith(' أ')) return f.slice(0, -2).trim();
    if (f.endsWith(' ب')) return f.slice(0, -2).trim();
    return f;
  }

  // ====== Dashboard computed labels you already show ======
  get currentFamilyLabel(): string {
    const fam = String(this.user?.deaconFamily || '').trim();
    if (!fam || fam.toUpperCase() === 'SYSTEM') return '—';
    return fam;
  }

  get showFamilyMeetingCard(): boolean {
    return true;
  }

  get khorsCards(): { label: string; count: number }[] {
    const out: { label: string; count: number }[] = [];
    if (this.stats.MARMARKOS_KHORS > 0) out.push({ label: 'مارمرقس', count: this.stats.MARMARKOS_KHORS });
    if (this.stats.ATHANASIUS_KHORS > 0) out.push({ label: 'اثناسيوس', count: this.stats.ATHANASIUS_KHORS });
    return out;
  }

  get showAnyKhorsCards(): boolean {
    return this.khorsCards.length > 0;
  }

  get hasRealFamily(): boolean {
    const family = String(this.user?.deaconFamily || '').trim();
    if (!family) return false;
    if (family.toUpperCase() === 'SYSTEM') return false;
    return true;
  }

  // ====== Events + Announcements state ======
  monthCursor: Date = new Date();
  families: string[] = [];
  familyDropdown: { label: string; value: string }[] = [];

  // ✅ NEW: scope واحد فوق الجدولين
  scopeFamily: string = '';
  scopeLocked: boolean = true;

  events: EventItem[] = [];
  announcements: AnnouncementItem[] = [];

  // dialogs
  showEventDialog = false;
  showJoinDialog = false;
  showParticipantsDialog = false;

  showAnnDialog = false;
  showAnnDetailsDialog = false;

  // forms
  eventForm: any = {
    id: null,
    title: '',
    description: '',
    eventAt: null as Date | null,
    publishAt: null as Date | null,
    targetFamily: ''
  };

  annForm: any = {
    id: null,
    title: '',
    description: '',
    targetFamily: ''
  };

  selectedJoinEvent: EventItem | null = null;
  participantsGroups: ParticipantsGroup[] = [];

  selectedAnn: AnnouncementItem | null = null;

  // ====== Date helpers ======
  private pad(n: number) { return n < 10 ? `0${n}` : `${n}`; }

  private toLocalIso(dt: Date): string {
    const y = dt.getFullYear();
    const m = this.pad(dt.getMonth() + 1);
    const d = this.pad(dt.getDate());
    const hh = this.pad(dt.getHours());
    const mm = this.pad(dt.getMinutes());
    const ss = this.pad(dt.getSeconds());
    return `${y}-${m}-${d}T${hh}:${mm}:${ss}`;
  }

  private monthKey(d: Date): string {
    const y = d.getFullYear();
    const m = this.pad(d.getMonth() + 1);
    return `${y}-${m}`;
  }

  private daysBetween(from: Date, to: Date): number {
    const ms = to.getTime() - from.getTime();
    return Math.floor(ms / (1000 * 60 * 60 * 24));
  }

  // ====== Init ======
  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
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

        // بعد ما المستخدم يتحمّل: حمّل الأسر + events + announcements
        this.initBoards();
      },
      error: () => this.router.navigate(['/login'])
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
      },
      error: () => {}
    });
  }

  // ====== Load families + content ======
  initBoards(): void {
    // ✅ اسمح لـ AMIN_KHEDMA/DEVELOPER يشتغلوا حتى لو deaconFamily مخفية/فاضية
    if (!this.hasRealFamily && !this.isAtLeast('AMIN_KHEDMA')) return;

    this.familyService.families().subscribe({
      next: (list) => {
        this.families = list || [];

        const myBase = this.mainFamily(this.user?.deaconFamily || '');

        // ✅ أمين خدمة/ديفيلوبر: يقدر يختار ALL أو أسرة
        if (this.isAtLeast('AMIN_KHEDMA')) {
          this.scopeLocked = false;
          this.familyDropdown = [
            { label: 'كل الأسر', value: 'ALL' },
            ...this.families.map(f => ({ label: f, value: f }))
          ];
          this.scopeFamily = 'ALL';
        } else {
          // ✅ باقي الأدوار: scope ثابت على أسرته فقط
          this.scopeLocked = true;
          this.familyDropdown = myBase ? [{ label: myBase, value: myBase }] : [];
          this.scopeFamily = myBase || '';
        }

        // default target family in forms (هيبقى نفس scope)
        this.eventForm.targetFamily = this.scopeFamily || '';
        this.annForm.targetFamily = this.scopeFamily || '';

        this.reloadEvents();
        this.reloadAnnouncements();
      },
      error: () => {
        this.reloadEvents();
        this.reloadAnnouncements();
      }
    });
  }

  // ✅ scope change (dropdown اللي فوق الجدولين)
  onScopeChange(): void {
    // خلي الفورم دايمًا على نفس scope (DropList واحدة)
    this.eventForm.targetFamily = this.scopeFamily || '';
    this.annForm.targetFamily = this.scopeFamily || '';

    this.reloadEvents();
    this.reloadAnnouncements();
  }

  onMonthChange(dir: number): void {
    const d = new Date(this.monthCursor);
    d.setMonth(d.getMonth() + dir);
    this.monthCursor = d;
    this.reloadEvents();
  }

  reloadEvents(): void {
    const month = this.monthKey(this.monthCursor);

    // ✅ فلترة الشهر: للأدوار العالية نفلتر بالـ scope، لغير كده نخليها undefined والباك يفلتر حسب صلاحياته
    const family = this.isAtLeast('AMIN_KHEDMA') ? (this.scopeFamily || undefined) : undefined;

    this.eventsService.list(month, family).subscribe({
      next: (list) => {
        this.events = list || [];
        this.firePendingAlarms();
      },
      error: () => {
        this.events = [];
      }
    });
  }

  private firePendingAlarms(): void {
    const now = new Date();
    const pending = this.events.filter(e => e.status === 'PENDING' && e.canPublish);

    for (const e of pending) {
      const ev = new Date(e.eventAt);
      const days = this.daysBetween(now, ev);

      if (days <= 7 && days > 4) {
        this.messageService.add({
          severity: 'warn',
          summary: 'تنبيه نشر',
          detail: `الإيفنت "${e.title}" فاضله ${days} أيام. لو ما اتنشرش قبل 4 أيام هيتم نشره تلقائي.`,
          life: 5000
        });
      }
    }
  }

  reloadAnnouncements(): void {
    const family = this.isAtLeast('AMIN_KHEDMA') ? (this.scopeFamily || undefined) : undefined;

    this.announcementsService.list(family).subscribe({
      next: (list) => this.announcements = list || [],
      error: () => this.announcements = []
    });
  }

  // ====== Events CRUD ======
  openCreateEvent(): void {
    this.eventForm = {
      id: null,
      title: '',
      description: '',
      eventAt: null,
      publishAt: null,
      // ✅ DropList واحدة: targetFamily = scopeFamily
      targetFamily: this.scopeFamily || ''
    };
    this.showEventDialog = true;
  }

  openEditEvent(e: EventItem): void {
    this.eventForm = {
      id: e.id,
      title: e.title,
      description: e.description || '',
      eventAt: e.eventAt ? new Date(e.eventAt) : null,
      publishAt: e.publishAt ? new Date(e.publishAt) : null,
      // readonly في الـ UI
      targetFamily: e.targetFamily
    };
    this.showEventDialog = true;
  }

  saveEvent(): void {
    // ✅ تأكد targetFamily موجود (جاية من scope أو من event نفسه في edit)
    if (!this.eventForm.targetFamily) {
      this.eventForm.targetFamily = this.scopeFamily || '';
    }

    if (!this.eventForm.title || !this.eventForm.eventAt || !this.eventForm.targetFamily) {
      this.messageService.add({ severity: 'error', summary: 'خطأ', detail: 'لازم عنوان + وقت الإيفنت + الأسرة', life: 3000 });
      return;
    }

    const payload = {
      title: this.eventForm.title,
      description: this.eventForm.description,
      eventAt: this.toLocalIso(this.eventForm.eventAt),
      targetFamily: this.eventForm.targetFamily,
      publishAt: this.eventForm.publishAt ? this.toLocalIso(this.eventForm.publishAt) : null
    };

    const obs = this.eventForm.id
      ? this.eventsService.update(this.eventForm.id, payload)
      : this.eventsService.create(payload);

    obs.subscribe({
      next: () => {
        this.showEventDialog = false;

        // ✅ اقفز لشهر الموعد اللي اتعمل (عشان يظهر فورًا)
        if (this.eventForm?.eventAt) {
          this.monthCursor = new Date(this.eventForm.eventAt);
        }

        this.messageService.add({ severity: 'success', summary: 'تم', detail: 'تم الحفظ', life: 2000 });

        // ✅ reload
        this.reloadEvents();
      },
      error: (err) => {
        this.messageService.add({ severity: 'error', summary: 'خطأ', detail: err?.error?.error || err?.error?.message || 'فشل الحفظ', life: 4000 });
      }
    });
  }

  publishEvent(e: EventItem): void {
    this.eventsService.publish(e.id).subscribe({
      next: () => {
        this.messageService.add({ severity: 'success', summary: 'تم', detail: 'تم النشر', life: 2000 });
        this.reloadEvents();
      },
      error: () => this.messageService.add({ severity: 'error', summary: 'خطأ', detail: 'فشل النشر', life: 3000 })
    });
  }

  deleteEvent(e: EventItem): void {
    this.eventsService.delete(e.id).subscribe({
      next: () => {
        this.messageService.add({ severity: 'success', summary: 'تم', detail: 'تم المسح', life: 2000 });
        this.reloadEvents();
      },
      error: () => this.messageService.add({ severity: 'error', summary: 'خطأ', detail: 'فشل المسح', life: 3000 })
    });
  }

  // ====== Join/Unjoin ======
  openJoin(e: EventItem): void {
    this.selectedJoinEvent = e;
    this.showJoinDialog = true;
  }

  confirmJoin(): void {
    if (!this.selectedJoinEvent) return;

    this.eventsService.join(this.selectedJoinEvent.id).subscribe({
      next: () => {
        this.messageService.add({ severity: 'success', summary: 'تم', detail: 'تم الانضمام', life: 2000 });
        this.showJoinDialog = false;
        this.reloadEvents();
      },
      error: () => this.messageService.add({ severity: 'error', summary: 'خطأ', detail: 'فشل الانضمام', life: 3000 })
    });
  }

  unjoin(e: EventItem): void {
    this.eventsService.unjoin(e.id).subscribe({
      next: () => {
        this.messageService.add({ severity: 'info', summary: 'تم', detail: 'تم إلغاء الانضمام', life: 2000 });
        this.reloadEvents();
      },
      error: () => this.messageService.add({ severity: 'error', summary: 'خطأ', detail: 'فشل إلغاء الانضمام', life: 3000 })
    });
  }

  // ====== Participants ======
  openParticipants(e: EventItem): void {
    this.eventsService.participants(e.id).subscribe({
      next: (groups) => {
        this.participantsGroups = groups || [];
        this.showParticipantsDialog = true;
      },
      error: () => this.messageService.add({ severity: 'error', summary: 'خطأ', detail: 'فشل تحميل التفاصيل', life: 3000 })
    });
  }

  // ====== Announcements CRUD ======
  openCreateAnnouncement(): void {
    this.annForm = {
      id: null,
      title: '',
      description: '',
      // ✅ DropList واحدة: targetFamily = scopeFamily
      targetFamily: this.scopeFamily || ''
    };
    this.showAnnDialog = true;
  }

  openEditAnnouncement(a: AnnouncementItem): void {
    this.annForm = {
      id: a.id,
      title: a.title,
      description: a.description || '',
      // readonly في الـ UI
      targetFamily: a.targetFamily
    };
    this.showAnnDialog = true;
  }

  saveAnnouncement(): void {
    if (!this.annForm.targetFamily) {
      this.annForm.targetFamily = this.scopeFamily || '';
    }

    if (!this.annForm.title || !this.annForm.targetFamily) {
      this.messageService.add({ severity: 'error', summary: 'خطأ', detail: 'لازم عنوان + الأسرة', life: 3000 });
      return;
    }

    const payload = {
      title: this.annForm.title,
      description: this.annForm.description,
      targetFamily: this.annForm.targetFamily
    };

    const obs = this.annForm.id
      ? this.announcementsService.update(this.annForm.id, payload)
      : this.announcementsService.create(payload);

    obs.subscribe({
      next: () => {
        this.showAnnDialog = false;

        this.messageService.add({ severity: 'success', summary: 'تم', detail: 'تم الحفظ', life: 2000 });

        this.reloadAnnouncements();
      },
      error: (err) => {
        this.messageService.add({ severity: 'error', summary: 'خطأ', detail: err?.error?.error || err?.error?.message || 'فشل الحفظ', life: 4000 });
      }
    });
  }

  deleteAnnouncement(a: AnnouncementItem): void {
    this.announcementsService.delete(a.id).subscribe({
      next: () => {
        this.messageService.add({ severity: 'success', summary: 'تم', detail: 'تم المسح', life: 2000 });
        this.reloadAnnouncements();
      },
      error: () => this.messageService.add({ severity: 'error', summary: 'خطأ', detail: 'فشل المسح', life: 3000 })
    });
  }

  publishAnnouncement(a: AnnouncementItem): void {
    this.announcementsService.publish(a.id).subscribe({
      next: () => {
        this.messageService.add({ severity: 'success', summary: 'تم', detail: 'تم النشر', life: 2000 });
        this.reloadAnnouncements();
      },
      error: () => this.messageService.add({ severity: 'error', summary: 'خطأ', detail: 'فشل النشر', life: 3000 })
    });
  }

  openAnnDetails(a: AnnouncementItem): void {
    this.selectedAnn = a;
    this.showAnnDetailsDialog = true;
  }

  // ====== UI helpers ======
  formatDateTime(s: string): string {
    const d = new Date(s);
    return d.toLocaleString('ar-EG');
  }

  daysAgo(dateStr: string): string {
    const d = new Date(dateStr);
    const now = new Date();
    const days = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
    if (days <= 0) return 'اليوم';
    if (days === 1) return 'منذ يوم';
    return `منذ ${days} أيام`;
  }

  annDaysLabel(a: AnnouncementItem): string {
    const ref = a.publishedAt || a.createdAt;
    return this.daysAgo(ref);
  }

  // ====== Logout (كما هو عندك) ======
  logout(): void {
    this.authService.logout().subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Logged out',
          detail: 'You have been logged out successfully.',
          life: 2000
        });

        setTimeout(() => {
          this.router.navigate(['/login']);
        }, 2000);
      },
      error: () => {
        this.messageService.add({
          severity: 'error',
          summary: 'Logout Failed',
          detail: 'Something went wrong while logging out.',
          life: 3000
        });
      }
    });
  }
}