import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { LoginComponent } from './login/login';
import { RegisterComponent } from './register/register';
import { RegisterServantComponent } from './register-servant/register-servant';
import { ForgotPasswordComponent } from './forgot-password/forgot-password';
import { ResourcesComponent } from './resources/resources';
import { AttendanceHistoryComponent } from './attendance-history/attendance-history';
import { DevSettingsComponent } from './dev-settings/dev-settings';

import { AuthGuard } from './guards/auth.guard';
import { RoleGuard } from './guards/role.guard';

import { LayoutComponent } from './layout/layout';

import { DashBoard } from './dash-board/dash-board';
import { ProfileComponent } from './profile/profile';
import { AttendanceComponent } from './attendance/attendance';
import { FamilyComponent } from './family/family';
import { FamilyAttendanceComponent } from './family-attendance/family-attendance';
import { FamilyInfoComponent } from './family-info/family-info';
import { TransferMembersComponent } from './transfer-members/transfer-members';
import { StartNewYearComponent } from './start-new-year/start-new-year';
import { GradesComponent } from './grades/grades';
import { IftekadComponent } from './iftekad/iftekad';
import { PendingApprovalComponent } from './pending-approval/pending-approval';
import { ChooseFamilyComponent } from './choose-family/choose-family';
const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },

  { path: 'login', component: LoginComponent },
  { path: 'register', component: RegisterComponent },
  { path: 'register-servant', component: RegisterServantComponent },
  { path: 'pending-approval', component: PendingApprovalComponent },
  { path: 'choose-family', component: ChooseFamilyComponent },
  { path: 'forgot-password', component: ForgotPasswordComponent },
  { path: 'reset-password', redirectTo: 'forgot-password', pathMatch: 'full' },

  {
    path: '',
    component: LayoutComponent,
    canActivate: [AuthGuard],
    children: [
      { path: 'dashboard', component: DashBoard },
      { path: 'profile', component: ProfileComponent },
      { path: 'resources', component: ResourcesComponent },
      { path: 'attendance-history', component: AttendanceHistoryComponent },

      { path: 'grades', component: GradesComponent },

      {
        path: 'attendance',
        component: AttendanceComponent,
        canActivate: [RoleGuard],
        data: { roles: ['KHADIM','AMIN_OSRA','AMIN_KHEDMA','DEVELOPER'] }
      },
      {
        path: 'family',
        redirectTo: 'family-attendance',
        pathMatch: 'full'
      },
      {
        path: 'family-attendance',
        component: FamilyAttendanceComponent,
        canActivate: [RoleGuard],
        data: { roles: ['KHADIM','AMIN_OSRA','AMIN_KHEDMA','DEVELOPER'] }
      },
      {
        path: 'family-info',
        component: FamilyInfoComponent,
        canActivate: [RoleGuard],
        data: { roles: ['KHADIM','AMIN_OSRA','AMIN_KHEDMA','DEVELOPER'] }
      },
      {
        path: 'transfer-members',
        component: TransferMembersComponent,
        canActivate: [RoleGuard],
        data: { roles: ['AMIN_OSRA','AMIN_KHEDMA','DEVELOPER'] }
      },
      {
        path: 'start-new-year',
        component: StartNewYearComponent,
        canActivate: [RoleGuard],
        data: { roles: ['AMIN_KHEDMA','DEVELOPER'] }
      },
      {
        path: 'dev-settings',
        component: DevSettingsComponent,
        canActivate: [RoleGuard],
        data: { roles: ['DEVELOPER'] }
      },
      {
        path: 'iftekad',
        component: IftekadComponent,
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
