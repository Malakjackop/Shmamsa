import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router, RouterModule } from '@angular/router';
import { MessageService } from 'primeng/api';

import { ToastModule } from 'primeng/toast';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputIconModule } from 'primeng/inputicon';

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

  @Input() isServant: boolean = false;

  registerForm!: FormGroup;

  interacted: Record<string, boolean> = {};
  errorGate: Record<string, boolean> = {};
  submitAttempted = false;
  serverError: string | null = null;

  showPassword = false;
  showConfirmPassword = false;
  showOtherGrade = false;

  constructor(
    private fb: FormBuilder,
    private http: HttpClient,
    private router: Router,
    private messageService: MessageService
  ) {}

  ngOnInit(): void {
    this.buildForm();

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
    return String(this.registerForm?.get('servingWhere')?.value || '');
  }
  private buildForm() {
    const minAge = this.isServant ? 16 : 6;

    this.registerForm = this.fb.group({
      fullName: ['', Validators.required],
      username: ['', Validators.required],
      phoneNumber: [''],
      address: [''],
      email: ['', [Validators.required, Validators.email]],

      nationalId: ['', [Validators.required, this.nationalIdValidator(minAge)]],
      dateOfBirth: [''],
      gender: [''],

      // ✅ make selects update instantly (no need to click outside)
      servingWhere: this.fb.control('', { updateOn: 'change' }),

      deaconFamily: this.fb.control('', { validators: [Validators.required], updateOn: 'change' }),
      // NOTE: second family is managed by أمين الخدمة من داخل النظام (not during self registration)
      deaconDegree: this.fb.control('', { validators: [Validators.required], updateOn: 'change' }),

      khors: this.fb.control('', { updateOn: 'change' }), // MARMARKOS / ATHANASIUS / BOTH / NONE

      // ✅ NEW
      attendKhors: this.fb.control('', { updateOn: 'change' }), // MARMARKOS / ATHANASIUS / NONE

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

      guardiansPhone: [''],
      guardianRelation: [''],

      password: ['', Validators.required],
      confirmPassword: ['', Validators.required],

      secret: ['']
    }, { updateOn: 'blur' });

    if (this.isServant) {
      this.registerForm.get('status')?.setValue('student', { emitEvent: false });
      this.onStatusChange();

      this.registerForm.get('secret')?.setValidators([Validators.required]);
      this.registerForm.get('secret')?.updateValueAndValidity({ emitEvent: false });

      this.registerForm.get('servingWhere')?.setValidators([Validators.required]);
      this.registerForm.get('servingWhere')?.updateValueAndValidity({ emitEvent: false });
    }
  }


