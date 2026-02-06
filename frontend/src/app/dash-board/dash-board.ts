import { Component, OnInit, inject } from '@angular/core';
import { AuthService } from '../services/auth.service';
import { AttendanceService } from '../services/attendance.service';
import { Router } from '@angular/router';
import { MessageService } from 'primeng/api'; // ✅ Import PrimeNG toast service

@Component({
  selector: 'app-dash-board',
  standalone: false,
  templateUrl: './dash-board.html',
  styleUrls: ['./dash-board.css'],
  providers: [MessageService] // ✅ Provide it locally or globally in app.module.ts
})
export class DashBoard implements OnInit {
  private authService = inject(AuthService);
  private attendanceService = inject(AttendanceService);
  private router = inject(Router);
  private messageService = inject(MessageService);

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

  // ✅ Dashboard stats (totals from database)
  stats: { FRIDAY_LITURGY: number; TASBEEHA: number; FAMILY_MEETING: number } = {
    FRIDAY_LITURGY: 0,
    TASBEEHA: 0,
    FAMILY_MEETING: 0
  };

  ngOnInit(): void {
    this.loadUserData();
    this.loadMyStats();
  }

  loadUserData(): void {
    this.authService.getUserData().subscribe({
      next: (data) => {
        this.user = data;
      },
      error: (err) => {
        console.error('Failed to load user info:', err);
      }
    });
  }

  loadMyStats(): void {
    this.attendanceService.getMyStats().subscribe({
      next: (data) => {
        this.stats = data;
      },
      error: (err) => {
        console.error('Failed to load attendance stats:', err);
      }
    });
  }

  // ✅ Logout with toast + redirect
  logout(): void {
    this.authService.logout().subscribe({
      next: () => {
        // Show a success toast
        this.messageService.add({
          severity: 'success',
          summary: 'Logged out',
          detail: 'You have been logged out successfully.',
          life: 2000
        });

        // Delay redirect slightly so the toast is visible
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
