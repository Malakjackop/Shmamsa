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

import { DevSettingsService, CustomField, VisibilityCondition } from '../services/dev-settings.service';
import { AuthService, FamilyOption } from '../services/auth.service';
import { effectiveShowInTargets, parseShowInTargets } from '../shared/custom-field-display';

interface FieldSection {
  id: string;
  title: string;
  fieldKeys: string[];
  fields: CustomField[];
}

interface VisibilityConditionDraft {
  type: 'RULE' | 'FIELD';
  rule: string;
  fieldKey: string;
  values: string[];
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
  private authService = inject(AuthService);
  private msg = inject(MessageService);
  private confirm = inject(ConfirmationService);
  private readonly showInTargetOrder = ['FAMILY_INFO', 'PROFILE'];
  private readonly showInTargetLabels: Record<string, string> = {
    FAMILY_INFO: 'بيانات الأسرة',
    PROFILE: 'الصفحة الشخصية'
  };

  fields: CustomField[] = [];
  groupedSections: FieldSection[] = [];
  loading = true;

  /* ── Dialog state ─────────────────────────────────────── */
  dialogVisible = false;
  dialogMode: 'create' | 'edit' = 'create';
  editingField: Partial<CustomField> = {};
  optionInputs: string[] = [];
  selectedRequiredRules: string[] = [];
  visibilityConditions: VisibilityConditionDraft[] = [];
  memberFamilyOptions: string[] = [];
  servantFamilyOptions: string[] = [];

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

  visibilityConditionRuleOptions = [
    { label: 'لا يظهر', value: 'NEVER' },
    ...this.requiredRuleOptions
  ];

  visibilityConditionTypeOptions = [
    { label: 'شرط عام', value: 'RULE' as const },
    { label: 'قيمة حقل', value: 'FIELD' as const }
  ];

  showInOptions = [
    { label: 'بيانات الأسرة', value: 'FAMILY_INFO' },
    { label: 'الصفحة الشخصية', value: 'PROFILE' },
    { label: 'بيانات الأسرة والصفحة الشخصية', value: 'FAMILY_INFO,PROFILE' },
    { label: 'متظهرش', value: 'NONE' }
  ];

