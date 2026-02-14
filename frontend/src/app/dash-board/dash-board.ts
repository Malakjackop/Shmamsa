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

  stats: { FRIDAY_LITURGY: number; TASBEEHA: number; FAMILY_MEETING: number } = {
    FRIDAY_LITURGY: 0,
    TASBEEHA: 0,
    FAMILY_MEETING: 0
  };

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
        this.stats = data;
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
