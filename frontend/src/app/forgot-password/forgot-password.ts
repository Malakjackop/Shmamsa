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
    email: ['', [Validators.required, Validators.email]]
  });

  onSubmit() {
    if (this.forgotForm.invalid) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Missing Field',
        detail: 'Please enter a valid email.'
      });
      return;
    }

    const { email } = this.forgotForm.value;

    this.authService.forgotPassword(email!).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Code Sent',
          detail: 'A 5-digit reset code has been sent to your email.',
          life: 2500
        });

        setTimeout(() => {
          this.router.navigate(['/reset-password']);
        }, 1200);
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
