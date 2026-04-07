import { Injectable, inject, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject, of, switchMap } from 'rxjs';
import { map, tap, catchError } from 'rxjs/operators';

export type AuthUser = {
  authenticated?: boolean;
  username?: string;
  role?: string | number;
  roleCode?: number;
  status?: string | null;
  studyType?: string | null;
  servingScope?: string | null;
  khors?: string | null;
  khorsYear?: number | string | null;
  workDetails?: string | null;
  familyAssignments?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

export type AuthPayload = Record<string, unknown>;

export type FamilyOption = {
  id?: number;
  code?: string;
  nameAr: string;
  baseName?: string;
  branch?: string | null;
  category?: string;
};

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private http = inject(HttpClient);
  private baseUrl = '/api/auth';
  private user$ = new BehaviorSubject<AuthUser | null>(null);
  private isBrowser: boolean;

  constructor(@Inject(PLATFORM_ID) platformId: Object) {
    this.isBrowser = isPlatformBrowser(platformId);
  }


  refreshUser(): Observable<AuthUser | null> {
    if (!this.isBrowser) {
      this.user$.next(null);
      return of(null);
    }

    return this.http.get<AuthUser>(`${this.baseUrl}/user`, { withCredentials: true }).pipe(
      map((res) => (res && res.authenticated === false ? null : res)),
      tap((u) => this.user$.next(u)),
      catchError(() => {
        this.user$.next(null);
        return of(null);
      })
    );
  }

  login(username: string, password: string): Observable<AuthUser | null> {
    return this.http
      .post(`${this.baseUrl}/login`, { username, password }, { withCredentials: true })
      .pipe(switchMap(() => this.refreshUser()));
  }
  registerServant(user: AuthPayload, secret: string): Observable<unknown> {
    return this.http.post(`${this.baseUrl}/register-servant`, user, {
      withCredentials: true,
      headers: { 'X-REG-SECRET': secret }
    });
  }

  register(user: AuthPayload): Observable<unknown> {
    return this.http.post(`${this.baseUrl}/register`, user, { withCredentials: true });
  }

  getUserData(force = false): Observable<AuthUser | null> {
    if (!force && this.user$.value !== null) {
      return this.user$.asObservable();
    }
    return this.refreshUser();
  }

  getMyQrToken(): Observable<{ token: string }> {
    if (!this.isBrowser) {
      return of({ token: '' });
    }
    return this.http.get<{ token: string }>(`/api/qr/me/token`, { withCredentials: true });
  }

  logout(): Observable<unknown> {
    return this.http.post(`${this.baseUrl}/logout`, {}, { withCredentials: true }).pipe(
      tap(() => this.user$.next(null))
    );
  }

  forgotPassword(email: string): Observable<unknown> {
    return this.http.post(`${this.baseUrl}/forgot-password`, { email }, { withCredentials: true });
  }

  resetPassword(token: string, newPassword: string): Observable<unknown> {
    return this.http.post(`${this.baseUrl}/reset-password`, { token, newPassword }, { withCredentials: true });
  }

  updateProfile(profileData: AuthPayload): Observable<AuthUser> {
    return this.http.put<AuthUser>(`${this.baseUrl}/profile`, profileData, { withCredentials: true }).pipe(
      tap((u) => this.user$.next(u))
    );
  }

  getFamilyOptions(audience: 'SERVANT' | 'MEMBER'): Observable<FamilyOption[]> {
    if (!this.isBrowser) return of([]);
    return this.http.get<FamilyOption[]>(`${this.baseUrl}/family-options?audience=${audience}`, { withCredentials: true }).pipe(
      map((res) => (Array.isArray(res) ? res : [])),
      catchError(() => of([]))
    );
  }
}
