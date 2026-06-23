import { Component, Input, OnInit, PLATFORM_ID, inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, AbstractControl, ValidationErrors, ValidatorFn, FormControl } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router, RouterModule } from '@angular/router';
import { MessageService } from 'primeng/api';
import { DevSettingsService, CustomField, VisibilityCondition } from '../services/dev-settings.service';

import { ToastModule } from 'primeng/toast';

interface FamilyOption {
  id?: number;
  code?: string;
  nameAr: string;
  baseName?: string;
  branch?: string | null;
  category?: string;
}

const FALLBACK_SYSTEM_FIELD_KEYS = new Set([
  'fullName',
  'username',
  'phoneNumber',
  'address',
  'nationalId',
  'email',
  'dateOfBirth',
  'gender',
  'deaconDegree',
  'deaconFamily',
  'khors',
  'servingWhere',
  'attendKhors',
  'status',
  'graduatedFrom',
  'graduateJob',
  'studyType',
  'schoolName',
  'schoolGrade',
  'otherGrade',
  'universityName',
  'faculty',
  'universityGrade',
  'isWorking',
  'workDetails',
  'guardiansPhone',
  'guardianRelation',
  'khorsYear'
]);

@Component({
  selector: 'app-register',
  templateUrl: './register.html',
  styleUrls: ['./register.css'],
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ReactiveFormsModule,
    ToastModule
  ],
  providers: [MessageService]
})
export class RegisterComponent implements OnInit {
  private platformId = inject(PLATFORM_ID);

  @Input() isServant: boolean = false;

  registerForm!: FormGroup;

  interacted: Record<string, boolean> = {};
  errorGate: Record<string, boolean> = {};
  submitAttempted = false;
  serverError: string | null = null;

  showPassword = false;
  showConfirmPassword = false;
  memberFamilyOptions: FamilyOption[] = [];
  servantWhereOptions: FamilyOption[] = [];
  khorsFamilyOptions: FamilyOption[] = [];
  attendKhorsFamilyOptions: FamilyOption[] = [];

  orderedFields: CustomField[] = [];
  private devSettingsService = inject(DevSettingsService);

  constructor(
    private fb: FormBuilder,
    private http: HttpClient,
    private router: Router,
    private messageService: MessageService
  ) {}

  ngOnInit(): void {
    this.buildForm();
    this.registerForm.valueChanges.subscribe(() => this.syncConfiguredRequiredErrors());
    if (isPlatformBrowser(this.platformId)) {
      this.loadFamilyOptions();
      this.loadFields();
    } else if (this.isServant) {
      this.servantWhereOptions = this.fallbackServantWhereOptions();
    } else {
      this.memberFamilyOptions = this.fallbackMemberFamilyOptions();
    }

    this.registerForm.get('status')?.valueChanges.subscribe(() => this.onStatusChange());
    this.registerForm.get('studyType')?.valueChanges.subscribe(() => this.onStudyTypeChange());

    this.registerForm.get('password')?.valueChanges.subscribe(() => this.applyPasswordMismatch());
    this.registerForm.get('confirmPassword')?.valueChanges.subscribe(() => this.applyPasswordMismatch());

    if (this.isServant) {
      this.registerForm.get('servingWhere')?.valueChanges.subscribe(() => this.onServingWhereChange());
      this.registerForm.get('servingScope')?.valueChanges.subscribe(() => this.onServingScopeChange());
      this.registerForm.get('khors')?.valueChanges.subscribe(() => this.onKhorsChanged());
    }

    this.onStatusChange();
    this.onStudyTypeChange();
    this.syncConfiguredRequiredErrors();
  }

  get servingScope(): string {
    return String(this.registerForm?.get('servingScope')?.value || '');
  }

  get khorsValue(): string {
    return String(this.registerForm?.get('khors')?.value || '');
  }


  get servingWhereValue(): string {
    return this.familyNameFromValue(this.registerForm?.get('servingWhere')?.value, this.servantWhereOptions);
  }

  get khorsOptionValues(): FamilyOption[] {
    return [...this.khorsFamilyOptions, { nameAr: 'بدون خورس' }];
  }

  get attendKhorsOptionValues(): FamilyOption[] {
    return [...this.attendKhorsFamilyOptions, { nameAr: 'بدون خورس' }];
  }

  isKhorsServingWhere(): boolean {
    return this.khorsFamilyOptions.some(k => k.nameAr === this.servingWhereValue);
  }

  get firstKhorsName(): string {
    return this.khorsFamilyOptions.length > 0 ? this.khorsFamilyOptions[0].nameAr : '';
  }

