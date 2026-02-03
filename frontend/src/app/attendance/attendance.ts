
import { Component, OnInit, inject } from '@angular/core';
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

  me: any;
  scanning = false;

  selectedType: AttendanceType = 'FRIDAY_LITURGY';

  // list of scanned users (unique by id)
  scanned: { id: number; fullName: string; deaconFamily?: string }[] = [];

  ngOnInit() {
    this.auth.getUserData().subscribe((u) => (this.me = u));
  }

  toggleScan() {
    this.scanning = !this.scanning;
  }

  onCodeResult(resultString: string) {
    try {
      const data = JSON.parse(resultString);
      const id = Number(data.id);
      const fullName = String(data.fullName || data.name || '').trim();
      const deaconFamily = data.deaconFamily ? String(data.deaconFamily) : undefined;

      if (!id || !fullName) return;

      if (this.scanned.some((x) => x.id === id)) return;

      this.scanned.push({ id, fullName, deaconFamily });
    } catch {
      // ignore invalid QR
    }
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
