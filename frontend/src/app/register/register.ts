import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
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

  showPassword = false;
  showConfirmPassword = false;

  // ✅ UI toggles for immediate section display
  isStudent = false;
  isGraduate = false;
  isSchool = false;
  isUniversity = false;


  constructor(
    private fb: FormBuilder,
    private http: HttpClient,
    private router: Router,
    private messageService: MessageService
  ) {
  }




  ngOnInit(): void {
    this.buildForm();

    // ✅ Make sections open immediately when select changes
    this.registerForm.get('status')?.valueChanges.subscribe(() => this.onStatusChange());
    this.registerForm.get('studyType')?.valueChanges.subscribe(() => this.onStudyTypeChange());

    // ✅ Keep confirm password mismatch updated
    this.registerForm.get('password')?.valueChanges.subscribe(() => this.applyPasswordMismatch());
    this.registerForm.get('confirmPassword')?.valueChanges.subscribe(() => this.applyPasswordMismatch());

    // Initialize flags once
    this.onStatusChange();
    this.onStudyTypeChange();
  }
private buildForm() {
  
    const minAge = this.isServant ? 16 : 6;

    this.registerForm = this.fb.group({
fullName: ['', Validators.required],
    username: ['', Validators.required],
    phoneNumber: [''],
    nationalId: ['', [Validators.required, this.nationalIdValidator(minAge)]],
    email: ['', [Validators.required, Validators.email]],
    dateOfBirth: [''],
    gender: [''],

    deaconFamily: ['', Validators.required],
    deaconDegree: ['', Validators.required],
    status: this.fb.control('', { updateOn: 'change' }),
    graduatedFrom: [''],
    graduateJob: [''],
    studyType: this.fb.control('', { updateOn: 'change' }),
    schoolName: [''],
    schoolGrade: [''],
    universityName: [''],
    faculty: [''],
    universityGrade: [''],

    isWorking: [''],
    workDetails: [''],

    guardiansPhone: [''],
    guardianRelation: [''],

    password: ['', Validators.required],
    confirmPassword: ['', Validators.required],

    secret: ['']
  }, { updateOn: 'blur' });

  if (this.isServant) {
    this.registerForm.get('secret')?.setValidators([Validators.required]);
  }
  this.registerForm.get('secret')?.updateValueAndValidity();
}


  // ✅ National ID validator (Egyptian 14 digits) + minAge
  private nationalIdValidator(minAge: number): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const nid = String(control.value || '').trim();
      if (!nid) return null; // required handled separately
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

      // age calculation
      const now = new Date();
      let age = now.getFullYear() - dob.getFullYear();
      const m = now.getMonth() - dob.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;

      if (age < minAge) return { nationalIdMinAge: { minAge, age } };
      return null;
    };
  }

  // ✅ Show toast error on blur (instead of waiting submit)
  onFieldBlur(controlName: string, label?: string) {
    const c = this.registerForm.get(controlName);
    if (!c) return;

    // show validation as soon as user leaves the input
    c.markAsTouched();
    c.updateValueAndValidity({ emitEvent: false });

    // keep confirmPassword mismatch updated on blur/change
    if (controlName === 'confirmPassword' || controlName === 'password') {
      this.applyPasswordMismatch();
    }

    if (c.valid) return;

    const msg = this.getErrorMessage(controlName, label);
    if (!msg) return;

    this.messageService.add({ severity: 'error', summary: 'خطأ', detail: msg });
  }



  // ✅ Update UI + validators immediately when user selects Student/Graduate
  onStatusChange() {
    const status = this.registerForm.get('status')?.value;

    // clear graduate fields when not graduate
    if (status !== 'graduate') {
      this.registerForm.get('graduatedFrom')?.setValue('', { emitEvent: false });
      this.registerForm.get('graduateJob')?.setValue('', { emitEvent: false });
      this.registerForm.get('graduatedFrom')?.clearValidators();
      this.registerForm.get('graduateJob')?.clearValidators();
    } else {
      // optional: make them required
      this.registerForm.get('graduatedFrom')?.setValidators([Validators.required]);
      this.registerForm.get('graduateJob')?.setValidators([Validators.required]);
    }

    this.registerForm.get('graduatedFrom')?.updateValueAndValidity({ emitEvent: false });
    this.registerForm.get('graduateJob')?.updateValueAndValidity({ emitEvent: false });
  }

  // ✅ Update UI + validators immediately when user selects School/University
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

  // ✅ Apply confirm password mismatch error to confirmPassword control
  applyPasswordMismatch() {
    const pass = this.registerForm.get('password')?.value;
    const confirmCtrl = this.registerForm.get('confirmPassword');
    if (!confirmCtrl) return;

    const confirm = confirmCtrl.value;

    // if empty, let required handle it
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

  // ✅ Human-friendly error messages per control
  getErrorMessage(controlName: string, label?: string): string | null {
    const c = this.registerForm.get(controlName);
    if (!c || !c.errors) return null;

    const e: any = c.errors;

    // common
    if (e['required']) return `${label || 'هذا الحقل'} مطلوب`;
    if (e['email']) return `البريد الإلكتروني غير صحيح`;

    // national id custom validator keys from this project
    if (e['nationalIdFormat']) return 'الرقم القومي لازم يكون 14 رقم وتاريخ ميلاد صحيح';
    if (e['nationalIdMinAge']) return `لازم السن يكون ${e['nationalIdMinAge']?.minAge} سنين أو أكثر`;

    // password mismatch
    if (e['mismatch']) return 'كلمة المرور وتأكيدها مش متطابقين';

    // default fallback
    return label ? `قيمة ${label} غير صحيحة` : 'قيمة غير صحيحة';
  }


  togglePassword() {
    this.showPassword = !this.showPassword;
  }

  toggleConfirmPassword() {
    this.showConfirmPassword = !this.showConfirmPassword;
  }
onSubmit() {
  this.submit();
}

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

  // ✅ Gender: 13th digit (odd=Male, even=Female)
  const genderDigit = Number(nid.charAt(12));
  const gender = (genderDigit % 2 === 0) ? 'FEMALE' : 'MALE';
  this.registerForm.get('gender')?.setValue(gender);
}


