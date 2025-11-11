import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private http = inject(HttpClient);
  private baseUrl = 'http://localhost:8080/api/auth'; // ✅ Backend base URL

  // ✅ Login
  login(username: string, password: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/login`, { username, password }, { withCredentials: true });
  }

  // ✅ Register
  register(user: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/register`, user, { withCredentials: true });
  }

  // ✅ Get user profile
  getUserData(): Observable<any> {
    return this.http.get(`${this.baseUrl}/user`, { withCredentials: true }); // ✅ matches backend
  }

  // ✅ Logout
  logout(): Observable<any> {
    return this.http.post(`${this.baseUrl}/logout`, {}, { withCredentials: true });
  }

  // ✅ Forgot Password (Step 1)
  forgotPassword(phoneNumber: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/forgot-password`, { phoneNumber }, { withCredentials: true });
  }

  // ✅ Forgot Password (Step 2)
  forgotPasswordWithUsername(phoneNumber: string, username: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/forgot-password/select`, { phoneNumber, username }, { withCredentials: true });
  }

  // ✅ Reset Password
  resetPassword(token: string, newPassword: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/reset-password`, { token, newPassword }, { withCredentials: true });
  }

  // ✅ Update Profile
  updateProfile(profileData: any): Observable<any> {
    return this.http.put(`${this.baseUrl}/profile`, profileData, { withCredentials: true });
  }
}
