import { Component, inject } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { AuthService } from '../services/auth.service';
import { MessageService } from 'primeng/api';
import { Router } from '@angular/router';

@Component({
  selector: 'app-reset-password',
    standalone:false,
  templateUrl: './reset-password.html',
  styleUrls: ['./reset-password.css'],
  providers: [MessageService]
})
export class ResetPasswordComponent {
  fb = inject(FormBuilder);
  authService = inject(AuthService);
  messageService = inject(MessageService);
  router = inject(Router);

  showPassword = false;

  resetForm = this.fb.group({
    token: ['', Validators.required],
    newPassword: ['', Validators.required]
  });

  onSubmit() {
    if (this.resetForm.invalid) {
      this.messageService.add({ severity: 'warn', summary: 'Missing Fields', detail: 'Please fill in both fields.' });
      return;
    }

    const { token, newPassword } = this.resetForm.value;
    this.authService.resetPassword(token!, newPassword!).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Password Reset',
          detail: 'Your password has been updated successfully!'
        });
        setTimeout(() => this.router.navigate(['/login']), 2000);
      },
      error: (err) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: err.error?.error || 'Invalid or expired token.'
        });
      }
    });
  }
}
