
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class FamilyService {
  private http = inject(HttpClient);
  private baseUrl = '/api/family';
  private khorsUrl = '/api/khors';

  families(context?: string): Observable<string[]> {
    let params = new HttpParams();
    if (context) params = params.set('context', context);
    return this.http.get<string[]>(`${this.baseUrl}/families`, { params, withCredentials: true });
  }

  /**
   * Fetch members for a family.
   * @param family optional family base name
   * @param includeSelf when true, the backend will include the logged-in user in the list
   */
  members(family?: string, includeSelf: boolean = false, context?: string): Observable<any[]> {
    let params = new HttpParams();
    if (family) params = params.set('family', family);
    if (includeSelf) params = params.set('includeSelf', 'true');
    if (context) params = params.set('context', context);
    return this.http.get<any[]>(`${this.baseUrl}/members`, { params, withCredentials: true });
  }

  search(name: string, family?: string): Observable<any[]> {
  let params = new HttpParams().set('name', name || '');
  if (family) params = params.set('family', family);
  return this.http.get<any[]>(`${this.baseUrl}/search`, { params, withCredentials: true });
  }


  memberAttendance(id: number, family?: string, type?: string): Observable<any[]> {
    let params = new HttpParams();
    if (family) params = params.set('family', family);
    if (type) params = params.set('type', type);
    return this.http.get<any[]>(`${this.baseUrl}/members/${id}/attendance`, { params, withCredentials: true });
  }

  memberDetails(id: number, family?: string): Observable<any> {
    let params = new HttpParams();
    if (family) params = params.set('family', family);
    return this.http.get<any>(`${this.baseUrl}/members/${id}`, { params, withCredentials: true });
  }

  deleteMember(id: number): Observable<any> {
    return this.http.delete<any>(`${this.baseUrl}/members/${id}`, { withCredentials: true });
  }


  transferMembers(memberIds: number[], newFamily: string, targetRole?: string, extraFamilies?: string[]): Observable<any> {
    return this.http.post<any>(
      `${this.baseUrl}/transfer-members`,
      { memberIds, newFamily, targetRole, extraFamilies },
      { withCredentials: true }
    );
  }

  /** Remove a member from a choir (Marmarkos / Athanasius). */
  removeFromKhors(memberId: number, khorsLabel: string): Observable<any> {
    let params = new HttpParams().set('khors', khorsLabel);
    return this.http.delete<any>(`${this.khorsUrl}/members/${memberId}`, { params, withCredentials: true });
  }
}
