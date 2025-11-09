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
      phoneNumber: ['', [Validators.required, Validators.pattern(/^\d{11}$/)]],
      nationalId: ['', [Validators.required, Validators.pattern(/^\d{14}$/)]],
      dateOfBirth: ['', Validators.required],
      status: ['', Validators.required],
      deaconFamily: ['', Validators.required],
      deaconDegree: ['', Validators.required],
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
      guardianPhone: [''],
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
    const guardian = formGroup.get('guardianPhone')?.value;
    if (!phone || !guardian) return null;
    return phone === guardian ? { sameAsGuardian: true } : null;
  }

  toggleShowPassword() {
    this.showPassword = !this.showPassword;
  }

  toggleShowConfirmPassword() {
    this.showConfirmPassword = !this.showConfirmPassword;
  }

  // ✅ Submit form
  onSubmit() {
    if (this.registerForm.invalid) {
      this.showValidationErrors();
      return;
    }

    if (this.registerForm.errors?.['sameAsGuardian']) {
      this.messageService.add({
        severity: 'error',
        summary: 'Invalid Input',
        detail: 'Your phone number cannot match your guardian’s phone number.',
        life: 4000
      });
      return;
    }

    const raw = this.registerForm.value;
    const payload = {
      ...raw,
      status: raw.status?.toLowerCase() || '',
      studyType: raw.studyType?.toLowerCase() || '',
      dateOfBirth: raw.dateOfBirth
        ? new Date(raw.dateOfBirth).toISOString().split('T')[0]
        : '',
      isWorking: raw.isWorking === 'yes'
    };

    console.log('📤 Sending payload:', payload);
this.authService.register(payload).subscribe({
  next: (res: any) => {   // 👈 added : any
    this.messageService.add({
      severity: 'success',
      summary: 'Registration Successful 🎉',
      detail: 'Your account has been created successfully!',
      life: 4000
    });
    this.registerForm.reset();
    setTimeout(() => this.router.navigate(['/login']), 2000);
  },
  error: (err: any) => {  // 👈 added : any
    console.error('❌ Registration error:', err);
    this.messageService.add({
      severity: 'error',
      summary: 'Registration Failed ❌',
      detail: err.error?.message || 'Something went wrong. Please try again.',
      life: 5000
    });
  }
});

  }

  // ✅ Toast for invalid form
  showValidationErrors() {
    const controls = this.registerForm.controls;
    const invalidFields: string[] = [];

    for (const name in controls) {
      const control = controls[name];
      if (control.invalid) {
        switch (name) {
          case 'fullName': invalidFields.push('Full Name'); break;
          case 'username': invalidFields.push('Username'); break;
          case 'phoneNumber': invalidFields.push('Phone Number'); break;
          case 'nationalId': invalidFields.push('National ID'); break;
          case 'dateOfBirth': invalidFields.push('Date of Birth'); break;
          case 'status': invalidFields.push('Status'); break;
          case 'deaconFamily': invalidFields.push('Deacon Family'); break;
          case 'deaconDegree': invalidFields.push('Deacon Degree'); break;
          case 'password': invalidFields.push('Password'); break;
          case 'confirmPassword': invalidFields.push('Confirm Password'); break;
        }
      }
    }

    if (this.registerForm.errors?.['passwordsMismatch']) {
      this.messageService.add({
        severity: 'error',
        summary: 'Password Error',
        detail: 'Passwords do not match.',
        life: 4000
      });
    }

    if (invalidFields.length > 0) {
      this.messageService.add({
        severity: 'error',
        summary: 'Invalid Form',
        detail: `Please correct: ${invalidFields.join(', ')}`,
        life: 5000
      });
    }
  }
}
