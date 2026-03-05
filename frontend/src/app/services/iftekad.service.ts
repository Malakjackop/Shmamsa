import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';

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
  getVisits(memberId: number) {
    return this.http.get<any[]>(`/api/iftekad/visits?memberId=${memberId}`);
  }

  /** Create a new visit entry */
  createVisit(payload: { memberId: number; date: string; description?: string; companions?: string }) {
    return this.http.post<any>('/api/iftekad/visits', payload);
  }

  /** Update an existing visit entry */
  updateVisit(visitId: number, payload: { date: string; description?: string; companions?: string }) {
    return this.http.put<any>(`/api/iftekad/visits/${visitId}`, payload);
  }

  /** Delete a visit entry */
  deleteVisit(visitId: number) {
    return this.http.delete<any>(`/api/iftekad/visits/${visitId}`);
  }
}
