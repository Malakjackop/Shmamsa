import { Component, OnInit, inject, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import { assignmentRolesOf, normalizeRole } from '../shared/role-utils';

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
  isSidebarCollapsed = false;

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {}

ngOnInit(): void {
  if (isPlatformBrowser(this.platformId)) {
    this.isSidebarCollapsed = localStorage.getItem('layout.sidebar.collapsed') === 'true';
  }
  this.auth.getUserData(true).subscribe({
    next: (u) => this.user = u,
    error: () => this.user = null
  });
}
  /** True if user has AMIN_OSRA on any assigned family slot (scoped). */
  private hasAnyAminOsraScope(): boolean {
    const roles = assignmentRolesOf(this.user);
    return roles.includes('AMIN_OSRA');
  }

  isServantOrAbove(): boolean {
    const r = normalizeRole(this.user?.role);
    return ['KHADIM', 'AMIN_OSRA', 'AMIN_KHEDMA', 'DEVELOPER'].includes(r) || this.hasAnyAminOsraScope();
  }

  isAminOsraOrAbove(): boolean {
    const r = normalizeRole(this.user?.role);
    return ['AMIN_OSRA', 'AMIN_KHEDMA', 'DEVELOPER'].includes(r) || this.hasAnyAminOsraScope();
  }

  isAminKhedmaOrDev(): boolean {
    const r = normalizeRole(this.user?.role);
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

  toggleSidebar(): void {
    this.isSidebarCollapsed = !this.isSidebarCollapsed;
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem('layout.sidebar.collapsed', String(this.isSidebarCollapsed));
    }
  }

logout() {
  this.auth.logout().subscribe({
    next: () => this.router.navigate(['/login']),
    error: () => this.router.navigate(['/login'])
  });
}
}



