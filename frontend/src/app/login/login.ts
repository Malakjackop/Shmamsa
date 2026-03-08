import { Component, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { MessageService } from 'primeng/api';
import { finalize } from 'rxjs';

@Component({
  selector: 'app-login',
  standalone: false,
  templateUrl: './login.html',
  styleUrls: ['./login.css'],
  providers: [MessageService]
})
export class LoginComponent {
  fb = inject(FormBuilder);
  router = inject(Router);
  authService = inject(AuthService);
  messageService = inject(MessageService);

  loginForm: FormGroup = this.fb.group({
    username: ['', Validators.required],
    password: ['', Validators.required],
  });

  loginError: string | null = null;
  showPassword = false;
  isLoading = false;

  toggleShowPassword(): void {
    this.showPassword = !this.showPassword;
  }

  onSubmit(): void {
    if (this.isLoading) {
      return;
    }

    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      this.messageService.add({
        severity: 'warn',
        summary: 'Validation Error',
        detail: 'برجاء ملئ البيانات المطلوبه',
      });
      return;
    }

    const { username, password } = this.loginForm.value;
    this.loginError = null;
    this.isLoading = true;

    this.authService
      .login(username, password)
      .pipe(finalize(() => (this.isLoading = false)))
      .subscribe({
        next: (user) => {
          this.messageService.add({
            severity: 'success',
            summary: 'تسجيل دخول ناجح',
            detail: `اهلا بعودتك،  ${user?.username ?? username}!`
          });
          setTimeout(() => this.router.navigate(['/dashboard']), 500);
        },
        error: (err) => {
          this.loginError = err.error?.error || 'اسم المستخدم او كلمة المرور خطأ';
        }
      });
  }
}
