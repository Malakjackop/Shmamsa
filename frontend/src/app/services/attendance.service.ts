import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export type AttendanceType =
  | 'FRIDAY_LITURGY'
  | 'MARMARKOS_KHORS'
  | 'ATHANASIUS_KHORS'
  | 'TASBEEHA'
  | 'FAMILY_MEETING';

@Injectable({ providedIn: 'root' })
export class AttendanceService {
  private http = inject(HttpClient);
  private baseUrl = '/api/attendance';

  daily(
    date: string, // yyyy-MM-dd
    type: AttendanceType,
    family?: string
  ): Observable<{
    ok: boolean;
    date: string;
    type: AttendanceType;
    family?: string;
    familyBase?: string | null;
    total: number;
    presentCount: number;
    absentCount: number;
    recordsCount: number;
    present: Array<{ id: number; fullName: string; role?: string; deaconFamily?: string; status: 'PRESENT' | 'ABSENT' }>;
    absent: Array<{ id: number; fullName: string; role?: string; deaconFamily?: string; status: 'PRESENT' | 'ABSENT' }>;
  }> {
    const params: any = { date, type };
    if (family) params.family = family;
    return this.http.get<any>(`${this.baseUrl}/daily`, { params, withCredentials: true });
  }

  markAbsent(userId: number, date: string, type: AttendanceType, family?: string): Observable<any> {
    return this.http.post(
      `${this.baseUrl}/mark-absent`,
      { userId, date, type, family },
      { withCredentials: true }
    );
  }

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

  getMyStats(): Observable<{
    FRIDAY_LITURGY: number;
    MARMARKOS_KHORS?: number;
    ATHANASIUS_KHORS?: number;
    TASBEEHA: number;
    FAMILY_MEETING: number;
    FAMILY_MEETING_BY_FAMILY?: Record<string, number>;
  }> {
    return this.http.get<{
      FRIDAY_LITURGY: number;
      MARMARKOS_KHORS?: number;
      ATHANASIUS_KHORS?: number;
      TASBEEHA: number;
      FAMILY_MEETING: number;
      FAMILY_MEETING_BY_FAMILY?: Record<string, number>;
    }>(
      `${this.baseUrl}/my-stats-v2`,
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