  get secondKhorsName(): string {
    return this.khorsFamilyOptions.length > 1 ? this.khorsFamilyOptions[1].nameAr : '';
  }
  private buildForm() {
    const minAge = this.isServant ? 16 : 6;

    this.registerForm = this.fb.group({
      fullName: ['', [Validators.required, this.arabicTextOnly()]],
      username: ['', Validators.required],
      phoneNumber: ['', [this.optionalPhone11()]],
      address: ['', [Validators.required, this.arabicTextOnly(true)]],
      email: ['', [Validators.required, Validators.email]],

      nationalId: ['', [Validators.required, this.nationalIdValidator(minAge)]],
      dateOfBirth: this.fb.control({ value: '', disabled: true }),
      gender: this.fb.control({ value: '', disabled: true }),

      servingWhere: this.fb.control('', { updateOn: 'change' }),

      deaconFamily: this.fb.control('', { validators: [Validators.required], updateOn: 'change' }),
      deaconDegree: this.fb.control('', { validators: [Validators.required], updateOn: 'change' }),

      khors: this.fb.control('', { updateOn: 'change' }), 
      attendKhors: this.fb.control('', { updateOn: 'change' }), 

      servingScope: this.fb.control(this.isServant ? '' : '', {
        validators: this.isServant ? [Validators.required] : [],
        updateOn: 'change'
      }),

      status: this.fb.control('', { updateOn: 'change' }),

      graduatedFrom: [''],
      graduateJob: [''],

      studyType: this.fb.control('', { updateOn: 'change' }),

      schoolName: [''],
      schoolGrade: this.fb.control('', { updateOn: 'change' }),
      otherGrade: this.fb.control('', { updateOn: 'change' }),

      universityName: [''],
      faculty: [''],
      universityGrade: [''],
      isWorking: this.fb.control('', { updateOn: 'change' }),
      workDetails: [''],

      guardiansPhone: ['', [this.optionalPhone11()]],
      guardianRelation: [''],
      khorsYear: [''],

      password: ['', Validators.required],
      confirmPassword: ['', Validators.required],

      secret: ['']
    }, {
  validators: [this.guardianNotSameAsPhone()],
  updateOn: 'blur'
});
    

    if (this.isServant) {
      this.registerForm.get('status')?.setValue('student', { emitEvent: false });
      this.onStatusChange();

      this.registerForm.get('secret')?.setValidators([Validators.required]);
      this.registerForm.get('secret')?.updateValueAndValidity({ emitEvent: false });

      this.registerForm.get('servingWhere')?.setValidators([Validators.required]);
      this.registerForm.get('servingWhere')?.updateValueAndValidity({ emitEvent: false });
    }
  }

  private loadFamilyOptions() {
    const audience = this.isServant ? 'SERVANT' : 'MEMBER';
    this.http.get<FamilyOption[]>(`/api/auth/family-options?audience=${audience}`, { withCredentials: true })
      .subscribe({
        next: (options) => {
          const safe = Array.isArray(options) ? options : [];
          if (this.isServant) {
            this.servantWhereOptions = safe.length ? safe : this.fallbackServantWhereOptions();
          } else {
            this.memberFamilyOptions = safe.length ? safe : this.fallbackMemberFamilyOptions();
          }
        },
        error: () => {
          if (this.isServant) {
            this.servantWhereOptions = this.fallbackServantWhereOptions();
          } else {
            this.memberFamilyOptions = this.fallbackMemberFamilyOptions();
          }
        }
      });
    this.http.get<FamilyOption[]>(`/api/auth/family-options?audience=KHORS`, { withCredentials: true })
      .subscribe({
        next: (options) => {
          this.khorsFamilyOptions = Array.isArray(options) && options.length ? options : this.fallbackKhorsOptions();
          this.attendKhorsFamilyOptions = this.khorsFamilyOptions;
        },
        error: () => {
          this.khorsFamilyOptions = this.fallbackKhorsOptions();
          this.attendKhorsFamilyOptions = this.fallbackAttendKhorsOptions();
        }
      });
  }

  private fallbackMemberFamilyOptions(): FamilyOption[] {
    return [
      { nameAr: 'اسرة السمائين' },
      { nameAr: 'اسرة القديس ابانوب' },
      { nameAr: 'اسرة القديس ديسقورس' },
      { nameAr: 'اسرة القديس سيدهم بشاي' },
      { nameAr: 'اسرة القديس اسكلابيوس' },
      { nameAr: 'اسرة القديس البابا كيرلس أ' },
      { nameAr: 'اسرة القديس البابا كيرلس ب' },
      { nameAr: 'اسرة القديس الانبا ابرام أ' },
      { nameAr: 'اسرة القديس الانبا ابرام ب' },
      { nameAr: 'اسرة القديس اسطفانوس أ' },
      { nameAr: 'اسرة القديس اسطفانوس ب' }
    ];
  }

  private fallbackServantWhereOptions(): FamilyOption[] {
    return [
      { nameAr: 'اسرة السمائين' },
      { nameAr: 'اسرة القديس ابانوب' },
      { nameAr: 'اسرة القديس ديسقورس' },
      { nameAr: 'اسرة القديس سيدهم بشاي' },
      { nameAr: 'اسرة القديس اسكلابيوس' },
      { nameAr: 'اسرة القديس البابا كيرلس' },
      { nameAr: 'اسرة القديس الانبا ابرام' },
      { nameAr: 'اسرة القديس اسطفانوس' },
      { nameAr: 'خورس مارمرقس' },
      { nameAr: 'خورس البابا اثناسيوس' }
    ];
  }

  private fallbackKhorsOptions(): FamilyOption[] {
    return [
      { nameAr: 'خورس مارمرقس' },
      { nameAr: 'خورس البابا اثناسيوس' }
    ];
  }

  private fallbackAttendKhorsOptions(): FamilyOption[] {
    return [
      { nameAr: 'خورس مارمرقس' },
      { nameAr: 'خورس البابا اثناسيوس' }
    ];
  }

