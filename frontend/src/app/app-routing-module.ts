import { NgModule } from '@angular/core';
import { LoginComponent } from './login/login';
import { RouterModule, Routes } from '@angular/router';
import { RegisterComponent } from './register/register';
const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' }, // default route
  { path: 'login', component: LoginComponent },
  { path: 'register', component: RegisterComponent },
  // { path: 'dashboard', component: DashboardComponent }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule {}
