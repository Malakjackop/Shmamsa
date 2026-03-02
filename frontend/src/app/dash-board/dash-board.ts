import { Component, OnInit, inject, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { AuthService } from '../services/auth.service';
import { AttendanceService } from '../services/attendance.service';
import { Router } from '@angular/router';
import { MessageService } from 'primeng/api';
import { FamilyService } from '../services/family.service';
import { EventsService } from '../services/events.service';

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
  private eventsService = inject(EventsService);
  private router = inject(Router);
  private messageService = inject(MessageService);

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {}

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

  private roleRank: Record<string, number> = {
    KHADIM: 1,
    AMIN_OSRA: 2,
    AMIN_KHEDMA: 3,
    ADMIN: 4
  };

  familyDropdown: Array<{ label: string; value: string }> = [];
  scopeFamily: string = 'ALL';

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
    title: '',
    description: '',
    eventAt: null,
    publishAt: null,
    targetFamily: 'ALL'
  };

  annForm: any = {
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
  const base = this.arKhorsName(k);
  return base || '';
}

get isKhorsOnlyServant(): boolean {
  const role = String(this.user?.role || '').trim().toUpperCase();
  const scope = String(this.user?.servingScope || '').trim().toUpperCase();
  const family = String(this.user?.deaconFamily || '').trim().toUpperCase();

  if (role === 'AMIN_KHEDMA') return true;
  if (scope === 'KHORS_ONLY') return true;

  if (family === 'SYSTEM') return true;

  return false;
}

get currentFamilyLabel(): string {
  const family = String(this.user?.deaconFamily || '').trim();
  const served = this.servedKhorsLabel();
  const attend = this.attendKhorsLabel();

  const labels: string[] = [];

  if (!this.isKhorsOnlyServant && family && family.toUpperCase() !== 'SYSTEM') {
    labels.push(family);
  }

  if (served) labels.push(served);

  if (attend && !labels.some(x => x.includes(attend))) {
    labels.push(attend);
  }

  return labels.join(' + ');
}

get showFamilyMeetingCard(): boolean {
  const fam = String(this.user?.deaconFamily || '').trim();
  return !!fam && fam.toUpperCase() !== 'SYSTEM';
}

