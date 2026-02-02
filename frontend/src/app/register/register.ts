import { Component, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { AuthService } from '../services/auth.service';
import { Router } from '@angular/router';
import { MessageService } from 'primeng/api';

@Component({
  selector: 'app-register',
  standalone: false,
  templateUrl: './register.html',
  styleUrls: ['./register.css']
})
export class RegisterComponent {
  fb = inject(FormBuilder);
  authService = inject(AuthService);
  router = inject(Router);
  messageService = inject(MessageService);

  registerForm: FormGroup;
  showPassword = false;
  showConfirmPassword = false;
  submitted = false;

  constructor() {
    this.registerForm = this.fb.group({
      fullName: ['', Validators.required],
      username: ['', Validators.required],
      password: ['', Validators.required],
      confirmPassword: ['', Validators.required],
      phoneNumber: ['', [Validators.pattern(/^\d{11}$/)]],
      nationalId: [
        '',
        [
          Validators.required,
          Validators.pattern(/^\d{14}$/),
          this.nationalIdAgeValidator
        ]
      ],
      dateOfBirth: ['', Validators.required],
      status: ['', Validators.required],
      deaconFamily: ['', Validators.required],
      deaconDegree: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
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
      guardianRelation: ['']
    }, {
      validators: [this.passwordMatchValidator, this.phoneNotEqualGuardian]
    });
  }


    // ✅ Triggered when leaving the National ID input
    onNationalIdBlur(){
      const value = this.registerForm.get('nationalId')?.value;
      const dobControl = this.registerForm.get('dateOfBirth');

      // ✅ if NationalId less than 14 digit
      if (!value || value.length !== 14) {
        dobControl?.setValue('');
        dobControl?.enable();
        if (value) {
          this.messageService.add({
            severity: 'error',
            summary: 'Wrong NationalID',
            detail: 'National ID must be 14 digits',
            life: 4000
          });
        }
        return;
      }


      const birthDate = this.extractBirthDateFromNationalId(value);

      if (!birthDate) {
        dobControl?.setValue('');
        dobControl?.enable();
        this.messageService.add({
          severity: 'error',
          summary: 'Wrong NationalID',
          detail: 'Invalid NationalID',
          life: 4000
        });
        return;
      }


      dobControl?.setValue(birthDate.toISOString().split('T')[0]);
      dobControl?.disable();
      const age = this.calculateAge(birthDate);
      if (age < 6) {
        this.messageService.add({
          severity: 'error',
          summary: 'Age is less than 6 years',
          detail: 'Age must be older than 6 years',
          life: 4000
        });
      }
  }

  // ✅ Calculate Age
  calculateAge(birthDate: Date): number {
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  }

  // ✅ Validators
  passwordMatchValidator(formGroup: AbstractControl): ValidationErrors | null {
    const pass = formGroup.get('password')?.value;
    const confirm = formGroup.get('confirmPassword')?.value;
    return pass === confirm ? null : { passwordsMismatch: true };
  }

  nationalIdAgeValidator = (control: AbstractControl): ValidationErrors | null => {
    const nationalId = control.value;
    if (!nationalId || nationalId.length !== 14) return null;

    const century = nationalId[0] === '2' ? 1900 : 2000;
    const year = century + parseInt(nationalId.substring(1, 3));
    const month = parseInt(nationalId.substring(3, 5)) - 1;
    const day = parseInt(nationalId.substring(5, 7));

    const birthDate = new Date(year, month, day);

    if (isNaN(birthDate.getTime())) {
      return { invalidNationalId: true };
    }

    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }

    return age < 6 ? { underAge: true } : null;
  };

  extractBirthDateFromNationalId(nationalId: string): Date | null {
    if (!nationalId || nationalId.length !== 14) return null;

    const century = nationalId[0] === '2' ? 1900 : 2000;
    const year = century + parseInt(nationalId.substring(1, 3));
    const month = parseInt(nationalId.substring(3, 5)) - 1; // JS months 0-11
    const day = parseInt(nationalId.substring(5, 7));

    const date = new Date(Date.UTC(year, month, day));
    return isNaN(date.getTime()) ? null : date;
  }



  phoneNotEqualGuardian(formGroup: AbstractControl): ValidationErrors | null {
    const phone = formGroup.get('phoneNumber')?.value;
    const guardian = formGroup.get('guardiansPhone')?.value;
    if (!phone || !guardian) return null;
    return phone === guardian ? { sameAsGuardian: true } : null;
  }

  toggleShowPassword() { this.showPassword = !this.showPassword; }
  toggleShowConfirmPassword() { this.showConfirmPassword = !this.showConfirmPassword; }

  // ✅ Submit form
  onSubmit() {
    this.submitted = true;
    if (this.registerForm.invalid) {
      this.showValidationErrors();
      return;
    }

    const raw = this.registerForm.value;

    // ✅ Clean payload to match backend model
    const payload = {
      ...raw,
      status: raw.status?.toLowerCase() || '',
      studyType: raw.studyType?.toLowerCase() || '',
      dateOfBirth: raw.dateOfBirth
        ? new Date(raw.dateOfBirth).toISOString().split('T')[0]
        : null,
      isWorking: raw.isWorking === 'yes',  // ✅ convert string to boolean
      guardiansPhone: raw.guardiansPhone?.trim() || null, // ✅ convert empty string to null
      phoneNumber: raw.phoneNumber?.trim() || null,
    };

    this.authService.register(payload).subscribe({
      next: (res: any) => {
        this.messageService.add({
          severity: 'success',
          summary: 'Registration Successful 🎉',
          detail: 'Your account has been created successfully!',
          life: 4000
        });
        this.registerForm.reset();
        setTimeout(() => this.router.navigate(['/login']), 2000);
      },
      error: (err: any) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Registration Failed ❌',
          detail: err.error?.error || 'Something went wrong. Please try again.',
          life: 5000
        });
      }
    });
  }

  // ✅ Toast for invalid form
  showValidationErrors() {
    this.messageService.add({
      severity: 'warn',
      summary: 'Invalid Form',
      detail: 'Please fill in all required fields correctly.',
      life: 4000
    });
  }
}