  /* ── Custom fields ───────────────────────────────── */
  private loadFields(): void {
    this.devSettingsService.getEnabledFields().subscribe({
      next: (fields) => {
        this.orderedFields = this.sortFields(this.resolveOrderedFields(fields || []));
        this.ensureDynamicFieldControls();
        this.syncConfiguredRequiredErrors();
      },
      error: () => {
        this.orderedFields = this.sortFields(this.fallbackOrderedFields());
        this.ensureDynamicFieldControls();
        this.syncConfiguredRequiredErrors();
      }
    });
  }

  private resolveOrderedFields(fields: CustomField[]): CustomField[] {
    const safeFields = Array.isArray(fields) ? fields : [];
    const hasSystemFields = safeFields.some(field => this.isKnownSystemField(field?.fieldKey));
    return hasSystemFields ? safeFields : this.fallbackOrderedFields();
  }

  private ensureDynamicFieldControls(): void {
    for (const f of this.orderedFields) {
      if (!f.isSystem && !this.registerForm.contains('custom_' + f.fieldKey)) {
        const validators = f.required ? [Validators.required] : [];
        this.registerForm.addControl('custom_' + f.fieldKey, new FormControl('', validators));
      }
    }
  }

  private isKnownSystemField(fieldKey: string | undefined): boolean {
    return !!fieldKey && FALLBACK_SYSTEM_FIELD_KEYS.has(fieldKey);
  }

  private fallbackOrderedFields(): CustomField[] {
    const field = (
      fieldKey: string,
      labelAr: string,
      fieldType: 'TEXT' | 'SELECT' | 'DATE',
      displayOrder: number,
      overrides: Partial<CustomField> = {}
    ): CustomField => ({
      fieldKey,
      labelAr,
      fieldType,
      options: '',
      required: false,
      requiredRule: 'NEVER',
      visibilityRule: 'ALWAYS',
      visibilityDependsOn: '',
      visibilityDependsValues: '',
      visibilityConditions: [],
      showIn: 'NONE',
      showInConfigured: false,
      profileEditable: false,
      category: 'system',
      displayOrder,
      enabled: true,
      isSystem: true,
      ...overrides
    });

    return [
      field('fullName', 'الاسم بالكامل بالعربي', 'TEXT', 1, { required: true }),
      field('username', 'اسم المستخدم', 'TEXT', 2, { required: true }),
      field('phoneNumber', 'رقم الهاتف', 'TEXT', 3),
      field('address', 'العنوان', 'TEXT', 4),
      field('nationalId', 'الرقم القومي', 'TEXT', 5),
      field('email', 'البريد الإلكتروني', 'TEXT', 6, { required: true }),
      field('dateOfBirth', 'تاريخ الميلاد', 'DATE', 7),
      field('gender', 'النوع', 'TEXT', 8),
      field('deaconDegree', 'رتبة الشماس', 'SELECT', 9, { required: true }),
      field('deaconFamily', 'الأسرة', 'SELECT', 10, { visibilityRule: 'MEMBER_ONLY' }),
      field('khors', 'الخورس', 'SELECT', 11, { visibilityRule: 'MEMBER_ONLY' }),
      field('khorsYear', 'سنة الخورس', 'TEXT', 12, { visibilityRule: 'MEMBER_ONLY' }),
      field('servingWhere', 'بتخدم فين', 'SELECT', 13, { visibilityRule: 'SERVANT_ONLY' }),
      field('attendKhors', 'خورس الحضور', 'SELECT', 14, { visibilityRule: 'SERVANT_ONLY' }),
      field('status', 'الحالة', 'SELECT', 15),
      field('graduatedFrom', 'الجامعة المتخرج منها', 'TEXT', 16, { visibilityRule: 'GRADUATE_ONLY' }),
      field('graduateJob', 'الوظيفة الحالية', 'TEXT', 17, { visibilityRule: 'GRADUATE_ONLY' }),
      field('studyType', 'الجهة الدراسية', 'SELECT', 18, { visibilityRule: 'STUDENT_ONLY' }),
      field('schoolName', 'اسم المدرسة', 'TEXT', 19, { visibilityRule: 'STUDENT_SCHOOL' }),
      field('schoolGrade', 'الصف الدراسي', 'SELECT', 20, { visibilityRule: 'STUDENT_SCHOOL' }),
      field('otherGrade', 'صف دراسي آخر', 'TEXT', 21, {
        visibilityConditions: [
          { type: 'RULE', rule: 'STUDENT_SCHOOL' },
          { type: 'FIELD', fieldKey: 'schoolGrade', values: ['other'] }
        ]
      }),
      field('universityName', 'اسم الجامعة', 'TEXT', 22, { visibilityRule: 'STUDENT_UNIVERSITY' }),
      field('faculty', 'الكلية', 'TEXT', 23, { visibilityRule: 'STUDENT_UNIVERSITY' }),
      field('universityGrade', 'الفرقة الدراسية', 'TEXT', 24, { visibilityRule: 'STUDENT_UNIVERSITY' }),
      field('isWorking', 'هل تعمل؟', 'SELECT', 25, { visibilityRule: 'GRADUATE_ONLY' }),
      field('workDetails', 'ما هي وظيفتك', 'TEXT', 26, {
        visibilityConditions: [
          { type: 'RULE', rule: 'GRADUATE_ONLY' },
          { type: 'FIELD', fieldKey: 'isWorking', values: ['true'] }
        ]
      }),
      field('guardiansPhone', 'هاتف ولي الأمر', 'TEXT', 27),
      field('guardianRelation', 'صلة القرابة', 'TEXT', 28)
    ];
  }

