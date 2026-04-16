import { Injectable, inject, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';

export type AttendanceType =
  | 'FRIDAY_LITURGY'
  | 'MARMARKOS_KHORS'
  | 'ATHANASIUS_KHORS'
  | 'TASBEEHA'
  | 'FAMILY_MEETING'
  | 'CUSTOM_EVENT';

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

export type AttendanceConfig = {
  servantEntryOpenDays: number[];
  servantSelectableEventDays: number[];
  allowCustomTitleOnNonDefaultDays: boolean;
  typeLabels: Record<string, string>;
  typeDays: Partial<Record<AttendanceType, number[]>>;
  familyTypeDays?: Record<string, Partial<Record<AttendanceType, number[]>>>;
  familyAbsenceAllowedDays?: Record<string, number[]>;
  familyAbsenceOpenDays?: Record<string, number[]>;
};

export type AttendanceAccessGrant = {
  id?: number;
  targetUserId?: number;
  targetUserName?: string;
  targetUserRole?: string;
  createdById?: number;
  createdByName?: string;
  grantKind: 'SELF_CHECKIN' | 'TAKE_ATTENDANCE';
  familyId?: number | null;
  familyBase?: string | null;
  allowedTypes: AttendanceType[];
  note?: string | null;
  startsAt: string;
  endsAt: string;
  enabled?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type AttendanceContext = {
  config: AttendanceConfig;
  role?: string;
  todayOpenForServant: boolean;
  activeGrants: AttendanceAccessGrant[];
  selfCheckinAllowed: boolean;
  takeAttendanceGrantActive: boolean;
  selfAllowedTypes: AttendanceType[];
  takeAllowedTypes: AttendanceType[];
  canUseCustomEvent: boolean;
};

export type AttendanceConfigResponse = {
  config: AttendanceConfig;
  manageableFamilies?: string[];
};

@Injectable({ providedIn: 'root' })
export class AttendanceService {
  private http = inject(HttpClient);
  private baseUrl = '/api/attendance';
  private isBrowser: boolean;

  constructor(@Inject(PLATFORM_ID) platformId: Object) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  context(): Observable<AttendanceContext> {
    if (!this.isBrowser) {
      return of({
        config: {
          servantEntryOpenDays: [4, 5, 6, 0, 1],
          servantSelectableEventDays: [4, 5, 6],
          allowCustomTitleOnNonDefaultDays: true,
          typeLabels: {},
          typeDays: {},
          familyTypeDays: {},
          familyAbsenceAllowedDays: {},
          familyAbsenceOpenDays: {}
        },
        todayOpenForServant: true,
        activeGrants: [],
        selfCheckinAllowed: false,
        takeAttendanceGrantActive: false,
        selfAllowedTypes: [],
        takeAllowedTypes: [],
        canUseCustomEvent: false
      });
    }
    return this.http.get<AttendanceContext>(`${this.baseUrl}/context`, { withCredentials: true });
  }

  daily(
    date: string,
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
    date?: string,
    family?: string,
    customTitle?: string
  ): Observable<AttendanceMutationResponse> {
    if (!this.isBrowser) return of(null);
    return this.http.post<AttendanceMutationResponse>(
      `${this.baseUrl}/submit`,
      { users, type, date, family, customTitle },
      { withCredentials: true }
    );
  }

  selfCheckin(type: AttendanceType, date?: string): Observable<AttendanceMutationResponse> {
    if (!this.isBrowser) return of(null);
    return this.http.post<AttendanceMutationResponse>(
      `${this.baseUrl}/self-checkin`,
      { type, date },
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
    effectiveFamilyBase?: string;
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
      effectiveFamilyBase?: string;
      alreadyRecorded?: boolean;
      alreadyPresent?: boolean;
      existingStatus?: 'PRESENT' | 'ABSENT' | null;
    }>(
      `${this.baseUrl}/scan-token`,
      { token, date, type, family }
    , { withCredentials: true });
  }

  listAccessGrants(): Observable<AttendanceAccessGrant[]> {
    if (!this.isBrowser) return of([]);
    return this.http.get<AttendanceAccessGrant[]>(`${this.baseUrl}/access-grants`, { withCredentials: true });
  }

  createAccessGrant(payload: Partial<AttendanceAccessGrant>): Observable<AttendanceAccessGrant> {
    return this.http.post<AttendanceAccessGrant>(`${this.baseUrl}/access-grants`, payload, { withCredentials: true });
  }

  updateAccessGrant(id: number, payload: Partial<AttendanceAccessGrant>): Observable<AttendanceAccessGrant> {
    return this.http.put<AttendanceAccessGrant>(`${this.baseUrl}/access-grants/${id}`, payload, { withCredentials: true });
  }

  deleteAccessGrant(id: number): Observable<{ ok: boolean; id: number }> {
    return this.http.delete<{ ok: boolean; id: number }>(`${this.baseUrl}/access-grants/${id}`, { withCredentials: true });
  }

  getAttendanceConfig(): Observable<AttendanceConfigResponse> {
    if (!this.isBrowser) {
      return of({
        config: {
          servantEntryOpenDays: [4, 5, 6, 0, 1],
          servantSelectableEventDays: [4, 5, 6],
          allowCustomTitleOnNonDefaultDays: true,
          typeLabels: {},
          typeDays: {},
          familyTypeDays: {}
        },
        manageableFamilies: []
      });
    }
    return this.http.get<AttendanceConfigResponse>(`${this.baseUrl}/config`, { withCredentials: true });
  }

  saveFamilyTypeDays(
    familyBase: string,
    typeDays: Partial<Record<AttendanceType, number[]>>,
    absenceAllowedDays?: number[],
    absenceOpenDays?: number[]
  ): Observable<AttendanceConfig> {
    if (!this.isBrowser) {
      return of({
        servantEntryOpenDays: [4, 5, 6, 0, 1],
        servantSelectableEventDays: [4, 5, 6],
        allowCustomTitleOnNonDefaultDays: true,
        typeLabels: {},
        typeDays: {},
        familyTypeDays: { [familyBase]: typeDays },
        familyAbsenceAllowedDays: { [familyBase]: absenceAllowedDays || [] },
        familyAbsenceOpenDays: { [familyBase]: absenceOpenDays || [] }
      });
    }
    return this.http.put<AttendanceConfig>(
      `${this.baseUrl}/config/family-days`,
      { familyBase, typeDays, absenceAllowedDays, absenceOpenDays },
      { withCredentials: true }
    );
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

  resetAttendance(userIds: number[]): Observable<AttendanceMutationResponse> {
    if (!this.isBrowser) return of(null);
    return this.http.post<AttendanceMutationResponse>(`${this.baseUrl}/reset`, { userIds }, { withCredentials: true });
  }

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