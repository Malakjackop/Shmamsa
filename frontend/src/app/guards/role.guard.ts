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

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Observable<boolean | UrlTree> | boolean | UrlTree {

    // ✅ SSR: allow render; browser will enforce after hydration
    if (!isPlatformBrowser(this.platformId)) {
      return true;
    }

    const allowed = (route.data?.['roles'] as string[]) || [];

    return this.authService.getUserData().pipe(
      map(user => {
        const role = user?.role;
        if (!role) {
          return this.router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
        }
        if (allowed.length === 0 || allowed.includes(role)) {
          return true;
        }
        return this.router.createUrlTree(['/dashboard']);
      }),
      catchError(() => of(this.router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } })))
    );
  }
}