  private readonly visibilityDependencyFallbackOptions: Record<string, string[]> = {
    gender: ['MALE', 'FEMALE'],
    deaconDegree: ['مش مرشوم', 'ابصالتس', 'اغنسطس', 'ايبودياكون'],
    khors: ['MARMARKOS', 'ATHANASIUS', 'NONE'],
    attendKhors: ['MARMARKOS', 'ATHANASIUS', 'NONE'],
    status: ['student', 'graduate'],
    studyType: ['school', 'university'],
    schoolGrade: ['أولى ابتدائي', 'تانية ابتدائي', 'تالتة ابتدائي', 'رابعة ابتدائي', 'خامسة ابتدائي', 'سادسة ابتدائي', 'أولى إعدادي', 'تانية إعدادي', 'تالتة إعدادي', 'أولى ثانوي', 'تانية ثانوي', 'تالتة ثانوي', 'other'],
    isWorking: ['false', 'true']
  };

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
    this.loadFamilyOptionSources();
    this.loadFields();
  }

  loadFields(): void {
    this.loading = true;
    this.svc.getAllFields().subscribe({
      next: (data) => {
        this.fields = this.sortFields((data || []).map(field => ({
          ...field,
          showIn: this.resolveEffectiveShowInValue(field.showIn, field)
        })));
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
    this.visibilityConditions = [];
    this.dialogVisible = true;
  }

  openEdit(f: CustomField): void {
    this.dialogMode = 'edit';
    this.selectedRequiredRules = this.parseRequiredRules(f.requiredRule);
    this.visibilityConditions = this.deserializeVisibilityConditions(f);
    this.editingField = {
      ...f,
      required: this.isRequiredConfigured(f),
      requiredRule: this.serializeRequiredRules(this.selectedRequiredRules),
      showIn: this.resolveEffectiveShowInValue(f.showIn, f),
      visibilityRule: 'ALWAYS',
      visibilityDependsOn: '',
      visibilityDependsValues: ''
    };
    this.optionInputs = this.resolveDialogOptions(f);
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

    const visibilityConditions = this.serializeVisibilityConditions();
    if (visibilityConditions === null) {
      return;
    }

    const payload: Partial<CustomField> = {
      ...this.editingField,
      required: !!this.editingField.required && this.selectedRequiredRules.length === 0,
      requiredRule: !!this.editingField.required ? this.serializeRequiredRules(this.selectedRequiredRules) : 'NEVER',
      showIn: this.normalizeConfiguredShowInValue(this.editingField.showIn),
      showInConfigured: true,
      visibilityRule: this.legacyVisibilityRule(visibilityConditions),
      visibilityDependsOn: this.legacyVisibilityDependsOn(visibilityConditions),
      visibilityDependsValues: this.legacyVisibilityDependsValues(visibilityConditions),
      visibilityConditions,
      options: this.resolveOptionsPayload()
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

  usesManagedFamilyOptions(field: Partial<CustomField> = this.editingField): boolean {
    return this.getManagedFamilyFieldAudience(field.fieldKey) !== null;
  }

  addVisibilityCondition(): void {
    this.visibilityConditions = [
      ...this.visibilityConditions,
      { type: 'RULE', rule: this.requiredRuleOptions[0]?.value || '', fieldKey: '', values: [] }
    ];
  }

  removeVisibilityCondition(index: number): void {
    this.visibilityConditions = this.visibilityConditions.filter((_, currentIndex) => currentIndex !== index);
  }

  onVisibilityConditionTypeChange(index: number): void {
    const condition = this.visibilityConditions[index];
    if (!condition) {
      return;
    }

    if (condition.type === 'RULE') {
      condition.rule = condition.rule || this.requiredRuleOptions[0]?.value || '';
      condition.fieldKey = '';
      condition.values = [];
      return;
    }

    condition.rule = '';
    condition.fieldKey = '';
    condition.values = [];
  }

  onVisibilityConditionFieldChange(index: number, fieldKey: string): void {
    const condition = this.visibilityConditions[index];
    if (!condition) {
      return;
    }

    const normalizedFieldKey = String(fieldKey || '').trim();
    condition.fieldKey = normalizedFieldKey;

    if (!normalizedFieldKey) {
      condition.values = [];
      return;
    }

    const allowedOptions = new Set(this.getVisibilityDependencyOptions(normalizedFieldKey));
    condition.values = condition.values.filter(value => allowedOptions.has(value));
  }

  visibilityDependencyFieldChoices(currentCondition?: VisibilityConditionDraft): Array<{ label: string; value: string }> {
    const currentFieldKey = String(this.editingField.fieldKey || '').trim();
    const currentDependsOn = String(currentCondition?.fieldKey || '').trim();
    const currentOrder = this.dialogMode === 'create'
      ? Number.MAX_SAFE_INTEGER
      : Number(this.editingField.displayOrder ?? Number.MAX_SAFE_INTEGER);

    return this.sortFields(this.fields)
      .filter(field => field.fieldKey !== currentFieldKey)
      .filter(field => field.fieldKey === currentDependsOn || (
        this.supportsVisibilityDependencyField(field) &&
        (field.displayOrder ?? 0) < currentOrder
      ))
      .map(field => ({ label: field.labelAr, value: field.fieldKey }));
  }

  getVisibilityDependencyOptions(fieldKey?: string): string[] {
    const normalizedFieldKey = String(fieldKey || '').trim();
    if (!normalizedFieldKey) {
      return [];
    }

    const managedOptions = this.getManagedFamilyOptions(normalizedFieldKey);
    if (managedOptions.length) {
      return managedOptions;
    }

    const configuredOptions = (this.fields.find(field => field.fieldKey === normalizedFieldKey)?.options || '')
      .split(',')
      .map(option => option.trim())
      .filter(Boolean);

    if (configuredOptions.length) {
      return configuredOptions;
    }

    return [...(this.visibilityDependencyFallbackOptions[normalizedFieldKey] || [])];
  }

  visibilityDependencyValueLabel(fieldKey: string | undefined, value: string): string {
    const normalizedFieldKey = String(fieldKey || '').trim();
    const normalizedValue = String(value || '').trim();

    if (normalizedFieldKey === 'gender') {
      if (normalizedValue === 'MALE') return 'ذكر';
      if (normalizedValue === 'FEMALE') return 'أنثى';
    }
    if (normalizedFieldKey === 'status') {
      if (normalizedValue === 'student') return 'طالب';
      if (normalizedValue === 'graduate') return 'خريج';
    }
    if (normalizedFieldKey === 'studyType') {
      if (normalizedValue === 'school') return 'مدرسة';
      if (normalizedValue === 'university') return 'جامعة';
    }
    if (normalizedFieldKey === 'isWorking') {
      if (normalizedValue === 'true') return 'نعم';
      if (normalizedValue === 'false') return 'لا';
    }
    if (normalizedFieldKey === 'khors' || normalizedFieldKey === 'attendKhors') {
      if (normalizedValue === 'MARMARKOS') return 'خورس مارمرقس';
      if (normalizedValue === 'ATHANASIUS') return 'خورس البابا أثناسيوس';
      if (normalizedValue === 'NONE') return 'بدون خورس';
    }
    if (normalizedFieldKey === 'schoolGrade' && normalizedValue === 'other') {
      return 'أخرى';
    }

    return normalizedValue;
  }

  hasVisibilityConditionValue(index: number, value: string): boolean {
    return !!this.visibilityConditions[index]?.values.includes(value);
  }

  toggleVisibilityConditionValue(index: number, value: string, checked: boolean): void {
    const condition = this.visibilityConditions[index];
    if (!condition) {
      return;
    }

    if (checked) {
      if (!condition.values.includes(value)) {
        condition.values = [...condition.values, value];
      }
    } else {
      condition.values = condition.values.filter(item => item !== value);
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

  private parseCsvValues(values?: string): string[] {
    return Array.from(new Set(
      String(values || '')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean)
    ));
  }

  private serializeCsvValues(values: string[]): string {
    const normalized = Array.from(new Set((values || []).map(value => value.trim()).filter(Boolean)));
    return normalized.join(',');
  }

  private deserializeVisibilityConditions(field: Partial<CustomField>): VisibilityConditionDraft[] {
    const fromApi = Array.isArray(field.visibilityConditions)
      ? field.visibilityConditions
      : [];

    if (fromApi.length) {
      return fromApi
        .map(condition => this.toVisibilityConditionDraft(condition))
        .filter((condition): condition is VisibilityConditionDraft => condition !== null);
    }

    const legacyConditions: VisibilityConditionDraft[] = [];
    const legacyRule = String(field.visibilityRule || '').trim().toUpperCase();
    if (legacyRule && legacyRule !== 'ALWAYS') {
      legacyConditions.push({
        type: 'RULE',
        rule: legacyRule,
        fieldKey: '',
        values: []
      });
    }

    const legacyFieldKey = String(field.visibilityDependsOn || '').trim();
    const legacyValues = this.parseCsvValues(field.visibilityDependsValues);
    if (legacyFieldKey && legacyValues.length) {
      legacyConditions.push({
        type: 'FIELD',
        rule: '',
        fieldKey: legacyFieldKey,
        values: legacyValues
      });
    }

    return legacyConditions;
  }

  private toVisibilityConditionDraft(condition: VisibilityCondition | null | undefined): VisibilityConditionDraft | null {
    if (!condition) {
      return null;
    }

    const type = String(condition.type || '').trim().toUpperCase();
    if (type === 'RULE') {
      const rule = String(condition.rule || '').trim().toUpperCase();
      if (!rule) {
        return null;
      }
      return { type: 'RULE', rule, fieldKey: '', values: [] };
    }

    if (type === 'FIELD') {
      const fieldKey = String(condition.fieldKey || '').trim();
      const values = Array.from(new Set((condition.values || []).map(value => String(value || '').trim()).filter(Boolean)));
      if (!fieldKey || !values.length) {
        return null;
      }
      return { type: 'FIELD', rule: '', fieldKey, values };
    }

    return null;
  }

  private serializeVisibilityConditions(): VisibilityCondition[] | null {
    const normalizedConditions: VisibilityCondition[] = [];

    for (const condition of this.visibilityConditions) {
      if (!condition) {
        continue;
      }

      if (condition.type === 'RULE') {
        const rule = String(condition.rule || '').trim().toUpperCase();
        if (!rule) {
          this.msg.add({ severity: 'warn', summary: 'تنبيه', detail: 'اختَر الشرط العام في كل سطر من شروط الظهور.' });
          return null;
        }

        normalizedConditions.push({ type: 'RULE', rule });
        continue;
      }

      const fieldKey = String(condition.fieldKey || '').trim();
      if (!fieldKey) {
        this.msg.add({ severity: 'warn', summary: 'تنبيه', detail: 'اختَر الحقل الذي سيعتمد عليه شرط الظهور.' });
        return null;
      }

      const values = Array.from(new Set((condition.values || []).map(value => String(value || '').trim()).filter(Boolean)));
      if (!values.length) {
        this.msg.add({ severity: 'warn', summary: 'تنبيه', detail: 'اختَر قيمة واحدة على الأقل لكل شرط ظهور يعتمد على حقل.' });
        return null;
      }

      normalizedConditions.push({ type: 'FIELD', fieldKey, values });
    }

    return normalizedConditions;
  }

  private legacyVisibilityRule(conditions: VisibilityCondition[]): string {
    return conditions.find(condition => condition.type === 'RULE')?.rule || 'ALWAYS';
  }

  private legacyVisibilityDependsOn(conditions: VisibilityCondition[]): string {
    return conditions.find(condition => condition.type === 'FIELD')?.fieldKey || '';
  }

  private legacyVisibilityDependsValues(conditions: VisibilityCondition[]): string {
    return this.serializeCsvValues(conditions.find(condition => condition.type === 'FIELD')?.values || []);
  }

  private supportsVisibilityDependencyField(field: CustomField): boolean {
    if (!field?.enabled) {
      return false;
    }

    if (field.fieldType === 'SELECT') {
      return this.getVisibilityDependencyOptions(field.fieldKey).length > 0;
    }

    return this.getVisibilityDependencyOptions(field.fieldKey).length > 0;
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
    const normalized = this.normalizeConfiguredShowInValue(val);
    if (normalized === 'NONE') {
      return this.showInOptions.find(o => o.value === 'NONE')?.label || 'متظهرش';
    }

    return parseShowInTargets(normalized)
      .map(target => this.showInTargetLabels[target] || target)
      .join(' + ');
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

  private loadFamilyOptionSources(): void {
    forkJoin({
      member: this.authService.getFamilyOptions('MEMBER'),
      servant: this.authService.getFamilyOptions('SERVANT')
    }).subscribe({
      next: ({ member, servant }) => {
        this.memberFamilyOptions = this.extractFamilyNames(member || []);
        this.servantFamilyOptions = this.extractFamilyNames(servant || []);
        this.refreshManagedFieldOptionsIfNeeded();
      },
      error: () => {
        this.memberFamilyOptions = [];
        this.servantFamilyOptions = [];
      }
    });
  }

  private extractFamilyNames(options: FamilyOption[]): string[] {
    return Array.from(new Set(
      (options || [])
        .map(option => String(option?.nameAr || '').trim())
        .filter(Boolean)
    ));
  }

  private getManagedFamilyFieldAudience(fieldKey?: string | null): 'MEMBER' | 'SERVANT' | null {
    const normalized = String(fieldKey || '').trim();
    if (normalized === 'deaconFamily') return 'MEMBER';
    if (normalized === 'servingWhere') return 'SERVANT';
    return null;
  }

  private getManagedFamilyOptions(fieldKey?: string | null): string[] {
    const audience = this.getManagedFamilyFieldAudience(fieldKey);
    if (audience === 'MEMBER') {
      return [...this.memberFamilyOptions];
    }
    if (audience === 'SERVANT') {
      return [...this.servantFamilyOptions];
    }
    return [];
  }

  private resolveDialogOptions(field: Partial<CustomField>): string[] {
    const managedOptions = this.getManagedFamilyOptions(field.fieldKey);
    if (managedOptions.length) {
      return managedOptions;
    }
    return this.parseOptions(field.options);
  }

  private refreshManagedFieldOptionsIfNeeded(): void {
    if (!this.dialogVisible || !this.usesManagedFamilyOptions()) {
      return;
    }
    this.optionInputs = this.resolveDialogOptions(this.editingField);
  }

  private resolveOptionsPayload(): string {
    if (this.editingField.fieldType !== 'SELECT') {
      return '';
    }
    if (this.usesManagedFamilyOptions()) {
      return String(this.editingField.options || '').trim();
    }
    return this.optionInputs.map(o => o.trim()).filter(Boolean).join(',');
  }

  private resolveEffectiveShowInValue(showIn?: string | null, field?: Partial<CustomField> | null): string {
    const targets = effectiveShowInTargets({
      fieldKey: String(field?.fieldKey || '').trim(),
      isSystem: !!field?.isSystem,
      showInConfigured: !!field?.showInConfigured,
      showIn: showIn || ''
    });
    const orderedTargets = this.showInTargetOrder.filter(target => targets.includes(target));
    return orderedTargets.length ? orderedTargets.join(',') : 'NONE';
  }

  private normalizeConfiguredShowInValue(showIn?: string | null): string {
    const targets = parseShowInTargets(showIn);
    const orderedTargets = this.showInTargetOrder.filter(target => targets.includes(target));
    return orderedTargets.length ? orderedTargets.join(',') : 'NONE';
  }
}
