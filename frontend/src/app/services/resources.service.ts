import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export type ResourceItem = {
  id: number;
  title?: string;
  description?: string;
  category?: string;
  family?: string;
  fileName?: string;
  contentType?: string;
  uploadedAt?: string;
  uploadedBy?: string;
  [key: string]: unknown;
};

export type ResourceMutationResponse = Record<string, unknown> | null;

@Injectable({ providedIn: 'root' })
export class ResourcesService {
  private http = inject(HttpClient);
  private baseUrl = '/api/resources';

  list(family?: string): Observable<ResourceItem[]> {
    let params = new HttpParams();
    if (family) params = params.set('family', family);
    return this.http.get<ResourceItem[]>(this.baseUrl, { params, withCredentials: true });
  }

  upload(data: FormData): Observable<ResourceMutationResponse> {
    return this.http.post<ResourceMutationResponse>(this.baseUrl, data, { withCredentials: true });
  }

  update(id: number, data: FormData): Observable<ResourceMutationResponse> {
    return this.http.put<ResourceMutationResponse>(`${this.baseUrl}/${id}`, data, { withCredentials: true });
  }

  delete(id: number): Observable<ResourceMutationResponse> {
    return this.http.delete<ResourceMutationResponse>(`${this.baseUrl}/${id}`, { withCredentials: true });
  }

  downloadUrl(id: number): string {
    return `${this.baseUrl}/${id}/download`;
  }
}
