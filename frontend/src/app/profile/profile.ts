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
  qrData = ''; 
  user: any;

  profileForm = this.fb.group({
    fullName: [{ value: '', disabled: true }, Validators.required],
    email: [{ value: '', disabled: true }, [Validators.required, Validators.email]],
    phoneNumber: [{ value: '', disabled: true }],
    address: [{ value: '', disabled: true }],
    guardiansPhone: [{ value: '', disabled: true }],
    guardianRelation: [{ value: '', disabled: true }],
    deaconFamily: [{ value: '', disabled: true }],
    deaconDegree: [{ value: '', disabled: true }],
    status: [{ value: '', disabled: true }],
    studyType: [{ value: '', disabled: true }],
    schoolName: [{ value: '', disabled: true }],
    schoolGrade: [{ value: '', disabled: true }],
    universityName: [{ value: '', disabled: true }],
    faculty: [{ value: '', disabled: true }],
    universityGrade: [{ value: '', disabled: true }],
    isWorking: [{ value: false, disabled: true }],
    graduatedFrom: [{ value: '', disabled: true }],
    graduateJob: [{ value: '', disabled: true }],
    workDetails: [{ value: '', disabled: true }]
  });

ngOnInit() {

this.profileForm.get('status')?.valueChanges.subscribe((v) => {

  this.profileForm.get('studyType')?.valueChanges.subscribe((v) => {
  if (!this.editMode) return;

  if (this.isServant() && v === 'school') {
    this.profileForm.patchValue({ studyType: 'university' }, { emitEvent: false });
    v = 'university';
  }
});


  if (!this.editMode) return;

  if (v === 'graduate') {
    this.profileForm.patchValue({
      studyType: '',
      schoolName: '',
      schoolGrade: '',
      universityName: '',
      faculty: '',
      universityGrade: ''
    });

    this.profileForm.get('studyType')?.disable();
    this.profileForm.get('schoolName')?.disable();
    this.profileForm.get('schoolGrade')?.disable();
    this.profileForm.get('universityName')?.disable();
    this.profileForm.get('faculty')?.disable();
    this.profileForm.get('universityGrade')?.disable();

    this.profileForm.get('graduatedFrom')?.enable();
    this.profileForm.get('graduateJob')?.enable();
  } else {
    this.profileForm.get('graduatedFrom')?.disable();
    this.profileForm.get('graduateJob')?.disable();
    this.profileForm.patchValue({
      graduatedFrom: '',
      graduateJob: ''
    });

    this.profileForm.get('studyType')?.enable();
  }
});



  this.authService.getUserData().subscribe({
    next: (user) => {
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

const normalizedUser = {
  ...user,
  status: (user?.status || '').toLowerCase(),
  studyType: (user?.studyType || '').toLowerCase()
};

this.user = normalizedUser;
this.profileForm.patchValue(normalizedUser);


        this.profileForm.get('isWorking')?.setValue(!!user?.workDetails);
        this.authService.getMyQrToken().subscribe({
          next: (res) => (this.qrData = res?.token || ''),
          error: () => {
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
isServant(): boolean {
  return ['KHADIM','AMIN_OSRA','AMIN_KHEDMA','DEVELOPER'].includes(this.user?.role);
}

isSchool(): boolean {
  return this.profileForm.get('studyType')?.value === 'school';
}

isUniversity(): boolean {
  return this.profileForm.get('studyType')?.value === 'university';
}

isGraduate(): boolean {
  return this.profileForm.get('status')?.value === 'graduate';
}




isMinor(): boolean {
  const dob = this.user?.dateOfBirth;
  if (!dob) return false;
  const d = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age < 18;
}



toggleEdit() {
  this.editMode = !this.editMode;

  if (!this.editMode) {
    this.profileForm.disable();
    this.profileForm.patchValue(this.user); 
    return;
  }

  this.profileForm.disable();
  this.profileForm.get('status')?.enable();

  // ✅ allow editing email from profile
  this.profileForm.get('email')?.enable();


  this.profileForm.get('phoneNumber')?.enable();
  this.profileForm.get('address')?.enable();
  this.profileForm.get('workDetails')?.enable();

  if (!this.isServant()) {
    this.profileForm.get('guardiansPhone')?.enable();
    this.profileForm.get('guardianRelation')?.enable();
  }

  const st = this.profileForm.get('status')?.value;

if (st === 'graduate') {
  this.profileForm.get('graduatedFrom')?.enable();
  this.profileForm.get('graduateJob')?.enable();
  return; 
}


const status = this.profileForm.get('status')?.value;

if (status === 'student') {
  this.profileForm.get('studyType')?.enable();

  const st = this.profileForm.get('studyType')?.value;

  if (this.isServant() && st === 'school') {
    this.profileForm.patchValue({ studyType: 'university' });
  }

  if (st === 'school' && !this.isServant()) {
    this.profileForm.get('schoolName')?.enable();
    this.profileForm.get('schoolGrade')?.enable();
  }

  if (st === 'university') {
    this.profileForm.get('universityName')?.enable();
    this.profileForm.get('faculty')?.enable();
    this.profileForm.get('universityGrade')?.enable();
  }
}




  if (this.isServant()) {
    this.profileForm.get('status')?.enable();
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
