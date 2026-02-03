import { NgModule } from '@angular/core';
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
import { ResetPasswordComponent } from './reset-password/reset-password';
import { ProfileComponent } from './profile/profile';
import { RegisterServantComponent } from './register-servant/register-servant';
import { AboutComponent } from './about/about';
import { FamilyComponent } from './family/family';
import { AttendanceComponent } from './attendance/attendance';

import { providePrimeNG } from 'primeng/config';
import Aura from '@primeuix/themes/aura';
import { MessageService } from 'primeng/api';

// ✅ PrimeNG Component Modules
import { ToastModule } from 'primeng/toast';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { PanelModule } from 'primeng/panel';
import { AvatarModule } from 'primeng/avatar';
import { InputTextModule } from 'primeng/inputtext';
import { InputIconModule } from 'primeng/inputicon';

@NgModule({
  declarations: [
    App,
    LoginComponent,
    DashBoard,
    ForgotPasswordComponent,
    ResetPasswordComponent,
    ProfileComponent,
    AboutComponent,
    FamilyComponent,
    AttendanceComponent
  ],
  imports: [
    BrowserModule,
    RegisterComponent,
    RegisterServantComponent,
    AppRoutingModule,
    HttpClientModule,
    ReactiveFormsModule,
    FormsModule,
    CommonModule,
    BrowserAnimationsModule,
    RouterModule, // ✅ Fixes "router-outlet is not a known element"
    QRCodeComponent,
    ZXingScannerModule,
    // ✅ PrimeNG imports
    ToastModule,
    ButtonModule,
    CardModule,
    PanelModule,
    AvatarModule,
    InputTextModule,
    InputIconModule
  ],
  providers: [
    MessageService,
    providePrimeNG({
      theme: {
        preset: Aura
      }
    })
  ],
  bootstrap: [App]
})
export class AppModule {}
