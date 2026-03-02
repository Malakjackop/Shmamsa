import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class EventsService {
  private http = inject(HttpClient);
  private baseUrl = '/api/events';

  list(month: string, family: string): Observable<any[]> {
    let params = new HttpParams();
    if (month) params = params.set('month', month);
    if (family) params = params.set('family', family);

    return this.http.get<any[]>(this.baseUrl, {
      withCredentials: true,
      params
    });
  }

  create(payload: any): Observable<any> {
    return this.http.post<any>(this.baseUrl, payload, { withCredentials: true });
  }

  update(id: number, payload: any): Observable<any> {
    return this.http.put<any>(`${this.baseUrl}/${id}`, payload, { withCredentials: true });
  }

  publish(id: number): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/${id}/publish`, {}, { withCredentials: true });
  }

  delete(id: number): Observable<any> {
    return this.http.delete<any>(`${this.baseUrl}/${id}`, { withCredentials: true });
  }
}

