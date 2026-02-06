import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Router, RouterModule } from '@angular/router';
import { MessageService } from 'primeng/api';

import { ToastModule } from 'primeng/toast';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputIconModule } from 'primeng/inputicon';

@Component({
  selector: 'app-register',
  templateUrl: './register.html',
  styleUrls: ['./register.css'],
    standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ReactiveFormsModule,
    ToastModule,
    ButtonModule,
    InputTextModule,
    InputIconModule
  ],
  providers: [MessageService]
})
export class RegisterComponent {
  @Input() isServant: boolean = false;

  registerForm!: FormGroup;

  showPassword = false;
  showConfirmPassword = false;

  constructor(
    private fb: FormBuilder,
    private http: HttpClient,
    private router: Router,
    private messageService: MessageService
  ) {
    this.buildForm();
  }

private buildForm() {
  this.registerForm = this.fb.group({
    fullName: ['', Validators.required],
    username: ['', Validators.required],
    phoneNumber: [''],
    nationalId: ['', [Validators.required, Validators.pattern(/^\d{14}$/)]],
    email: ['', [Validators.required, Validators.email]],
    dateOfBirth: [{ value: '', disabled: true }],

    // New gender ya lukaaa
    gender: [{ value: '', disabled: true }],

    deaconFamily: ['', Validators.required],
    deaconDegree: ['', Validators.required],

    status: [''],
    graduatedFrom: [''],
    graduateJob: [''],

    studyType: [''],
    schoolName: [''],
    schoolGrade: [''],
    universityName: [''],
    faculty: [''],
    universityGrade: [''],

    isWorking: [''],
    workDetails: [''],

    guardiansPhone: [''],
    guardianRelation: [''],

    password: ['', Validators.required],
    confirmPassword: ['', Validators.required],

    secret: ['']
  });

  if (this.isServant) {
    this.registerForm.get('secret')?.setValidators([Validators.required]);
  }
  this.registerForm.get('secret')?.updateValueAndValidity();
}

  togglePassword() {
    this.showPassword = !this.showPassword;
  }

  toggleConfirmPassword() {
    this.showConfirmPassword = !this.showConfirmPassword;
  }
  onSubmit() {
    this.submit();
}

  onNationalIdBlur() {

    const nationalIdControl = this.registerForm.get('nationalId');
    const dobControl = this.registerForm.get('dateOfBirth');
    const genderControl = this.registerForm.get('gender');

    const nid = String(nationalIdControl?.value || '').trim();

    // repeated digits
    if (/^(\d)\1{13}$/.test(nid)) {
      this.showError('Fake National ID', 'Repeated digits are not allowed');
      nationalIdControl?.setErrors({ fake: true });
      return;
    }

    // must be 14 digits
    if (!/^\d{14}$/.test(nid)) {
      this.showError('Invalid National ID', 'Must be exactly 14 digits');
      nationalIdControl?.setErrors({ invalid: true });
      return;
    }

    const centuryCode = nid[0];

    const yearBase =
      centuryCode === '2' ? 1900 :
        centuryCode === '3' ? 2000 : null;

    if (!yearBase) {
      this.showInvalidId();
      return;
    }

    const year = yearBase + Number(nid.substring(1, 3));
    const month = Number(nid.substring(3, 5));
    const day = Number(nid.substring(5, 7));

    const birthDate = new Date(year, month - 1, day);

    // fake birthDate
    if (
      birthDate.getFullYear() !== year ||
      birthDate.getMonth() !== month - 1 ||
      birthDate.getDate() !== day
    ) {
      this.showInvalidId();
      return;
    }

    // Age check
    const age = this.calculateAge(birthDate);

    if (this.isServant && age < 16) {
      this.showError('Age Error', 'Servant must be at least 16 years old');
      nationalIdControl?.setErrors({ underAge: true });
      return;
    }

    if (!this.isServant && age < 6) {
      this.showError('Age Error', 'Age must be at least 6 years');
      nationalIdControl?.setErrors({ underAge: true });
      return;
    }


    // Gender

    const genderDigit = Number(nid[12]);

    const gender = genderDigit % 2 === 0 ? 'Female' : 'Male';

    const formattedDate = this.formatDate(birthDate);


    dobControl?.enable();
    dobControl?.setValue(formattedDate);
    dobControl?.disable();

    genderControl?.enable();
    genderControl?.setValue(gender);
    genderControl?.disable();

    nationalIdControl?.setErrors(null);
  }

  //------------------------------------
  private calculateAge(birthDate: Date): number {

    const today = new Date();

    let age = today.getFullYear() - birthDate.getFullYear();

    const m = today.getMonth() - birthDate.getMonth();

    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }

    return age;
  }

  private formatDate(date: Date): string {

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  //------------------------------------
  private showInvalidId() {

    this.showError('Fake National ID', 'Invalid birth date inside National ID');
  }

  //------------------------------------
  private showError(summary: string, detail: string) {

    this.messageService.add({
      severity: 'error',
      summary,
      detail,
      life: 4000
    });
  }

  //------------------------------------
  submit() {

    if (this.registerForm.get('nationalId')?.errors) {

      this.showError('Error', 'Please enter a valid National ID');
      return;
    }

    if (this.registerForm.invalid) {
      this.showError('Error', 'Please fill all required fields.');
      return;
    }

    const formValue = this.registerForm.getRawValue();

    if (formValue.password !== formValue.confirmPassword) {
      this.showError('Error', 'Passwords do not match.');
      return;
    }

    const payload = { ...formValue };


    const request = this.isServant
      ? this.http.post(
        'http://localhost:8080/api/auth/register-servant',
        payload,
        {
          headers: new HttpHeaders({
            'X-REG-SECRET': String(formValue.secret || '').trim()
          })
        }
      )
      : this.http.post('http://localhost:8080/api/auth/register', payload);

    request.subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Success',
          detail: 'Registered successfully.'
        });

        this.router.navigate(['/login']);
      },
      error: (err) => {
        const msg = err?.error?.error || err?.error?.message || 'Registration failed.';
        this.showError('Error', msg);
      }
    });
  }
}
