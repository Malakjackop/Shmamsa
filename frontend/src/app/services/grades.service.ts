import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface GradeColumn {
  id: string;
  title: string;
}

export interface SheetView {
  familyBase: string;
  status: string;
  updatedAt?: string;
  publishedAt?: string;
  columns: GradeColumn[];
  members: Array<{ id: number; fullName: string; values: Record<string, string> }>;
}

export interface SheetPayload {
  columns: GradeColumn[];
  rows: Record<string, Record<string, string>>; // userId -> {colId -> value}
}

export interface MyGradesView {
  familyBase: string;
  publishedAt?: string | null;
  columns: GradeColumn[];
  values: Record<string, string>;
}

@Injectable({ providedIn: 'root' })
export class GradesService {
  private http = inject(HttpClient);
  private baseUrl = '/api/grades';

  getSheet(family: string): Observable<SheetView> {
    const params = new HttpParams().set('family', family);
    return this.http.get<SheetView>(`${this.baseUrl}/sheet`, { params, withCredentials: true });
  }

  saveSheet(family: string, payload: SheetPayload): Observable<any> {
    const params = new HttpParams().set('family', family);
    return this.http.put(`${this.baseUrl}/sheet`, payload, { params, withCredentials: true });
  }

  publishSheet(family: string): Observable<any> {
    const params = new HttpParams().set('family', family);
    return this.http.post(`${this.baseUrl}/sheet/publish`, {}, { params, withCredentials: true });
  }

  myGrades(family?: string): Observable<MyGradesView> {
    let params = new HttpParams();
    if (family) params = params.set('family', family);
    return this.http.get<MyGradesView>(`${this.baseUrl}/me`, { params, withCredentials: true });
  }
}
