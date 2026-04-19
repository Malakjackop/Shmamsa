import { Injectable, inject, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';

export interface CustomField {
  id?: number;
  fieldKey: string;
  labelAr: string;
  fieldType: 'TEXT' | 'SELECT';
  options?: string;
  required: boolean;
  requiredRule?: string;
  visibilityRule: string;
  visibilityDependsOn?: string;
  visibilityDependsValues?: string;
  visibilityConditions?: VisibilityCondition[];
  showIn: string;
  displayOrder: number;
  enabled: boolean;
  isSystem?: boolean;
  createdAt?: string;
}

export interface VisibilityCondition {
  type: 'RULE' | 'FIELD';
  rule?: string;
  fieldKey?: string;
  values?: string[];
}

@Injectable({
  providedIn: 'root'
})
export class DevSettingsService {
  private http = inject(HttpClient);
  private isBrowser: boolean;

  constructor(@Inject(PLATFORM_ID) platformId: Object) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  /* ── Public (no auth needed) ─────────────────────────────── */
  getEnabledFields(): Observable<CustomField[]> {
    if (!this.isBrowser) return of([]);
    return this.http.get<CustomField[]>('/api/auth/custom-fields', { withCredentials: true });
  }

  /* ── Developer-only ────────────────────────────────────────── */
  getAllFields(): Observable<CustomField[]> {
    if (!this.isBrowser) return of([]);
    return this.http.get<CustomField[]>('/api/dev/custom-fields', { withCredentials: true });
  }

  createField(field: Partial<CustomField>): Observable<CustomField> {
    return this.http.post<CustomField>('/api/dev/custom-fields', field, { withCredentials: true });
  }

  updateField(id: number, field: Partial<CustomField>): Observable<CustomField> {
    return this.http.put<CustomField>(`/api/dev/custom-fields/${id}`, field, { withCredentials: true });
  }

  toggleField(id: number): Observable<{ id: number; enabled: boolean }> {
    return this.http.put<{ id: number; enabled: boolean }>(`/api/dev/custom-fields/${id}/toggle`, {}, { withCredentials: true });
  }

  deleteField(id: number): Observable<any> {
    return this.http.delete(`/api/dev/custom-fields/${id}`, { withCredentials: true });
  }
}
