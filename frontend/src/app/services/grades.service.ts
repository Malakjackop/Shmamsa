import { Injectable, inject, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of } from 'rxjs';

export interface GradeColumn {
  id: string;
  title: string;
}

export type ResultTerm = 'FIRST' | 'SECOND' | 'BOTH';

export interface SheetView {
  familyBase: string;
  selectedTerm: 'FIRST' | 'SECOND';
  status: string;
  updatedAt?: string;
  publishedAt?: string | null;
  firstPublishedAt?: string | null;
  secondPublishedAt?: string | null;
  columns: GradeColumn[];
  members: Array<{ id: number; fullName: string; values: Record<string, string> }>;
}

export interface SheetPayload {
  columns: GradeColumn[];
  rows: Record<string, Record<string, string>>;
}

export interface MyGradesView {
  familyBase: string;
  firstPublishedAt?: string | null;
  secondPublishedAt?: string | null;
  firstRank?: number | null;
  secondRank?: number | null;
  combinedRank?: number | null;
  firstColumns: GradeColumn[];
  firstValues: Record<string, string>;
  secondColumns: GradeColumn[];
  secondValues: Record<string, string>;
}

export type SchoolResultChoice = 'PASS' | 'FAIL';

@Injectable({ providedIn: 'root' })
export class GradesService {
  private http = inject(HttpClient);
  private baseUrl = '/api/grades';
  private isBrowser: boolean;

  constructor(@Inject(PLATFORM_ID) platformId: Object) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  private emptySheet(family = ''): SheetView {
    return {
      familyBase: family,
      selectedTerm: 'FIRST',
      status: 'DRAFT',
      columns: [],
      members: []
    };
  }

  private emptyMyGrades(): MyGradesView {
    return {
      familyBase: '',
      firstColumns: [],
      firstValues: {},
      secondColumns: [],
      secondValues: {}
    };
  }

  getSheet(family: string, term: 'FIRST' | 'SECOND'): Observable<SheetView> {
    if (!this.isBrowser) return of({ ...this.emptySheet(family), selectedTerm: term });
    const params = new HttpParams().set('family', family).set('term', term);
    return this.http.get<SheetView>(`${this.baseUrl}/sheet`, { params, withCredentials: true });
  }

  saveSheet(family: string, term: 'FIRST' | 'SECOND', payload: SheetPayload): Observable<any> {
    if (!this.isBrowser) return of(null);
    const params = new HttpParams().set('family', family).set('term', term);
    return this.http.put(`${this.baseUrl}/sheet`, payload, { params, withCredentials: true });
  }

  publishSheet(family: string, resultTerm: 'FIRST' | 'SECOND'): Observable<any> {
    if (!this.isBrowser) return of(null);
    const params = new HttpParams().set('family', family);
    return this.http.post(`${this.baseUrl}/sheet/publish`, { resultTerm }, { params, withCredentials: true });
  }

  unpublishSheet(family: string, resultTerm: 'FIRST' | 'SECOND'): Observable<any> {
    if (!this.isBrowser) return of(null);
    const params = new HttpParams().set('family', family);
    return this.http.post(`${this.baseUrl}/sheet/unpublish`, { resultTerm }, { params, withCredentials: true });
  }

  myGrades(family?: string): Observable<MyGradesView> {
    if (!this.isBrowser) return of({ ...this.emptyMyGrades(), familyBase: family || '' });
    let params = new HttpParams();
    if (family) params = params.set('family', family);
    return this.http.get<MyGradesView>(`${this.baseUrl}/me`, { params, withCredentials: true });
  }

  confirmSchoolResult(result: SchoolResultChoice, family?: string, studyYear?: string): Observable<any> {
    if (!this.isBrowser) return of(null);
    let params = new HttpParams();
    if (family) params = params.set('family', family);
    return this.http.post(`${this.baseUrl}/confirm-school-result`, { result, studyYear }, { params, withCredentials: true });
  }
}
