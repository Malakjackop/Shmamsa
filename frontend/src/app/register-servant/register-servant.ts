import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RegisterComponent } from '../register/register';

@Component({
  selector: 'app-register-servant',
  templateUrl: './register-servant.html',
    standalone: true,
  imports: [CommonModule, RegisterComponent]
})
export class RegisterServantComponent {}
