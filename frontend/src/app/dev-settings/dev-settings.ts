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
import { forkJoin } from 'rxjs';

import { DevSettingsService, CustomField } from '../services/dev-settings.service';

interface FieldSection {
  id: string;
  title: string;
  fieldKeys: string[];
  fields: CustomField[];
}

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
  groupedSections: FieldSection[] = [];
  loading = true;

  /* ── Dialog state ─────────────────────────────────────── */
  dialogVisible = false;
  dialogMode: 'create' | 'edit' = 'create';
  editingField: Partial<CustomField> = {};
  optionInputs: string[] = [];
  selectedRequiredRules: string[] = [];

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

  requiredRuleOptions = [
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

  private readonly sectionDefinitions: Array<Omit<FieldSection, 'fields'>> = [
    {
      id: 'personal',
      title: 'بيانات شخصية للجميع',
      fieldKeys: [
        'username',
        'fullName',
        'phoneNumber',
        'address',
        'nationalId',
        'email',
        'dateOfBirth',
        'gender',
        'guardiansPhone',
        'guardianRelation'
      ]
    },
    {
      id: 'service',
      title: 'بيانات الخدمة',
      fieldKeys: [
        'deaconDegree',
        'deaconFamily',
        'khors',
        'servingWhere',
        'attendKhors'
      ]
    },
    {
      id: 'study',
      title: 'بيانات الدراسة',
      fieldKeys: [
        'status',
        'studyType',
        'schoolName',
        'schoolGrade',
        'otherGrade',
        'universityName',
        'faculty',
        'universityGrade'
      ]
    },
    {
      id: 'work',
      title: 'تفاصيل العمل',
      fieldKeys: [
        'graduatedFrom',
        'graduateJob',
        'isWorking',
        'workDetails'
      ]
    }
  ];

  ngOnInit(): void {
    this.loadFields();
  }

  loadFields(): void {
    this.loading = true;
    this.svc.getAllFields().subscribe({
      next: (data) => {
        this.fields = this.sortFields(data || []);
        this.rebuildSections();
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
      requiredRule: 'NEVER',
      visibilityRule: 'ALWAYS',
      showIn: 'NONE',
      displayOrder: this.fields.length
    };
    this.optionInputs = [''];
    this.selectedRequiredRules = [];
    this.dialogVisible = true;
  }

  openEdit(f: CustomField): void {
    this.dialogMode = 'edit';
    this.selectedRequiredRules = this.parseRequiredRules(f.requiredRule);
    this.editingField = {
      ...f,
      required: this.isRequiredConfigured(f),
      requiredRule: this.serializeRequiredRules(this.selectedRequiredRules)
    };
    this.optionInputs = this.parseOptions(f.options);
    this.dialogVisible = true;
  }

  saveField(): void {
    if (!this.editingField.fieldKey?.trim() || !this.editingField.labelAr?.trim()) {
      this.msg.add({ severity: 'warn', summary: 'تنبيه', detail: 'المفتاح والاسم مطلوبين' });
      return;
    }

    const keyRegex = /^[a-zA-Z0-9_]+$/;
    if (!keyRegex.test(this.editingField.fieldKey)) {
      this.msg.add({ severity: 'warn', summary: 'تنبيه', detail: 'مفتاح الحقل يجب أن يكون حروف إنجليزية وأرقام وعلامة _ فقط.' });
      return;
    }

    const payload: Partial<CustomField> = {
      ...this.editingField,
      required: !!this.editingField.required && this.selectedRequiredRules.length === 0,
      requiredRule: !!this.editingField.required ? this.serializeRequiredRules(this.selectedRequiredRules) : 'NEVER',
      options: this.editingField.fieldType === 'SELECT' ? this.optionInputs.map(o => o.trim()).filter(Boolean).join(',') : ''
    };

    if (this.dialogMode === 'create') {
      this.svc.createField(payload).subscribe({
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
      this.svc.updateField(this.editingField.id!, payload).subscribe({
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

  addOption(): void {
    this.optionInputs.push('');
  }

  removeOption(index: number): void {
    this.optionInputs.splice(index, 1);
    if (!this.optionInputs.length) {
      this.optionInputs = [''];
    }
  }

  onFieldTypeChange(): void {
    if (this.editingField.fieldType === 'SELECT' && !this.optionInputs.length) {
      this.optionInputs = [''];
    }
  }

  onRequiredToggle(required: boolean): void {
    this.editingField.required = !!required;
    if (!required) {
      this.selectedRequiredRules = [];
      this.editingField.requiredRule = 'NEVER';
    }
  }

  hasRequiredRule(rule: string): boolean {
    return this.selectedRequiredRules.includes(rule);
  }

  toggleRequiredRule(rule: string, checked: boolean): void {
    if (checked) {
      if (!this.selectedRequiredRules.includes(rule)) {
        this.selectedRequiredRules = [...this.selectedRequiredRules, rule];
      }
    } else {
      this.selectedRequiredRules = this.selectedRequiredRules.filter(item => item !== rule);
    }

    this.editingField.requiredRule = this.serializeRequiredRules(this.selectedRequiredRules);
  }

  isRequiredConfigured(field: Partial<CustomField>): boolean {
    return !!field.required || this.hasConditionalRequirement(field);
  }

  hasConditionalRequirement(field: Partial<CustomField>): boolean {
    return this.parseRequiredRules(field.requiredRule).length > 0;
  }

  requirementLabel(field: CustomField): string {
    if (field.required) {
      return 'Required';
    }
    if (this.hasConditionalRequirement(field)) {
      return 'Conditional';
    }
    return 'Optional';
  }

  isRequirementOptional(field: CustomField): boolean {
    return !field.required && !this.hasConditionalRequirement(field);
  }

  private parseOptions(options?: string): string[] {
    const parsed = (options || '')
      .split(',')
      .map(o => o.trim())
      .filter(Boolean);
    return parsed.length ? parsed : [''];
  }

  private parseRequiredRules(requiredRule?: string): string[] {
    const parsed = String(requiredRule || '')
      .split(',')
      .map(rule => rule.trim().toUpperCase())
      .filter(rule => !!rule && rule !== 'NEVER');

    return Array.from(new Set(parsed));
  }

  private serializeRequiredRules(rules: string[]): string {
    const normalized = Array.from(new Set((rules || []).map(rule => rule.trim().toUpperCase()).filter(Boolean)));
    return normalized.length ? normalized.join(',') : 'NEVER';
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
          error: (err) => {
            const detail = err?.error?.message || 'فشل حذف الحقل';
            this.msg.add({ severity: 'error', summary: 'خطأ', detail });
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
  dropSection(event: CdkDragDrop<CustomField[]>, sectionId: string) {
    if (event.previousIndex === event.currentIndex) return;

    const section = this.groupedSections.find(s => s.id === sectionId);
    if (!section) return;

    moveItemInArray(section.fields, event.previousIndex, event.currentIndex);

    const orderedFields = this.groupedSections.flatMap(s => s.fields).map((field, index) => ({
      ...field,
      displayOrder: index
    }));

    this.fields = orderedFields;
    this.rebuildSections();

    const requests = orderedFields
      .filter(field => field.id != null)
      .map(field => this.svc.updateField(field.id!, { displayOrder: field.displayOrder }));

    if (!requests.length) {
      this.msg.add({ severity: 'success', summary: 'تم', detail: 'تم تحديث ترتيب الحقول' });
      return;
    }

    forkJoin(requests).subscribe({
      next: () => {
        this.msg.add({ severity: 'success', summary: 'تم', detail: 'تم تحديث ترتيب الحقول' });
        this.loadFields();
      },
      error: () => {
        this.msg.add({ severity: 'error', summary: 'خطأ', detail: 'فشل حفظ ترتيب الحقول' });
        this.loadFields();
      }
    });
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

  private rebuildSections(): void {
    const sortedFields = this.sortFields(this.fields);
    const sectionByKey = new Map<string, string>();
    const sectionState = new Map<string, FieldSection>();

    this.sectionDefinitions.forEach(def => {
      sectionState.set(def.id, { ...def, fields: [] });
      def.fieldKeys.forEach(key => sectionByKey.set(key, def.id));
    });

    const additionalFields: CustomField[] = [];
    for (const field of sortedFields) {
      const sectionId = sectionByKey.get(field.fieldKey);
      if (!sectionId) {
        additionalFields.push(field);
        continue;
      }

      sectionState.get(sectionId)?.fields.push(field);
    }

    const sections = this.sectionDefinitions
      .map(def => sectionState.get(def.id)!)
      .filter(section => section.fields.length > 0);

    if (additionalFields.length) {
      sections.push({
        id: 'additional',
        title: 'حقول إضافية',
        fieldKeys: additionalFields.map(field => field.fieldKey),
        fields: additionalFields
      });
    }

    this.groupedSections = sections;
  }

  private sortFields(fields: CustomField[]): CustomField[] {
    return [...fields].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
  }
}
