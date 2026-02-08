import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
  AbstractControl,
  ValidationErrors,
  ValidatorFn
} from '@angular/forms';
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
export class RegisterComponent {
  @Input() isServant: boolean = false;

  registerForm!: FormGroup;

  showPassword = false;
  showConfirmPassword = false;

  constructor(
    private fb: FormBuilder,
    private http: HttpClient,
    private router: Router,
    private messageService: MessageService
  ) {
    this.buildForm();
  }

  // ✅ National ID validator: 14 digits + valid DOB + minAge (default 6)
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

      // validate date parts
      if (month < 1 || month > 12 || day < 1 || day > 31) return { nationalIdFormat: true };

      const dob = new Date(year, month - 1, day);
      if (isNaN(dob.getTime())) return { nationalIdFormat: true };

      // ✅ age calc
      const now = new Date();
      let age = now.getFullYear() - dob.getFullYear();
      const m = now.getMonth() - dob.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;

      if (age < minAge) return { nationalIdMinAge: { minAge, age } };

      return null;
    };
  }

  private buildForm() {
    this.registerForm = this.fb.group({
      fullName: ['', Validators.required],
      username: ['', Validators.required],
      phoneNumber: [''],
      nationalId: ['', [Validators.required, this.nationalIdValidator(6)]],
      email: ['', [Validators.required, Validators.email]],
      dateOfBirth: [''],
      gender: [''],

      deaconFamily: ['', Validators.required],
      deaconDegree: ['', Validators.required],

      status: [''],
      graduatedFrom: [''],
      graduateJob: [''],

      studyType: [''],
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
    });

    if (this.isServant) {
      this.registerForm.get('secret')?.setValidators([Validators.required]);
    }
    this.registerForm.get('secret')?.updateValueAndValidity();
  }

  // ✅ Human-friendly error message (used by blur toast)
  private getErrorMessage(controlName: string, label?: string): string | null {
    const c = this.registerForm.get(controlName);
    if (!c || !c.errors) return null;

    const e: any = c.errors;

    if (e['required']) return `${label || 'هذا الحقل'} مطلوب`;
    if (e['email']) return 'البريد الإلكتروني غير صحيح';

    // National ID
    if (e['nationalIdFormat']) return 'الرقم القومي لازم يكون 14 رقم وتاريخ ميلاد صحيح';
    if (e['nationalIdMinAge']) return `لازم السن يكون ${e['nationalIdMinAge']?.minAge} سنين أو أكثر`;

    return label ? `قيمة ${label} غير صحيحة` : 'قيمة غير صحيحة';
  }

  // ✅ Show toast errors on blur (including required + national id age)
  onFieldBlur(controlName: string, label?: string) {
    const c = this.registerForm.get(controlName);
    if (!c) return;

    c.markAsTouched();
    c.updateValueAndValidity({ emitEvent: false });

    if (c.valid) return;

    const msg = this.getErrorMessage(controlName, label);
    if (!msg) return;

    this.messageService.add({ severity: 'error', summary: 'خطأ', detail: msg });
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

    // ✅ always re-validate on blur so toast shows correct reason
    this.registerForm.get('nationalId')?.updateValueAndValidity({ emitEvent: false });

    if (!nid) return; // required handled by toast

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

    const iso = `${year.toString().padStart(4, '0')}-${mm}-${dd}`;
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
      confirmPassword: formValue.confirmPassword, // ✅ مهم للباك

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
            const msg = err?.error?.error || err?.error?.message || 'Registration failed.';
            this.messageService.add({ severity: 'error', summary: 'Error', detail: msg });
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
            const msg = err?.error?.error || err?.error?.message || 'Registration failed.';
            this.messageService.add({ severity: 'error', summary: 'Error', detail: msg });
          }
        });
    }
  }
}
