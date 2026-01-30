import { Component, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { MessageService } from 'primeng/api';

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

  toggleShowPassword(): void {
    this.showPassword = !this.showPassword;
  }

  onSubmit(): void {
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      this.messageService.add({
        severity: 'warn',
        summary: 'Validation Error',
        detail: 'Please fill in all required fields.',
      });
      return;
    }

    const { username, password } = this.loginForm.value;

this.authService.login(username, password).subscribe({
  next: () => {
    this.messageService.add({ severity:'success', summary:'Login Successful', detail:`Welcome back, ${username}!` });
    setTimeout(() => this.router.navigate(['/dashboard']), 1000);
  },
  error: (err) => {
    this.loginError = err.error?.error || 'Invalid username or password';
  }
});

  }
}
