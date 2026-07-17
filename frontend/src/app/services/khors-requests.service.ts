import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { HttpParams } from '@angular/common/http';

export type ChoirStandingPayload = {
  khors: string;
  rows: number;
  cols: number;
  direction: string;
  seats: Array<{ memberId: number | null; memberName: string | null; score: number }>;
  published: boolean;
  frontAtTop: boolean;
  frontOffset: number;
  crowdOffset: number;
};

export type KhorsJoinRequestView = {
  requestId: number;
  userId: number;
  fullName: string;
  familyName: string;
  deaconFamily: string;
  role: string;
  requestedKhors: string;
  createdAt: string;
};

@Injectable({
  providedIn: 'root'
})
export class KhorsRequestsService {
  private http = inject(HttpClient);
  private baseUrl = '/api/khors-requests';

  pendingCount(khors?: string): Observable<{ count: number }> {
    let params = new HttpParams();
    if (khors) params = params.set('khors', khors);
    return this.http.get<{ count: number }>(`${this.baseUrl}/pending/count`, { withCredentials: true, params });
  }

  pending(khors?: string): Observable<KhorsJoinRequestView[]> {
    let params = new HttpParams();
    if (khors) params = params.set('khors', khors);
    return this.http.get<KhorsJoinRequestView[]>(`${this.baseUrl}/pending`, { withCredentials: true, params });
  }

  decide(requestId: number, approved: boolean): Observable<any> {
    return this.http.post(
      `${this.baseUrl}/${requestId}/decision`,
      { approved },
      { withCredentials: true }
    );
  }

  // ===== Choir Standing =====

  getChoirStanding(khors: string): Observable<ChoirStandingPayload | null> {
    return this.http.get<ChoirStandingPayload | null>(
      `/api/khors/standing`,
      { params: { khors }, withCredentials: true }
    );
  }

  saveChoirStanding(data: ChoirStandingPayload): Observable<ChoirStandingPayload> {
    return this.http.put<ChoirStandingPayload>(
      `/api/khors/standing`,
      data,
      { withCredentials: true }
    );
  }
}
