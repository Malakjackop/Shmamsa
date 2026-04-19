import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { AuthService } from '../services/auth.service';
import { MessageService } from 'primeng/api';
import { Router } from '@angular/router';
import { normalizeRole } from '../shared/role-utils';
import { DevSettingsService, CustomField } from '../services/dev-settings.service';
import { buildVisibleCustomFieldEntries } from '../shared/custom-field-display';

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
  devSettingsService = inject(DevSettingsService);
  messageService = inject(MessageService);
  router = inject(Router);

  editMode = false;
  activeTab: 'personal' | 'other' = 'personal';
  user: any;
  profileDisplayFields: CustomField[] = [];

  readonly deaconDegreeOptions = [
    'مش مرشوم',
    'ابصالتس',
    'اغنسطس',
    'ايبودياكون',
  ];

  readonly khorsOptions = [
    { value: 'ATHANASIUS', label: 'خورس البابا اثناسيوس' },
    { value: 'MARMARKOS', label: 'خورس مارمرقس' },
    { value: 'NONE', label: 'مش موجود في خورس' }
  ];

  readonly khorsYearOptions = [
    { value: 1, label: 'سنه اوله' },
    { value: 2, label: 'سنه تانيه' },
    { value: 3, label: 'سنه تالته' },
    { value: 4, label: 'سنه رابعه' },
    { value: 5, label: 'سنه خامسه' }
  ];

  profileForm = this.fb.group({
    fullName: [{ value: '', disabled: true }, Validators.required],
    email: [{ value: '', disabled: true }, [Validators.required, Validators.email]],
    phoneNumber: [{ value: '', disabled: true }],
    address: [{ value: '', disabled: true }],
    guardiansPhone: [{ value: '', disabled: true }],
    guardianRelation: [{ value: '', disabled: true }],
    deaconFamily: [{ value: '', disabled: true }],
    deaconDegree: [{ value: '', disabled: true }],
    khors: [{ value: 'NONE', disabled: true }],
    khorsYear: [{ value: null as number | null, disabled: true }],
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
    this.loadProfileDisplayFields();
    this.profileForm.get('status')?.valueChanges.subscribe(() => this.applyStatusRules());
    this.profileForm.get('studyType')?.valueChanges.subscribe(() => this.applyStudyTypeRules());
    this.profileForm.get('khors')?.valueChanges.subscribe(() => this.applyKhorsRules());

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
          status: this.normalizeStatus(user?.status),
          studyType: this.normalizeStudyType(user?.studyType),
          khors: this.normalizeKhors(user?.khors),
          khorsYear: user?.khorsYear ? Number(user.khorsYear) : null
        };

        this.user = normalizedUser;
        this.profileForm.patchValue(normalizedUser, { emitEvent: false });
        this.profileForm.get('isWorking')?.setValue(!!user?.workDetails, { emitEvent: false });
        this.profileForm.disable({ emitEvent: false });

        this.applyStatusRules();
        this.applyStudyTypeRules();
        this.applyKhorsRules();
      },
      error: () =>
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Failed to load profile.'
        })
    });
  }

  profileCustomEntries(): Array<{ label: string; value: string }> {
    return buildVisibleCustomFieldEntries(
      this.profileDisplayFields,
      this.user?.customFields as Record<string, unknown> | undefined,
      'PROFILE'
    );
  }

  isServantOrAbove(): boolean {
    return ['KHADIM', 'AMIN_OSRA', 'AMIN_KHEDMA', 'DEVELOPER'].includes(this.normalizeRole(this.user?.role));
  }

  isServant(): boolean {
    return ['KHADIM', 'AMIN_OSRA', 'AMIN_KHEDMA', 'DEVELOPER'].includes(this.normalizeRole(this.user?.role));
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

  showStatusField(): boolean {
    return !this.isGraduate();
  }

  canSelectSchoolOption(): boolean {
    if (!this.editMode) return true;
    return !this.isUniversity();
  }

  isMarmarkosKhors(): boolean {
    return String(this.profileForm.get('khors')?.value || '').toUpperCase() === 'MARMARKOS';
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

  private normalizeRole(v: any): string {
    return normalizeRole(v);
  }

  private normalizeStatus(v: any): string {
    const x = String(v || '').trim().toLowerCase();
    if (x === 'graduate' || x === 'خريج') return 'graduate';
    if (x === 'student' || x === 'طالب') return 'student';
    return x;
  }

  private normalizeStudyType(v: any): string {
    const x = String(v || '').trim().toLowerCase();
    if (x === 'school' || x === 'مدرسة') return 'school';
    if (x === 'university' || x === 'جامعة' || x === 'جامعه') return 'university';
    return x;
  }

  private normalizeKhors(v: any): string {
    const x = String(v || '').trim().toUpperCase();
    if (!x) return 'NONE';
    if (x === 'MARMARKOS' || x === 'ATHANASIUS' || x === 'NONE') return x;
    return 'NONE';
  }

  private applyStatusRules() {
    if (this.isGraduate()) {
      this.profileForm.get('studyType')?.disable({ emitEvent: false });
      this.profileForm.get('schoolName')?.disable({ emitEvent: false });
      this.profileForm.get('schoolGrade')?.disable({ emitEvent: false });
      this.profileForm.get('universityName')?.disable({ emitEvent: false });
      this.profileForm.get('faculty')?.disable({ emitEvent: false });
      this.profileForm.get('universityGrade')?.disable({ emitEvent: false });
      if (this.editMode) {
        this.profileForm.get('graduatedFrom')?.enable({ emitEvent: false });
        this.profileForm.get('graduateJob')?.enable({ emitEvent: false });
      } else {
        this.profileForm.get('graduatedFrom')?.disable({ emitEvent: false });
        this.profileForm.get('graduateJob')?.disable({ emitEvent: false });
      }
      return;
    }

    this.profileForm.get('graduatedFrom')?.disable({ emitEvent: false });
    this.profileForm.get('graduateJob')?.disable({ emitEvent: false });
    this.applyStudyTypeRules();
  }

  private applyStudyTypeRules() {
    if (this.isGraduate() || !this.editMode) return;

    this.profileForm.get('schoolName')?.disable({ emitEvent: false });
    this.profileForm.get('schoolGrade')?.disable({ emitEvent: false });
    this.profileForm.get('universityName')?.disable({ emitEvent: false });
    this.profileForm.get('faculty')?.disable({ emitEvent: false });
    this.profileForm.get('universityGrade')?.disable({ emitEvent: false });

    const type = this.profileForm.get('studyType')?.value;

    if (type === 'school') {
      this.profileForm.get('schoolName')?.enable({ emitEvent: false });
      this.profileForm.get('schoolGrade')?.disable({ emitEvent: false });
    }

    if (type === 'university') {
      this.profileForm.get('universityName')?.enable({ emitEvent: false });
      this.profileForm.get('faculty')?.enable({ emitEvent: false });
      this.profileForm.get('universityGrade')?.enable({ emitEvent: false });
    }
  }

  private applyKhorsRules() {
    const kh = this.normalizeKhors(this.profileForm.get('khors')?.value);

    if (kh === 'MARMARKOS') {
      this.profileForm.get('khorsYear')?.enable({ emitEvent: false });
      return;
    }

    this.profileForm.patchValue({ khorsYear: null }, { emitEvent: false });
    this.profileForm.get('khorsYear')?.disable({ emitEvent: false });
  }

  toggleEdit() {
    this.editMode = !this.editMode;

    if (!this.editMode) {
      this.profileForm.disable({ emitEvent: false });
      this.profileForm.patchValue(this.user, { emitEvent: false });
      this.applyStatusRules();
      this.applyStudyTypeRules();
      this.applyKhorsRules();
      return;
    }

    this.profileForm.disable({ emitEvent: false });

    this.profileForm.get('email')?.enable({ emitEvent: false });
    this.profileForm.get('phoneNumber')?.enable({ emitEvent: false });
    this.profileForm.get('address')?.enable({ emitEvent: false });
    this.profileForm.get('guardiansPhone')?.enable({ emitEvent: false });
    this.profileForm.get('guardianRelation')?.enable({ emitEvent: false });
    this.profileForm.get('workDetails')?.enable({ emitEvent: false });
    this.profileForm.get('schoolName')?.enable({ emitEvent: false });
    this.profileForm.get('schoolGrade')?.enable({ emitEvent: false });
    this.profileForm.get('universityName')?.enable({ emitEvent: false });
    this.profileForm.get('faculty')?.enable({ emitEvent: false });
    this.profileForm.get('universityGrade')?.enable({ emitEvent: false });
    this.profileForm.get('graduatedFrom')?.enable({ emitEvent: false });
    this.profileForm.get('graduateJob')?.enable({ emitEvent: false });

    this.applyStatusRules();
    this.applyStudyTypeRules();
    this.applyKhorsRules();
  }

  saveChanges() {
    const raw = this.profileForm.getRawValue();
    const payload: any = {
      fullName: raw.fullName,
      email: raw.email,
      phoneNumber: raw.phoneNumber,
      address: raw.address,
      guardiansPhone: raw.guardiansPhone,
      guardianRelation: raw.guardianRelation,
      schoolName: raw.schoolName,
      schoolGrade: raw.schoolGrade,
      universityName: raw.universityName,
      faculty: raw.faculty,
      universityGrade: raw.universityGrade,
      graduatedFrom: raw.graduatedFrom,
      graduateJob: raw.graduateJob,
      workDetails: raw.isWorking ? raw.workDetails : ''
    };

    this.authService.updateProfile(payload).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'حفظ',
          detail: 'تم تحديث الملف الشخصي بنجاح'
        });
        this.profileForm.disable({ emitEvent: false });
        this.editMode = false;
        this.user = { ...this.user, ...payload };
        this.profileForm.patchValue(this.user, { emitEvent: false });
        this.applyStatusRules();
        this.applyStudyTypeRules();
        this.applyKhorsRules();
      },
      error: (err) =>
        this.messageService.add({
          severity: 'error',
          summary: 'خطأ',
          detail: err.error?.error || 'تحديث فاشل'
        })
    });
  }

  async copyPhone(value: any) {
    const phone = String(value ?? '').trim();
    if (!phone) return;

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(phone);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = phone;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }

      this.messageService.add({ severity: 'success', summary: 'تم', detail: 'تم نسخ الرقم' });
    } catch {
      this.messageService.add({ severity: 'error', summary: 'خطأ', detail: 'فشل نسخ الرقم' });
    }
  }

  logout() {
    this.authService.logout().subscribe(() => {
      localStorage.clear();
      window.location.href = '/login';
    });
  }

  private loadProfileDisplayFields() {
    this.devSettingsService.getEnabledFields().subscribe({
      next: (fields) => {
        this.profileDisplayFields = fields || [];
      },
      error: () => {
        this.profileDisplayFields = [];
      }
    });
  }
}
