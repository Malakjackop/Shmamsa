import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private http = inject(HttpClient);
  private baseUrl = 'http://localhost:8080/api/auth';

  // ✅ Login method
  login(username: string, password: string): Observable<{ token: string }> {
    return this.http.post<{ token: string }>(`${this.baseUrl}/login`, {
      username,
      password
    });
  }

  // ✅ Register method
  register(user: {
    username: string;
    password: string;
    phoneNumber: string;
    nationalId: string;
    dateOfBirth: string;
    motherPhone: string;
    fatherPhone: string;
    motherJob: string;
    fatherJob: string;
  }): Observable<any> {
    return this.http.post(`${this.baseUrl}/register`, user);
  }
}
