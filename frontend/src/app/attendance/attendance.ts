
import { Component, OnInit, inject, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { AttendanceService, AttendanceType } from '../services/attendance.service';
import { AuthService } from '../services/auth.service';
import { MessageService } from 'primeng/api';

@Component({
  selector: 'app-attendance',
  standalone: false,
  templateUrl: './attendance.html',
  styleUrls: ['./attendance.css'],
  providers: [MessageService]
})
export class AttendanceComponent implements OnInit {
  private attendance = inject(AttendanceService);
  private auth = inject(AuthService);
  private message = inject(MessageService);

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {}

  me: any;
  scanning = false;

  selectedType: AttendanceType = 'FRIDAY_LITURGY';

  // list of scanned users (unique by id)
  scanned: { id: number; fullName: string; deaconFamily?: string }[] = [];

  ngOnInit() {
    // ✅ SSR: don't call protected endpoints on the server render
    if (!isPlatformBrowser(this.platformId)) return;

    this.auth.getUserData().subscribe((u) => (this.me = u));
  }

  toggleScan() {
    this.scanning = !this.scanning;
  }

  onCodeResult(resultString: string) {
    const token = (resultString || '').trim();
    if (!token) return;

    // ✅ Verify token with backend (trusted source)
    this.attendance.scanToken(token).subscribe({
      next: (u) => {
        if (!u?.id) return;
        if (this.scanned.some((x) => x.id === u.id)) return;
        this.scanned.push({ id: u.id, fullName: u.fullName, deaconFamily: u.deaconFamily });
      },
      error: () => {
        this.message.add({ severity: 'warn', summary: 'Invalid QR', detail: 'This QR is not valid or user not found' });
      }
    });
  }

  remove(id: number) {
    this.scanned = this.scanned.filter((x) => x.id !== id);
  }

  submit() {
    const ids = this.scanned.map((x) => x.id);
    if (ids.length === 0) {
      this.message.add({ severity: 'warn', summary: 'No users', detail: 'Scan at least one QR code' });
      return;
    }

    this.attendance.submit(ids, this.selectedType).subscribe({
      next: (res) => {
        this.message.add({
          severity: 'success',
          summary: 'Saved',
          detail: `Created: ${res.created}, Skipped: ${res.skipped}`
        });
        this.scanned = [];
      },
      error: (err) => {
        this.message.add({ severity: 'error', summary: 'Error', detail: err?.error?.error || 'Failed' });
      }
    });
  }
}
