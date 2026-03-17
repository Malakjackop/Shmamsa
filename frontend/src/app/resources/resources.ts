import { Component, OnInit, inject, Inject, PLATFORM_ID, ElementRef, ViewChild } from '@angular/core';
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
  @ViewChild('uploadPanel') uploadPanel?: ElementRef<HTMLElement>;
  @ViewChild('resourceFileInput') resourceFileInput?: ElementRef<HTMLInputElement>;

  private auth = inject(AuthService);
  private famService = inject(FamilyService);
  private resService = inject(ResourcesService);
  private msg = inject(MessageService);
  private confirmService = inject(ConfirmationService);

  user: any = null;

  families: string[] = [];
  selectedFamily: string = '';
  familyMenuLocked = false;
  familyMenuHovered = false;

  resources: any[] = [];

  title: string = '';
  description: string = '';
  pickedFile: File | null = null;

  editing: any = null;

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

  private assignmentsOf(entity: any): Array<{ familyName: string; role: string }> {
    const assignments = Array.isArray(entity?.familyAssignments) ? entity.familyAssignments : [];
    return assignments
      .map((x: any) => ({
        familyName: String(x?.familyName || '').trim(),
        role: this.normRole(x?.role)
      }))
      .filter((x: any) => !!x.familyName);
  }

  private getServedFamilies(): string[] {
    const res: string[] = [];
    for (const assignment of this.assignmentsOf(this.user)) {
      const f = String(assignment.familyName || '').trim();
      if (!f) continue;
      const r = assignment.role;
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

  showFamilySelector(): boolean {
    return this.isUploader() && this.families.length > 1;
  }

  getFamilyLabel(family: string): string {
    return family === 'ALL' ? 'كل الاسر' : family;
  }

  private getLongestFamilyLabelLength(): number {
    return this.families
      .map((family) => this.getFamilyLabel(family).length)
      .reduce((longest, current) => Math.max(longest, current), this.getFamilyLabel(this.selectedFamily).length);
  }

  getFilterWidth(): string {
    const labelLength = this.familyMenuHovered
      ? this.getLongestFamilyLabelLength()
      : this.getFamilyLabel(this.selectedFamily).length;

    return `calc(${labelLength + 2}ch + 52px)`;
  }

  selectFamily(family: string): void {
    this.familyMenuLocked = true;
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    if (this.selectedFamily === family) {
      return;
    }

    this.selectedFamily = family;
    this.loadResources();
  }

  unlockFamilyMenu(): void {
    this.familyMenuHovered = false;
    this.familyMenuLocked = false;
  }

  onFamilyMenuEnter(): void {
    this.familyMenuHovered = true;
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

    if (this.editing) {
      this.saveEdit();
      return;
    }

    const trimmedTitle = this.title.trim();
    if (!trimmedTitle) {
      this.msg.add({ severity: 'warn', summary: 'العنوان مطلوب', detail: 'من فضلك اكتب اسم الملف أولا' });
      return;
    }

    if (!this.pickedFile) {
      this.msg.add({ severity: 'warn', summary: 'اختر ملف', detail: 'من فضلك اختر ملف أولا' });
      return;
    }

    const fd = new FormData();
    fd.append('file', this.pickedFile);
    fd.append('title', trimmedTitle);

    if (this.selectedFamily) {
      fd.append('family', this.selectedFamily);
    }

    this.resService.upload(fd).subscribe({
      next: () => {
        this.msg.add({ severity: 'success', summary: 'رفع', detail: 'تم رفع الملف بنجاح' });
        this.resetForm();
        this.loadResources();
      },
      error: (err) => {
        this.msg.add({ severity: 'error', summary: 'خطأ', detail: err?.error?.error || 'رفع فاشل' });
      }
    });
  }

  openEdit(r: any) {
    this.editing = r;
    this.title = r?.title || '';
    this.description = r?.description || '';
    this.pickedFile = null;
    this.resetFileInput();
    this.scrollToUploadPanel();
  }

  saveEdit() {
    if (!this.editing) return;

    const trimmedTitle = this.title.trim();
    if (!trimmedTitle) {
      this.msg.add({ severity: 'warn', summary: 'العنوان مطلوب', detail: 'من فضلك اكتب اسم الملف قبل الحفظ' });
      return;
    }

    const fd = new FormData();
    fd.append('title', trimmedTitle);
    fd.append('description', this.description || '');
    if (this.pickedFile) fd.append('file', this.pickedFile);

    this.resService.update(this.editing.id, fd).subscribe({
      next: () => {
        this.msg.add({ severity: 'success', summary: 'تحديث', detail: 'تم تحديث المصادر' });
        this.resetForm();
        this.loadResources();
      },
      error: (err) => {
        this.msg.add({ severity: 'error', summary: 'خطأ', detail: err?.error?.error || 'تحديث فاشل' });
      }
    });
  }

  cancelEdit() {
    this.resetForm();
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

  private resetForm(): void {
    this.editing = null;
    this.title = '';
    this.description = '';
    this.pickedFile = null;
    this.resetFileInput();
  }

  private resetFileInput(): void {
    if (this.resourceFileInput?.nativeElement) {
      this.resourceFileInput.nativeElement.value = '';
    }
  }

  private scrollToUploadPanel(): void {
    if (typeof document === 'undefined') {
      return;
    }

    const mainContainer = document.querySelector('.main');
    if (mainContainer instanceof HTMLElement) {
      mainContainer.scrollTo({ top: 0, behavior: 'smooth' });
    }

    this.uploadPanel?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
