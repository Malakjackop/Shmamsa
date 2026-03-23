import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export type IftekadVisitRecord = {
  id: number;
  memberId: number;
  visitDate: string;
  description?: string | null;
  companions?: string | null;
  createdAt?: string;
  recordedBy?: { id: number; fullName: string; role: string } | null;
};

export type IftekadDeleteResponse = Record<string, unknown> | null;

/**
 * Iftekad (visits) API wrapper.
 * Backend endpoints are expected under /api/iftekad/**
 */
@Injectable({ providedIn: 'root' })
export class IftekadService {
  private http = inject(HttpClient);

  /** Returns a map of memberId -> last visit date (yyyy-MM-dd) */
  lastVisitDates(memberIds: number[]) {
    return this.http.post<Record<string, string | null>>('/api/iftekad/last', {
      ids: memberIds
    });
  }

  /** Returns full visit history for a member */
  getVisits(memberId: number): Observable<IftekadVisitRecord[]> {
    return this.http.get<IftekadVisitRecord[]>(`/api/iftekad/visits?memberId=${memberId}`);
  }

  /** Create a new visit entry */
  createVisit(payload: { memberId: number; date: string; description?: string; companions?: string }): Observable<IftekadVisitRecord> {
    return this.http.post<IftekadVisitRecord>('/api/iftekad/visits', payload);
  }

  /** Update an existing visit entry */
  updateVisit(visitId: number, payload: { date: string; description?: string; companions?: string }): Observable<IftekadVisitRecord> {
    return this.http.put<IftekadVisitRecord>(`/api/iftekad/visits/${visitId}`, payload);
  }

  /** Delete a visit entry */
  deleteVisit(visitId: number): Observable<IftekadDeleteResponse> {
    return this.http.delete<IftekadDeleteResponse>(`/api/iftekad/visits/${visitId}`);
  }
}
