import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export type EventAudience = 'EVERYONE' | 'SERVANTS_ONLY';

export type BoardEvent = {
  id?: number | null;
  title?: string;
  description?: string | null;
  eventAt?: string | Date | null;
  removeAt?: string | Date | null;
  targetFamily?: string;
  targetAudience?: EventAudience | string;
  status?: string;
  publishedAt?: string | null;
  createdAt?: string | null;
  joinCount?: number;
  joined?: boolean;
  canPublish?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  canSeeParticipants?: boolean;
};

export type BoardAnnouncement = {
  id?: number | null;
  title?: string;
  description?: string | null;
  targetFamily?: string;
  targetAudience?: EventAudience | string;
  status?: string;
  publishedAt?: string | null;
  createdAt?: string | null;
  canPublish?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
};

export type BoardParticipantMember = {
  id?: number;
  fullName?: string;
  familyName?: string;
  role?: string | number;
  [key: string]: unknown;
};

export type BoardParticipantGroup = {
  family: string;
  members: BoardParticipantMember[];
};

export type BoardItemPayload = {
  title: string;
  description: string | null;
  targetFamily: string;
  targetFamilyId: number | null;
  targetAudience: string;
};

export type BoardEventPayload = BoardItemPayload & {
  eventAt: string | null;
  removeAt: string | null;
};

@Injectable({ providedIn: 'root' })
export class BoardService {
  private http = inject(HttpClient);

  listEvents(month: string, family?: string, audience?: string): Observable<BoardEvent[]> {
    let params = new HttpParams().set('month', month);
    if (family) params = params.set('family', family);
    if (audience) params = params.set('audience', audience);
    return this.http.get<BoardEvent[]>('/api/events', { params, withCredentials: true });
  }

  createEvent(payload: BoardEventPayload): Observable<unknown> {
    return this.http.post('/api/events', payload, { withCredentials: true });
  }

  updateEvent(id: number, payload: BoardEventPayload): Observable<unknown> {
    return this.http.put(`/api/events/${id}`, payload, { withCredentials: true });
  }

  publishEvent(id: number): Observable<unknown> {
    return this.http.post(`/api/events/${id}/publish`, {}, { withCredentials: true });
  }

  deleteEvent(id: number): Observable<unknown> {
    return this.http.delete(`/api/events/${id}`, { withCredentials: true });
  }

  joinEvent(id: number): Observable<unknown> {
    return this.http.post(`/api/events/${id}/join`, {}, { withCredentials: true });
  }

  unjoinEvent(id: number): Observable<unknown> {
    return this.http.delete(`/api/events/${id}/join`, { withCredentials: true });
  }

  participants(id: number): Observable<BoardParticipantGroup[]> {
    return this.http.get<BoardParticipantGroup[]>(`/api/events/${id}/participants`, { withCredentials: true });
  }

  listAnnouncements(family?: string, audience?: string): Observable<BoardAnnouncement[]> {
    let params = new HttpParams();
    if (family) params = params.set('family', family);
    if (audience) params = params.set('audience', audience);
    return this.http.get<BoardAnnouncement[]>('/api/announcements', { params, withCredentials: true });
  }

  createAnnouncement(payload: BoardItemPayload): Observable<unknown> {
    return this.http.post('/api/announcements', payload, { withCredentials: true });
  }

  updateAnnouncement(id: number, payload: BoardItemPayload): Observable<unknown> {
    return this.http.put(`/api/announcements/${id}`, payload, { withCredentials: true });
  }

  publishAnnouncement(id: number): Observable<unknown> {
    return this.http.post(`/api/announcements/${id}/publish`, {}, { withCredentials: true });
  }

  deleteAnnouncement(id: number): Observable<unknown> {
    return this.http.delete(`/api/announcements/${id}`, { withCredentials: true });
  }
}
