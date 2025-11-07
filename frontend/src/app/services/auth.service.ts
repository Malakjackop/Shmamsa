import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private http = inject(HttpClient);
  private baseUrl = 'http://localhost:8080/api/auth';

  // ✅ Login (cookie-based JWT)
  login(username: string, password: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/login`, { username, password }, { withCredentials: true })
      .pipe(catchError((error: HttpErrorResponse) => throwError(() => error)));
  }

  // ✅ Register (optional)
  register(user: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/register`, user, { withCredentials: true })
      .pipe(catchError((error: HttpErrorResponse) => throwError(() => error)));
  }

  // ✅ Profile (automatically includes JWT cookie)
getUserData(): Observable<any> {
  return this.http.get(`${this.baseUrl}/user`, { withCredentials: true });
}

}
