import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { AuthService } from '../services/auth.service';
import { MessageService } from 'primeng/api';
import { Router } from '@angular/router';
import { normalizeRole } from '../shared/role-utils';
import { DevSettingsService, CustomField } from '../services/dev-settings.service';
import { customFieldHasTarget, effectiveProfileEditable, effectiveShowInTargets, getSystemFieldDefaultProfileEditable } from '../shared/custom-field-display';

type ProfileCustomEntry = {
  fieldKey: string;
  label: string;
  value: string;
  fieldType: 'TEXT' | 'SELECT' | 'DATE';
  editable: boolean;
  options: string[];
};

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
  profileDisplayFieldsLoaded = false;
  profileCustomFieldValues: Record<string, string> = {};

  private readonly editableProfileControlNames = [
    'email',
    'phoneNumber',
    'address',
    'guardiansPhone',
    'guardianRelation',
    'deaconDegree',
    'status',
    'studyType',
    'schoolName',
    'schoolGrade',
    'universityName',
    'faculty',
    'universityGrade',
    'graduatedFrom',
    'graduateJob',
    'workDetails'
  ];

  readonly deaconDegreeOptions = [
    'مش مرشوم',
    'ابصالتس',
    'اغنسطس',
    'ايبودياكون',
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

        this.applyUserData(user);
      },
      error: () =>
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Failed to load profile.'
        })
    });
  }

  profileCustomEntries(): ProfileCustomEntry[] {
    return (this.profileDisplayFields || [])
      .filter(field => !field.isSystem)
      .filter(field => customFieldHasTarget(field, 'PROFILE'))
      .map(field => {
        const fieldKey = String(field.fieldKey || '').trim();
        const value = String(this.profileCustomFieldValues[fieldKey] ?? '').trim();
        const editable = effectiveProfileEditable(field);
        return {
          fieldKey,
          label: field.labelAr,
          value,
          fieldType: field.fieldType,
          editable,
          options: this.parseCustomFieldOptions(field.options)
        };
      })
      .filter(entry => this.editMode || entry.value !== '');
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
        this.enableProfileControlIfEditable('graduatedFrom');
        this.enableProfileControlIfEditable('graduateJob');
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
      this.enableProfileControlIfEditable('schoolName');
      this.enableProfileControlIfEditable('schoolGrade');
    }

    if (type === 'university') {
      this.enableProfileControlIfEditable('universityName');
      this.enableProfileControlIfEditable('faculty');
      this.enableProfileControlIfEditable('universityGrade');
    }
  }

  private applyKhorsRules() {
    const kh = this.normalizeKhors(this.profileForm.get('khors')?.value);

    if (kh === 'MARMARKOS') {
      this.enableProfileControlIfEditable('khorsYear');
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
      this.syncProfileCustomFieldValues();
      this.applyStatusRules();
      this.applyStudyTypeRules();
      this.applyKhorsRules();
      return;
    }

    this.profileForm.disable({ emitEvent: false });
    this.editableProfileControlNames.forEach(controlName => this.enableProfileControlIfEditable(controlName));

    this.applyStatusRules();
    this.applyStudyTypeRules();
    this.applyKhorsRules();
  }

  saveChanges() {
    const raw = this.profileForm.getRawValue();
    const payload: any = {
      email: raw.email,
      phoneNumber: raw.phoneNumber,
      address: raw.address,
      guardiansPhone: raw.guardiansPhone,
      guardianRelation: raw.guardianRelation,
      deaconDegree: raw.deaconDegree,
      status: raw.status,
      studyType: raw.studyType,
      schoolName: raw.schoolName,
      schoolGrade: raw.schoolGrade,
      universityName: raw.universityName,
      faculty: raw.faculty,
      universityGrade: raw.universityGrade,
      graduatedFrom: raw.graduatedFrom,
      graduateJob: raw.graduateJob,
      workDetails: raw.workDetails,
      customFields: this.collectEditableCustomFieldPayload()
    };

    this.authService.updateProfile(payload).subscribe({
      next: (user) => {
        this.messageService.add({
          severity: 'success',
          summary: 'حفظ',
          detail: 'تم تحديث الملف الشخصي بنجاح'
        });
        this.profileForm.disable({ emitEvent: false });
        this.editMode = false;
        this.applyUserData(user);
      },
      error: (err) =>
        this.messageService.add({
          severity: 'error',
          summary: 'خطأ',
          detail: err.error?.error || 'تحديث فاشل'
        })
    });
  }

  private loadProfileDisplayFields() {
    this.devSettingsService.getEnabledFields().subscribe({
      next: (fields) => {
        this.profileDisplayFields = fields || [];
        this.profileDisplayFieldsLoaded = true;
        this.syncProfileCustomFieldValues();
      },
      error: () => {
        this.profileDisplayFields = [];
        this.profileDisplayFieldsLoaded = true;
        this.syncProfileCustomFieldValues();
      }
    });
  }

  showProfileField(fieldKey: string): boolean {
    const normalizedFieldKey = String(fieldKey || '').trim();
    if (!normalizedFieldKey) {
      return false;
    }

    const configuredField = this.profileDisplayFields.find(field => field.fieldKey === normalizedFieldKey);
    if (configuredField) {
      return customFieldHasTarget(configuredField, 'PROFILE');
    }

    if (this.profileDisplayFieldsLoaded) {
      return false;
    }

    return effectiveShowInTargets({
      fieldKey: normalizedFieldKey,
      isSystem: true,
      showIn: ''
    }).includes('PROFILE');
  }

  isProfileFieldEditable(fieldKey: string): boolean {
    const normalizedFieldKey = String(fieldKey || '').trim();
    if (!normalizedFieldKey) {
      return false;
    }

    const configuredField = this.profileDisplayFields.find(field => field.fieldKey === normalizedFieldKey);
    if (configuredField) {
      return customFieldHasTarget(configuredField, 'PROFILE') && effectiveProfileEditable(configuredField);
    }

    if (this.profileDisplayFieldsLoaded) {
      return false;
    }

    return effectiveShowInTargets({
      fieldKey: normalizedFieldKey,
      isSystem: true,
      showIn: ''
    }).includes('PROFILE') && getSystemFieldDefaultProfileEditable(normalizedFieldKey);
  }

  customFieldOptionLabel(value: string): string {
    return String(value || '').trim();
  }

  private applyUserData(user: any): void {
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
    this.syncProfileCustomFieldValues();
    this.applyStatusRules();
    this.applyStudyTypeRules();
    this.applyKhorsRules();
  }

  private enableProfileControlIfEditable(controlName: string): void {
    if (!this.editMode || !this.isProfileFieldEditable(controlName)) {
      return;
    }

    this.profileForm.get(controlName)?.enable({ emitEvent: false });
  }

  private syncProfileCustomFieldValues(): void {
    const nextValues: Record<string, string> = {};
    const userValues = (this.user?.customFields || {}) as Record<string, unknown>;

    for (const field of this.profileDisplayFields || []) {
      if (field.isSystem || !customFieldHasTarget(field, 'PROFILE')) {
        continue;
      }
      nextValues[field.fieldKey] = String(userValues[field.fieldKey] ?? '');
    }

    this.profileCustomFieldValues = nextValues;
  }

  private collectEditableCustomFieldPayload(): Record<string, string> {
    const payload: Record<string, string> = {};

    for (const field of this.profileDisplayFields || []) {
      if (field.isSystem || !customFieldHasTarget(field, 'PROFILE') || !effectiveProfileEditable(field)) {
        continue;
      }

      payload[field.fieldKey] = String(this.profileCustomFieldValues[field.fieldKey] ?? '').trim();
    }

    return payload;
  }

  private parseCustomFieldOptions(options?: string | null): string[] {
    return String(options || '')
      .split(',')
      .map(option => option.trim())
      .filter(Boolean);
  }
}
