
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export type AttendanceType = 'FRIDAY_LITURGY' | 'TASBEEHA' | 'FAMILY_MEETING';

@Injectable({ providedIn: 'root' })
export class AttendanceService {
  private http = inject(HttpClient);
  private baseUrl = '/api/attendance';

  submit(userIds: number[], type: AttendanceType): Observable<any> {
    return this.http.post(`${this.baseUrl}/submit`, { userIds, type }, { withCredentials: true });
  }
}
