
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export type AdminMutationResponse = Record<string, unknown> | null;

@Injectable({ providedIn: 'root' })
export class AdminService {
  private http = inject(HttpClient);
  private baseUrl = '/api/admin';

  roles(): Observable<string[]> {
    return this.http.get<string[]>(`${this.baseUrl}/roles`, { withCredentials: true });
  }

  changeRole(userId: number, newRole: string): Observable<AdminMutationResponse> {
    return this.http.post<AdminMutationResponse>(
      `${this.baseUrl}/change-role`,
      { userId, newRole },
      { withCredentials: true }
    );
  }
}
