
import { Component, OnInit, inject } from '@angular/core';
import { FamilyService } from '../services/family.service';
import { AdminService } from '../services/admin.service';
import { AuthService } from '../services/auth.service';
import { MessageService } from 'primeng/api';

type Member = {
  id: number;
  fullName: string;
  role: string;
  deaconFamily: string;
  fridayLiturgy: number;
  tasbeeha: number;
  familyMeeting: number;
};

@Component({
  selector: 'app-family',
  standalone: false,
  templateUrl: './family.html',
  styleUrls: ['./family.css'],
  providers: [MessageService]
})
export class FamilyComponent implements OnInit {
  private familySvc = inject(FamilyService);
  private adminSvc = inject(AdminService);
  private auth = inject(AuthService);
  private message = inject(MessageService);

  me: any;
  members: Member[] = [];
  families: string[] = [];
  selectedFamily = '';
  loading = false;

  detailsFor: Member | null = null;
  details: any[] = [];

  allRoles: string[] = [];

  ngOnInit() {
    this.auth.getUserData().subscribe({
      next: (u) => {
        this.me = u;
        this.loadRoles();
        this.initFamilyMode();
      },
      error: () => {}
    });
  }

  isAminKhedmaOrDev(): boolean {
    return this.me?.role === 'AMIN_KHEDMA' || this.me?.role === 'DEVELOPER';
  }

  canEditRoles(): boolean {
    return this.isAminKhedmaOrDev();
  }

  private initFamilyMode() {
    if (this.isAminKhedmaOrDev()) {
      this.familySvc.families().subscribe({
        next: (f) => {
          this.families = f || [];
          if (this.families.length) {
            this.selectedFamily = this.families[0];
            this.loadMembers();
          }
        },
        error: () => {}
      });
    } else {
      this.selectedFamily = this.me?.deaconFamily;
      this.loadMembers();
    }
  }

  loadMembers() {
    this.loading = true;
    const famParam = this.isAminKhedmaOrDev() ? this.selectedFamily : undefined;

    this.familySvc.members(famParam).subscribe({
      next: (m) => {
        this.members = (m as any) || [];
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.message.add({ severity: 'error', summary: 'Error', detail: err?.error?.error || 'Failed to load' });
      }
    });
  }

  openDetails(member: Member) {
    this.detailsFor = member;
    const famParam = this.isAminKhedmaOrDev() ? this.selectedFamily : undefined;

    this.familySvc.memberAttendance(member.id, famParam).subscribe({
      next: (d) => (this.details = d || []),
      error: () => (this.details = [])
    });
  }

  closeDetails() {
    this.detailsFor = null;
    this.details = [];
  }

  private loadRoles() {
    if (!this.canEditRoles()) return;
    this.adminSvc.roles().subscribe({ next: (r) => (this.allRoles = r || []) });
  }

  changeRole(member: Member, newRole: string) {
    if (!this.canEditRoles()) return;

    this.adminSvc.changeRole(member.id, newRole).subscribe({
      next: () => {
        this.message.add({ severity: 'success', summary: 'Updated', detail: 'Role updated' });
        member.role = newRole;
      },
      error: (err) => {
        this.message.add({ severity: 'error', summary: 'Error', detail: err?.error?.error || 'Failed' });
      }
    });
  }

  async exportExcel() {
    try {
      const XLSX = await import('xlsx');
      const rows = this.members.map((m) => ({
        fullName: m.fullName,
        role: m.role,
        deaconFamily: m.deaconFamily,
        fridayLiturgy: m.fridayLiturgy,
        tasbeeha: m.tasbeeha,
        familyMeeting: m.familyMeeting
      }));

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Members');
      XLSX.writeFile(wb, `family_${this.selectedFamily || 'my'}_members.xlsx`);
    } catch (e) {
      this.message.add({ severity: 'error', summary: 'Export failed', detail: 'Excel export failed' });
    }
  }

  async exportPdf() {
    try {
      const jsPDF = (await import('jspdf')).default;
      const autoTable = (await import('jspdf-autotable')).default;

      const doc = new jsPDF();
      doc.text(`Family: ${this.selectedFamily || ''}`, 14, 14);

      const body = this.members.map((m) => [
        m.fullName,
        m.role,
        String(m.fridayLiturgy),
        String(m.tasbeeha),
        String(m.familyMeeting)
      ]);

      autoTable(doc, {
        head: [['Name', 'Role', 'Friday Liturgy', 'Tasbeeha', 'Family Meeting']],
        body
      });

      doc.save(`family_${this.selectedFamily || 'my'}_members.pdf`);
    } catch {
      this.message.add({ severity: 'error', summary: 'Export failed', detail: 'PDF export failed' });
    }
  }
}
