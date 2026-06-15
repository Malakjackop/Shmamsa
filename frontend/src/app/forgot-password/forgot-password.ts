import { Component, inject } from '@angular/core';
import { AuthService } from '../services/auth.service';
import { MessageService } from 'primeng/api';
import { Router } from '@angular/router';
import{environment}from '../../environments/environment';

@Component({
  selector: 'app-forgot-password',
  standalone: false,
  templateUrl: './forgot-password.html',
  styleUrls: ['./forgot-password.css'],
  providers: [MessageService]
})
export class ForgotPasswordComponent {
  authService = inject(AuthService);
  messageService = inject(MessageService);
  router = inject(Router);

  step = 1;

  phoneNumber = '';
  waCode = '';      
  otp = '';        
  newPassword = '';
  showPassword = false;
  isSending = false;

  private churchWhatsApp = environment.churchWhatsAppNumber;

  requestWaCode() {
    const phone = this.phoneNumber.trim();

    if (!phone || phone.length !== 11 || !phone.startsWith('0')) {
      this.messageService.add({ severity: 'warn', detail: 'برجاء إدخال رقم هاتف صحيح (11 رقم)' });
      return;
    }

    this.isSending = true;
    this.authService.forgotPassword(phone).subscribe({
      next: (res: any) => {
        this.waCode = res.waCode;
        this.step = 2;
      },
      error: (err: any) => {
        this.messageService.add({
          severity: 'error',
          detail: err.error?.message || err.error?.error || 'حدث خطأ، حاول مرة أخرى'
        });
      },
      complete: () => { this.isSending = false; }
    });
  }

  openWhatsApp() {
    const text = encodeURIComponent(this.waCode);
    window.open(`https://wa.me/${this.churchWhatsApp}?text=${text}`, '_blank');
  }

  resetPassword() {
    if (!this.otp.trim() || !this.newPassword.trim()) {
      this.messageService.add({ severity: 'warn', detail: 'برجاء إدخال الـ OTP وكلمة المرور الجديدة' });
      return;
    }

    this.authService.resetPassword(this.otp.trim(), this.newPassword.trim()).subscribe({
      next: () => {
        this.messageService.add({ severity: 'success', detail: 'تم تحديث كلمة المرور بنجاح', life: 2500 });
        setTimeout(() => this.router.navigate(['/login']), 1000);
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
