
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
    date?: string // yyyy-MM-dd
  ): Observable<any> {
    return this.http.post(`${this.baseUrl}/submit`, { users, type, date }, { withCredentials: true });
  }

  scanToken(token: string): Observable<{ id: number; username: string; fullName: string; deaconFamily?: string }> {
    return this.http.post<{ id: number; username: string; fullName: string; deaconFamily?: string }>(
      `${this.baseUrl}/scan-token`,
      { token }
    );
  }

  getMyStats(): Observable<{ FRIDAY_LITURGY: number; TASBEEHA: number; FAMILY_MEETING: number }> {
    return this.http.get<{ FRIDAY_LITURGY: number; TASBEEHA: number; FAMILY_MEETING: number }>(
      `${this.baseUrl}/my-stats`,
      { withCredentials: true }
    );
  }

history(): Observable<any> {
  return this.http.get('/api/attendance/history', { withCredentials: true });
}

resetAttendance(userIds: number[]): Observable<any> {
  return this.http.post(`${this.baseUrl}/reset`, { userIds }, { withCredentials: true });
}

// Start a new year: reset attendance for all accounts (servants + served)
startNewYear(): Observable<any> {
  return this.http.post(`${this.baseUrl}/start-new-year`, {}, { withCredentials: true });
}

}
