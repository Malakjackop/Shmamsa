import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MessageService, ConfirmationService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { TagModule } from 'primeng/tag';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';

import { DevSettingsService, CustomField } from '../services/dev-settings.service';

@Component({
  selector: 'app-dev-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ToastModule,
    TableModule,
    ButtonModule,
    DialogModule,
    ConfirmDialogModule,
    TagModule,
    InputTextModule,
    SelectModule,
    DragDropModule
  ],
  providers: [MessageService, ConfirmationService],
  templateUrl: './dev-settings.html',
  styleUrls: ['./dev-settings.css']
})
export class DevSettingsComponent implements OnInit {
  private svc = inject(DevSettingsService);
  private msg = inject(MessageService);
  private confirm = inject(ConfirmationService);

  fields: CustomField[] = [];
  loading = true;

  /* ── Dialog state ─────────────────────────────────────── */
  dialogVisible = false;
  dialogMode: 'create' | 'edit' = 'create';
  editingField: Partial<CustomField> = {};

  fieldTypeOptions = [
    { label: 'نص (Text)', value: 'TEXT' },
    { label: 'قائمة اختيارات (Select)', value: 'SELECT' }
  ];

  visibilityOptions = [
    { label: 'يظهر دايماً', value: 'ALWAYS' },
    { label: 'مخدوم بس', value: 'MEMBER_ONLY' },
    { label: 'خادم بس', value: 'SERVANT_ONLY' },
    { label: 'طالب (أي نوع)', value: 'STUDENT_ONLY' },
    { label: 'طالب مدرسة', value: 'STUDENT_SCHOOL' },
    { label: 'طالب جامعة', value: 'STUDENT_UNIVERSITY' },
    { label: 'خريج بس', value: 'GRADUATE_ONLY' }
  ];

  showInOptions = [
    { label: 'بيانات الأسرة', value: 'FAMILY_INFO' },
    { label: 'الصفحة الشخصية', value: 'PROFILE' },
    { label: 'متظهرش', value: 'NONE' }
  ];

  ngOnInit(): void {
    this.loadFields();
  }

  loadFields(): void {
    this.loading = true;
    this.svc.getAllFields().subscribe({
      next: (data) => {
        this.fields = data;
        this.loading = false;
      },
      error: () => {
        this.msg.add({ severity: 'error', summary: 'خطأ', detail: 'فشل تحميل الحقول' });
        this.loading = false;
      }
    });
  }

  /* ── Dialog helpers ──────────────────────────────────── */
  openCreate(): void {
    this.dialogMode = 'create';
    this.editingField = {
      fieldKey: '',
      labelAr: '',
      fieldType: 'TEXT',
      options: '',
      required: false,
      visibilityRule: 'ALWAYS',
      showIn: 'NONE',
      displayOrder: this.fields.length
    };
    this.dialogVisible = true;
  }

  openEdit(f: CustomField): void {
    this.dialogMode = 'edit';
    this.editingField = { ...f };
    this.dialogVisible = true;
  }

  saveField(): void {
    if (!this.editingField.fieldKey?.trim() || !this.editingField.labelAr?.trim()) {
      this.msg.add({ severity: 'warn', summary: 'تنبيه', detail: 'المفتاح والاسم مطلوبين' });
      return;
    }

    if (this.dialogMode === 'create') {
      this.svc.createField(this.editingField).subscribe({
        next: () => {
          this.msg.add({ severity: 'success', summary: 'تم', detail: 'تم إنشاء الحقل بنجاح' });
          this.dialogVisible = false;
          this.loadFields();
        },
        error: (err) => {
          const detail = err?.error?.message || 'فشل إنشاء الحقل';
          this.msg.add({ severity: 'error', summary: 'خطأ', detail });
        }
      });
    } else {
      this.svc.updateField(this.editingField.id!, this.editingField).subscribe({
        next: () => {
          this.msg.add({ severity: 'success', summary: 'تم', detail: 'تم تعديل الحقل بنجاح' });
          this.dialogVisible = false;
          this.loadFields();
        },
        error: (err) => {
          const detail = err?.error?.message || 'فشل تعديل الحقل';
          this.msg.add({ severity: 'error', summary: 'خطأ', detail });
        }
      });
    }
  }

  toggleField(f: CustomField): void {
    this.svc.toggleField(f.id!).subscribe({
      next: (res) => {
        f.enabled = res.enabled;
        const status = res.enabled ? 'مفعّل' : 'معطّل';
        this.msg.add({ severity: 'info', summary: 'تم', detail: `الحقل ${status}` });
      },
      error: () => {
        this.msg.add({ severity: 'error', summary: 'خطأ', detail: 'فشل تحديث الحالة' });
      }
    });
  }

  deleteField(f: CustomField): void {
    this.confirm.confirm({
      message: `هل أنت متأكد من حذف الحقل "${f.labelAr}"؟ سيتم حذف كل البيانات المرتبطة.`,
      header: 'تأكيد الحذف',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'حذف',
      rejectLabel: 'إلغاء',
      accept: () => {
        this.svc.deleteField(f.id!).subscribe({
          next: () => {
            this.msg.add({ severity: 'success', summary: 'تم', detail: 'تم حذف الحقل' });
            this.loadFields();
          },
          error: () => {
            this.msg.add({ severity: 'error', summary: 'خطأ', detail: 'فشل حذف الحقل' });
          }
        });
      }
    });
  }

  moveUp(index: number): void {
    if (index <= 0) return;
    const curr = this.fields[index];
    const prev = this.fields[index - 1];
    const tmpOrder = curr.displayOrder;
    curr.displayOrder = prev.displayOrder;
    prev.displayOrder = tmpOrder;

    this.svc.updateField(curr.id!, { displayOrder: curr.displayOrder }).subscribe();
    this.svc.updateField(prev.id!, { displayOrder: prev.displayOrder }).subscribe({
      next: () => this.loadFields()
    });
  }

  moveDown(index: number): void {
    if (index >= this.fields.length - 1) return;
    const curr = this.fields[index];
    const next = this.fields[index + 1];
    const tmpOrder = curr.displayOrder;
    curr.displayOrder = next.displayOrder;
    next.displayOrder = tmpOrder;

    this.svc.updateField(curr.id!, { displayOrder: curr.displayOrder }).subscribe();
    this.svc.updateField(next.id!, { displayOrder: next.displayOrder }).subscribe({
      next: () => this.loadFields()
    });
  }

  /* ── Drag & Drop ────────────────────────────────────── */
  drop(event: CdkDragDrop<CustomField[]>) {
    if (event.previousIndex === event.currentIndex) return;

    moveItemInArray(this.fields, event.previousIndex, event.currentIndex);

    // Update display orders
    this.fields.forEach((f, idx) => {
      f.displayOrder = idx;
      this.svc.updateField(f.id!, { displayOrder: idx }).subscribe();
    });

    this.msg.add({ severity: 'success', summary: 'تم', detail: 'تم تحديث ترتيب الحقول' });
  }

  /* ── Label helpers ──────────────────────────────────── */
  enabledCount(): number {
    return this.fields.filter(f => f.enabled).length;
  }

  visibilityLabel(rule: string): string {
    return this.visibilityOptions.find(o => o.value === rule)?.label || rule;
  }

  showInLabel(val: string): string {
    return this.showInOptions.find(o => o.value === val)?.label || val;
  }

  typeLabel(type: string): string {
    return this.fieldTypeOptions.find(o => o.value === type)?.label || type;
  }
}
