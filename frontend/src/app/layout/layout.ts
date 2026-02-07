import { Component, OnInit, inject, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [CommonModule, RouterModule, ToastModule],
  templateUrl: './layout.html',
  styleUrls: ['./layout.css'],
  providers: [MessageService]
})
export class LayoutComponent implements OnInit {
  private auth = inject(AuthService);
  private router = inject(Router);
  private msg = inject(MessageService);

  user: any = null;

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {}

  ngOnInit(): void {
    // ✅ SSR: don't call protected endpoints on the server
    if (!isPlatformBrowser(this.platformId)) return;

    this.auth.getUserData().subscribe({
      next: (u) => (this.user = u),
      error: () => this.router.navigate(['/login'])
    });
  }

  isMakhdom(): boolean {
    return this.user?.role === 'MAKHDOM';
  }

  isServantOrAbove(): boolean {
    return ['KHADIM','AMIN_OSRA','AMIN_KHEDMA','DEVELOPER'].includes(this.user?.role);
  }

  logout() {
    this.auth.logout().subscribe({
      next: () => this.router.navigate(['/login']),
      error: () => this.router.navigate(['/login'])
    });
  }
}
