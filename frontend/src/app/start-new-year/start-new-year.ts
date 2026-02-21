import { Component, OnInit, inject } from '@angular/core';
import { AuthService } from '../services/auth.service';
import { AttendanceService } from '../services/attendance.service';
import { MessageService, ConfirmationService } from 'primeng/api';

@Component({
  selector: 'app-start-new-year',
  standalone: false,
  templateUrl: './start-new-year.html',
  styleUrls: ['./start-new-year.css'],
  providers: [MessageService, ConfirmationService]
})
export class StartNewYearComponent implements OnInit {
  private auth = inject(AuthService);
  private attendanceSvc = inject(AttendanceService);
  private msg = inject(MessageService);
  private confirm = inject(ConfirmationService);

  me: any = null;
  running = false;

  ngOnInit(): void {
    this.auth.getUserData().subscribe({
      next: (u) => (this.me = u),
      error: () => (this.me = null)
    });
  }

  isAllowed(): boolean {
    return this.me?.role === 'AMIN_KHEDMA' || this.me?.role === 'DEVELOPER';
  }

  startNewYear() {
    if (!this.isAllowed()) {
      this.msg.add({ severity: 'error', summary: 'Forbidden', detail: 'غير مسموح' });
      return;
    }

    this.confirm.confirm({
      header: 'Start New Year',
      icon: 'pi pi-exclamation-triangle',
      message:
        'هل أنت متأكد؟ سيتم مسح كل سجل الحضور لكل الحسابات (خدام + مخدومين). لا يمكن التراجع.',
      acceptLabel: 'Confirm',
      rejectLabel: 'Cancel',
      accept: () => {
        this.running = true;
        this.attendanceSvc.startNewYear().subscribe({
          next: (res) => {
            this.running = false;
            const users = res?.users ?? '';
            const deleted = res?.deletedRecords ?? '';
            this.msg.add({
              severity: 'success',
              summary: 'Done',
              detail: `تم تصفير الحضور بنجاح. Users: ${users}  Deleted records: ${deleted}`
            });
          },
          error: (err) => {
            this.running = false;
            this.msg.add({
              severity: 'error',
              summary: 'Failed',
              detail: err?.error?.message || err?.error?.error || 'Failed'
            });
          }
        });
      }
    });
  }
}
