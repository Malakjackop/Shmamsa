import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { isPlatformBrowser } from '@angular/common';
import { Observable, of } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { catchError, filter, map } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class AuthGuard implements CanActivate {

  constructor(
    private authService: AuthService,
    private router: Router,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {}

  canActivate(): Observable<boolean | UrlTree> | boolean {

    // ✅ SSR: اسمح بالتحميل، متقررّش Auth هنا
    if (!isPlatformBrowser(this.platformId)) {
      return true;
    }

    return this.authService.getUserData().pipe(

      // ✅ تجاهل أول null (loading state)
      filter(user => user !== undefined),

      map(user => {
        if (user) {
          return true;
        }
        return this.router.createUrlTree(['/login']);
      }),

      // ✅ لو API رجعت 401/403
      catchError(() => of(this.router.createUrlTree(['/login'])))
    );
  }
}
