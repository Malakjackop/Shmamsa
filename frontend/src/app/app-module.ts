import { NgModule, provideBrowserGlobalErrorListeners } from '@angular/core';
import { BrowserModule, provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { ReactiveFormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { AppRoutingModule } from './app-routing-module';
import { CommonModule } from '@angular/common';
import { App } from './app';
import { LoginComponent } from './login/login';
import { RegisterComponent } from './register/register';

import { providePrimeNG } from 'primeng/config';
import Aura from '@primeuix/themes/aura';
import { ToastModule } from 'primeng/toast';
import { ButtonModule } from 'primeng/button';
import { MessageService } from 'primeng/api';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';


@NgModule({
  declarations: [
    App,
    LoginComponent,
    RegisterComponent
  ],
  imports: [
    BrowserModule,
    AppRoutingModule,
    HttpClientModule,
    ReactiveFormsModule,
    CommonModule,
    ToastModule,
    ButtonModule,
    BrowserAnimationsModule,

],
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideClientHydration(withEventReplay()),
    MessageService,
    providePrimeNG({
            theme: {
                preset: Aura
            }
        })
  ],
  bootstrap: [App]
})
export class AppModule { }
