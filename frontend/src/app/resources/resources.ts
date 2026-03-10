import { Component, OnInit, inject, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { AuthService } from '../services/auth.service';
import { FamilyService } from '../services/family.service';
import { ResourcesService } from '../services/resources.service';
import { MessageService } from 'primeng/api';
import { ConfirmationService } from 'primeng/api';

@Component({
  selector: 'app-resources',
  standalone: false,
  templateUrl: './resources.html',
  styleUrls: ['./resources.css'],
  providers: [MessageService ,ConfirmationService]
})
export class ResourcesComponent implements OnInit {
  private auth = inject(AuthService);
  private famService = inject(FamilyService);
  private resService = inject(ResourcesService);
  private msg = inject(MessageService);
  private confirmService = inject(ConfirmationService);

  user: any = null;

  families: string[] = [];
  selectedFamily: string = '';

  resources: any[] = [];

  title: string = '';
  description: string = '';
  pickedFile: File | null = null;

  editing: any = null;
  editTitle: string = '';
  editDescription: string = '';
  editFile: File | null = null;

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {}

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    this.auth.getUserData(true).subscribe({
      next: (u) => {
        this.user = u;
        this.initPage();
      }
    });
  }

  private normRole(v: any): string {
    const raw = String(v || '').trim();
    const up = raw.toUpperCase();
    if (!up) return '';
    if (['امين اسرة', 'امين الاسرة', 'أمين أسرة', 'أمين الاسرة', 'امين الأسرة', 'أمين الأسرة'].includes(raw)) return 'AMIN_OSRA';
    if (['امين خدمة', 'امين الخدمه', 'أمين خدمة', 'أمين الخدمه', 'امين الخدمة', 'أمين الخدمة'].includes(raw)) return 'AMIN_KHEDMA';
    if (up.startsWith('ROLE_')) return up.substring(5);
    return up;
  }

  private getServedFamilies(): string[] {
    const slots: Array<[string | undefined, string | undefined]> = [
      [this.user?.deaconFamily, this.user?.deaconFamilyRole || this.user?.role],
      [this.user?.deaconFamily2, this.user?.deaconFamilyRole2],
      [this.user?.deaconFamily3, this.user?.deaconFamilyRole3],
      [this.user?.deaconFamily4, this.user?.deaconFamilyRole4]
    ];

    const res: string[] = [];
    for (const [fam, role] of slots) {
      const f = String(fam || '').trim();
      if (!f) continue;
      const r = this.normRole(role);
      if (!['KHADIM', 'AMIN_OSRA', 'AMIN_KHEDMA', 'DEVELOPER'].includes(r)) continue;
      if (!res.includes(f)) res.push(f);
    }
    return res;
  }

  isMakhdom(): boolean {
    return this.normRole(this.user?.role) === 'MAKHDOM';
  }

  isUploader(): boolean {
    return this.getServedFamilies().length > 0 || ['KHADIM','AMIN_OSRA','AMIN_KHEDMA','DEVELOPER'].includes(this.normRole(this.user?.role));
  }

  isAminKhedmaOrDev(): boolean {
    return ['AMIN_KHEDMA','DEVELOPER'].includes(this.normRole(this.user?.role));
  }

  initPage() {
    if (this.isAminKhedmaOrDev()) {
      this.famService.families().subscribe({
        next: (list) => {
          this.families = ['ALL', ...list];
          this.selectedFamily = this.families[0] || 'ALL';
          this.loadResources();
        }
      });
    } else if (this.isUploader()) {
      this.families = this.getServedFamilies();
      this.selectedFamily = this.families[0] || '';
      this.loadResources();
    } else {
      this.loadResources();
    }
  }

  loadResources() {

    if (this.isAminKhedmaOrDev()) {
      this.resService.list(this.selectedFamily).subscribe({
        next: (data) => (this.resources = data || []),
        error: () => (this.resources = [])
      });
      return;
    }

    this.resService.list(this.selectedFamily || undefined).subscribe({
      next: (data) => (this.resources = data || []),
      error: () => (this.resources = [])
    });
  }

  onPickFile(e: any) {
    const f = e?.target?.files?.[0];
    this.pickedFile = f || null;
  }

  upload() {
    if (!this.isUploader()) return;
    if (!this.pickedFile) {
      this.msg.add({ severity: 'warn', summary: 'اختر ملف ', detail: 'من فضلك اختر ملف اولا' });
      return;
    }

    const fd = new FormData();
    fd.append('file', this.pickedFile);
    if (this.title) fd.append('title', this.title);
    if (this.description) fd.append('description', this.description);

    if (this.selectedFamily) {
      fd.append('family', this.selectedFamily);
    }

    this.resService.upload(fd).subscribe({
      next: () => {
        this.msg.add({ severity: 'success', summary: 'رفع', detail: 'تم رفع الملف بنجاح' });
        this.title = '';
        this.description = '';
        this.pickedFile = null;
        this.loadResources();
      },
      error: (err) => {
        this.msg.add({ severity: 'error', summary: 'خطأ', detail: err?.error?.error || 'رفع فاشل' });
      }
    });
  }

  openEdit(r: any) {
    this.editing = r;
    this.editTitle = r?.title || '';
    this.editDescription = r?.description || '';
    this.editFile = null;
  }

  onEditFile(e: any) {
    const f = e?.target?.files?.[0];
    this.editFile = f || null;
  }

  saveEdit() {
    if (!this.editing) return;

    const fd = new FormData();
    fd.append('title', this.editTitle || '');
    fd.append('description', this.editDescription || '');
    if (this.editFile) fd.append('file', this.editFile);

    this.resService.update(this.editing.id, fd).subscribe({
      next: () => {
        this.msg.add({ severity: 'success', summary: 'تحديث', detail: 'تم تحديث المصادر' });
        this.editing = null;
        this.loadResources();
      },
      error: (err) => {
        this.msg.add({ severity: 'error', summary: 'خطأ', detail: err?.error?.error || 'تحديث فاشل' });
      }
    });
  }

  cancelEdit() {
    this.editing = null;
  }

remove(r: any) {
  this.confirmService.confirm({
    message: 'هل ترغب في حذف هذا الملف ؟',
    header: 'تأكيد الحذف',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'حذف',
    rejectLabel: 'الغاء',
    accept: () => {
      this.resService.delete(r.id).subscribe({
        next: () => {
          this.msg.add({ severity: 'success', summary: 'حذف', detail: ' تم حذف الملف بنجاح' });
          this.loadResources();
        },
        error: (err) => {
          this.msg.add({ severity: 'error', summary: 'خطأ', detail: err?.error?.error || 'فشل الحذف' });
        }
      });
    }
  });
}


  download(r: any) {
    window.open(this.resService.downloadUrl(r.id), '_blank');
  }
}
