import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export type FamilyJoinRequestView = {
  requestId: number;
  userId: number;
  fullName: string;
  username: string;
  deaconFamily: string;
  role: string;
  familyId: number;
  familyName: string;
  status: string;
  createdAt: string;
};

@Injectable({
  providedIn: 'root'
})
export class FamilyJoinRequestService {
  private http = inject(HttpClient);
  private baseUrl = '/api/family-requests';

  pendingCount(): Observable<{ count: number }> {
    return this.http.get<{ count: number }>(`${this.baseUrl}/pending/count`, { withCredentials: true });
  }

  pending(): Observable<FamilyJoinRequestView[]> {
    return this.http.get<FamilyJoinRequestView[]>(`${this.baseUrl}/pending`, { withCredentials: true });
  }

  decide(requestId: number, approved: boolean): Observable<any> {
    return this.http.post(`${this.baseUrl}/${requestId}/decision`, { approved }, { withCredentials: true });
  }

  submitRequest(familyId: number): Observable<any> {
    return this.http.post(this.baseUrl, { familyId }, { withCredentials: true });
  }

  myStatus(): Observable<{ status: string; familyId: number | null; familyName: string | null }> {
    return this.http.get<{ status: string; familyId: number | null; familyName: string | null }>(
      `${this.baseUrl}/my-status`,
      { withCredentials: true }
    );
  }
}
