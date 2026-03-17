import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ActivatedRouteSnapshot, CanActivate, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';

@Injectable({
  providedIn: 'root'
})
export class RoleGuard implements CanActivate {
  constructor(
    private authService: AuthService,
    private router: Router,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {}

  private normRole(v: any): string {
    const raw = String(v || '').trim();
    const up = raw.toUpperCase();
    if (!up) return '';
    if (['امين اسرة','امين الاسرة','أمين أسرة','أمين الاسرة','امين الأسرة','أمين الأسرة','امين اسرة'].includes(raw)) return 'AMIN_OSRA';
    if (['امين الخدمة','امين الخدمه','أمين الخدمة','أمين الخدمه','امين خدمه','أمين خدمه'].includes(raw)) return 'AMIN_KHEDMA';
    if (up.startsWith('ROLE_')) return up.substring(5);
    return up;
  }

  private scopedRoles(user: any): string[] {
    const assignments = Array.isArray(user?.familyAssignments) ? user.familyAssignments : [];
    return assignments.map((x: any) => this.normRole(x?.role)).filter(Boolean);
  }

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Observable<boolean | UrlTree> | boolean | UrlTree {

    // ✅ SSR: allow render; browser will enforce after hydration
    if (!isPlatformBrowser(this.platformId)) {
      return true;
    }

    const allowedRaw = (route.data?.['roles'] as string[]) || [];
    const allowed = allowedRaw.map((x: any) => String(x||'').trim().toUpperCase().replace(/^ROLE_/, ''));

    return this.authService.getUserData().pipe(
      map(user => {
        const role = this.normRole(user?.role);
        if (!role) {
          return this.router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
        }
        if (allowed.length === 0 || allowed.includes(role)) {
          return true;
        }

        const scopedRoles = this.scopedRoles(user);

        if (allowed.includes('AMIN_OSRA') && scopedRoles.includes('AMIN_OSRA')) {
          return true;
        }
        return this.router.createUrlTree(['/dashboard']);
      }),
      catchError(() => of(this.router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } })))
    );
  }
}

