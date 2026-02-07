import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject, tap, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

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

  return this.http.get<any>(`${this.baseUrl}/user`, { withCredentials: true }).pipe(
    map((res) => {
      // backend may return { authenticated: false } when not logged in
      if (res && res.authenticated === false) return null;
      return res;
    }),
    tap((u) => this.user$.next(u)),
    catchError(() => {
      this.user$.next(null);
      return of(null);
    })
  );

}

  // ✅ Get signed QR token for the logged-in user
  getMyQrToken(): Observable<{ token: string }> {
    return this.http.get<{ token: string }>(`/api/qr/me/token`, { withCredentials: true });
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
    return this.http.put(`${this.baseUrl}/profile`, profileData, { withCredentials: true }).pipe(
      tap((u) => this.user$.next(u))
    );
  }
}
