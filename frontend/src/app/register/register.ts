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

  constructor() {
    this.registerForm = this.fb.group({
      fullName: ['', Validators.required],
      username: ['', Validators.required],
      password: ['', Validators.required],
      confirmPassword: ['', Validators.required],
      phoneNumber: ['', [Validators.pattern(/^\d{11}$/)]],
      nationalId: ['', [Validators.required, Validators.pattern(/^\d{14}$/)]],
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

  // ✅ Validators
  passwordMatchValidator(formGroup: AbstractControl): ValidationErrors | null {
    const pass = formGroup.get('password')?.value;
    const confirm = formGroup.get('confirmPassword')?.value;
    return pass === confirm ? null : { passwordsMismatch: true };
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
