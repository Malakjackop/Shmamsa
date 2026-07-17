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

export type AttendanceRuleGroup = {
  name: string;
  types: AttendanceType[];
  allRequired: boolean;
  bonusAllowed: boolean;
};

export type AttendanceConfig = {
  servantEntryOpenDays: number[];
  servantSelectableEventDays: number[];
  allowCustomTitleOnNonDefaultDays: boolean;
  typeLabels: Record<string, string>;
  typeDays: Partial<Record<AttendanceType, number[]>>;
  familyTypeDays?: Record<string, Partial<Record<AttendanceType, number[]>>>;
  familyAbsenceAllowedDays?: Record<string, number[]>;
  familyAbsenceOpenDays?: Record<string, number[]>;
  attendanceRuleGroups?: AttendanceRuleGroup[];
  typeAbsenceModes?: Record<string, string[]>;
  typeAbsenceModeDays?: Record<string, number[]>;
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
  dayOfWeek?: number | null;
  note?: string | null;
  startsAt: string;
  endsAt: string;
  enabled?: boolean;
  createdAt?: string;
  updatedAt?: string;
  active?: boolean;
  upcoming?: boolean;
  ended?: boolean;
  startsInSeconds?: number | null;
  endsInSeconds?: number | null;
};

export type AttendanceContext = {
  config: AttendanceConfig;
  scheduleDays?: Record<string, Partial<Record<AttendanceType, number[]>>>;
  scheduleTimes?: Record<string, Partial<Record<AttendanceType, Record<string, string>>>>;
  scheduleCreatedDates?: Record<string, Partial<Record<AttendanceType, Record<string, string>>>>;
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

export type AttendanceCustomEvent = {
  id?: number;
  familyBase: string | null;
  scope?: 'ALL' | 'FAMILY';
  title: string;
  dayOfWeek: number;
  enabled: boolean;
  status?: 'ACTIVE' | 'PENDING';
  alwaysActive: boolean;
  activeFrom?: string | null;
  activeTo?: string | null;
  createdById?: number | null;
  createdByName?: string | null;
  permittedEditors?: Array<{ id: number; fullName: string }>;
  permittedEditorIds?: number[];
  permittedEditorNames?: string[];
  permittedEditorId?: number | null;
  permittedEditorName?: string | null;
  canEdit?: boolean;
  createdAt?: string;
  updatedAt?: string;
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
    family?: string,
    customTitle?: string
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
    if (customTitle) params['customTitle'] = customTitle;
    return this.http.get<DailyAttendanceResponse>(`${this.baseUrl}/daily`, { params, withCredentials: true });
  }

  markAbsent(
    userId: number,
    date: string,
    type: AttendanceType,
    family?: string,
    customTitle?: string
  ): Observable<AttendanceMutationResponse> {
    if (!this.isBrowser) return of(null);
    return this.http.post<AttendanceMutationResponse>(
      `${this.baseUrl}/mark-absent`,
      { userId, date, type, family, customTitle },
      { withCredentials: true }
    );
  }

  updateAttendanceDate(id: number, date: string): Observable<{ ok: boolean; id: number; date: string }> {
    if (!this.isBrowser) return of({ ok: true, id, date });
    return this.http.put<{ ok: boolean; id: number; date: string }>(
      `${this.baseUrl}/records/${id}`,
      { date },
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
    family?: string,
    customTitle?: string
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
      { token, date, type, family, customTitle }
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

  listCustomEvents(familyBase?: string): Observable<AttendanceCustomEvent[]> {
    if (!this.isBrowser) return of([]);
    const params: Record<string, string> = {};
    if (familyBase) params['familyBase'] = familyBase;
    return this.http.get<AttendanceCustomEvent[]>(`${this.baseUrl}/custom-events`, {
      params,
      withCredentials: true
    });
  }

  createCustomEvent(payload: Partial<AttendanceCustomEvent>): Observable<AttendanceCustomEvent> {
    return this.http.post<AttendanceCustomEvent>(`${this.baseUrl}/custom-events`, payload, { withCredentials: true });
  }

  updateCustomEvent(id: number, payload: Partial<AttendanceCustomEvent>): Observable<AttendanceCustomEvent> {
    return this.http.put<AttendanceCustomEvent>(`${this.baseUrl}/custom-events/${id}`, payload, { withCredentials: true });
  }

  deleteCustomEvent(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.baseUrl}/custom-events/${id}`, { withCredentials: true });
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

  saveFullAttendanceConfig(config: AttendanceConfig): Observable<AttendanceConfig> {
    if (!this.isBrowser) {
      return of(config);
    }
    return this.http.put<AttendanceConfig>(`${this.baseUrl}/config`, config, { withCredentials: true });
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
    BONUS_STATS?: Record<string, number>;
    ALTERNATIVE_STATS?: Record<string, { PRESENT: number; TOTAL: number }>;
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
      BONUS_STATS?: Record<string, number>;
      ALTERNATIVE_STATS?: Record<string, { PRESENT: number; TOTAL: number }>;
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

  cancelDay(
    date: string,
    type: AttendanceType,
    families: string[]
  ): Observable<{ ok: boolean; cancelled: number }> {
    if (!this.isBrowser) return of({ ok: true, cancelled: 0 });
    return this.http.post<{ ok: boolean; cancelled: number }>(
      `${this.baseUrl}/cancel-day`,
      { date, type, families },
      { withCredentials: true }
    );
  }

  undoCancelDay(
    date: string,
    type: AttendanceType,
    families: string[]
  ): Observable<{ ok: boolean; removed: number }> {
    if (!this.isBrowser) return of({ ok: true, removed: 0 });
    return this.http.delete<{ ok: boolean; removed: number }>(
      `${this.baseUrl}/cancel-day`,
      { body: { date, type, families }, withCredentials: true }
    );
  }

  getSchedules(familyBase?: string): Observable<any[]> {
    if (!this.isBrowser) return of([]);
    const params: Record<string, string> = {};
    if (familyBase) params['familyBase'] = familyBase;
    return this.http.get<any[]>(`${this.baseUrl}/schedules`, { params, withCredentials: true });
  }

  createSchedule(payload: {
    familyBase: string;
    type: AttendanceType;
    dayOfWeek: number;
    time?: string;
    enabled?: boolean;
  }): Observable<any> {
    if (!this.isBrowser) return of(null);
    return this.http.post<any>(`${this.baseUrl}/schedules`, payload, { withCredentials: true });
  }

  deleteSchedule(id: number): Observable<{ ok: boolean }> {
    if (!this.isBrowser) return of({ ok: true });
    return this.http.delete<{ ok: boolean }>(`${this.baseUrl}/schedules/${id}`, { withCredentials: true });
  }

  generateSchedules(): Observable<{ ok: boolean; created: number }> {
    if (!this.isBrowser) return of({ ok: true, created: 0 });
    return this.http.post<{ ok: boolean; created: number }>(`${this.baseUrl}/schedules/generate`, {}, { withCredentials: true });
  }

  getCancellations(
    date: string,
    type: AttendanceType
  ): Observable<{ cancellations: string[] }> {
    if (!this.isBrowser) return of({ cancellations: [] });
    return this.http.get<{ cancellations: string[] }>(
      `${this.baseUrl}/cancellations`,
      { params: { date, type }, withCredentials: true }
    );
  }

  getCancelledDatesInRange(
    from: string,
    to: string,
    type: AttendanceType,
    family?: string
  ): Observable<{ dates: string[] }> {
    if (!this.isBrowser) return of({ dates: [] });
    let params: Record<string, string> = { from, to, type };
    if (family) params['family'] = family;
    return this.http.get<{ dates: string[] }>(
      `${this.baseUrl}/cancelled-dates`,
      { params, withCredentials: true }
    );
  }

  // ===== Absence Notes =====

  getAbsenceNotes(familyBase: string, date: string): Observable<any[]> {
    if (!this.isBrowser) return of([]);
    return this.http.get<any[]>(`${this.baseUrl}/absence-notes`, {
      params: { familyBase, date },
      withCredentials: true
    });
  }

  saveAbsenceNote(body: { memberId: number; date: string; attendanceType: string; note: string; familyBase: string }): Observable<any> {
    if (!this.isBrowser) return of(null);
    return this.http.post<any>(`${this.baseUrl}/absence-notes`, body, { withCredentials: true });
  }
}
