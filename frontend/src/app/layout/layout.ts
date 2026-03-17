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
  this.auth.getUserData(true).subscribe({
    next: (u) => this.user = u,
    error: () => this.user = null
  });
}



  /** Normalize role values coming from backend (supports ROLE_*, and Arabic labels). */
  private normRole(v: any): string {
    const raw = String(v ?? '').trim();
    if (!raw) return '';
    const upper = raw.toUpperCase();

    // Arabic variants
    const ar = raw.replace(/\s+/g, ' ').trim();
    if (
      [
        'امين اسرة',
        'امين الاسرة',
        'أمين أسرة',
        'أمين الاسرة',
        'امين الأسرة',
        'أمين الأسرة',
        'امين اسرة'
      ].includes(ar)
    )
      return 'AMIN_OSRA';
    if (
      [
        'امين الخدمة',
        'امين الخدمه',
        'أمين الخدمة',
        'أمين الخدمه',
        'امين خدمه',
        'أمين خدمه'
      ].includes(ar)
    )
      return 'AMIN_KHEDMA';

    if (upper.startsWith('ROLE_')) return upper.substring(5);
    return upper;
  }

  /** True if user has AMIN_OSRA on any assigned family slot (scoped). */
  private hasAnyAminOsraScope(): boolean {
    const roles = Array.isArray(this.user?.familyAssignments)
      ? this.user.familyAssignments.map((x: any) => this.normRole(x?.role))
      : [];
    return roles.includes('AMIN_OSRA');
  }

  isServantOrAbove(): boolean {
    const r = this.normRole(this.user?.role);
    return ['KHADIM', 'AMIN_OSRA', 'AMIN_KHEDMA', 'DEVELOPER'].includes(r) || this.hasAnyAminOsraScope();
  }

  isAminOsraOrAbove(): boolean {
    const r = this.normRole(this.user?.role);
    return ['AMIN_OSRA', 'AMIN_KHEDMA', 'DEVELOPER'].includes(r) || this.hasAnyAminOsraScope();
  }

  isAminKhedmaOrDev(): boolean {
    const r = this.normRole(this.user?.role);
    return ['AMIN_KHEDMA', 'DEVELOPER'].includes(r);
  }

  private servedFamiliesCount(): number {
    const families = Array.isArray(this.user?.familyAssignments)
      ? this.user.familyAssignments
          .map((x: any) => String(x?.familyName ?? '').trim())
          .filter(Boolean)
      : [];

    return new Set(families).size;
  }

  usePluralFamilyLabels(): boolean {
    return this.isAminKhedmaOrDev() || this.servedFamiliesCount() > 1;
  }


  goHome(): void {
    this.router.navigate(['/dashboard']);
  }

logout() {
  this.auth.logout().subscribe({
    next: () => this.router.navigate(['/login']),
    error: () => this.router.navigate(['/login'])
  });
}
}



