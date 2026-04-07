import { Injectable, inject, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';

export type AttendanceType =
  | 'FRIDAY_LITURGY'
  | 'MARMARKOS_KHORS'
  | 'ATHANASIUS_KHORS'
  | 'TASBEEHA'
  | 'FAMILY_MEETING';

export type AttendancePerson = {
  id: number;
  fullName: string;
  role?: string;
  familyName?: string;
  deaconFamily?: string;
  status: 'PRESENT' | 'ABSENT';
};

export type DailyAttendanceResponse = {
  ok: boolean;
  date: string;
  type: AttendanceType;
  family?: string;
  familyBase?: string | null;
  total: number;
  presentCount: number;
  absentCount: number;
  recordsCount: number;
  present: AttendancePerson[];
  absent: AttendancePerson[];
};

export type AttendanceArchive = {
  id?: number;
  name?: string;
  createdAt?: string;
  [key: string]: unknown;
};

export type AttendanceMutationResponse = {
  presentCreated?: number;
  presentUpdated?: number;
  absentCreated?: number;
  skipped?: number;
  created?: number;
  updated?: number;
  date?: string;
  users?: number | string;
  archivedRecords?: number | string;
  [key: string]: unknown;
} | null;

@Injectable({ providedIn: 'root' })
export class AttendanceService {
  private http = inject(HttpClient);
  private baseUrl = '/api/attendance';
  private isBrowser: boolean;

  constructor(@Inject(PLATFORM_ID) platformId: Object) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  daily(
    date: string, // yyyy-MM-dd
    type: AttendanceType,
    family?: string
  ): Observable<DailyAttendanceResponse> {
    if (!this.isBrowser) {
      return of({
        ok: true,
        date,
        type,
        family,
        familyBase: family || null,
        total: 0,
        presentCount: 0,
        absentCount: 0,
        recordsCount: 0,
        present: [],
        absent: []
      });
    }
    const params: Record<string, string> = { date, type };
    if (family) params['family'] = family;
    return this.http.get<DailyAttendanceResponse>(`${this.baseUrl}/daily`, { params, withCredentials: true });
  }

  markAbsent(userId: number, date: string, type: AttendanceType, family?: string): Observable<AttendanceMutationResponse> {
    if (!this.isBrowser) return of(null);
    return this.http.post<AttendanceMutationResponse>(
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
  ): Observable<AttendanceMutationResponse> {
    if (!this.isBrowser) return of(null);
    return this.http.post<AttendanceMutationResponse>(
      `${this.baseUrl}/submit`,
      { users, type, date, family },
      { withCredentials: true }
    );
  }

  scanToken(
    token: string,
    date?: string,
    type?: AttendanceType,
    family?: string
  ): Observable<{
    id: number;
    username: string;
    fullName: string;
    familyName?: string;
    deaconFamily?: string;
    alreadyRecorded?: boolean;
    alreadyPresent?: boolean;
    existingStatus?: 'PRESENT' | 'ABSENT' | null;
  }> {
    if (!this.isBrowser) {
      return of({
        id: 0,
        username: '',
        fullName: ''
      });
    }
    return this.http.post<{
      id: number;
      username: string;
      fullName: string;
      familyName?: string;
      deaconFamily?: string;
      alreadyRecorded?: boolean;
      alreadyPresent?: boolean;
      existingStatus?: 'PRESENT' | 'ABSENT' | null;
    }>(
      `${this.baseUrl}/scan-token`,
      { token, date, type, family }
    , { withCredentials: true });
  }

  getMyStats(): Observable<{
    FRIDAY_LITURGY: number;
    MARMARKOS_KHORS?: number;
    ATHANASIUS_KHORS?: number;
    TASBEEHA: number;
    FAMILY_MEETING: number;
    FRIDAY_LITURGY_TOTAL?: number;
    MARMARKOS_KHORS_TOTAL?: number;
    ATHANASIUS_KHORS_TOTAL?: number;
    TASBEEHA_TOTAL?: number;
    FAMILY_MEETING_TOTAL?: number;
    FAMILY_MEETING_BY_FAMILY?: Record<string, number>;
    FAMILY_MEETING_TOTAL_BY_FAMILY?: Record<string, number>;
  }> {
    if (!this.isBrowser) {
      return of({
        FRIDAY_LITURGY: 0,
        TASBEEHA: 0,
        FAMILY_MEETING: 0,
        MARMARKOS_KHORS: 0,
        ATHANASIUS_KHORS: 0,
        FAMILY_MEETING_BY_FAMILY: {},
        FAMILY_MEETING_TOTAL_BY_FAMILY: {}
      });
    }
    return this.http.get<{
      FRIDAY_LITURGY: number;
      MARMARKOS_KHORS?: number;
      ATHANASIUS_KHORS?: number;
      TASBEEHA: number;
      FAMILY_MEETING: number;
      FRIDAY_LITURGY_TOTAL?: number;
      MARMARKOS_KHORS_TOTAL?: number;
      ATHANASIUS_KHORS_TOTAL?: number;
      TASBEEHA_TOTAL?: number;
      FAMILY_MEETING_TOTAL?: number;
      FAMILY_MEETING_BY_FAMILY?: Record<string, number>;
      FAMILY_MEETING_TOTAL_BY_FAMILY?: Record<string, number>;
    }>(
      `${this.baseUrl}/my-stats-v2`,
      { withCredentials: true }
    );
  }

  history(): Observable<Record<string, unknown>[]> {
    if (!this.isBrowser) return of([]);
    return this.http.get<Record<string, unknown>[]>(`${this.baseUrl}/history`, { withCredentials: true });
  }

  // (لو زرار reset القديم لسه مستخدمينه في أي مكان)
  resetAttendance(userIds: number[]): Observable<AttendanceMutationResponse> {
    if (!this.isBrowser) return of(null);
    return this.http.post<AttendanceMutationResponse>(`${this.baseUrl}/reset`, { userIds }, { withCredentials: true });
  }

  // ====== أرشيفات الحضور ======
  archives(): Observable<AttendanceArchive[]> {
    if (!this.isBrowser) return of([]);
    return this.http.get<AttendanceArchive[]>(`${this.baseUrl}/archives`, { withCredentials: true });
  }

  startNewYearArchive(name: string): Observable<AttendanceMutationResponse> {
    if (!this.isBrowser) return of(null);
    return this.http.post<Record<string, unknown>>(
      `${this.baseUrl}/start-new-year`,
      { name },
      { withCredentials: true }
    );
  }


  downloadArchivePdf(id: number) {
    if (!this.isBrowser) return of(new Blob());
    return this.http.get(`${this.baseUrl}/archives/${id}/pdf`, {
      responseType: 'blob',
      withCredentials: true
    });
  }

  archivePdfUrl(id: number): string {
    return `${this.baseUrl}/archives/${id}/pdf`;
  }
}
