import { Component, Input, OnInit, PLATFORM_ID, inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router, RouterModule } from '@angular/router';
import { MessageService } from 'primeng/api';

import { ToastModule } from 'primeng/toast';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputIconModule } from 'primeng/inputicon';

interface FamilyOption {
  id?: number;
  code?: string;
  nameAr: string;
  baseName?: string;
  branch?: string | null;
  category?: string;
}

@Component({
  selector: 'app-register',
  templateUrl: './register.html',
  styleUrls: ['./register.css'],
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ReactiveFormsModule,
    ToastModule,
    ButtonModule,
    InputTextModule,
    InputIconModule
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
  showOtherGrade = false;
  memberFamilyOptions: FamilyOption[] = [];
  servantWhereOptions: FamilyOption[] = [];

  constructor(
    private fb: FormBuilder,
    private http: HttpClient,
    private router: Router,
    private messageService: MessageService
  ) {}

  ngOnInit(): void {
    this.buildForm();
    if (isPlatformBrowser(this.platformId)) {
      this.loadFamilyOptions();
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

    this.registerForm.get('schoolGrade')?.valueChanges.subscribe(value => {
      this.showOtherGrade = value === 'other';

      const otherCtrl = this.registerForm.get('otherGrade');

      if (value === 'other') {
        otherCtrl?.setValidators([Validators.required]);
      } else {
        otherCtrl?.setValue('', { emitEvent: false });
        otherCtrl?.clearValidators();
      }

      otherCtrl?.updateValueAndValidity({ emitEvent: false });
    });
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
  private buildForm() {
    const minAge = this.isServant ? 16 : 6;

    this.registerForm = this.fb.group({
      fullName: ['', [Validators.required, this.arabicTextOnly()]],
      username: ['', Validators.required],
      phoneNumber: ['', [this.optionalPhone11()]],
      address: ['', [Validators.required, this.arabicTextOnly(true)]],
      email: ['', [Validators.required, Validators.email]],

      nationalId: ['', [Validators.required, this.nationalIdValidator(minAge)]],
      dateOfBirth: [''],
      gender: [''],

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

  if (where === 'خورس مارمرقس') {
    scopeCtrl?.setValue('KHORS_ONLY', { emitEvent: false });
    famCtrl?.setValue('خورس مارمرقس', { emitEvent: false });
    khorsCtrl?.setValue('MARMARKOS', { emitEvent: false });

    attendCtrl?.setValue('ATHANASIUS', { emitEvent: false });
    attendCtrl?.disable({ emitEvent: false });

  } else if (where === 'خورس البابا اثناسيوس') {
    scopeCtrl?.setValue('KHORS_ONLY', { emitEvent: false });
    famCtrl?.setValue('خورس البابا اثناسيوس', { emitEvent: false });
    khorsCtrl?.setValue('ATHANASIUS', { emitEvent: false });

    attendCtrl?.setValue('NONE', { emitEvent: false });
    attendCtrl?.enable({ emitEvent: false });

  } else {
    scopeCtrl?.setValue('FAMILY_ONLY', { emitEvent: false });
    famCtrl?.setValue(where, { emitEvent: false });
    khorsCtrl?.setValue('NONE', { emitEvent: false });

    attendCtrl?.enable({ emitEvent: false });
    if (!String(attendCtrl?.value || '').trim() || String(attendCtrl?.value || '').trim() === 'NONE') {
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
      khorsCtrl?.setValue('NONE', { emitEvent: false });
    } else {
      khorsCtrl?.setValidators([Validators.required]);
      const khorsValue = String(khorsCtrl?.value || '').toUpperCase();
      if (khorsValue === 'NONE' || (scope !== 'KHORS_ONLY' && khorsValue === 'BOTH')) {
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
      attendCtrl?.setValue('NONE', { emitEvent: false });
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

    const kh = String(this.registerForm.get('khors')?.value || '').toUpperCase();
    const attendCtrl = this.registerForm.get('attendKhors');

    if (scope === 'FAMILY_ONLY') {
      attendCtrl?.enable({ emitEvent: false });
      return;
    }

    if (kh === 'MARMARKOS') {
      attendCtrl?.clearValidators();
      attendCtrl?.setValue('ATHANASIUS', { emitEvent: false });
      attendCtrl?.disable({ emitEvent: false }); 
    } else {
      attendCtrl?.clearValidators();
      attendCtrl?.setValue('NONE', { emitEvent: false });
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
      this.registerForm.get('graduatedFrom')?.clearValidators();
      this.registerForm.get('graduateJob')?.clearValidators();
    } else {
      this.registerForm.get('graduatedFrom')?.setValidators([Validators.required]);
      this.registerForm.get('graduateJob')?.setValidators([Validators.required]);
    }

    this.registerForm.get('graduatedFrom')?.updateValueAndValidity({ emitEvent: false });
    this.registerForm.get('graduateJob')?.updateValueAndValidity({ emitEvent: false });

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
      this.registerForm.get('schoolName')?.clearValidators();
      this.registerForm.get('schoolGrade')?.clearValidators();
    } else {
      this.registerForm.get('schoolName')?.setValidators([Validators.required]);
      this.registerForm.get('schoolGrade')?.setValidators([Validators.required]);
    }

    if (studyType !== 'university') {
      this.registerForm.get('universityName')?.setValue('', { emitEvent: false });
      this.registerForm.get('faculty')?.setValue('', { emitEvent: false });
      this.registerForm.get('universityGrade')?.setValue('', { emitEvent: false });
      this.registerForm.get('universityName')?.clearValidators();
      this.registerForm.get('faculty')?.clearValidators();
      this.registerForm.get('universityGrade')?.clearValidators();
    } else {
      this.registerForm.get('universityName')?.setValidators([Validators.required]);
      this.registerForm.get('faculty')?.setValidators([Validators.required]);
      this.registerForm.get('universityGrade')?.setValidators([Validators.required]);
    }

    this.registerForm.get('schoolName')?.updateValueAndValidity({ emitEvent: false });
    this.registerForm.get('schoolGrade')?.updateValueAndValidity({ emitEvent: false });
    this.registerForm.get('universityName')?.updateValueAndValidity({ emitEvent: false });
    this.registerForm.get('faculty')?.updateValueAndValidity({ emitEvent: false });
    this.registerForm.get('universityGrade')?.updateValueAndValidity({ emitEvent: false });
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
    if (!/^\d{14}$/.test(nid)) return;

    const centuryCode = nid[0];
    const yy = nid.substring(1, 3);
    const mm = nid.substring(3, 5);
    const dd = nid.substring(5, 7);

    const yearBase = centuryCode === '2' ? 1900 : centuryCode === '3' ? 2000 : null;
    if (yearBase === null) return;

    const year = yearBase + Number(yy);
    const month = Number(mm);
    const day = Number(dd);
    if (month < 1 || month > 12 || day < 1 || day > 31) return;

    const iso = `${year.toString().padStart(4,'0')}-${mm}-${dd}`;
    this.registerForm.get('dateOfBirth')?.setValue(iso);

    const genderDigit = Number(nid.charAt(12));
    const gender = (genderDigit % 2 === 0) ? 'FEMALE' : 'MALE';
    this.registerForm.get('gender')?.setValue(gender);
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

      secret: String(formValue.secret || '').trim(),
    };

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
