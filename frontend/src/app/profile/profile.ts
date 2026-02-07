import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { AuthService } from '../services/auth.service';
import { MessageService } from 'primeng/api';
import { Router } from '@angular/router';

@Component({
  selector: 'app-profile',
  standalone: false,
  templateUrl: './profile.html',
  styleUrls: ['./profile.css'],
  providers: [MessageService]
})
export class ProfileComponent implements OnInit {
  fb = inject(FormBuilder);
  authService = inject(AuthService);
  messageService = inject(MessageService);
  router = inject(Router);


  editMode = false;
  qrData = ''; // ✅ holds QR content
  user: any;

  profileForm = this.fb.group({
    fullName: [{ value: '', disabled: true }, Validators.required],
    email: [{ value: '', disabled: true }, [Validators.required, Validators.email]],
    phoneNumber: [{ value: '', disabled: true }],
    guardiansPhone: [{ value: '', disabled: true }],
    guardianRelation: [{ value: '', disabled: true }],
    deaconFamily: [{ value: '', disabled: true }],
    deaconDegree: [{ value: '', disabled: true }],
    status: [{ value: '', disabled: true }],
    studyType: [{ value: '', disabled: true }],
    schoolName: [{ value: '', disabled: true }],
    universityName: [{ value: '', disabled: true }],
    faculty: [{ value: '', disabled: true }],
    universityGrade: [{ value: '', disabled: true }],
    isWorking: [{ value: false, disabled: true }],
    workDetails: [{ value: '', disabled: true }]
  });

ngOnInit() {
  this.authService.getUserData().subscribe({
    next: (user) => {
        // ممكن يحصل Refresh قبل ما يكون فيه Session صالحة → user بيبقى null
        if (!user) {
          this.user = null;
          this.messageService.add({
            severity: 'warn',
            summary: 'Session expired',
            detail: 'Please login again.'
          });
          this.router.navigate(['/login']);
          return;
        }

        this.user = user;
        this.profileForm.patchValue(user);
        // derive isWorking from workDetails
        this.profileForm.get('isWorking')?.setValue(!!user?.workDetails);
        // ✅ Ask backend for a signed QR token (safe to screenshot/print)
        this.authService.getMyQrToken().subscribe({
          next: (res) => (this.qrData = res?.token || ''),
          error: () => {
            // fallback: keep something visible (NOT secure) if token fails
            this.qrData = '';
          }
        });
    },
    error: () => this.messageService.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Failed to load profile.',
    }),
  });
}
isServantOrAbove(): boolean {
  return ['KHADIM','AMIN_OSRA','AMIN_KHEDMA','DEVELOPER'].includes(this.user?.role);
}



  toggleEdit() {
    this.editMode = !this.editMode;
    if (this.editMode) {
      this.profileForm.enable();
    } else {
      this.profileForm.disable();
    }
  }

  saveChanges() {
    const raw = this.profileForm.getRawValue();
    const payload: any = { ...raw };
    if (!payload.isWorking) payload.workDetails = '';

    this.authService.updateProfile(payload).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Saved',
          detail: 'Profile updated successfully!'
        });
        this.profileForm.disable();
        this.editMode = false;
      },
      error: (err) =>
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: err.error?.error || 'Update failed.'
        })
    });
  }

  logout() {
    this.authService.logout().subscribe(() => {
      localStorage.clear();
      window.location.href = '/login';
    });
  }
}
