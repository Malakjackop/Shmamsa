import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { MessageService, ConfirmationService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { TagModule } from 'primeng/tag';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { forkJoin, interval, Subscription } from 'rxjs';

import { DevSettingsService, CustomField, VisibilityCondition, FamilyCatalog, SecretCodeResponse } from '../services/dev-settings.service';
import { AuthService, FamilyOption } from '../services/auth.service';
import { effectiveProfileEditable, effectiveShowInTargets, parseShowInTargets } from '../shared/custom-field-display';

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
    RouterModule,
    ToastModule,
    TableModule,
    ButtonModule,
    DialogModule,
    ConfirmDialogModule,
    TagModule,
    InputTextModule,
    SelectModule,
    DatePickerModule,
    DragDropModule
  ],
  providers: [MessageService, ConfirmationService],
  templateUrl: './dev-settings.html',
  styleUrls: ['./dev-settings.css']
})
export class DevSettingsComponent implements OnInit, OnDestroy {
  private svc = inject(DevSettingsService);
  private authService = inject(AuthService);
  private msg = inject(MessageService);
  private confirm = inject(ConfirmationService);
  private route = inject(ActivatedRoute);
  private readonly showInTargetOrder = ['FAMILY_INFO', 'PROFILE', 'IFTEKAD'];
  private readonly showInTargetLabels: Record<string, string> = {
    FAMILY_INFO: 'بيانات الأسرة',
    PROFILE: 'الصفحة الشخصية',
    IFTEKAD: 'الافتقاد'
  };

  fields: CustomField[] = [];
  groupedSections: FieldSection[] = [];
  collapsedSectionIds: Set<string> = new Set();
  loading = true;

  /* ── Tab state ────────────────────────────────────────── */
  activeTab: 'fields' | 'families' | 'secret' | 'permissions' = 'fields';

  /* ── Families state ───────────────────────────────────── */
  families: FamilyCatalog[] = [];
  familiesLoading = false;
  familyCategoryCollapsedIds: Set<string> = new Set();
  familyDialogVisible = false;
  familyDialogMode: 'create' | 'edit' = 'create';
  editingFamily: Partial<FamilyCatalog> = {};
  familyDateFrom: Date | null = null;
  familyDateUntil: Date | null = null;
  familyDirectJoinEnabled = false;
  familyHasBranches = false;
  familyBranchCount = 0;

  /* ── Family join config ───────────────────────────────── */
  knownSchoolGrades = [
    'أولى ابتدائي', 'تانية ابتدائي', 'تالتة ابتدائي', 'رابعة ابتدائي', 'خامسة ابتدائي', 'سادسة ابتدائي',
    'أولى إعدادي', 'تانية إعدادي', 'تالتة إعدادي',
    'أولى ثانوي', 'تانية ثانوي', 'تالتة ثانوي',
    'other'
  ];
  selectedDirectJoinGrades: string[] = [];

  /* ── Secret Code state ────────────────────────────────── */
  secretCode = '';
  secretValidFrom: string = '';
  secretValidTo: string = '';
  secretValid = false;
  secretLoading = false;
  secretGenerating = false;
  remainingSeconds = 0;
  private timerSub?: Subscription;

  /* ── Dialog state ─────────────────────────────────────── */
  dialogVisible = false;
  dialogMode: 'create' | 'edit' = 'create';
  editingField: Partial<CustomField> = {};
  optionInputs: string[] = [];
  selectedRequiredRules: string[] = [];
  visibilityConditions: VisibilityConditionDraft[] = [];
  memberFamilyOptions: string[] = [];
  servantFamilyOptions: string[] = [];
  khorsFamilyOptions: string[] = [];
  attendKhorsFamilyOptions: string[] = [];
  private familyOptionsLoaded = false;

  /* ── Role Settings state ────────────────────────────── */
  roles: Array<{
    id?: number;
    name: string;
    displayNameAr: string;
    sortOrder: number;
    active: boolean;
    permissions: string;
  }> = [];
  allPermissions: string[] = [];
  roleLoading = false;
  roleDialogVisible = false;
  roleDialogMode: 'create' | 'edit' = 'create';
  editingRole: Partial<{
    id?: number;
    name: string;
    displayNameAr: string;
    sortOrder: number;
    active: boolean;
    permissions: string;
  }> = {};
  selectedPermissions: string[] = [];