  isFieldVisible(f: CustomField): boolean {
    return this.isFieldCurrentlyVisible(f);
  }

  getCustomFieldOptions(f: CustomField): string[] {
    if (!f.options) return [];
    return f.options.split(',').map(o => o.trim()).filter(Boolean);
  }

  getFieldConfig(fieldKey: string): CustomField | undefined {
    return this.orderedFields.find(f => f.fieldKey === fieldKey);
  }

  isSelectField(fieldKey: string): boolean {
    return this.getFieldConfig(fieldKey)?.fieldType === 'SELECT';
  }

  fieldLabel(fieldKey: string, fallback: string): string {
    return this.getFieldConfig(fieldKey)?.labelAr || fallback;
  }

  fieldRequired(fieldKey: string, fallback = false): boolean {
    const cfg = this.getFieldConfig(fieldKey);
    return cfg ? this.isFieldConfiguredRequired(cfg) : fallback;
  }

  customFieldRequired(f: CustomField): boolean {
    return this.isFieldConfiguredRequired(f);
  }

  fieldOptions(fieldKey: string, fallback: string[] = []): string[] {
    const cfg = this.getFieldConfig(fieldKey);
    const dynamic = cfg?.options?.split(',').map(o => o.trim()).filter(Boolean) || [];
    return dynamic.length ? dynamic : fallback;
  }

  private matchesRule(rule: string): boolean {
    const normalized = String(rule || 'ALWAYS').trim().toUpperCase();
    const status = String(this.registerForm.get('status')?.value || '').trim().toLowerCase();
    const studyType = String(this.registerForm.get('studyType')?.value || '').trim().toLowerCase();

    if (normalized === 'ALWAYS') return true;
    if (normalized === 'NEVER') return false;
    if (normalized === 'MEMBER_ONLY') return !this.isServant;
    if (normalized === 'SERVANT_ONLY') return this.isServant;
    if (normalized === 'STUDENT_ONLY') return status === 'student';
    if (normalized === 'STUDENT_SCHOOL') return status === 'student' && studyType === 'school';
    if (normalized === 'STUDENT_UNIVERSITY') return status === 'student' && studyType === 'university';
    if (normalized === 'GRADUATE_ONLY') return status === 'graduate';
    return false;
  }

  private matchesAnyRule(rules?: string): boolean {
    if (!rules) {
      return false;
    }

    return rules
      .split(',')
      .map(rule => rule.trim().toUpperCase())
      .filter(rule => !!rule && rule !== 'NEVER')
      .some(rule => this.matchesRule(rule));
  }

  private matchesVisibilityDependency(field: CustomField): boolean {
    const dependsOn = String(field.visibilityDependsOn || '').trim();
    if (!dependsOn) {
      return true;
    }

    const expectedValues = this.parseVisibilityDependencyValues(field.visibilityDependsValues);
    if (!expectedValues.length) {
      return false;
    }

    const controlName = this.getVisibilityDependencyControlName(dependsOn);
    const rawValue = this.registerForm.get(controlName)?.value;
    const displayValue = this.resolveVisibilityValue(dependsOn, rawValue);
    const currentValue = this.normalizeVisibilityDependencyValue(displayValue);
    if (!currentValue) {
      return false;
    }

    return expectedValues.includes(currentValue);
  }

  private matchesVisibilityCondition(condition: VisibilityCondition): boolean {
    if (!condition) {
      return true;
    }

    if (condition.type === 'RULE') {
      return this.matchesRule(condition.rule || 'ALWAYS');
    }

    if (condition.type === 'FIELD') {
      const fieldKey = String(condition.fieldKey || '').trim();
      if (!fieldKey) {
        return false;
      }

      const expectedValues = Array.from(new Set(
        (condition.values || [])
          .map(value => this.normalizeVisibilityDependencyValue(value))
          .filter(Boolean)
      ));
      if (!expectedValues.length) {
        return false;
      }

      const controlName = this.getVisibilityDependencyControlName(fieldKey);
      const rawValue = this.registerForm.get(controlName)?.value;
      const displayValue = this.resolveVisibilityValue(fieldKey, rawValue);
      const currentValue = this.normalizeVisibilityDependencyValue(displayValue);
      if (!currentValue) {
        return false;
      }

      return expectedValues.includes(currentValue);
    }

    return true;
  }

  private matchesVisibilityConditions(field: CustomField): boolean {
    const conditions = Array.isArray(field.visibilityConditions) ? field.visibilityConditions : [];
    if (!conditions.length) {
      return this.matchesRule(field.visibilityRule || 'ALWAYS') && this.matchesVisibilityDependency(field);
    }

    return conditions.every(condition => this.matchesVisibilityCondition(condition));
  }

  private getVisibilityDependencyControlName(fieldKey: string): string {
    const config = this.getFieldConfig(fieldKey);
    if (config && !config.isSystem) {
      return 'custom_' + fieldKey;
    }
    return fieldKey;
  }

