import { Component, OnInit, inject, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { AuthService } from '../services/auth.service';
import { AttendanceService } from '../services/attendance.service';
import { Router } from '@angular/router';
import { MessageService } from 'primeng/api'; 

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

private servedKhorsLabel(): string {
  const k = String(this.user?.khors || '').trim().toUpperCase();
  const base = this.arKhorsName(k);
  if (!base) return '';
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
    const label = withYear && year ? `${name} (${year})` : name;

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
  }

  loadUserData(): void {
    this.authService.getUserData().subscribe({
      next: (data) => {
        if (!data) {
          this.router.navigate(['/login']);
          return;
        }
        this.user = data;
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
      error: () => {
      }
    });
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
