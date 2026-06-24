
import { Injectable, inject, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of } from 'rxjs';

export type FamilyMemberSummary = {
  id: number;
  fullName?: string;
  role?: string | number;
  familyName?: string;
  deaconFamily?: string;
  familyAssignments?: Array<Record<string, unknown>>;
  phoneNumber?: string;
  guardiansPhone?: string;
  address?: string;
  schoolGrade?: string;
  dateOfBirth?: string;
  fridayLiturgyPresent?: number;
  fridayLiturgyTotal?: number;
  tasbeehaPresent?: number;
  tasbeehaTotal?: number;
  familyMeetingPresent?: number;
  familyMeetingTotal?: number;
  marmarkosKhorsPresent?: number;
  marmarkosKhorsTotal?: number;
  athanasiusKhorsPresent?: number;
  athanasiusKhorsTotal?: number;
  khors?: string;
  khorsYear?: number | string | null;
  servingScope?: string;
  [key: string]: unknown;
};

export type FamilyAttendanceRecord = {
  id?: number;
  attendanceId?: number;
  date?: string;
  attendanceDate?: string;
  day?: string;
  time?: string;
  attendanceTime?: string;
  createdAt?: string;
  type?: string;
  attendanceType?: string;
  status?: 'PRESENT' | 'ABSENT' | string;
  takenBy?: { id?: number; fullName?: string; role?: string } | null;
  archived?: boolean | number | string;
  isArchived?: boolean | number | string;
  inArchive?: boolean | number | string;
  isInArchive?: boolean | number | string;
  archiveId?: number | null;
  archive?: unknown;
  archiveName?: string;
  archivedAt?: string;
  archiveDate?: string;
  [key: string]: unknown;
};

export type FamilyMemberDetails = {
  username?: string;
  email?: string;
  customFields?: Record<string, string>;
  deaconDegree?: string;
  nationalId?: string;
  address?: string;
  phoneNumber?: string;
  guardiansPhone?: string;
  guardianRelation?: string;
  dateOfBirth?: string;
  gender?: string;
  status?: string;
  studyType?: string;
  schoolName?: string;
  schoolGrade?: string;
  universityName?: string;
  faculty?: string;
  universityGrade?: string;
  graduatedFrom?: string;
  graduateJob?: string;
  isWorking?: string | boolean;
  workDetails?: string;
  deaconFamily?: string;
  familyAssignments?: Array<Record<string, unknown>>;
  [key: string]: unknown;
} | null;

export type FamilyMutationResponse = {
  updated?: number;
  [key: string]: unknown;
} | null;

@Injectable({ providedIn: 'root' })
export class FamilyService {
  private http = inject(HttpClient);
  private baseUrl = '/api/family';
  private khorsUrl = '/api/khors';
  private isBrowser: boolean;

  constructor(@Inject(PLATFORM_ID) platformId: Object) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  families(context?: string): Observable<string[]> {
    if (!this.isBrowser) return of([]);
    let params = new HttpParams();
    if (context) params = params.set('context', context);
    return this.http.get<string[]>(`${this.baseUrl}/families`, { params, withCredentials: true });
  }

  /**
   * Fetch members for a family.
   * @param family optional family base name
   * @param includeSelf when true, the backend will include the logged-in user in the list
   */
  members(family?: string, includeSelf: boolean = false, context?: string): Observable<FamilyMemberSummary[]> {
    if (!this.isBrowser) return of([]);
    let params = new HttpParams();
    if (family) params = params.set('family', family);
    if (includeSelf) params = params.set('includeSelf', 'true');
    if (context) params = params.set('context', context);
    return this.http.get<FamilyMemberSummary[]>(`${this.baseUrl}/members`, { params, withCredentials: true });
  }

  search(name: string, family?: string): Observable<FamilyMemberSummary[]> {
    if (!this.isBrowser) return of([]);
    let params = new HttpParams().set('name', name || '');
    if (family) params = params.set('family', family);
    return this.http.get<FamilyMemberSummary[]>(`${this.baseUrl}/search`, { params, withCredentials: true });
  }


  memberAttendance(id: number, family?: string, type?: string): Observable<FamilyAttendanceRecord[]> {
    if (!this.isBrowser) return of([]);
    let params = new HttpParams();
    if (family) params = params.set('family', family);
    if (type) params = params.set('type', type);
    return this.http.get<FamilyAttendanceRecord[]>(`${this.baseUrl}/members/${id}/attendance`, { params, withCredentials: true });
  }

  memberDetails(id: number, family?: string): Observable<FamilyMemberDetails> {
    if (!this.isBrowser) return of(null);
    let params = new HttpParams();
    if (family) params = params.set('family', family);
    return this.http.get<FamilyMemberDetails>(`${this.baseUrl}/members/${id}`, { params, withCredentials: true });
  }

  deleteMember(id: number): Observable<FamilyMutationResponse> {
    if (!this.isBrowser) return of(null);
    return this.http.delete<Record<string, unknown>>(`${this.baseUrl}/members/${id}`, { withCredentials: true });
  }


  transferMembers(memberIds: number[], newFamily: string, targetRole?: string, extraFamilies?: string[], extraAssignments?: Array<{ family: string; role: string }>, transferFamily?: string): Observable<FamilyMutationResponse> {
    if (!this.isBrowser) return of(null);
    return this.http.post<Record<string, unknown>>(
      `${this.baseUrl}/transfer-members`,
      { memberIds, newFamily, targetRole, extraFamilies, extraAssignments, transferFamily },
      { withCredentials: true }
    );
  }

  /** Remove a servant's assignment from a specific family without transferring elsewhere. */
  removeServantFromFamily(memberId: number, family: string): Observable<FamilyMutationResponse> {
    if (!this.isBrowser) return of(null);
    return this.http.post<Record<string, unknown>>(
      `${this.baseUrl}/remove-assignment`,
      { memberId, family },
      { withCredentials: true }
    );
  }

  /** Remove a member from a choir (Marmarkos / Athanasius). */
  removeFromKhors(memberId: number, khorsLabel: string): Observable<FamilyMutationResponse> {
    if (!this.isBrowser) return of(null);
    let params = new HttpParams().set('khors', khorsLabel);
    return this.http.delete<Record<string, unknown>>(`${this.khorsUrl}/members/${memberId}`, { params, withCredentials: true });
  }
}