  private parseVisibilityDependencyValues(values?: string): string[] {
    return Array.from(new Set(
      String(values || '')
        .split(',')
        .map(value => this.normalizeVisibilityDependencyValue(value))
        .filter(Boolean)
    ));
  }

  private resolveVisibilityValue(fieldKey: string, rawValue: unknown): unknown {
    if (rawValue == null) return rawValue;
    const allOptions: FamilyOption[] = [
      ...this.memberFamilyOptions,
      ...this.khorsOptionValues,
      ...this.servantWhereOptions,
      ...this.attendKhorsOptionValues
    ];
    const rawStr = String(rawValue).trim();
    const found = allOptions.find(o =>
      (o.id != null && String(o.id).trim() === rawStr) ||
      (o.nameAr === rawStr)
    );
    if (found) return found.nameAr;
    return rawValue;
  }

  private normalizeVisibilityDependencyValue(value: unknown): string {
    return value == null ? '' : String(value).trim().toLowerCase();
  }

  private isFieldConfiguredRequired(field: CustomField): boolean {
    if (!field?.enabled) return false;
    if (!this.isFieldCurrentlyVisible(field)) return false;
    return !!field.required || this.matchesAnyRule(field.requiredRule);
  }

  private isFieldCurrentlyVisible(field: CustomField): boolean {
    if (!field?.enabled) return false;
    return this.matchesVisibilityConditions(field);
  }

  private sortFields(fields: CustomField[]): CustomField[] {
    return [...fields].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
  }

  private syncConfiguredRequiredErrors(): void {
    for (const field of this.orderedFields) {
      const controlName = field.isSystem ? field.fieldKey : 'custom_' + field.fieldKey;
      const control = this.registerForm.get(controlName);
      if (!control) continue;

      const shouldRequire = this.isFieldConfiguredRequired(field);
      const isEmpty = this.isEmptyValue(control.value);
      const nextErrors = { ...(control.errors || {}) };

      if (shouldRequire && isEmpty) {
        nextErrors['configRequired'] = true;
      } else {
        delete nextErrors['configRequired'];
      }

      const hasErrors = Object.keys(nextErrors).length > 0;
      const currentErrors = control.errors || null;
      const nextValue = hasErrors ? nextErrors : null;
      if (JSON.stringify(currentErrors) !== JSON.stringify(nextValue)) {
        control.setErrors(nextValue);
      }
    }
  }

  private isEmptyValue(value: unknown): boolean {
    if (value === null || value === undefined) return true;
    if (typeof value === 'boolean') return false;
    return String(value).trim() === '';
  }

  private arabicTextOnly(allowNumbers = false): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const value = String(control.value ?? '').trim();
      if (!value) return null;

      const pattern = allowNumbers
        ? /^[\u0600-\u06FF\s0-9٠-٩.,،\-\/]+$/
        : /^[\u0600-\u06FF\s]+$/;

      return pattern.test(value) ? null : { arabicOnly: true };
    };
  }
  private optionalPhone11(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const v = String(control.value ?? '').trim();
      if (!v) return null;
      return /^\d{11}$/.test(v) ? null : { phone11: true };
    };
  }

