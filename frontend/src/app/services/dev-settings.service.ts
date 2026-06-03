import { Injectable, inject, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Observable, map, of } from 'rxjs';

export interface CustomField {
  id?: number;
  fieldKey: string;
  labelAr: string;
  fieldType: 'TEXT' | 'SELECT' | 'DATE';
  options?: string;
  required: boolean;
  requiredRule?: string;
  visibilityRule: string;
  visibilityDependsOn?: string;
  visibilityDependsValues?: string;
  visibilityConditions?: VisibilityCondition[];
  showIn: string;
  showInConfigured?: boolean;
  profileEditable?: boolean;
  category?: string;
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

function showInIncludesProfile(showIn?: string | null): boolean {
  return String(showIn || '')
    .split(',')
    .map(target => target.trim().toUpperCase())
    .includes('PROFILE');
}

export function normalizeCustomFieldResponse(field: CustomField): CustomField {
  if (!field) {
    return field;
  }

  if (
    !Object.prototype.hasOwnProperty.call(field, 'profileEditable') &&
    field.showInConfigured === true &&
    showInIncludesProfile(field.showIn)
  ) {
    return {
      ...field,
      profileEditable: false
    };
  }

  return field;
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
    return this.http
      .get<CustomField[]>('/api/auth/custom-fields', { withCredentials: true })
      .pipe(map((fields) => (fields || []).map(normalizeCustomFieldResponse)));
  }

  /* ── Developer-only ────────────────────────────────────────── */
  getAllFields(): Observable<CustomField[]> {
    if (!this.isBrowser) return of([]);
    return this.http
      .get<CustomField[]>('/api/dev/custom-fields', { withCredentials: true })
      .pipe(map((fields) => (fields || []).map(normalizeCustomFieldResponse)));
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

  reorderFields(items: { id: number; displayOrder: number }[]): Observable<any> {
    return this.http.put('/api/dev/custom-fields/reorder', items, { withCredentials: true });
  }

  /* ── Families management ──────────────────────────────── */
  getAllFamilies(): Observable<FamilyCatalog[]> {
    if (!this.isBrowser) return of([]);
    return this.http.get<FamilyCatalog[]>('/api/dev/families', { withCredentials: true });
  }

  createFamily(family: Partial<FamilyCatalog>): Observable<FamilyCatalog[]> {
    return this.http.post<FamilyCatalog[]>('/api/dev/families', family, { withCredentials: true });
  }

  updateFamily(id: number, family: Partial<FamilyCatalog>): Observable<FamilyCatalog[]> {
    return this.http.put<FamilyCatalog[]>(`/api/dev/families/${id}`, family, { withCredentials: true });
  }

  toggleFamilyActive(id: number): Observable<{ id: number; active: boolean }> {
    return this.http.put<{ id: number; active: boolean }>(`/api/dev/families/${id}/toggle-active`, {}, { withCredentials: true });
  }

  deleteFamily(id: number): Observable<any> {
    return this.http.delete(`/api/dev/families/${id}`, { withCredentials: true });
  }

  reorderFamilies(items: { id: number; sortOrder: number }[]): Observable<any> {
    return this.http.put('/api/dev/families/reorder', items, { withCredentials: true });
  }

  /* ── Servant Registration Secret ──────────────────────── */
  getCurrentSecretCode(): Observable<SecretCodeResponse> {
    if (!this.isBrowser) return of({ code: '', validFrom: '', validTo: '', valid: false });
    return this.http.get<SecretCodeResponse>('/api/dev/servant-secret/current', { withCredentials: true });
  }

  generateSecretCode(): Observable<SecretCodeResponse> {
    return this.http.post<SecretCodeResponse>('/api/dev/servant-secret/generate', {}, { withCredentials: true });
  }

  /* ── Role Settings ──────────────────────────────────── */
  getAllRoles(): Observable<RoleSettings[]> {
    if (!this.isBrowser) return of([]);
    return this.http.get<RoleSettings[]>('/api/dev/roles', { withCredentials: true });
  }

  getAllPermissions(): Observable<string[]> {
    if (!this.isBrowser) return of([]);
    return this.http.get<string[]>('/api/dev/roles/permissions', { withCredentials: true });
  }

  createRole(role: Partial<RoleSettings>): Observable<RoleSettings> {
    return this.http.post<RoleSettings>('/api/dev/roles', role, { withCredentials: true });
  }

  updateRole(id: number, role: Partial<RoleSettings>): Observable<RoleSettings> {
    return this.http.put<RoleSettings>(`/api/dev/roles/${id}`, role, { withCredentials: true });
  }

  deleteRole(id: number): Observable<any> {
    return this.http.delete(`/api/dev/roles/${id}`, { withCredentials: true });
  }

  reorderRoles(ids: number[]): Observable<any> {
    return this.http.put('/api/dev/roles/reorder', { ids }, { withCredentials: true });
  }
}

export interface RoleSettings {
  id?: number;
  name: string;
  displayNameAr: string;
  sortOrder: number;
  active: boolean;
  permissions: string;
}

export interface SecretCodeResponse {
  code: string;
  validFrom: string;
  validTo: string;
  valid: boolean;
}

export interface FamilyCatalog {
  id?: number;
  code: string;
  nameAr: string;
  baseName?: string;
  branch?: string;
  category?: string;
  active: boolean;
  sortOrder: number;
  servantSelectable: boolean;
  memberSelectable: boolean;
  khorsSelectable: boolean;
  attendKhorsSelectable: boolean;
  directJoinGrades?: string;
  directJoinFrom?: string;
  directJoinUntil?: string;
}