  permissionLabels: Record<string, string> = {
    VIEW_ATTENDANCE: 'عرض الحضور',
    TAKE_ATTENDANCE: 'تسجيل الحضور',
    VIEW_FAMILY_INFO: 'عرض بيانات الأسر',
    MANAGE_FAMILY_INFO: 'تعديل بيانات الأسر',
    MANAGE_EVENTS: 'إدارة المناسبات',
    MANAGE_ANNOUNCEMENTS: 'إدارة الإعلانات',
    MANAGE_IFTEKAD: 'إدارة الافتقاد',
    TRANSFER_MEMBERS: 'نقل الأعضاء',
    MANAGE_ROLES: 'إدارة الصلاحيات',
    START_NEW_YEAR: 'بدء سنة جديدة',
    MANAGE_KHORS: 'إدارة الخورس',
    VIEW_GRADES: 'عرض الدرجات',
    MANAGE_REGISTRATION_FIELDS: 'إدارة حقول التسجيل',
    MANAGE_FAMILIES: 'إدارة الأسر',
    MANAGE_SECRET_CODE: 'إدارة الكود السري',
    MANAGE_RESOURCES: 'إدارة الملفات',
    VIEW_ATTENDANCE_HISTORY: 'عرض تاريخ الحضور',
    MANAGE_ATTENDANCE_ACCESS: 'إدارة صلاحيات الحضور'
  };

  categoryOptions: string[] = [];
  selectedCategory: string = '';
  newCategoryName: string = '';
  showNewCategoryInput = false;

  fieldTypeOptions = [
    { label: 'نص (Text)', value: 'TEXT' },
    { label: 'قائمة اختيارات (Select)', value: 'SELECT' },
    { label: 'تاريخ (Date)', value: 'DATE' }
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
    { label: 'الافتقاد', value: 'IFTEKAD' }
  ];

  private get availableCategories(): string[] {
    const cats = new Set<string>();
    this.sectionDefinitions.forEach(s => cats.add(s.title));
    this.fields.forEach(f => { if (f.category?.trim()) cats.add(f.category!.trim()); });
    return Array.from(cats).sort();
  }

  private readonly visibilityDependencyFallbackOptions: Record<string, string[]> = {
    gender: ['MALE', 'FEMALE'],
    deaconDegree: ['مش مرشوم', 'ابصالتس', 'اغنسطس', 'ايبودياكون'],
    status: ['student', 'graduate'],
    studyType: ['school', 'university'],
    schoolGrade: ['أولى ابتدائي', 'تانية ابتدائي', 'تالتة ابتدائي', 'رابعة ابتدائي', 'خامسة ابتدائي', 'سادسة ابتدائي', 'أولى إعدادي', 'تانية إعدادي', 'تالتة إعدادي', 'أولى ثانوي', 'تانية ثانوي', 'تالتة ثانوي', 'other'],
    isWorking: ['false', 'true']
  };

