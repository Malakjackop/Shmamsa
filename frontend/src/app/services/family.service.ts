
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class FamilyService {
  private http = inject(HttpClient);
  private baseUrl = '/api/family';

  families(): Observable<string[]> {
    return this.http.get<string[]>(`${this.baseUrl}/families`, { withCredentials: true });
  }

  /**
   * Fetch members for a family.
   * @param family optional family base name
   * @param includeSelf when true, the backend will include the logged-in user in the list
   */
  members(family?: string, includeSelf: boolean = false): Observable<any[]> {
    let params = new HttpParams();
    if (family) params = params.set('family', family);
    if (includeSelf) params = params.set('includeSelf', 'true');
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


  transferMembers(memberIds: number[], newFamily: string): Observable<any> {
    return this.http.post<any>(
      `${this.baseUrl}/transfer-members`,
      { memberIds, newFamily },
      { withCredentials: true }
    );
  }
}
