import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ResourcesService {
  private http = inject(HttpClient);
  private baseUrl = '/api/resources';

  list(family?: string): Observable<any[]> {
    let params = new HttpParams();
    if (family) params = params.set('family', family);
    return this.http.get<any[]>(this.baseUrl, { params, withCredentials: true });
  }

  upload(data: FormData): Observable<any> {
    return this.http.post<any>(this.baseUrl, data, { withCredentials: true });
  }

  update(id: number, data: FormData): Observable<any> {
    return this.http.put<any>(`${this.baseUrl}/${id}`, data, { withCredentials: true });
  }

  delete(id: number): Observable<any> {
    return this.http.delete<any>(`${this.baseUrl}/${id}`, { withCredentials: true });
  }

  downloadUrl(id: number): string {
    return `${this.baseUrl}/${id}/download`;
  }
}
