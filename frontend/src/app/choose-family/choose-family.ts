import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService, FamilyOption } from '../services/auth.service';
import { FamilyJoinRequestService } from '../services/family-join-request.service';
import { MessageService } from 'primeng/api';

@Component({
  selector: 'app-choose-family',
  standalone: false,
  templateUrl: './choose-family.html',
  styleUrls: ['./choose-family.css'],
  providers: [MessageService]
})
export class ChooseFamilyComponent implements OnInit {
  private router = inject(Router);
  private authService = inject(AuthService);
  private familyJoinReq = inject(FamilyJoinRequestService);
  private msg = inject(MessageService);

  families: FamilyOption[] = [];
  selectedFamilyId: number | null = null;
  loading = true;
  submitting = false;

  ngOnInit() {
    this.authService.getFamilyOptions('MEMBER').subscribe((list) => {
      this.families = list || [];
      this.loading = false;
    });
  }

  onFamilyChange(event: Event) {
    const val = (event.target as HTMLSelectElement).value;
    this.selectedFamilyId = val ? Number(val) : null;
  }

  selectFamily() {
    if (!this.selectedFamilyId) return;
    this.submitting = true;
    this.familyJoinReq.submitRequest(this.selectedFamilyId).subscribe({
      next: () => {
        const fam = this.families.find(x => x.id === this.selectedFamilyId);
        this.msg.add({ severity: 'success', summary: 'تم', detail: `تم إرسال طلب الانضمام لأسرة ${fam?.nameAr || ''}` });
        setTimeout(() => this.router.navigate(['/login']), 1500);
      },
      error: (err) => {
        this.submitting = false;
        this.msg.add({ severity: 'error', summary: 'خطأ', detail: err?.error?.message || 'فشل إرسال الطلب' });
      }
    });
  }

  logout() {
    this.authService.logout().subscribe(() => this.router.navigate(['/login']));
  }
}
