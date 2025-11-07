import { Component, OnInit, inject } from '@angular/core';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-dash-board',
  standalone: false,
  templateUrl: './dash-board.html',
  styleUrls: ['./dash-board.css']
})
export class DashBoard implements OnInit {

  private authService = inject(AuthService);

  // ✅ Hold all user info
  user: any = {
    fullName: '',
    username: '',
    phoneNumber: '',
    status: '',
    deaconFamily: '',
    universityName: '',
    faculty: '',
    dateOfBirth: ''
  };

  ngOnInit(): void {
    this.loadUserData();
  }

  // ✅ Fetch the full user object
  loadUserData(): void {
    this.authService.getUserData().subscribe({
      next: (data) => {
        this.user = data; // store all user info
      },
      error: (err) => {
        console.error('Failed to load user info:', err);
      }
    });
  }
}
