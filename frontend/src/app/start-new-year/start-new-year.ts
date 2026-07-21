import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { AuthService } from '../services/auth.service';
import { AttendanceService } from '../services/attendance.service';
import { MessageService, ConfirmationService } from 'primeng/api';
import { normalizeRole } from '../shared/role-utils';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-start-new-year',
  standalone: false,
  templateUrl: './start-new-year.html',
  styleUrls: ['./start-new-year.css'],
  providers: [MessageService, ConfirmationService]
})
export class StartNewYearComponent implements OnInit, OnDestroy {
  private auth = inject(AuthService);
  attendanceSvc = inject(AttendanceService);
  private msg = inject(MessageService);
  private confirm = inject(ConfirmationService);
  private userSub?: Subscription;

  me: any = null;
  running = false;

  archiveName: string = '';
  archivesList: any[] = [];

  showFilesDialog = false;
  selectedArchive: any = null;
  archiveFiles: Array<{ type: string; label: string; familyName: string }> = [];
  loadingFiles = false;

  ngOnInit(): void {
    this.userSub = this.auth.getUserData().subscribe({
      next: (u) => {
        this.me = u;
        if (this.isAllowed()) this.loadArchives();
      },
      error: () => (this.me = null)
    });
  }

  ngOnDestroy(): void {
    this.userSub?.unsubscribe();
  }

  isAllowed(): boolean {
    return ['AMIN_KHEDMA', 'DEVELOPER'].includes(normalizeRole(this.me?.role));
  }

  loadArchives() {
    this.attendanceSvc.archives().subscribe({
      next: (list) => (this.archivesList = Array.isArray(list) ? list : []),
      error: () => (this.archivesList = [])
    });
  }

  formatArchiveCreatedAt(value: unknown): string {
    if (!value) return '-';

    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) return String(value);

    return new Intl.DateTimeFormat('ar-EG', {
      weekday: 'long',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(date);
  }

  openFilesDialog(a: any) {
    this.selectedArchive = a;
    this.archiveFiles = [];
    this.loadingFiles = true;
    this.showFilesDialog = true;

    this.attendanceSvc.getArchiveFiles(a.id).subscribe({
      next: (res) => {
        this.archiveFiles = Array.isArray(res?.files) ? res.files : [];
        this.loadingFiles = false;
      },
      error: () => {
        this.archiveFiles = [];
        this.loadingFiles = false;
      }
    });
  }

  closeFilesDialog() {
    this.showFilesDialog = false;
    this.selectedArchive = null;
    this.archiveFiles = [];
  }

  private triggerDownload(blob: Blob, filename: string) {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }

  downloadFile(file: { type: string; label: string; familyName: string }) {
    if (!this.selectedArchive) return;
    const a = this.selectedArchive;
    const safe = (a?.name || 'archive').toString().replace(/[\\/:*?"<>|]/g, '_');
    const safeLabel = file.label.replace(/[\\/:*?"<>|]/g, '_');

    if (file.type === 'family') {
      this.attendanceSvc.downloadArchivePdf(a.id, file.familyName).subscribe({
        next: (blob: Blob) => this.triggerDownload(blob, `${safe} - ${safeLabel}.pdf`),
        error: () => console.error('PDF download failed')
      });
    } else if (file.type === 'servants') {
      this.attendanceSvc.downloadArchivePdf(a.id, undefined, 'servants').subscribe({
        next: (blob: Blob) => this.triggerDownload(blob, `${safe} - ${safeLabel}.pdf`),
        error: () => console.error('PDF download failed')
      });
    }
  }

  downloadAll() {
    if (!this.selectedArchive) return;
    const a = this.selectedArchive;
    this.attendanceSvc.downloadArchivePdfsZip(a.id).subscribe({
      next: (blob: Blob) => {
        const safe = (a?.name || 'archive').toString().replace(/[\\/:*?"<>|]/g, '_');
        this.triggerDownload(blob, `${safe}.zip`);
      },
      error: () => console.error('ZIP download failed')
    });
  }

  startNewYear() {
    if (!this.isAllowed()) {
      this.msg.add({ severity: 'error', summary: 'Forbidden', detail: 'غير مسموح' });
      return;
    }

    if (!this.archiveName || !this.archiveName.trim()) {
      this.msg.add({ severity: 'warn', summary: 'اسم الأرشيف', detail: 'اكتب اسم الأرشيف قبل البدء' });
      return;
    }

    this.confirm.confirm({
      header: 'بدء سنة جديدة',
      icon: 'pi pi-exclamation-triangle',
      message:
        'هل أنت متأكد؟ سيتم أرشفة كل سجل الحضور لكل الحسابات (خدام + مخدومين)، ثم يبدأ العد من 0. لا يوجد حذف.',
      acceptLabel: 'تأكيد',
      rejectLabel: 'إلغاء',
      accept: () => {
        this.running = true;

        this.attendanceSvc.startNewYearArchive(this.archiveName.trim()).subscribe({
          next: (res) => {
            this.running = false;

            const users = res?.users ?? '';
            const archived = res?.archivedRecords ?? '';

            this.archiveName = '';
            this.loadArchives();

            this.msg.add({
              severity: 'success',
              summary: 'تم',
              detail: `تم أرشفة سنة كاملة وبدء سنة جديدة. Users: ${users}  Archived records: ${archived}`
            });
          },
          error: (err) => {
            this.running = false;
            this.msg.add({
              severity: 'error',
              summary: 'فشل',
              detail: err?.error?.message || err?.error?.error || 'Failed'
            });
          }
        });
      }
    });
  }
}
