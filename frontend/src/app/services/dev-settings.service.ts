import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface CustomField {
  id?: number;
  fieldKey: string;
  labelAr: string;
  fieldType: 'TEXT' | 'SELECT';
  options?: string;
  required: boolean;
  requiredRule?: string;
  visibilityRule: string;
  showIn: string;
  displayOrder: number;
  enabled: boolean;
  isSystem?: boolean;
  createdAt?: string;
}

@Injectable({
  providedIn: 'root'
})
export class DevSettingsService {
  private http = inject(HttpClient);

  /* ── Public (no auth needed) ─────────────────────────────── */
  getEnabledFields(): Observable<CustomField[]> {
    return this.http.get<CustomField[]>('/api/auth/custom-fields', { withCredentials: true });
  }

  /* ── Developer-only ────────────────────────────────────────── */
  getAllFields(): Observable<CustomField[]> {
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
