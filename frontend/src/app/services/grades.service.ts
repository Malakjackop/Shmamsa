import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

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

  getSheet(family: string, term: 'FIRST' | 'SECOND'): Observable<SheetView> {
    const params = new HttpParams().set('family', family).set('term', term);
    return this.http.get<SheetView>(`${this.baseUrl}/sheet`, { params, withCredentials: true });
  }

  saveSheet(family: string, term: 'FIRST' | 'SECOND', payload: SheetPayload): Observable<any> {
    const params = new HttpParams().set('family', family).set('term', term);
    return this.http.put(`${this.baseUrl}/sheet`, payload, { params, withCredentials: true });
  }

  publishSheet(family: string, resultTerm: 'FIRST' | 'SECOND'): Observable<any> {
    const params = new HttpParams().set('family', family);
    return this.http.post(`${this.baseUrl}/sheet/publish`, { resultTerm }, { params, withCredentials: true });
  }

  unpublishSheet(family: string, resultTerm: 'FIRST' | 'SECOND'): Observable<any> {
    const params = new HttpParams().set('family', family);
    return this.http.post(`${this.baseUrl}/sheet/unpublish`, { resultTerm }, { params, withCredentials: true });
  }

  myGrades(family?: string): Observable<MyGradesView> {
    let params = new HttpParams();
    if (family) params = params.set('family', family);
    return this.http.get<MyGradesView>(`${this.baseUrl}/me`, { params, withCredentials: true });
  }

  confirmSchoolResult(result: SchoolResultChoice, family?: string, studyYear?: string): Observable<any> {
    let params = new HttpParams();
    if (family) params = params.set('family', family);
    return this.http.post(`${this.baseUrl}/confirm-school-result`, { result, studyYear }, { params, withCredentials: true });
  }
}
