import { NgModule ,  LOCALE_ID } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { RouterModule } from '@angular/router'; // ✅ Needed for <router-outlet>
import { QRCodeComponent } from 'angularx-qrcode';
import { ZXingScannerModule } from '@zxing/ngx-scanner';

import { AppRoutingModule } from './app-routing-module';
import { App } from './app';
import { LoginComponent } from './login/login';
import { RegisterComponent } from './register/register';
import { DashBoard } from './dash-board/dash-board';
import { ForgotPasswordComponent } from './forgot-password/forgot-password';
import { ProfileComponent } from './profile/profile';
import { RegisterServantComponent } from './register-servant/register-servant';
import { AboutComponent } from './about/about';
import { FamilyComponent } from './family/family';
import { FamilyAttendanceComponent } from './family-attendance/family-attendance';
import { FamilyInfoComponent } from './family-info/family-info';
import { AttendanceComponent } from './attendance/attendance';
import { ResourcesComponent } from './resources/resources';
import { AttendanceHistoryComponent } from './attendance-history/attendance-history';
import { TransferMembersComponent } from './transfer-members/transfer-members';
import { StartNewYearComponent } from './start-new-year/start-new-year';
import { GradesComponent } from './grades/grades';
import { DevSettingsComponent } from './dev-settings/dev-settings';

import { providePrimeNG } from 'primeng/config';
import Aura from '@primeuix/themes/aura';
import { MessageService } from 'primeng/api';
import { RoleLabelPipe } from './pipes/role-label.pipe';

// ✅ PrimeNG Component Modules
import { ToastModule } from 'primeng/toast';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { PanelModule } from 'primeng/panel';
import { AvatarModule } from 'primeng/avatar';
import { InputTextModule } from 'primeng/inputtext';
import { InputIconModule } from 'primeng/inputicon';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
// ✅ PrimeNG v19+ renamed Calendar -> DatePicker (new import path)
import { DatePickerModule } from 'primeng/datepicker';

import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';
import { TagModule } from 'primeng/tag';
import { TableModule } from 'primeng/table';


@NgModule({
  declarations: [
    App,
    LoginComponent,
    DashBoard,
    ForgotPasswordComponent,
    ProfileComponent,
    AboutComponent,
    FamilyComponent,
    FamilyAttendanceComponent,
    FamilyInfoComponent,
    TransferMembersComponent,
    AttendanceComponent,
    ResourcesComponent,
    StartNewYearComponent,
    GradesComponent,

  ],
  imports: [
    BrowserModule,
    RoleLabelPipe,
    RegisterComponent,
    RegisterServantComponent,
    AttendanceHistoryComponent,
    DevSettingsComponent,
    AppRoutingModule,
    HttpClientModule,
    ReactiveFormsModule,
    FormsModule,
    CommonModule,
    BrowserAnimationsModule,
    RouterModule,
    QRCodeComponent,
    ZXingScannerModule,
    // ✅ PrimeNG imports
    ToastModule,
    ButtonModule,
    CardModule,
    PanelModule,
    AvatarModule,
    InputTextModule,
    InputIconModule,
    ConfirmDialogModule,
    DatePickerModule,
    DialogModule,
    SelectModule,
    TextareaModule,
    TagModule,
    TableModule
  ],
  providers: [
    { provide: LOCALE_ID, useValue: 'ar-EG' },
    MessageService,
    providePrimeNG({
      theme: {
        preset: Aura
      },
      translation: {
        dayNames: ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'],
        dayNamesShort: ['أحد','اثنين','ثلاثاء','أربعاء','خميس','جمعة','سبت'],
        dayNamesMin: ['أحد','اثنين','ثلاثاء','أربعاء','خميس','جمعة','سبت'],
        monthNames: ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'],
        monthNamesShort: ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'],
        today: 'الآن',
        clear: 'امسح'
      }
    })
  ],
  bootstrap: [App]
})
export class AppModule {}








