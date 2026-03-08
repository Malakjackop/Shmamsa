import { Component, inject } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { AuthService } from '../services/auth.service';
import { MessageService } from 'primeng/api';
import { Router } from '@angular/router';

@Component({
  selector: 'app-forgot-password',
  standalone: false,
  templateUrl: './forgot-password.html',
  styleUrls: ['./forgot-password.css'],
  providers: [MessageService]
})
export class ForgotPasswordComponent {
  fb = inject(FormBuilder);
  authService = inject(AuthService);
  messageService = inject(MessageService);
  router = inject(Router);

  showPassword = false;
  isSendingCode = false;
  codeSent = false;

  resetForm = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    token: ['', Validators.required],
    newPassword: ['', Validators.required]
  });

  get emailControl() {
    return this.resetForm.get('email');
  }

  sendCode() {
    const email = this.emailControl?.value;
    if (this.emailControl?.invalid || !email || this.isSendingCode) {
      return;
    }

    this.isSendingCode = true;
    this.authService.forgotPassword(email).subscribe({
      next: () => {
        this.codeSent = true;
        this.messageService.add({
          severity: 'success',
          detail: 'تم ارسال الكود بنجاح',
          life: 2500
        });
      },
      error: (err: any) => {
        this.messageService.add({
          severity: 'error',
          detail: err.error?.error || 'حدث شئ خطأ.'
        });
      },
      complete: () => {
        this.isSendingCode = false;
      }
    });
  }

  onSubmit() {
    if (this.resetForm.invalid) {
      this.messageService.add({
        severity: 'warn',
        detail: 'برجاء ادخال البيانات المطلوبة'
      });
      return;
    }

    if (!this.codeSent) {
      this.messageService.add({
        severity: 'warn',
        detail: 'برجاء ارسال الكود على الإيميل اولا'
      });
      return;
    }

    const { token, newPassword } = this.resetForm.value;

    this.authService.resetPassword(token!, newPassword!).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          detail: 'تم تحديث كلمة المرور بنجاح',
          life: 2500
        });

        setTimeout(() => {
          this.router.navigate(['/login']);
        }, 1000);
      },
      error: (err: any) => {
        this.messageService.add({
          severity: 'error',
          detail: err.error?.error || 'الكود غير صحيح أو منتهي الصلاحية'
        });
      }
    });
  }
}
