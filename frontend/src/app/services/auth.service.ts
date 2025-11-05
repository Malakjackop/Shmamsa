import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private http = inject(HttpClient);
  private baseUrl = 'http://localhost:8080/api/auth';

  // ✅ Login
  login(username: string, password: string): Observable<{ token: string }> {
    return this.http.post<{ token: string }>(`${this.baseUrl}/login`, {
      username,
      password
    });
  }

  // ✅ Register (updated to match new backend User.java)
  register(user: {
    fullName?: string;
    username: string;
    password: string;
    nationalId: string;
    phoneNumber: string;
    guardiansPhone?: string;
    guardianRelation?: string;
    dateOfBirth: string;
    status: string;
    studyType?: string;
    schoolName?: string;
    schoolGrade?: string;
    universityName?: string;
    faculty?: string;
    universityGrade?: string;
    graduatedFrom?: string;
    graduateJob?: string;
    isWorking?: boolean;
    workDetails?: string;
    deaconFamily: string;
  }): Observable<any> {
    const headers = new HttpHeaders({ 'Content-Type': 'application/json' });

    return this.http
      .post(`${this.baseUrl}/register`, user, { headers })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          console.error('❌ Registration error:', error);
          return throwError(() => error);
        })
      );
  }
}
