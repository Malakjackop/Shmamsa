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

get showKhorsCard(): boolean {
  const k = String(this.user?.khors || '').trim().toUpperCase();
  return k !== '' && k !== 'NONE';
}

get khorsAttendanceCount(): number {
  const k = String(this.user?.khors || '').trim().toUpperCase();
  if (k === 'MARMARKOS') return this.stats.MARMARKOS_KHORS || 0;
  if (k === 'ATHANASIUS') return this.stats.ATHANASIUS_KHORS || 0;
  if (k === 'BOTH') return (this.stats.MARMARKOS_KHORS || 0) + (this.stats.ATHANASIUS_KHORS || 0);
  return 0;
}

  private arKhorsName(khors: any): string {
  const k = String(khors || '').trim().toUpperCase();
  if (k === 'MARMARKOS') return 'خورس مارمرقس';
  if (k === 'ATHANASIUS') return 'خورس الانبا اثناسيوس';
  if (k === 'BOTH') return 'خورس مارمرقس + خورس الانبا اثناسيوس';
  return '';
}

get currentFamilyLabel(): string {
  const role = String(this.user?.role || '').trim().toUpperCase();
  const scope = String(this.user?.servingScope || '').trim().toUpperCase();
  const family = String(this.user?.deaconFamily || '').trim();
  const khorsLabel = this.arKhorsName(this.user?.khors);

  if (role === 'AMIN_KHEDMA') {
    return khorsLabel || 'خورس';
  }

  if (scope === 'KHORS_ONLY') {
    return khorsLabel || 'خورس';
  }

  if (family && khorsLabel) {
    return `${family} + ${khorsLabel}`;
  }

  return khorsLabel || family || '';
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
