import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { LoginComponent } from './login/login';
import { RegisterComponent } from './register/register';
import { RegisterServantComponent } from './register-servant/register-servant';
import { ForgotPasswordComponent } from './forgot-password/forgot-password';
import { ResetPasswordComponent } from './reset-password/reset-password';
import { ResourcesComponent } from './resources/resources';

import { AuthGuard } from './guards/auth.guard';
import { RoleGuard } from './guards/role.guard';

import { LayoutComponent } from './layout/layout';   

import { DashBoard } from './dash-board/dash-board';
import { ProfileComponent } from './profile/profile';
import { AboutComponent } from './about/about';
import { AttendanceComponent } from './attendance/attendance';
import { FamilyComponent } from './family/family';

const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },

  { path: 'login', component: LoginComponent },
  { path: 'register', component: RegisterComponent },
  { path: 'register-servant', component: RegisterServantComponent },
  { path: 'forgot-password', component: ForgotPasswordComponent },
  { path: 'reset-password', component: ResetPasswordComponent },

  {
    path: '',
    component: LayoutComponent,
    canActivate: [AuthGuard],
    children: [
      { path: 'dashboard', component: DashBoard },
      { path: 'profile', component: ProfileComponent },
      { path: 'about', component: AboutComponent },
      { path: 'resources', component: ResourcesComponent },

      {
        path: 'attendance',
        component: AttendanceComponent,
        canActivate: [RoleGuard],
        data: { roles: ['KHADIM','AMIN_OSRA','AMIN_KHEDMA','DEVELOPER'] }
      },
      {
        path: 'family',
        component: FamilyComponent,
        canActivate: [RoleGuard],
        data: { roles: ['KHADIM','AMIN_OSRA','AMIN_KHEDMA','DEVELOPER'] }
      }
    ]
  },

  { path: '**', redirectTo: 'login' }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule {}
