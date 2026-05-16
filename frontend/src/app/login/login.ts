import { Component, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { FamilyJoinRequestService } from '../services/family-join-request.service';
import { MessageService } from 'primeng/api';
import { finalize, map, switchMap, catchError } from 'rxjs';
import { of } from 'rxjs';

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
  familyJoinReq = inject(FamilyJoinRequestService);

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
      .pipe(
        finalize(() => (this.isLoading = false)),
        switchMap((user) =>
          this.familyJoinReq.myStatus().pipe(
            map((status) => ({ user, status })),
            catchError(() => of({ user, status: { status: 'NONE', familyId: null, familyName: null } }))
          )
        )
      )
      .subscribe({
        next: ({ user, status }) => {
          if (status.status === 'PENDING') {
            const family = status.familyName || '';
            this.router.navigate(['/pending-approval'], { queryParams: { family } });
          } else if (status.status === 'REJECTED') {
            this.router.navigate(['/choose-family']);
          } else {
            this.messageService.add({
              severity: 'success',
              summary: 'تسجيل دخول ناجح',
              detail: `اهلا بعودتك،  ${user?.username ?? username}!`
            });
            setTimeout(() => this.router.navigate(['/dashboard']), 500);
          }
        },
        error: (err) => {
          this.loginError = err?.error?.error || 'اسم المستخدم أو كلمة المرور غير صحيحة';
        }
      });
  }
}
