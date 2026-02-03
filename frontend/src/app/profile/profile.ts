import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { AuthService } from '../services/auth.service';
import { MessageService } from 'primeng/api';

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

    
  editMode = false;
  qrData = ''; // ✅ holds QR content
  user: any;

  profileForm = this.fb.group({
    fullName: [{ value: '', disabled: true }, Validators.required],
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
    workDetails: [{ value: '', disabled: true }]
  });

ngOnInit() {
  this.authService.getUserData().subscribe({
    next: (user) => {
        this.user = user;
        this.profileForm.patchValue(user);
        this.qrData = JSON.stringify({
        id: user.id,
        fullName: user.fullName,
        deaconFamily: user.deaconFamily
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
    this.authService.updateProfile(this.profileForm.value).subscribe({
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