get khorsCards(): Array<{ code: 'MARMARKOS' | 'ATHANASIUS'; label: string; count: number }> {
  const out: Array<{ code: 'MARMARKOS' | 'ATHANASIUS'; label: string; count: number }> = [];
  const year = this.arYearLabel(this.user?.khorsYear);

  const servedK = String(this.user?.khors || '').trim().toUpperCase();
  const attendK = String(this.user?.attendKhors || '').trim().toUpperCase();

  const add = (code: 'MARMARKOS' | 'ATHANASIUS', withYear: boolean) => {
    const name = this.arKhorsName(code);
    const label =
  withYear && year && code !== 'ATHANASIUS'
    ? `${name} (${year})`
    : name;

    const count =
      code === 'MARMARKOS'
        ? (this.stats.MARMARKOS_KHORS || 0)
        : (this.stats.ATHANASIUS_KHORS || 0);

    if (!out.some(x => x.code === code)) out.push({ code, label, count });
  };

  if (servedK === 'MARMARKOS') add('MARMARKOS', true);
  if (servedK === 'ATHANASIUS') add('ATHANASIUS', true);
  if (servedK === 'BOTH') {
    add('MARMARKOS', true);
    add('ATHANASIUS', true);
  }

  if (attendK === 'MARMARKOS') add('MARMARKOS', false);
  if (attendK === 'ATHANASIUS') add('ATHANASIUS', false);

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

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.loadUserData();
    this.loadMyStats();
    this.loadFamilyDropdown();
  }

  loadUserData(): void {
    this.authService.getUserData().subscribe({
      next: (data) => {
        if (!data) {
          this.router.navigate(['/login']);
          return;
        }
        this.user = data;
        this.syncScopeTarget();

        // بعد ما نعرف المستخدم والأسرة، نحمّل جدول الشهر
        this.loadMonthBoards();
      },
      error: () => this.router.navigate(['/login'])
    });
  }

  
  private toYmd(d: any): string | null {
    if (!d) return null;
    const dt = (d instanceof Date) ? d : new Date(d);
    if (isNaN(dt.getTime())) return null;
    const yyyy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

private monthParam(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`; 
}

  private loadMonthBoards(): void {
    const month = this.monthParam(this.monthCursor);
    const family = this.scopeFamily && this.scopeFamily !== 'ALL' ? this.scopeFamily : '';

    this.eventsService.list(month, family).subscribe({
      next: (rows) => (this.events = rows || []),
      error: () => {
        this.eventsService.list('', '').subscribe({
          next: (rows) => {
            const monthPrefix = `${month}-`;
            const scoped = (rows || []).filter((e: any) => {
              const evDate = String(e?.eventAt || '');
              const inMonth = evDate.startsWith(monthPrefix) || evDate.startsWith(month);
              const inFamily =
                this.scopeFamily === 'ALL' ||
                String(e?.targetFamily || '').toUpperCase() === 'ALL' ||
                String(e?.targetFamily || '').trim() === String(this.scopeFamily || '').trim();
              return inMonth && inFamily;
            });
            this.events = scoped;
          },
          error: () => {
            this.events = [];
            this.messageService.add({
              severity: 'error',
              summary: 'خطأ',
              detail: 'حصل خطأ أثناء تحميل جدول الشهر.'
            });
          }
        });
      }
    });
  }

  private loadFamilyDropdown(): void {
    this.familyService.families().subscribe({
      next: (families) => {
        const opts = (families || [])
          .filter(x => !!x)
          .map(x => ({ label: x, value: x }));
        this.familyDropdown = [{ label: 'كل الأسر (الجميع)', value: 'ALL' }, ...opts];
      },
      error: () => {
        this.familyDropdown = [{ label: 'كل الأسر (الجميع)', value: 'ALL' }];
      }
    });
  }

  private syncScopeTarget(): void {
    if (this.scopeFamily !== 'ALL') return;
    const family = String(this.user?.deaconFamily || '').trim();
    const defaultFamily = family && family.toUpperCase() !== 'SYSTEM' ? family : 'ALL';
    this.eventForm.targetFamily = defaultFamily;
    this.annForm.targetFamily = defaultFamily;
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
      error: () => {
      }
    });
  }

  isAtLeast(role: 'KHADIM' | 'AMIN_OSRA' | 'AMIN_KHEDMA' | 'ADMIN'): boolean {
    const current = String(this.user?.role || '').trim().toUpperCase();
    const currentRank = this.roleRank[current] ?? 0;
    return currentRank >= (this.roleRank[role] ?? 0);
  }

  onScopeChange(): void {
    const target = this.scopeFamily || 'ALL';
    this.eventForm.targetFamily = target;
    this.annForm.targetFamily = target;

    this.loadMonthBoards();
  }

  onMonthChange(offset: number): void {
    const next = new Date(this.monthCursor);
    next.setMonth(next.getMonth() + Number(offset || 0));
    this.monthCursor = next;

    this.loadMonthBoards();
  }

  openCreateEvent(): void {
    this.eventForm = {
      title: '',
      description: '',
      eventAt: null,
      publishAt: null,
      targetFamily: this.scopeFamily || this.eventForm.targetFamily || 'ALL'
    };
    this.showEventDialog = true;
  }

  openEditEvent(e: any): void {
    this.eventForm = {
      id: e?.id,
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
      publishAt: this.toYmd(this.eventForm?.publishAt),
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
    const req$ = id ? this.eventsService.update(id, payload) : this.eventsService.create(payload);

    req$.subscribe({
      next: () => {
        this.showEventDialog = false;
        this.messageService.add({ severity: 'success', summary: 'تم', detail: 'اتحفظ الموعد.' });
        this.loadMonthBoards();
      },
      error: (err) => {
        this.showEventDialog = false;
        const msg = err?.error?.message || 'حصل خطأ أثناء الحفظ.';
        this.messageService.add({ severity: 'error', summary: 'خطأ', detail: msg });
      }
    });
  }

  formatDateTime(value: any): string {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('ar-EG', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  openJoin(e: any): void {
    this.selectedJoinEvent = e;
    this.showJoinDialog = true;
  }

  confirmJoin(): void {
    this.showJoinDialog = false;
    this.messageService.add({
      severity: 'info',
      summary: 'Soon',
      detail: 'Join action is not connected yet.'
    });
  }

  unjoin(_: any): void {
    this.messageService.add({
      severity: 'info',
      summary: 'Soon',
      detail: 'Unjoin action is not connected yet.'
    });
  }

  publishEvent(_: any): void {
    this.messageService.add({
      severity: 'info',
      summary: 'Soon',
      detail: 'Publish event action is not connected yet.'
    });
  }

  deleteEvent(_: any): void {
    this.messageService.add({
      severity: 'info',
      summary: 'Soon',
      detail: 'Delete event action is not connected yet.'
    });
  }

  openParticipants(_: any): void {
    this.participantsGroups = [];
    this.showParticipantsDialog = true;
  }

  openCreateAnnouncement(): void {
    this.annForm = {
      title: '',
      description: '',
      targetFamily: this.scopeFamily || this.annForm.targetFamily || 'ALL'
    };
    this.showAnnDialog = true;
  }

  openEditAnnouncement(a: any): void {
    this.annForm = {
      id: a?.id,
      title: a?.title || '',
      description: a?.description || '',
      targetFamily: a?.targetFamily || this.scopeFamily || 'ALL'
    };
    this.showAnnDialog = true;
  }

  saveAnnouncement(): void {
    this.showAnnDialog = false;
    this.messageService.add({
      severity: 'info',
      summary: 'Soon',
      detail: 'Announcement save wiring is not connected yet.'
    });
  }

  openAnnDetails(a: any): void {
    this.selectedAnn = a;
    this.showAnnDetailsDialog = true;
  }

  publishAnnouncement(_: any): void {
    this.messageService.add({
      severity: 'info',
      summary: 'Soon',
      detail: 'Publish announcement action is not connected yet.'
    });
  }

  deleteAnnouncement(_: any): void {
    this.messageService.add({
      severity: 'info',
      summary: 'Soon',
      detail: 'Delete announcement action is not connected yet.'
    });
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
    return this.daysAgo(a?.createdAt);
  }


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
      error: (err) => {
        console.error('Logout failed:', err);
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
