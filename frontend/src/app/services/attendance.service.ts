import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export type AttendanceType = 'FRIDAY_LITURGY' | 'TASBEEHA' | 'FAMILY_MEETING';

@Injectable({ providedIn: 'root' })
export class AttendanceService {
  private http = inject(HttpClient);
  private baseUrl = '/api/attendance';

  submit(
    users: { id: number; username?: string }[],
    type: AttendanceType,
    date?: string, // yyyy-MM-dd
    family?: string
  ): Observable<any> {
    return this.http.post(
      `${this.baseUrl}/submit`,
      { users, type, date, family },
      { withCredentials: true }
    );
  }

  scanToken(token: string): Observable<{ id: number; username: string; fullName: string; deaconFamily?: string }> {
    return this.http.post<{ id: number; username: string; fullName: string; deaconFamily?: string }>(
      `${this.baseUrl}/scan-token`,
      { token }
    , { withCredentials: true });
  }

  getMyStats(): Observable<{ FRIDAY_LITURGY: number; TASBEEHA: number; FAMILY_MEETING: number }> {
    return this.http.get<{ FRIDAY_LITURGY: number; TASBEEHA: number; FAMILY_MEETING: number }>(
      `${this.baseUrl}/my-stats`,
      { withCredentials: true }
    );
  }

  history(): Observable<any> {
    return this.http.get(`${this.baseUrl}/history`, { withCredentials: true });
  }

  // (لو زرار reset القديم لسه مستخدمينه في أي مكان)
  resetAttendance(userIds: number[]): Observable<any> {
    return this.http.post(`${this.baseUrl}/reset`, { userIds }, { withCredentials: true });
  }

  // ====== أرشيفات الحضور ======
  archives(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/archives`, { withCredentials: true });
  }

  startNewYearArchive(name: string): Observable<any> {
    return this.http.post<any>(
      `${this.baseUrl}/start-new-year`,
      { name },
      { withCredentials: true }
    );
  }


  downloadArchivePdf(id: number) {
  return this.http.get(`${this.baseUrl}/archives/${id}/pdf`, {
    responseType: 'blob',
    withCredentials: true
  });
}

  archivePdfUrl(id: number): string {
    return `${this.baseUrl}/archives/${id}/pdf`;
  }
}