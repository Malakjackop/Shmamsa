import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { BoardEvent, BoardEventPayload } from './board.service';

@Injectable({
  providedIn: 'root'
})
export class EventsService {
  private http = inject(HttpClient);
  private baseUrl = '/api/events';

  list(month: string, family: string): Observable<BoardEvent[]> {
    let params = new HttpParams();
    if (month) params = params.set('month', month);
    if (family) params = params.set('family', family);

    return this.http.get<BoardEvent[]>(this.baseUrl, {
      withCredentials: true,
      params
    });
  }

  create(payload: BoardEventPayload): Observable<unknown> {
    return this.http.post(this.baseUrl, payload, { withCredentials: true });
  }

  update(id: number, payload: BoardEventPayload): Observable<unknown> {
    return this.http.put(`${this.baseUrl}/${id}`, payload, { withCredentials: true });
  }

  publish(id: number): Observable<unknown> {
    return this.http.post(`${this.baseUrl}/${id}/publish`, {}, { withCredentials: true });
  }

  delete(id: number): Observable<unknown> {
    return this.http.delete(`${this.baseUrl}/${id}`, { withCredentials: true });
  }
}

