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

  forgotForm = this.fb.group({
    phoneNumber: ['', Validators.required],
    username: ['']
  });

  multipleUsers: any[] = [];
  step = 1;

  // ✅ Step 1: Submit phone number
  onSubmit() {
    if (this.forgotForm.invalid) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Missing Field',
        detail: 'Please enter your phone number.'
      });
      return;
    }

    const { phoneNumber } = this.forgotForm.value;
    this.authService.forgotPassword(phoneNumber!).subscribe({
      next: (res: any) => {
        if (res.multipleUsers) {
          this.multipleUsers = res.users;
          this.step = 2;
        } else {
          this.messageService.add({
            severity: 'success',
            summary: 'Code Sent',
            detail: 'A 5-digit reset code has been sent (check console for now).'
          });
          console.log('🔑 Reset Code:', res.code);
          setTimeout(() => {
            this.router.navigate(['/reset-password'], { queryParams: { code: res.code } });
          }, 1500);
        }
      },
      error: (err: any) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: err.error?.error || 'Something went wrong.'
        });
      }
    });
  }

  // ✅ Step 2: Select user if multiple
  onSelectUser(username: string) {
    const { phoneNumber } = this.forgotForm.value;
    this.authService.forgotPasswordWithUsername(phoneNumber!, username).subscribe({
      next: (res: any) => {
        this.messageService.add({
          severity: 'success',
          summary: 'Code Sent',
          detail: 'Reset code sent (check console).'
        });
        setTimeout(() => {
          this.router.navigate(['/reset-password'], { queryParams: { code: res.code } });
        }, 1500);
      },
      error: (err: any) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: err.error?.error || 'Something went wrong.'
        });
      }
    });
  }
}
