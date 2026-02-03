import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { BehaviorSubject, tap } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private http = inject(HttpClient);
  private baseUrl = '/api/auth';
  private user$ = new BehaviorSubject<any>(null);


  login(username: string, password: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/login`, { username, password }, { withCredentials: true });
  }



registerServant(user: any, secret: string): Observable<any> {
  return this.http.post(`${this.baseUrl}/register-servant`, user, {
    withCredentials: true,
    headers: { 'X-REG-SECRET': secret }
  });
}

  register(user: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/register`, user, { withCredentials: true });
  }

getUserData() {
  if (this.user$.value) return this.user$.asObservable();
  return this.http.get(`${this.baseUrl}/user`, { withCredentials: true }).pipe(
    tap(u => this.user$.next(u))
  );
}

  logout(): Observable<any> {
    return this.http.post(`${this.baseUrl}/logout`, {}, { withCredentials: true });
  }

  // ✅ Forgot password by EMAIL (NEW)
  forgotPassword(email: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/forgot-password`, { email }, { withCredentials: true });
  }

  resetPassword(token: string, newPassword: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/reset-password`, { token, newPassword }, { withCredentials: true });
  }

  updateProfile(profileData: any): Observable<any> {
    return this.http.put(`${this.baseUrl}/profile`, profileData, { withCredentials: true });
  }
}
