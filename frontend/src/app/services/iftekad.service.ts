import { Injectable, inject, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of } from 'rxjs';

export type IftekadVisitRecord = {
  id: number;
  memberId: number;
  visitDate: string;
  description?: string | null;
  companions?: string | null;
  createdAt?: string;
  recordedBy?: { id: number; fullName: string; role: string } | null;
};

export type IftekadSettings = {
  greenMaxMonths: number;
  yellowMaxMonths: number;
  cardFields: string[];
};

export const DEFAULT_IFTEKAD_SETTINGS: IftekadSettings = {
  greenMaxMonths: 3,
  yellowMaxMonths: 6,
  cardFields: ['schoolGrade', 'birthDate', 'lastVisit', 'family']
};

export type IftekadDeleteResponse = Record<string, unknown> | null;

/**
 * Iftekad (visits) API wrapper.
 * Backend endpoints are under /api/iftekad/**
 */
@Injectable({ providedIn: 'root' })
export class IftekadService {
  private http = inject(HttpClient);
  private readonly baseUrl = '/api/iftekad';
  private isBrowser: boolean;

  constructor(@Inject(PLATFORM_ID) platformId: Object) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  /** Returns a map of memberId -> last visit date (yyyy-MM-dd) */
  lastVisitDates(memberIds: number[]): Observable<Record<string, string | null>> {
    if (!this.isBrowser || !memberIds?.length) return of({});
    const params = new HttpParams().set('memberIds', memberIds.join(','));
    return this.http.get<Record<string, string | null>>(`${this.baseUrl}/last`, {
      params,
      withCredentials: true
    });
  }

  /** Returns full visit history for a member */
  getVisits(memberId: number): Observable<IftekadVisitRecord[]> {
    if (!this.isBrowser) return of([]);
    return this.http.get<IftekadVisitRecord[]>(`${this.baseUrl}/visits?memberId=${memberId}`, {
      withCredentials: true
    });
  }

  /** Create a new visit entry */
  createVisit(payload: { memberId: number; date: string; description?: string; companions?: string }): Observable<IftekadVisitRecord> {
    return this.http.post<IftekadVisitRecord>(`${this.baseUrl}/visits`, payload, { withCredentials: true });
  }

  /** Update an existing visit entry */
  updateVisit(visitId: number, payload: { date: string; description?: string; companions?: string }): Observable<IftekadVisitRecord> {
    return this.http.put<IftekadVisitRecord>(`${this.baseUrl}/visits/${visitId}`, payload, { withCredentials: true });
  }

  /** Delete a visit entry */
  deleteVisit(visitId: number): Observable<IftekadDeleteResponse> {
    return this.http.delete<IftekadDeleteResponse>(`${this.baseUrl}/visits/${visitId}`, { withCredentials: true });
  }

  getSettings(): Observable<IftekadSettings> {
    if (!this.isBrowser) return of(DEFAULT_IFTEKAD_SETTINGS);
    return this.http.get<IftekadSettings>(`${this.baseUrl}/settings`, { withCredentials: true });
  }

  updateSettings(settings: IftekadSettings): Observable<IftekadSettings> {
    return this.http.put<IftekadSettings>(`${this.baseUrl}/settings`, settings, { withCredentials: true });
  }
}
