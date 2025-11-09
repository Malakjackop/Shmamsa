import { Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { Observable, of } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { catchError, map } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class AuthGuard implements CanActivate {
  constructor(private authService: AuthService, private router: Router) {}

  canActivate():
    | Observable<boolean | UrlTree>
    | Promise<boolean | UrlTree>
    | boolean
    | UrlTree {
    // ✅ Try to fetch the current user (protected endpoint)
    return this.authService.getUserData().pipe(
      map(user => {
        if (user && user.username) {
          return true; // ✅ Authorized
        } else {
          this.router.navigate(['/login']);
          return false;
        }
      }),
      catchError(() => {
        // ❌ Invalid or expired JWT
        this.router.navigate(['/login']);
        return of(false);
      })
    );
  }
}
