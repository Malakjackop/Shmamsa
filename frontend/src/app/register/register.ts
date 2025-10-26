import { Component, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { AuthService } from '../services/auth.service';
import { Router } from '@angular/router';

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

  registerForm: FormGroup;
  showPassword = false;
  showConfirmPassword = false;
  registerError = '';
  registerSuccess = '';

  constructor() {
    this.registerForm = this.fb.group({
      username: ['', Validators.required],
      password: ['', Validators.required],
      confirmPassword: ['', Validators.required],
      phoneNumber: ['', [Validators.required, Validators.pattern(/^\d{11}$/)]],
      motherPhone: ['', [Validators.pattern(/^\d{11}$/)]],
      fatherPhone: ['', [Validators.pattern(/^\d{11}$/)]],
      nationalId: ['', [Validators.required, Validators.pattern(/^\d{14}$/)]],
      dateOfBirth: ['', Validators.required],
      motherJob: [''],
      fatherJob: ['']
    }, {
      validators: [this.phoneNotEqualValidator, this.passwordMatchValidator]
    });
  }

  // ✅ Custom validator: user phone cannot match parent phone
  phoneNotEqualValidator(formGroup: AbstractControl): ValidationErrors | null {
    const phone = formGroup.get('phoneNumber')?.value;
    const mother = formGroup.get('motherPhone')?.value;
    const father = formGroup.get('fatherPhone')?.value;

    if (!phone) return null;
    if (phone === mother || phone === father) {
      return { samePhoneAsParent: true };
    }
    return null;
  }

  // ✅ Custom validator: password match
  passwordMatchValidator(formGroup: AbstractControl): ValidationErrors | null {
    const password = formGroup.get('password')?.value;
    const confirm = formGroup.get('confirmPassword')?.value;
    return password === confirm ? null : { passwordsMismatch: true };
  }

  toggleShowPassword() {
    this.showPassword = !this.showPassword;
  }

  toggleShowConfirmPassword() {
    this.showConfirmPassword = !this.showConfirmPassword;
  }

  onSubmit() {
    if (this.registerForm.invalid) {
      this.registerError = 'Please correct all validation errors.';
      return;
    }

    // ✅ Send only what backend expects
    const formValues = this.registerForm.value;
    const user = {
      username: formValues.username,
      password: formValues.password,
      phoneNumber: formValues.phoneNumber,
      motherPhone: formValues.motherPhone,
      fatherPhone: formValues.fatherPhone,
      nationalId: formValues.nationalId,
      dateOfBirth: formValues.dateOfBirth,
      motherJob: formValues.motherJob,
      fatherJob: formValues.fatherJob
    };

    console.log('Sending payload:', user);

    this.authService.register(user).subscribe({
      next: () => {
        this.registerSuccess = 'Registration successful!';
        this.registerError = '';
        this.router.navigate(['/login']);
      },
      error: (err) => {
        console.error('Registration error:', err);
        this.registerError = err.error?.message || 'Registration failed. Please try again.';
        this.registerSuccess = '';
      }
    });
  }
}