toggleShowPassword() {
  this.togglePassword();
}

toggleShowConfirmPassword() {
  this.toggleConfirmPassword();
}


  
  // ✅ Show backend validation / API errors in a clear way
  private showApiErrors(err: any) {
    const api = err?.error;

    // Spring validation errors: { errors: { field: message, ... } }
    if (api && api.errors && typeof api.errors === 'object') {
      const fieldLabels: Record<string, string> = {
        fullName: 'الاسم بالكامل',
        username: 'اسم المستخدم',
        email: 'البريد الإلكتروني',
        password: 'كلمة المرور',
        confirmPassword: 'تأكيد كلمة المرور',
        nationalId: 'الرقم القومي',
        deaconFamily: 'أسرة الشمامسة',
        deaconDegree: 'الدرجة الشماسية',
        phoneNumber: 'رقم الموبايل',
        guardiansPhone: 'رقم ولي الأمر',
        guardianRelation: 'صلة القرابة',
        status: 'الحالة',
        studyType: 'نوع الدراسة',
        schoolName: 'اسم المدرسة',
        schoolGrade: 'الصف',
        universityName: 'اسم الجامعة/المعهد',
        faculty: 'الكلية',
        universityGrade: 'الفرقة',
        graduatedFrom: 'متخرج من',
        graduateJob: 'الوظيفة',
        isWorking: 'هل تعمل؟',
        workDetails: 'تفاصيل العمل',
        secret: 'Secret'
      };

      const entries = Object.entries(api.errors) as Array<[string, any]>;
      if (entries.length === 0) {
        this.messageService.add({ severity: 'error', summary: 'Error', detail: api.message || 'Validation failed' });
        return;
      }

      // show up to 5 toasts (avoid spam)
      entries.slice(0, 5).forEach(([field, msg]) => {
        const label = fieldLabels[field] || field;
        const detail = msg ? String(msg) : 'قيمة غير صحيحة';
        this.messageService.add({ severity: 'error', summary: label, detail });
      });

      if (entries.length > 5) {
        this.messageService.add({ severity: 'warn', summary: 'ملاحظات', detail: `فيه ${entries.length - 5} أخطاء كمان` });
      }
      return;
    }

    // ApiException: { message, code }
    const msg = api?.message || api?.error || 'Registration failed.';
    this.messageService.add({ severity: 'error', summary: 'Error', detail: msg });
  }

submit() {
  if (this.registerForm.invalid) {
    this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Please fill all required fields.' });
    return;
  }

  const formValue = this.registerForm.value;

  if (formValue.password !== formValue.confirmPassword) {
    this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Passwords do not match.' });
    return;
  }

  const payload: any = {
    fullName: formValue.fullName,
    username: formValue.username,
    email: formValue.email,
    password: formValue.password,
    deaconFamily: formValue.deaconFamily,

    phoneNumber: formValue.phoneNumber,
    nationalId: formValue.nationalId,
    dateOfBirth: formValue.dateOfBirth,
    gender: formValue.gender,
    deaconDegree: formValue.deaconDegree,

    status: formValue.status,
    graduatedFrom: formValue.graduatedFrom,
    graduateJob: formValue.graduateJob,

    studyType: formValue.studyType,
    schoolName: formValue.schoolName,
    schoolGrade: formValue.schoolGrade,
    universityName: formValue.universityName,
    faculty: formValue.faculty,
    universityGrade: formValue.universityGrade,

    isWorking: formValue.isWorking,
    workDetails: formValue.workDetails,

    guardiansPhone: formValue.guardiansPhone,
    guardianRelation: formValue.guardianRelation
  };

  if (this.isServant) {
    // ✅ Register servant
    const headers = new HttpHeaders({
      'X-REG-SECRET': String(formValue.secret || '').trim()
    });

    this.http.post('/api/auth/register-servant', payload, { headers, withCredentials: true })
      .subscribe({
        next: () => {
          this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Servant registered successfully.' });
          this.router.navigate(['/login']);
        },
        error: (err) => {
          this.showApiErrors(err);
        }
      });

  } else {
    // ✅ Register normal (MAKHDOM)
    this.http.post('/api/auth/register', payload, { withCredentials: true })
      .subscribe({
        next: () => {
          this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Registered successfully.' });
          this.router.navigate(['/login']);
        },
        error: (err) => {
          this.showApiErrors(err);
        }
      });
  }
}
}