onServingWhereChange() {
  if (!this.isServant) return;

  const where = this.familyNameFromValue(this.registerForm.get('servingWhere')?.value, this.servantWhereOptions);
  if (!where) return;

  const scopeCtrl = this.registerForm.get('servingScope');
  const famCtrl = this.registerForm.get('deaconFamily');
  const khorsCtrl = this.registerForm.get('khors');
  const attendCtrl = this.registerForm.get('attendKhors');

  if (where === this.firstKhorsName) {
    scopeCtrl?.setValue('KHORS_ONLY', { emitEvent: false });
    famCtrl?.setValue(where, { emitEvent: false });
    khorsCtrl?.setValue(where, { emitEvent: false });

    attendCtrl?.setValue(this.secondKhorsName, { emitEvent: false });
    attendCtrl?.disable({ emitEvent: false });

  } else if (this.isKhorsServingWhere()) {
    scopeCtrl?.setValue('KHORS_ONLY', { emitEvent: false });
    famCtrl?.setValue(where, { emitEvent: false });
    khorsCtrl?.setValue(where, { emitEvent: false });

    attendCtrl?.setValue('', { emitEvent: false });
    attendCtrl?.enable({ emitEvent: false });

  } else {
    scopeCtrl?.setValue('FAMILY_ONLY', { emitEvent: false });
    famCtrl?.setValue(where, { emitEvent: false });
    khorsCtrl?.setValue('', { emitEvent: false });

    attendCtrl?.enable({ emitEvent: false });
    if (!String(attendCtrl?.value || '').trim()) {
      attendCtrl?.setValue('', { emitEvent: false });
    }
  }

  this.onServingScopeChange();
  this.onKhorsChanged();
}

  familyOptionValue(option: FamilyOption): number | string {
    return option.id ?? option.nameAr;
  }

  private familyIdFromValue(value: unknown, options: FamilyOption[]): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    const asNumber = Number(raw);
    if (Number.isFinite(asNumber) && options.some(x => x.id === asNumber)) return asNumber;
    const found = options.find(x => x.nameAr === raw);
    return found?.id ?? null;
  }

  private familyNameFromValue(value: unknown, options: FamilyOption[]): string {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(options.find(x => x.id === value)?.nameAr || '').trim();
    }
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    const asNumber = Number(raw);
    if (Number.isFinite(asNumber)) {
      return String(options.find(x => x.id === asNumber)?.nameAr || raw).trim();
    }
    return raw;
  }

  onServingScopeChange() {
    if (!this.isServant) return;

    const scope = String(this.registerForm.get('servingScope')?.value || '').trim();
    if (!scope) return;

    const famCtrl = this.registerForm.get('deaconFamily');
    const khorsCtrl = this.registerForm.get('khors');
    const attendCtrl = this.registerForm.get('attendKhors');

    if (scope === 'KHORS_ONLY') {
      famCtrl?.clearValidators();
    } else {
      famCtrl?.setValidators([Validators.required]);
    }
    famCtrl?.updateValueAndValidity({ emitEvent: true });

    if (scope === 'FAMILY_ONLY') {
      khorsCtrl?.clearValidators();
      khorsCtrl?.setValue('', { emitEvent: false });
    } else {
      khorsCtrl?.setValidators([Validators.required]);
      const khorsValue = String(khorsCtrl?.value || '').trim();
      if (!khorsValue || (scope !== 'KHORS_ONLY')) {
        khorsCtrl?.setValue('', { emitEvent: false });
      }
    }
    khorsCtrl?.updateValueAndValidity({ emitEvent: true });

    if (scope === 'FAMILY_ONLY') {
      attendCtrl?.enable({ emitEvent: false });
      attendCtrl?.setValidators([Validators.required]);
      if (!String(attendCtrl?.value || '').trim()) {
        attendCtrl?.setValue('', { emitEvent: false });
      }
    } else {
      attendCtrl?.clearValidators();
      attendCtrl?.setValue('', { emitEvent: false });
      attendCtrl?.enable({ emitEvent: false });
    }
    attendCtrl?.updateValueAndValidity({ emitEvent: true });

    this.onKhorsChanged();
    this.registerForm.updateValueAndValidity({ emitEvent: true });
  }

  onKhorsChanged() {
    if (!this.isServant) return;

    const scope = String(this.registerForm.get('servingScope')?.value || '').trim();
    if (!scope) return;

    const kh = String(this.registerForm.get('khors')?.value || '').trim();
    const attendCtrl = this.registerForm.get('attendKhors');

    if (scope === 'FAMILY_ONLY') {
      attendCtrl?.enable({ emitEvent: false });
      return;
    }

    if (kh === this.firstKhorsName) {
      attendCtrl?.clearValidators();
      attendCtrl?.setValue(this.secondKhorsName, { emitEvent: false });
      attendCtrl?.disable({ emitEvent: false });
    } else {
      attendCtrl?.clearValidators();
      attendCtrl?.setValue('', { emitEvent: false });
      attendCtrl?.enable({ emitEvent: false });
    }

    attendCtrl?.updateValueAndValidity({ emitEvent: true });
    this.registerForm.updateValueAndValidity({ emitEvent: true });
  }

  private nationalIdValidator(minAge: number): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const nid = String(control.value || '').trim();
      if (!nid) return null;
      if (!/^\d{14}$/.test(nid)) return { nationalIdFormat: true };

      const centuryCode = nid[0];
      const yy = nid.substring(1, 3);
      const mm = nid.substring(3, 5);
      const dd = nid.substring(5, 7);

      const yearBase = centuryCode === '2' ? 1900 : centuryCode === '3' ? 2000 : null;
      if (yearBase === null) return { nationalIdFormat: true };

      const year = yearBase + Number(yy);
      const month = Number(mm);
      const day = Number(dd);

      const dob = new Date(year, month - 1, day);
      if (isNaN(dob.getTime())) return { nationalIdFormat: true };

      const now = new Date();
      let age = now.getFullYear() - dob.getFullYear();
      const m = now.getMonth() - dob.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;

      if (age < minAge) return { nationalIdMinAge: { minAge, age } };
      return null;
    };
  }

  markInteracted(controlName: string) {
    this.interacted[controlName] = true;
  }

  markTouched(controlName: string) {
    const c = this.registerForm.get(controlName);
    if (!c) return;

    if (this.submitAttempted || this.interacted[controlName]) {
      this.errorGate[controlName] = true;
      c.markAsTouched();
      c.updateValueAndValidity({ emitEvent: true });

      if (controlName === 'confirmPassword' || controlName === 'password') {
        this.applyPasswordMismatch();
      }
    }
  }

  markTouchedFromList(controlName: string) {
    const c = this.registerForm.get(controlName);
    if (!c) return;

    this.interacted[controlName] = true;

    const v = c.value;
    const hasValue = v !== null && v !== undefined && (v + '').trim() !== '';
    if (this.submitAttempted || hasValue) {
      this.errorGate[controlName] = true;
      c.markAsTouched();
    }

    c.updateValueAndValidity({ emitEvent: true });
    this.registerForm.updateValueAndValidity({ emitEvent: true });
  }

  shouldShowError(controlName: string): boolean {
    const c = this.registerForm.get(controlName);
    if (!c) return false;
    const allowed = this.submitAttempted || !!this.errorGate[controlName];
    return allowed && c.invalid;
  }

  errorText(controlName: string, label?: string): string {
    return this.getErrorMessage(controlName, label) || '';
  }

  onStatusChange() {
    const status = this.registerForm.get('status')?.value;

    if (status !== 'graduate') {
      this.registerForm.get('graduatedFrom')?.setValue('', { emitEvent: false });
      this.registerForm.get('graduateJob')?.setValue('', { emitEvent: false });
    }

    const studyTypeCtrl = this.registerForm.get('studyType');

    if (this.isServant && status === 'student') {
      studyTypeCtrl?.setValue('university', { emitEvent: false });
      studyTypeCtrl?.disable({ emitEvent: false });
      this.onStudyTypeChange();
    } else {
      studyTypeCtrl?.enable({ emitEvent: false });
      if (status !== 'student') {
        studyTypeCtrl?.setValue('', { emitEvent: false });
        this.onStudyTypeChange();
      }
    }
  }

  onStudyTypeChange() {
    const studyType = this.registerForm.get('studyType')?.value;

    if (studyType !== 'school') {
      this.registerForm.get('schoolName')?.setValue('', { emitEvent: false });
      this.registerForm.get('schoolGrade')?.setValue('', { emitEvent: false });
    }

    if (studyType !== 'university') {
      this.registerForm.get('universityName')?.setValue('', { emitEvent: false });
      this.registerForm.get('faculty')?.setValue('', { emitEvent: false });
      this.registerForm.get('universityGrade')?.setValue('', { emitEvent: false });
    }
  }

  applyPasswordMismatch() {
    const pass = this.registerForm.get('password')?.value;
    const confirmCtrl = this.registerForm.get('confirmPassword');
    if (!confirmCtrl) return;

    const confirm = confirmCtrl.value;

    if (!confirm) {
      const e = { ...(confirmCtrl.errors || {}) };
      delete e['mismatch'];
      confirmCtrl.setErrors(Object.keys(e).length ? e : null);
      return;
    }

    if (confirm !== pass) {
      confirmCtrl.setErrors({ ...(confirmCtrl.errors || {}), mismatch: true });
    } else {
      const e = { ...(confirmCtrl.errors || {}) };
      delete e['mismatch'];
      confirmCtrl.setErrors(Object.keys(e).length ? e : null);
    }
  }

  getErrorMessage(controlName: string, label?: string): string | null {
    const c = this.registerForm.get(controlName);
    if (!c || !c.errors) return null;

    const e: any = c.errors;
    if (e['required']) return (label || 'هذا الحقل ') + ' يلزم';
    if (e['configRequired']) return (label || 'هذا الحقل ') + ' يلزم';
    if (e['email']) return 'الايميل غير صحيح';
    if (e['arabicOnly']) return 'هذا الحقل لازم يتكتب بالعربي';
    if (e['nationalIdFormat']) return 'الرقم القومي لازم يكون 14 رقم ';
    if (e['nationalIdMinAge']) return 'السن لازم يكون   ' + e['nationalIdMinAge']?.minAge + ' سنين او اكثر';
    if (e['mismatch']) return 'كلية السر او تاكيد كلمة السر غير مطابقين';
    if (e['phone11']) return 'رقم الهاتف يجب أن يكون 11 رقم';
    if (e['guardianSameAsPhone']) return 'ممنوع تكرار نفس رقم ولي الأمر بالرقم الشخصي';
    if (e['api']) return String(e['api']);
    return label ? 'القيمه ' + label + ' غير صحيحه' : ' القيمة غير صحيحه ';
  }

  togglePassword() { this.showPassword = !this.showPassword; }
  toggleConfirmPassword() { this.showConfirmPassword = !this.showConfirmPassword; }

  onNationalIdBlur() {
    const nid = String(this.registerForm.get('nationalId')?.value || '').trim();
    if (!/^\d{14}$/.test(nid)) {
      this.setDerivedIdentityFields('', '');
      return;
    }

    const centuryCode = nid[0];
    const yy = nid.substring(1, 3);
    const mm = nid.substring(3, 5);
    const dd = nid.substring(5, 7);

    const yearBase = centuryCode === '2' ? 1900 : centuryCode === '3' ? 2000 : null;
    if (yearBase === null) {
      this.setDerivedIdentityFields('', '');
      return;
    }

    const year = yearBase + Number(yy);
    const month = Number(mm);
    const day = Number(dd);
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      this.setDerivedIdentityFields('', '');
      return;
    }

    const iso = `${year.toString().padStart(4,'0')}-${mm}-${dd}`;

    const genderDigit = Number(nid.charAt(12));
    const gender = (genderDigit % 2 === 0) ? 'FEMALE' : 'MALE';
    this.setDerivedIdentityFields(iso, gender);
  }

  private setDerivedIdentityFields(dateOfBirth: string, gender: string): void {
    this.registerForm.get('dateOfBirth')?.setValue(dateOfBirth, { emitEvent: false });
    this.registerForm.get('gender')?.setValue(gender, { emitEvent: false });
  }

  private showApiErrors(err: any) {
    this.serverError = null;
    const api = err?.error ?? err;

      const fieldBag =
    (api?.errors && typeof api.errors === 'object') ? api.errors :
    (api?.fields && typeof api.fields === 'object') ? api.fields :
    null;

 if (fieldBag) {
    Object.entries(fieldBag).forEach(([field, msg]) => {
      const ctrl = this.registerForm.get(field);
      if (!ctrl) return;

      const detail = msg ? String(msg) : 'قيمة غير صحيحة';
      ctrl.setErrors({ ...(ctrl.errors || {}), api: detail });
      ctrl.markAsTouched();
    });
    return;
  }

    const msg = api?.message || api?.error || 'حدث خطأ غير متوقع';
    this.serverError = msg;
this.messageService.add({ severity: 'error', summary: 'خطأ', detail: msg });
  }