// ✅ NEW: one dropdown "بتخدم فين" for servants (family OR choir)
onServingWhereChange() {
  if (!this.isServant) return;

  const where = String(this.registerForm.get('servingWhere')?.value || '').trim();
  if (!where) return;

  const scopeCtrl = this.registerForm.get('servingScope');
  const famCtrl = this.registerForm.get('deaconFamily');
  const khorsCtrl = this.registerForm.get('khors');
  const attendCtrl = this.registerForm.get('attendKhors');

  if (where === 'خورس مارمرقس') {
    scopeCtrl?.setValue('KHORS_ONLY', { emitEvent: false });
    famCtrl?.setValue('خورس مارمرقس', { emitEvent: false });
    khorsCtrl?.setValue('MARMARKOS', { emitEvent: false });

    // attend must be ATHANASIUS (locked)
    attendCtrl?.setValue('ATHANASIUS', { emitEvent: false });
    attendCtrl?.disable({ emitEvent: false });

  } else if (where === 'خورس البابا اثناسيوس') {
    scopeCtrl?.setValue('KHORS_ONLY', { emitEvent: false });
    famCtrl?.setValue('خورس البابا اثناسيوس', { emitEvent: false });
    khorsCtrl?.setValue('ATHANASIUS', { emitEvent: false });

    // no attend selection at all
    attendCtrl?.setValue('NONE', { emitEvent: false });
    attendCtrl?.enable({ emitEvent: false });

  } else {
    // Normal family
    scopeCtrl?.setValue('FAMILY_ONLY', { emitEvent: false });
    famCtrl?.setValue(where, { emitEvent: false });
    khorsCtrl?.setValue('NONE', { emitEvent: false });

    // allow user to choose attend
    attendCtrl?.enable({ emitEvent: false });
    if (!String(attendCtrl?.value || '').trim() || String(attendCtrl?.value || '').trim() === 'NONE') {
      attendCtrl?.setValue('', { emitEvent: false });
    }
  }

  // Apply existing validators/rules based on servingScope & khors
  this.onServingScopeChange();
  this.onKhorsChanged();
}

  // ✅ apply rules AFTER user chooses scope
  onServingScopeChange() {
    if (!this.isServant) return;

    const scope = String(this.registerForm.get('servingScope')?.value || '').trim();
    if (!scope) return;

    const famCtrl = this.registerForm.get('deaconFamily');
    const khorsCtrl = this.registerForm.get('khors');
    const attendCtrl = this.registerForm.get('attendKhors');

    // Family required only when serving in family
    if (scope === 'KHORS_ONLY') {
      famCtrl?.clearValidators();
      // keep current value (family label or choir label)
    } else {
      famCtrl?.setValidators([Validators.required]);
    }
    famCtrl?.updateValueAndValidity({ emitEvent: true });

    // Khors required when serving in khors
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

    // ✅ Attend Khors rules
    if (scope === 'FAMILY_ONLY') {
      // required + user chooses
      attendCtrl?.enable({ emitEvent: false });
      attendCtrl?.setValidators([Validators.required]);
      if (!String(attendCtrl?.value || '').trim()) {
        attendCtrl?.setValue('', { emitEvent: false });
      }
    } else {
      // not required by default, will be handled by onKhorsChanged()
      attendCtrl?.clearValidators();
      attendCtrl?.setValue('NONE', { emitEvent: false });
      attendCtrl?.enable({ emitEvent: false });
    }
    attendCtrl?.updateValueAndValidity({ emitEvent: true });

    this.onKhorsChanged();
    this.registerForm.updateValueAndValidity({ emitEvent: true });
  }

  // ✅ when servant chooses serving khors
  onKhorsChanged() {
    if (!this.isServant) return;

    const scope = String(this.registerForm.get('servingScope')?.value || '').trim();
    if (!scope) return;

    const kh = String(this.registerForm.get('khors')?.value || '').toUpperCase();
    const attendCtrl = this.registerForm.get('attendKhors');

    if (scope === 'FAMILY_ONLY') {
      // already handled (manual choice)
      attendCtrl?.enable({ emitEvent: false });
      return;
    }

    // scope KHORS_ONLY or BOTH:
    // if serving MARMARKOS -> attend ATHANASIUS (show + disabled)
    if (kh === 'MARMARKOS') {
      attendCtrl?.clearValidators();
      attendCtrl?.setValue('ATHANASIUS', { emitEvent: false });
      attendCtrl?.disable({ emitEvent: false }); // lock default
    } else {
      // serving ATHANASIUS or BOTH -> no attend selection
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

    // Treat list/select controls as "interacted" on change,
    // but don't open the error gate while the value is still empty.
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
    if (e['required']) return `${label || 'this field '} required`;
    if (e['email']) return `email not correct`;
    if (e['nationalIdFormat']) return 'national id must be 14 chracters ';
    if (e['nationalIdMinAge']) return `age must be  ${e['nationalIdMinAge']?.minAge} or more`;
    if (e['mismatch']) return 'password or confirm passwword not match';
    if (e['api']) return String(e['api']);

    return label ? `Value ${label} not correct` : ' Vlaue not correct ';
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
    const api = err?.error;

    if (api && api.errors && typeof api.errors === 'object') {
      const entries = Object.entries(api.errors) as Array<[string, any]>;
      entries.forEach(([field, msg]) => {
        const ctrl = this.registerForm.get(field);
        if (!ctrl) return;
        const detail = msg ? String(msg) : 'value not correct';
        ctrl.setErrors({ ...(ctrl.errors || {}), api: detail });
        if (this.submitAttempted) ctrl.markAsTouched();
      });
      return;
    }

    this.serverError = api?.message || api?.error || 'An unexpected error occurred. Please try again.';
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

      deaconFamily: formValue.deaconFamily,
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
  payload.servingWhere = String(formValue.servingWhere || '').trim();
  payload.servingScope = String(formValue.servingScope || '').trim();

  if (!payload.servingWhere || !payload.servingScope) {
    this.messageService.add({ severity: 'warn', summary: 'Missing', detail: 'اختار بتخدم فين' });
    return;
  }

  // ✅ Send attendKhors (may be NONE)
  payload.attendKhors = String(formValue.attendKhors || '').trim();

  this.http.post('/api/auth/register-servant', payload, { withCredentials: true })
    .subscribe({
      next: () => {
        this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Servant registered successfully.' });
        this.router.navigate(['/login']);
      },
      error: (err) => this.showApiErrors(err)
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