  private readonly sectionDefinitions: Array<Omit<FieldSection, 'fields'>> = [
    {
      id: 'personal',
      title: 'بيانات شخصية ',
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
    this.route.queryParams.subscribe(params => {
      const tab = params['tab'];
      if (tab === 'families') {
        this.activeTab = 'families';
        this.loadFamilies();
      } else if (tab === 'secret') {
        this.activeTab = 'secret';
        this.loadSecretCode();
      } else if (tab === 'permissions') {
        this.activeTab = 'permissions';
        this.loadRoles();
      } else {
        this.activeTab = 'fields';
      }
    });
    this.loadFields();
  }

  loadFields(): void {
    this.loading = true;
    this.svc.getAllFields().subscribe({
      next: (data) => {
        this.fields = this.sortFields((data || []).map(field => ({
          ...field,
          showIn: this.resolveEffectiveShowInValue(field.showIn, field),
          profileEditable: this.resolveEffectiveProfileEditable(field)
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
    this.ensureFamilyOptionsLoaded();
    this.editingField = {
      fieldKey: '',
      labelAr: '',
      fieldType: 'TEXT',
      options: '',
      required: false,
      requiredRule: 'NEVER',
      visibilityRule: 'ALWAYS',
      showIn: 'NONE',
      profileEditable: false,
      displayOrder: this.fields.length,
      category: ''
    };
    this.selectedCategory = '';
    this.newCategoryName = '';
    this.showNewCategoryInput = false;
    this.categoryOptions = this.availableCategories;
    this.optionInputs = [''];
    this.selectedRequiredRules = [];
    this.visibilityConditions = [];
    this.dialogVisible = true;
  }

  openEdit(f: CustomField): void {
    this.ensureFamilyOptionsLoaded();
    this.dialogMode = 'edit';
    this.selectedRequiredRules = this.parseRequiredRules(f.requiredRule);
    this.visibilityConditions = this.deserializeVisibilityConditions(f);
    this.editingField = {
      ...f,
      required: this.isRequiredConfigured(f),
      requiredRule: this.serializeRequiredRules(this.selectedRequiredRules),
      showIn: this.resolveEffectiveShowInValue(f.showIn, f),
      profileEditable: this.resolveEffectiveProfileEditable(f),
      visibilityRule: 'ALWAYS',
      visibilityDependsOn: '',
      visibilityDependsValues: ''
    };
    const inferredCategory = f.category || this.inferSectionFromFieldKey(f.fieldKey) || '';
    this.selectedCategory = inferredCategory;
    if (!f.category && inferredCategory) {
      this.editingField.category = inferredCategory;
    }
    this.newCategoryName = '';
    this.showNewCategoryInput = false;
    this.categoryOptions = this.availableCategories;
    this.optionInputs = this.resolveDialogOptions(f);
    this.dialogVisible = true;
  }

  onCategoryChange(category: string): void {
    if (category === '__new__') {
      this.showNewCategoryInput = true;
      this.newCategoryName = '';
      this.editingField.category = '';
    } else {
      this.showNewCategoryInput = false;
      this.editingField.category = category;
    }
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

    const category = !this.showNewCategoryInput
      ? this.editingField.category
      : this.newCategoryName.trim();

    const payload: Partial<CustomField> = {
      ...this.editingField,
      category: category || '',
      required: !!this.editingField.required && this.selectedRequiredRules.length === 0,
      requiredRule: !!this.editingField.required ? this.serializeRequiredRules(this.selectedRequiredRules) : 'NEVER',
      showIn: this.normalizeConfiguredShowInValue(this.editingField.showIn),
      showInConfigured: true,
      profileEditable: this.showInIncludesProfile(this.editingField.showIn) && !!this.editingField.profileEditable,
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

  onShowInChange(showInValue = this.editingField.showIn): void {
    this.editingField.showIn = this.normalizeConfiguredShowInValue(showInValue);
    if (!this.showInIncludesProfile(this.editingField.showIn)) {
      this.editingField.profileEditable = false;
    }
  }

  showInHasTarget(target: string): boolean {
    return parseShowInTargets(this.editingField.showIn).includes(target);
  }

  toggleShowInTarget(target: string, checked: boolean): void {
    const selected = new Set(parseShowInTargets(this.editingField.showIn));
    if (checked) {
      selected.add(target);
    } else {
      selected.delete(target);
    }

    this.onShowInChange(Array.from(selected).join(','));
  }

  showInIncludesProfile(showInValue?: string | null): boolean {
    return parseShowInTargets(showInValue).includes('PROFILE');
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

    const reorderItems = orderedFields
      .filter(field => field.id != null)
      .map(field => ({ id: field.id!, displayOrder: field.displayOrder }));

    if (!reorderItems.length) {
      this.msg.add({ severity: 'success', summary: 'تم', detail: 'تم تحديث ترتيب الحقول' });
      return;
    }

    this.svc.reorderFields(reorderItems).subscribe({
      next: () => {
        this.msg.add({ severity: 'success', summary: 'تم', detail: 'تم تحديث ترتيب الحقول' });
      },
      error: () => {
        this.msg.add({ severity: 'error', summary: 'خطأ', detail: 'فشل حفظ ترتيب الحقول' });
        this.loadFields();
      }
    });
  }

  toggleSection(sectionId: string): void {
    if (this.collapsedSectionIds.has(sectionId)) {
      this.collapsedSectionIds.delete(sectionId);
    } else {
      this.collapsedSectionIds.add(sectionId);
    }
  }

  dropCategory(event: CdkDragDrop<FieldSection[]>) {
    if (event.previousIndex === event.currentIndex) return;

    moveItemInArray(this.groupedSections, event.previousIndex, event.currentIndex);

    const orderedFields = this.groupedSections.flatMap(s => s.fields).map((field, index) => ({
      ...field,
      displayOrder: index
    }));

    this.fields = orderedFields;

    const reorderItems = orderedFields
      .filter(field => field.id != null)
      .map(field => ({ id: field.id!, displayOrder: field.displayOrder }));

    if (!reorderItems.length) {
      this.msg.add({ severity: 'success', summary: 'تم', detail: 'تم تحديث ترتيب التصنيفات' });
      return;
    }

    this.svc.reorderFields(reorderItems).subscribe({
      next: () => {
        this.msg.add({ severity: 'success', summary: 'تم', detail: 'تم تحديث ترتيب التصنيفات' });
      },
      error: () => {
        this.msg.add({ severity: 'error', summary: 'خطأ', detail: 'فشل حفظ ترتيب التصنيفات' });
        this.loadFields();
      }
    });
  }

  /* ── Families management ─────────────────────────────── */
  loadFamilies(): void {
    this.familiesLoading = true;
    this.svc.getAllFamilies().subscribe({
      next: (data) => {
        this.families = data || [];
        this.familiesLoading = false;
      },
      error: () => {
        this.msg.add({ severity: 'error', summary: 'خطأ', detail: 'فشل تحميل العائلات' });
        this.familiesLoading = false;
      }
    });
  }

  openCreateFamily(): void {
    this.familyDialogMode = 'create';
    this.familyHasBranches = false;
    this.familyBranchCount = 0;
    this.selectedDirectJoinGrades = [];
    this.familyDateFrom = null;
    this.familyDateUntil = null;
    this.familyDirectJoinEnabled = false;
    this.editingFamily = {
      nameAr: '',
      baseName: '',
      category: 'FAMILY',
      active: true,
      servantSelectable: true,
      memberSelectable: true,
      khorsSelectable: false,
      attendKhorsSelectable: false
    };
    this.familyDialogVisible = true;
  }

  openEditFamily(f: FamilyCatalog): void {
    this.familyDialogMode = 'edit';
    this.familyHasBranches = !!f.branch;
    this.familyBranchCount = 0;
    this.selectedDirectJoinGrades = this.parseGrades(f.directJoinGrades);
    this.familyDateFrom = this.parseDate(f.directJoinFrom);
    this.familyDateUntil = this.parseDate(f.directJoinUntil);
    this.familyDirectJoinEnabled = this.selectedDirectJoinGrades.length > 0 || !!this.familyDateFrom || !!this.familyDateUntil;
    this.editingFamily = { ...f };
    this.familyDialogVisible = true;
  }

  private parseDate(value?: string | null): Date | null {
    if (!value) return null;
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  private parseGrades(grades?: string | null): string[] {
    return (grades || '')
      .split(',')
      .map(g => g.trim())
      .filter(Boolean);
  }

  toggleDirectJoinGrade(grade: string, checked: boolean): void {
    if (checked) {
      if (!this.selectedDirectJoinGrades.includes(grade)) {
        this.selectedDirectJoinGrades = [...this.selectedDirectJoinGrades, grade];
      }
    } else {
      this.selectedDirectJoinGrades = this.selectedDirectJoinGrades.filter(g => g !== grade);
    }
  }

  hasDirectJoinGrade(grade: string): boolean {
    return this.selectedDirectJoinGrades.includes(grade);
  }

  onFamilyHasBranchesChange(hasBranches: boolean): void {
    this.familyHasBranches = hasBranches;
    if (!hasBranches) {
      this.familyBranchCount = 0;
    } else {
      this.familyBranchCount = 2;
    }
  }

  get branchLettersPreview(): string[] {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const count = Math.max(2, Math.min(26, this.familyBranchCount || 2));
    return letters.slice(0, count).split('');
  }

  get nextFamilyNumber(): number {
    const existing = this.families
      .map(f => f.code?.match(/^F(\d+)$/))
      .filter(m => m)
      .map(m => parseInt(m![1], 10))
      .filter(n => !isNaN(n));
    return existing.length ? Math.max(...existing) + 1 : 1;
  }

  saveFamily(): void {
    if (!this.editingFamily.nameAr?.trim()) {
      this.msg.add({ severity: 'warn', summary: 'تنبيه', detail: 'اسم العائلة مطلوب' });
      return;
    }

    const joinGrades = this.familyDirectJoinEnabled && this.selectedDirectJoinGrades.length
      ? this.selectedDirectJoinGrades.join(',')
      : null;

    if (this.familyDirectJoinEnabled && (!this.familyDateFrom || !this.familyDateUntil)) {
      this.msg.add({ severity: 'warn', summary: 'تنبيه', detail: 'يرجى تحديد مدة التفعيل (من تاريخ - إلى تاريخ)' });
      return;
    }

    if (this.familyDialogMode === 'create') {
      const payload: any = {
        nameAr: this.editingFamily.nameAr,
        category: this.editingFamily.category || 'FAMILY',
        servantSelectable: this.editingFamily.servantSelectable,
        memberSelectable: this.editingFamily.memberSelectable,
        khorsSelectable: this.editingFamily.khorsSelectable,
        attendKhorsSelectable: this.editingFamily.attendKhorsSelectable,
        directJoinGrades: joinGrades,
        directJoinFrom: this.familyDirectJoinEnabled ? this.formatDate(this.familyDateFrom) : null,
        directJoinUntil: this.familyDirectJoinEnabled ? this.formatDate(this.familyDateUntil) : null
      };
      if (this.familyHasBranches) {
        payload.baseName = this.editingFamily.baseName || this.editingFamily.nameAr;
        payload.branchCount = this.familyBranchCount;
      }
      this.svc.createFamily(payload).subscribe({
        next: (result) => {
          const count = Array.isArray(result) ? result.length : 1;
          this.msg.add({ severity: 'success', summary: 'تم', detail: `تم إنشاء ${count} عائلة بنجاح` });
          this.familyDialogVisible = false;
          this.loadFamilies();
        },
        error: (err) => {
          const detail = err?.error?.message || 'فشل إنشاء العائلة';
          this.msg.add({ severity: 'error', summary: 'خطأ', detail });
        }
      });
    } else {
      const { id, code, ...updateData } = this.editingFamily;
      const payload: any = {
        ...updateData,
        directJoinGrades: joinGrades,
        directJoinFrom: this.familyDirectJoinEnabled ? this.formatDate(this.familyDateFrom) : null,
        directJoinUntil: this.familyDirectJoinEnabled ? this.formatDate(this.familyDateUntil) : null
      };
      if (this.familyHasBranches) {
        payload.baseName = this.editingFamily.baseName || this.editingFamily.nameAr;
        payload.branchCount = this.familyBranchCount;
      }
      this.svc.updateFamily(id!, payload).subscribe({
        next: (result) => {
          const count = Array.isArray(result) ? result.length : 1;
          this.msg.add({ severity: 'success', summary: 'تم', detail: `تم حفظ ${count} عائلة بنجاح` });
          this.familyDialogVisible = false;
          this.loadFamilies();
        },
        error: (err) => {
          const detail = err?.error?.message || 'فشل تعديل العائلة';
          this.msg.add({ severity: 'error', summary: 'خطأ', detail });
        }
      });
    }
  }

  toggleFamilyActive(f: FamilyCatalog): void {
    this.svc.toggleFamilyActive(f.id!).subscribe({
      next: (res) => {
        f.active = res.active;
        const status = res.active ? 'مفعلة' : 'معطلة';
        this.msg.add({ severity: 'info', summary: 'تم', detail: `العائلة ${status}` });
      },
      error: (err) => {
        const detail = err?.error?.message || 'فشل تحديث حالة العائلة';
        this.msg.add({ severity: 'error', summary: 'خطأ', detail });
      }
    });
  }

  deleteFamily(f: FamilyCatalog): void {
    this.confirm.confirm({
      message: `هل أنت متأكد من حذف العائلة "${f.nameAr}"؟`,
      header: 'تأكيد الحذف',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'حذف',
      rejectLabel: 'إلغاء',
      accept: () => {
        this.svc.deleteFamily(f.id!).subscribe({
          next: () => {
            this.msg.add({ severity: 'success', summary: 'تم', detail: 'تم حذف العائلة' });
            this.loadFamilies();
          },
          error: (err) => {
            const detail = err?.error?.message || 'فشل حذف العائلة';
            this.msg.add({ severity: 'error', summary: 'خطأ', detail });
          }
        });
      }
    });
  }

  moveFamilyUp(index: number): void {
    if (index <= 0) return;
    const items = this.families.map((f, i) => ({ id: f.id!, sortOrder: i * 10 }));
    const tmp = items[index].sortOrder;
    items[index] = { ...items[index], sortOrder: items[index - 1].sortOrder };
    items[index - 1] = { ...items[index - 1], sortOrder: tmp };
    this.svc.reorderFamilies(items).subscribe({
      next: () => {
        this.msg.add({ severity: 'success', summary: 'تم', detail: 'تم تحديث الترتيب' });
        this.loadFamilies();
      },
      error: () => {
        this.msg.add({ severity: 'error', summary: 'خطأ', detail: 'فشل حفظ الترتيب' });
      }
    });
  }

  moveFamilyDown(index: number): void {
    if (index >= this.families.length - 1) return;
    const items = this.families.map((f, i) => ({ id: f.id!, sortOrder: i * 10 }));
    const tmp = items[index].sortOrder;
    items[index] = { ...items[index], sortOrder: items[index + 1].sortOrder };
    items[index + 1] = { ...items[index + 1], sortOrder: tmp };
    this.svc.reorderFamilies(items).subscribe({
      next: () => {
        this.msg.add({ severity: 'success', summary: 'تم', detail: 'تم تحديث الترتيب' });
        this.loadFamilies();
      },
      error: () => {
        this.msg.add({ severity: 'error', summary: 'خطأ', detail: 'فشل حفظ الترتيب' });
      }
    });
  }

  get familiesGrouped(): Array<{ category: string; label: string; families: FamilyCatalog[] }> {
    const groups: Array<{ category: string; label: string; families: FamilyCatalog[] }> = [];
    const familyGroup = this.families.filter(f => f.category !== 'KHORS');
    if (familyGroup.length) {
      groups.push({ category: 'FAMILY', label: 'الأسر', families: familyGroup });
    }
    const khorsGroup = this.families.filter(f => f.category === 'KHORS');
    if (khorsGroup.length) {
      groups.push({ category: 'KHORS', label: 'الخورس', families: khorsGroup });
    }
    return groups;
  }

  getFamilyIndex(f: FamilyCatalog): number {
    return this.families.indexOf(f);
  }

  toggleFamilyCategory(category: string): void {
    if (this.familyCategoryCollapsedIds.has(category)) {
      this.familyCategoryCollapsedIds.delete(category);
    } else {
      this.familyCategoryCollapsedIds.add(category);
    }
  }

  /* ── Role Settings methods ──────────────────────────── */
  loadRoles(): void {
    this.roleLoading = true;
    this.svc.getAllRoles().subscribe({
      next: (data) => {
        this.roles = data || [];
        this.roleLoading = false;
      },
      error: () => {
        this.msg.add({ severity: 'error', summary: 'خطأ', detail: 'فشل تحميل الأدوار' });
        this.roleLoading = false;
      }
    });
    this.svc.getAllPermissions().subscribe({
      next: (data) => {
        this.allPermissions = data || [];
      }
    });
  }

  openCreateRole(): void {
    this.roleDialogMode = 'create';
    this.editingRole = {
      name: '',
      displayNameAr: '',
      active: true,
      permissions: ''
    };
    this.selectedPermissions = [];
    this.roleDialogVisible = true;
  }

  openEditRole(r: typeof this.roles[0]): void {
    this.roleDialogMode = 'edit';
    this.editingRole = { ...r };
    this.selectedPermissions = (r.permissions || '')
      .split(',')
      .map(p => p.trim())
      .filter(Boolean);
    this.roleDialogVisible = true;
  }

  saveRole(): void {
    if (!this.editingRole.name?.trim()) {
      this.msg.add({ severity: 'warn', summary: 'تنبيه', detail: 'اسم الدور مطلوب' });
      return;
    }
    if (!this.editingRole.displayNameAr?.trim()) {
      this.msg.add({ severity: 'warn', summary: 'تنبيه', detail: 'الاسم بالعربي مطلوب' });
      return;
    }

    if (this.roleDialogMode === 'create') {
      const nameRegex = /^[A-Z][A-Z0-9_]*$/;
      if (!nameRegex.test(this.editingRole.name.trim())) {
        this.msg.add({ severity: 'warn', summary: 'تنبيه', detail: 'اسم الدور يجب أن يكون حروف إنجليزية كبيرة وأرقام و _ فقط' });
        return;
      }
      this.svc.createRole({
        name: this.editingRole.name.trim(),
        displayNameAr: this.editingRole.displayNameAr.trim(),
        permissions: this.selectedPermissions.join(',')
      }).subscribe({
        next: () => {
          this.msg.add({ severity: 'success', summary: 'تم', detail: 'تم إنشاء الدور بنجاح' });
          this.roleDialogVisible = false;
          this.loadRoles();
        },
        error: (err) => {
          const detail = err?.error?.message || 'فشل إنشاء الدور';
          this.msg.add({ severity: 'error', summary: 'خطأ', detail });
        }
      });
    } else {
      this.svc.updateRole(this.editingRole.id!, {
        displayNameAr: this.editingRole.displayNameAr?.trim(),
        active: this.editingRole.active,
        permissions: this.selectedPermissions.join(',')
      }).subscribe({
        next: () => {
          this.msg.add({ severity: 'success', summary: 'تم', detail: 'تم تعديل الدور بنجاح' });
          this.roleDialogVisible = false;
          this.loadRoles();
        },
        error: (err) => {
          const detail = err?.error?.message || 'فشل تعديل الدور';
          this.msg.add({ severity: 'error', summary: 'خطأ', detail });
        }
      });
    }
  }

  toggleRoleActive(r: typeof this.roles[0]): void {
    this.svc.updateRole(r.id!, { active: !r.active, displayNameAr: r.displayNameAr, permissions: r.permissions }).subscribe({
      next: () => {
        r.active = !r.active;
        const status = r.active ? 'مفعل' : 'معطل';
        this.msg.add({ severity: 'info', summary: 'تم', detail: `الدور ${status}` });
      },
      error: () => {
        this.msg.add({ severity: 'error', summary: 'خطأ', detail: 'فشل تحديث الحالة' });
      }
    });
  }

  deleteRole(r: typeof this.roles[0]): void {
    this.confirm.confirm({
      message: `هل أنت متأكد من حذف الدور "${r.displayNameAr}"؟`,
      header: 'تأكيد الحذف',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'حذف',
      rejectLabel: 'إلغاء',
      accept: () => {
        this.svc.deleteRole(r.id!).subscribe({
          next: () => {
            this.msg.add({ severity: 'success', summary: 'تم', detail: 'تم حذف الدور' });
            this.loadRoles();
          },
          error: (err) => {
            const detail = err?.error?.message || 'فشل حذف الدور';
            this.msg.add({ severity: 'error', summary: 'خطأ', detail });
          }
        });
      }
    });
  }

  moveRoleUp(index: number): void {
    if (index <= 0) return;
    const ids = this.roles.map(r => r.id!);
    const tmp = ids[index];
    ids[index] = ids[index - 1];
    ids[index - 1] = tmp;
    this.svc.reorderRoles(ids).subscribe({
      next: () => this.loadRoles(),
      error: () => this.msg.add({ severity: 'error', summary: 'خطأ', detail: 'فشل حفظ الترتيب' })
    });
  }

  moveRoleDown(index: number): void {
    if (index >= this.roles.length - 1) return;
    const ids = this.roles.map(r => r.id!);
    const tmp = ids[index];
    ids[index] = ids[index + 1];
    ids[index + 1] = tmp;
    this.svc.reorderRoles(ids).subscribe({
      next: () => this.loadRoles(),
      error: () => this.msg.add({ severity: 'error', summary: 'خطأ', detail: 'فشل حفظ الترتيب' })
    });
  }

  hasPermission(perm: string): boolean {
    return this.selectedPermissions.includes(perm);
  }

  togglePermission(perm: string, checked: boolean): void {
    if (checked) {
      if (!this.selectedPermissions.includes(perm)) {
        this.selectedPermissions = [...this.selectedPermissions, perm];
      }
    } else {
      this.selectedPermissions = this.selectedPermissions.filter(p => p !== perm);
    }
  }

  permissionLabel(perm: string): string {
    return this.permissionLabels[perm] || perm;
  }

  /* ── Secret Code ─────────────────────────────────────── */
  ngOnDestroy(): void {
    this.stopTimer();
  }

  loadSecretCode(): void {
    this.secretLoading = true;
    this.svc.getCurrentSecretCode().subscribe({
      next: (res) => {
        this.secretCode = res.code || '';
        this.secretValidFrom = res.validFrom || '';
        this.secretValidTo = res.validTo || '';
        this.secretValid = res.valid;
        this.secretLoading = false;
        if (this.secretValid && this.secretValidTo) {
          this.startTimer();
        } else {
          this.stopTimer();
          this.remainingSeconds = 0;
        }
      },
      error: () => {
        this.secretLoading = false;
        this.msg.add({ severity: 'error', summary: 'خطأ', detail: 'فشل تحميل الكود السري' });
      }
    });
  }

  generateSecret(): void {
    this.secretGenerating = true;
    this.svc.generateSecretCode().subscribe({
      next: (res) => {
        this.secretCode = res.code || '';
        this.secretValidFrom = res.validFrom || '';
        this.secretValidTo = res.validTo || '';
        this.secretValid = true;
        this.secretGenerating = false;
        this.startTimer();
        this.msg.add({ severity: 'success', summary: 'تم', detail: 'تم إنشاء الكود السري بنجاح' });
      },
      error: () => {
        this.secretGenerating = false;
        this.msg.add({ severity: 'error', summary: 'خطأ', detail: 'فشل إنشاء الكود السري' });
      }
    });
  }

  copyToClipboard(text: string): void {
    navigator.clipboard.writeText(text).then(() => {
      this.msg.add({ severity: 'success', summary: 'تم', detail: 'تم نسخ الكود' });
    }).catch(() => {
      this.msg.add({ severity: 'error', summary: 'خطأ', detail: 'فشل النسخ' });
    });
  }

  private startTimer(): void {
    this.stopTimer();
    this.updateRemainingSeconds();
    this.timerSub = interval(1000).subscribe(() => this.updateRemainingSeconds());
  }

  private stopTimer(): void {
    this.timerSub?.unsubscribe();
    this.timerSub = undefined;
  }

  private updateRemainingSeconds(): void {
    if (!this.secretValidTo) {
      this.remainingSeconds = 0;
      return;
    }
    const now = new Date().getTime();
    const end = new Date(this.secretValidTo).getTime();
    const diff = Math.floor((end - now) / 1000);
    if (diff <= 0) {
      this.remainingSeconds = 0;
      this.secretValid = false;
      this.stopTimer();
    } else {
      this.remainingSeconds = diff;
    }
  }

  get remainingTimeLabel(): string {
    if (!this.secretValid) return '';
    if (this.remainingSeconds <= 0) return '';
    const h = Math.floor(this.remainingSeconds / 3600);
    const m = Math.floor((this.remainingSeconds % 3600) / 60);
    const s = this.remainingSeconds % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  private rebuildSections(): void {
    const sortedFields = this.sortFields(this.fields);
    const sectionByKey = new Map<string, string>();
    const sectionState = new Map<string, FieldSection>();

    this.sectionDefinitions.forEach(def => {
      sectionState.set(def.id, { ...def, fields: [] });
      def.fieldKeys.forEach(key => sectionByKey.set(key, def.id));
    });

    const categorySections = new Map<string, FieldSection>();

    const categoryAliases: Record<string, string> = {
      'بيانات شخصية للجميع': 'بيانات شخصية',
    };

    for (const field of sortedFields) {
      let cat = field.category?.trim();
      if (cat && categoryAliases[cat]) {
        cat = categoryAliases[cat];
      }
      if (cat) {
        const predef = this.sectionDefinitions.find(s => s.title === cat);
        if (predef) {
          sectionState.get(predef.id)?.fields.push(field);
        } else {
          let sec = categorySections.get(cat);
          if (!sec) {
            sec = { id: cat, title: cat, fieldKeys: [], fields: [] };
            categorySections.set(cat, sec);
          }
          sec.fields.push(field);
          sec.fieldKeys.push(field.fieldKey);
        }
      } else {
        const sectionId = sectionByKey.get(field.fieldKey);
        if (sectionId) {
          sectionState.get(sectionId)?.fields.push(field);
        }
      }
    }

    const sections: FieldSection[] = [];

    this.sectionDefinitions.forEach(def => {
      const section = sectionState.get(def.id)!;
      if (section.fields.length > 0) {
        sections.push(section);
      }
    });

    for (const section of categorySections.values()) {
      sections.push(section);
    }

    const matchedKeys = new Set<string>();
    for (const section of sections) {
      section.fields.forEach(f => matchedKeys.add(f.fieldKey));
    }

    const remainingFields = sortedFields.filter(f => !matchedKeys.has(f.fieldKey));
    if (remainingFields.length) {
      sections.push({
        id: 'additional',
        title: 'حقول إضافية',
        fieldKeys: remainingFields.map(f => f.fieldKey),
        fields: remainingFields
      });
    }

    sections.sort((a, b) => {
      const minA = a.fields.length > 0 ? Math.min(...a.fields.map(f => f.displayOrder ?? 0)) : Infinity;
      const minB = b.fields.length > 0 ? Math.min(...b.fields.map(f => f.displayOrder ?? 0)) : Infinity;
      return minA - minB;
    });

    this.groupedSections = sections;
  }

  private inferSectionFromFieldKey(fieldKey?: string): string | null {
    if (!fieldKey) return null;
    for (const def of this.sectionDefinitions) {
      if (def.fieldKeys.includes(fieldKey)) {
        return def.title;
      }
    }
    return null;
  }

  private sortFields(fields: CustomField[]): CustomField[] {
    return [...fields].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
  }

  private ensureFamilyOptionsLoaded(): void {
    if (this.familyOptionsLoaded) return;
    this.familyOptionsLoaded = true;
    this.loadFamilyOptionSources();
  }

  private loadFamilyOptionSources(): void {
    forkJoin({
      member: this.authService.getFamilyOptions('MEMBER'),
      servant: this.authService.getFamilyOptions('SERVANT'),
      khors: this.authService.getFamilyOptions('KHORS'),
      attendKhors: this.authService.getFamilyOptions('KHORS_ATTEND')
    }).subscribe({
      next: ({ member, servant, khors, attendKhors }) => {
        this.memberFamilyOptions = this.extractFamilyNames(member || []);
        this.servantFamilyOptions = this.extractFamilyNames(servant || []);
        this.khorsFamilyOptions = this.extractFamilyNames(khors || []);
        this.attendKhorsFamilyOptions = this.extractFamilyNames(attendKhors || []);
        this.refreshManagedFieldOptionsIfNeeded();
      },
      error: () => {
        this.memberFamilyOptions = [];
        this.servantFamilyOptions = [];
        this.khorsFamilyOptions = [];
        this.attendKhorsFamilyOptions = [];
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

  private getManagedFamilyFieldAudience(fieldKey?: string | null): 'MEMBER' | 'SERVANT' | 'KHORS' | 'KHORS_ATTEND' | null {
    const normalized = String(fieldKey || '').trim();
    if (normalized === 'deaconFamily') return 'MEMBER';
    if (normalized === 'servingWhere') return 'SERVANT';
    if (normalized === 'khors') return 'KHORS';
    if (normalized === 'attendKhors') return 'KHORS_ATTEND';
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
    if (audience === 'KHORS') {
      return [...this.khorsFamilyOptions, 'بدون خورس'];
    }
    if (audience === 'KHORS_ATTEND') {
      return [...this.attendKhorsFamilyOptions, 'بدون خورس'];
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

  private resolveEffectiveProfileEditable(field?: Partial<CustomField> | null): boolean {
    if (!field || !this.showInIncludesProfile(this.resolveEffectiveShowInValue(field.showIn, field))) {
      return false;
    }

    return effectiveProfileEditable({
      fieldKey: String(field.fieldKey || '').trim(),
      isSystem: !!field.isSystem,
      profileEditable: field.profileEditable
    });
  }

  private formatDate(value: Date | null | undefined): string | null {
    if (!value) return null;
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}