private guardianNotSameAsPhone(): ValidatorFn {
  return (group: AbstractControl): ValidationErrors | null => {
    const phoneCtrl = group.get('phoneNumber');
    const guardianCtrl = group.get('guardiansPhone');

    if (!phoneCtrl || !guardianCtrl) return null;

    const phone = String(phoneCtrl.value ?? '').trim();
    const guardian = String(guardianCtrl.value ?? '').trim();

    const gErrors = { ...(guardianCtrl.errors || {}) };
    if (gErrors['guardianSameAsPhone']) {
      delete gErrors['guardianSameAsPhone'];
      guardianCtrl.setErrors(Object.keys(gErrors).length ? gErrors : null);
    }

    if (!phone || !guardian) return null;

    if (phone === guardian) {
      guardianCtrl.setErrors({ ...(guardianCtrl.errors || {}), guardianSameAsPhone: true });
      return { guardianSameAsPhone: true }; 
    }

    return null;
  };
}

  submit() {
    this.serverError = null;
    this.submitAttempted = true;

    if (this.registerForm.invalid) {
      this.registerForm.markAllAsTouched();
      this.applyPasswordMismatch();
      return;
    }

    const formValue = this.registerForm.getRawValue();

    if (formValue.password !== formValue.confirmPassword) {
      this.applyPasswordMismatch();
      this.registerForm.get('confirmPassword')?.markAsTouched();
      return;
    }

    const schoolGradeToSend =
      formValue.schoolGrade === 'other'
        ? String(formValue.otherGrade || '').trim()
        : formValue.schoolGrade;

    let khorsToSend = String(formValue.khors || '').trim();
    if (!this.isServant) {
      if (!khorsToSend) khorsToSend = 'NONE';
    }

    const payload: any = {
      fullName: formValue.fullName,
      username: formValue.username,
      email: formValue.email,
      password: formValue.password,
      confirmPassword: formValue.confirmPassword,

      deaconFamily: this.familyNameFromValue(formValue.deaconFamily, this.memberFamilyOptions),
      deaconFamilyId: this.familyIdFromValue(formValue.deaconFamily, this.memberFamilyOptions),
      deaconDegree: formValue.deaconDegree,

      khors: khorsToSend,

      phoneNumber: formValue.phoneNumber,
      address: formValue.address,
      nationalId: formValue.nationalId,
      dateOfBirth: formValue.dateOfBirth,
      gender: formValue.gender,

      status: formValue.status,
      graduatedFrom: formValue.graduatedFrom,
      graduateJob: formValue.graduateJob,

      studyType: formValue.studyType,
      schoolName: formValue.schoolName,
      schoolGrade: schoolGradeToSend,
      universityName: formValue.universityName,
      faculty: formValue.faculty,
      universityGrade: formValue.universityGrade,

      isWorking: formValue.isWorking,
      workDetails: formValue.workDetails,

      guardiansPhone: formValue.guardiansPhone,
      guardianRelation: formValue.guardianRelation,
      khorsYear: formValue.khorsYear,

      secret: String(formValue.secret || '').trim(),
      customFields: {}
    };

    // Extract custom fields values
    for (const key in formValue) {
      if (key.startsWith('custom_') && formValue[key] !== undefined && formValue[key] !== null) {
        const fieldKey = key.substring(7); // remove 'custom_'
        payload.customFields[fieldKey] = formValue[key];
      }
    }

    if (this.isServant) {
  payload.servingWhere = this.familyNameFromValue(formValue.servingWhere, this.servantWhereOptions);
  payload.servingScope = String(formValue.servingScope || '').trim();
  payload.deaconFamily = this.familyNameFromValue(formValue.deaconFamily, this.servantWhereOptions);
  payload.deaconFamilyId = this.familyIdFromValue(formValue.deaconFamily, this.servantWhereOptions);

  if (!payload.servingWhere || !payload.servingScope) {
    this.messageService.add({ severity: 'warn', summary: 'Missing', detail: 'اختار بتخدم فين' });
    return;
  }

  payload.attendKhors = String(formValue.attendKhors || '').trim();

  this.http.post('/api/auth/register-servant', payload, { withCredentials: true })
    .subscribe({
      next: () => {
        this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Servant registered successfully.' });
        this.router.navigate(['/login']);
      },
      error: (err) => {
  this.registerForm.markAllAsTouched();
  this.showApiErrors(err);
}
    });

} else {
      this.http.post('/api/auth/register', payload, { withCredentials: true })
        .subscribe({
          next: () => {
            this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Registered successfully.' });
            this.router.navigate(['/login']);
          },
          error: (err) => this.showApiErrors(err)
        });
    }
  }
}
