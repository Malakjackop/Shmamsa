import { Component, OnInit, inject, Inject, PLATFORM_ID, ElementRef, ViewChild } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { AuthService } from '../services/auth.service';
import { FamilyService } from '../services/family.service';
import { ResourcesService } from '../services/resources.service';
import { MessageService } from 'primeng/api';
import { ConfirmationService } from 'primeng/api';
import { normalizeAssignmentRole, normalizeRole } from '../shared/role-utils';

type ResourceCategory = 'GENERAL' | 'HYMNS' | 'COPTIC' | 'STUDIES';

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

  resources: any[] = [];
  readonly categoryOptions: Array<{ value: ResourceCategory; label: string }> = [
    { value: 'GENERAL', label: 'عام' },
    { value: 'HYMNS', label: 'الحان' },
    { value: 'COPTIC', label: 'قبطي' },
    { value: 'STUDIES', label: 'دراسات' }
  ];
  selectedUploadCategory: ResourceCategory = 'GENERAL';

  title: string = '';
  pickedFile: File | null = null;

  editing: any = null;

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

  private normRole(v: any): string {
    return normalizeRole(v);
  }

  private assignmentsOf(entity: any): Array<{ familyName: string; role: string }> {
    const assignments = Array.isArray(entity?.familyAssignments) ? entity.familyAssignments : [];
    return assignments
      .map((x: any) => ({
        familyName: String(x?.familyName || '').trim(),
        role: normalizeAssignmentRole(x, entity?.role)
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
    this.familyMenuLocked = false;
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
        next: (data) => (this.resources = (data || []).map((r) => ({ ...r, category: this.normalizeCategory(r?.category) }))),
        error: () => (this.resources = [])
      });
      return;
    }

    this.resService.list(this.selectedFamily || undefined).subscribe({
      next: (data) => (this.resources = (data || []).map((r) => ({ ...r, category: this.normalizeCategory(r?.category) }))),
      error: () => (this.resources = [])
    });
  }

  selectUploadCategory(category: ResourceCategory): void {
    this.selectedUploadCategory = category;
  }

  get selectedUploadCategoryLabel(): string {
    return this.categoryOptions.find((category) => category.value === this.selectedUploadCategory)?.label || '';
  }

  get uploadCategoryIndex(): number {
    const index = this.categoryOptions.findIndex((category) => category.value === this.selectedUploadCategory);
    return index >= 0 ? index : 0;
  }

  get categorySections(): Array<{ value: ResourceCategory; label: string; items: any[] }> {
    const activeCategory = this.selectedUploadCategory;
    return this.categoryOptions
      .filter((category) => category.value === activeCategory)
      .map((category) => ({
        ...category,
        items: (this.resources || []).filter((r) => this.normalizeCategory(r?.category) === category.value)
      }))
      .filter((section) => section.items.length > 0);
  }

  private normalizeCategory(value: any): ResourceCategory {
    const normalized = String(value || '').trim().toUpperCase();
    if (normalized === 'HYMNS' || normalized === 'COPTIC' || normalized === 'STUDIES') return normalized;
    return 'GENERAL';
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
    fd.append('category', this.selectedUploadCategory);

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
    this.selectedUploadCategory = this.normalizeCategory(r?.category);
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
    fd.append('category', this.selectedUploadCategory);
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
    this.selectedUploadCategory = 'GENERAL';
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

