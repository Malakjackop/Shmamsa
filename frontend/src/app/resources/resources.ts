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

    this.auth.getUserData().subscribe({
      next: (u) => {
        this.user = u;
        this.initPage();
      }
    });
  }

  isMakhdom(): boolean {
    return this.user?.role === 'MAKHDOM';
  }

  isUploader(): boolean {
    return ['KHADIM','AMIN_OSRA','AMIN_KHEDMA','DEVELOPER'].includes(this.user?.role);
  }

  isAminKhedmaOrDev(): boolean {
    return ['AMIN_KHEDMA','DEVELOPER'].includes(this.user?.role);
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
    } else {
      this.loadResources();
    }
  }

  loadResources() {

    if (this.isAminKhedmaOrDev()) {
      if (this.selectedFamily === 'ALL') {
        this.resources = [];
        return;
      }
      this.resService.list(this.selectedFamily).subscribe({
        next: (data) => (this.resources = data || []),
        error: () => (this.resources = [])
      });
      return;
    }

    this.resService.list().subscribe({
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
      this.msg.add({ severity: 'warn', summary: 'Pick file', detail: 'Please choose a file first' });
      return;
    }

    const fd = new FormData();
    fd.append('file', this.pickedFile);
    if (this.title) fd.append('title', this.title);
    if (this.description) fd.append('description', this.description);

    if (this.isAminKhedmaOrDev()) {
      fd.append('family', this.selectedFamily);
    }

    this.resService.upload(fd).subscribe({
      next: () => {
        this.msg.add({ severity: 'success', summary: 'Uploaded', detail: 'File uploaded successfully' });
        this.title = '';
        this.description = '';
        this.pickedFile = null;
        this.loadResources();
      },
      error: (err) => {
        this.msg.add({ severity: 'error', summary: 'Error', detail: err?.error?.error || 'Upload failed' });
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
        this.msg.add({ severity: 'success', summary: 'Updated', detail: 'Resource updated' });
        this.editing = null;
        this.loadResources();
      },
      error: (err) => {
        this.msg.add({ severity: 'error', summary: 'Error', detail: err?.error?.error || 'Update failed' });
      }
    });
  }

  cancelEdit() {
    this.editing = null;
  }

remove(r: any) {
  this.confirmService.confirm({
    message: 'Delete this resource?',
    header: 'Confirm Delete',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Delete',
    rejectLabel: 'Cancel',
    accept: () => {
      this.resService.delete(r.id).subscribe({
        next: () => {
          this.msg.add({ severity: 'success', summary: 'Deleted', detail: 'Resource deleted' });
          this.loadResources();
        },
        error: (err) => {
          this.msg.add({ severity: 'error', summary: 'Error', detail: err?.error?.error || 'Delete failed' });
        }
      });
    }
  });
}


  download(r: any) {
    window.open(this.resService.downloadUrl(r.id), '_blank');
  }
}
