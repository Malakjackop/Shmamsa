import { Component, OnInit, OnDestroy, inject, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import { assignmentRolesOf, normalizeRole } from '../shared/role-utils';
import { filter, Subscription } from 'rxjs';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [CommonModule, RouterModule, ToastModule],
  templateUrl: './layout.html',
  styleUrls: ['./layout.css'],
  providers: [MessageService]
})
export class LayoutComponent implements OnInit, OnDestroy {
  private auth = inject(AuthService);
  private router = inject(Router);
  private msg = inject(MessageService);
  private routerSub?: Subscription;

  user: any = null;
  isMobileMenuOpen = false;
  activeDropdown: string | null = null;

ngOnInit(): void {
  this.auth.getUserData(true).subscribe({
    next: (u) => this.user = u,
    error: () => this.user = null
  });

  this.routerSub = this.router.events.pipe(
    filter(event => event instanceof NavigationEnd)
  ).subscribe(() => this.closeMobileMenu());
}

ngOnDestroy(): void {
  this.routerSub?.unsubscribe();
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

  canOpenAttendance(): boolean {
    return this.isServantOrAbove() || !!this.user?.canOpenAttendance;
  }

  canOpenFamilyTools(): boolean {
    return this.isServantOrAbove();
  }

  isAminOsraOrAbove(): boolean {
    const r = normalizeRole(this.user?.role);
    return ['AMIN_OSRA', 'AMIN_KHEDMA', 'DEVELOPER'].includes(r) || this.hasAnyAminOsraScope();
  }

  isAminKhedmaOrDev(): boolean {
    const r = normalizeRole(this.user?.role);
    return ['AMIN_KHEDMA', 'DEVELOPER'].includes(r);
  }

  isDeveloper(): boolean {
    const r = normalizeRole(this.user?.role);
    return r === 'DEVELOPER';
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

  toggleDropdown(name: string): void {
    this.activeDropdown = this.activeDropdown === name ? null : name;
  }

  closeDropdowns(): void {
    this.activeDropdown = null;
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.closeDropdowns();
  }

  toggleMobileMenu(): void {
    this.isMobileMenuOpen = !this.isMobileMenuOpen;
    document.body.style.overflow = this.isMobileMenuOpen ? 'hidden' : '';
  }

  closeMobileMenu(): void {
    this.isMobileMenuOpen = false;
    document.body.style.overflow = '';
  }

logout() {
  this.closeMobileMenu();
  this.auth.logout().subscribe({
    next: () => this.router.navigate(['/login']),
    error: () => this.router.navigate(['/login'])
  });
}
}



