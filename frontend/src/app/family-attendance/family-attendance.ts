import { Component, OnInit, inject } from '@angular/core';
import { FamilyService } from '../services/family.service';
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
  selector: 'app-family-attendance',
  standalone: false,
  templateUrl: './family-attendance.html',
  styleUrls: ['./family-attendance.css'],
  providers: [MessageService]
})
export class FamilyAttendanceComponent implements OnInit {
  private familySvc = inject(FamilyService);
  private auth = inject(AuthService);
  private message = inject(MessageService);

  me: any;
  members: Member[] = [];
  families: string[] = [];
  selectedFamily = '';
  loading = false;

  // attendance details modal
  detailsFor: Member | null = null;
  details: any[] = [];
  detailsType: '' | 'FRIDAY_LITURGY' | 'TASBEEHA' | 'FAMILY_MEETING' = '';

  // profile modal
  profileFor: Member | null = null;
  profile: any = null;


  ngOnInit() {
    this.auth.getUserData().subscribe({
      next: (u) => {
        this.me = u;
        this.initFamilyMode();
      },
      error: () => {}
    });
  }

  isAminKhedmaOrDev(): boolean {
    return this.me?.role === 'AMIN_KHEDMA' || this.me?.role === 'DEVELOPER';
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

  // ===== Attendance details =====
  openDetails(member: Member) {
    this.detailsFor = member;
    this.detailsType = '';
    this.reloadDetails();
  }

  reloadDetails() {
    if (!this.detailsFor) return;
    const famParam = this.isAminKhedmaOrDev() ? this.selectedFamily : undefined;

    this.familySvc.memberAttendance(this.detailsFor.id, famParam, this.detailsType || undefined).subscribe({
      next: (d) => (this.details = d || []),
      error: () => (this.details = [])
    });
  }

  closeDetails() {
    this.detailsFor = null;
    this.details = [];
    this.detailsType = '';
  }

  // ===== Profile =====
  openProfile(member: Member) {
    this.profileFor = member;
    this.profile = null;
    const famParam = this.isAminKhedmaOrDev() ? this.selectedFamily : undefined;

    this.familySvc.memberDetails(member.id, famParam).subscribe({
      next: (p) => (this.profile = p),
      error: () => (this.profile = null)
    });
  }

  closeProfile() {
    this.profileFor = null;
    this.profile = null;
  }

  // ===== Export =====
  async exportExcel() {
    try {
      const XLSX = await import('xlsx');
      const rows = this.members.map((m) => ({
        fullName: m.fullName,
        deaconFamily: m.deaconFamily,
        fridayLiturgy: m.fridayLiturgy,
        tasbeeha: m.tasbeeha,
        familyMeeting: m.familyMeeting
      }));

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Attendance');
      XLSX.writeFile(wb, `family_${this.selectedFamily || 'my'}_attendance.xlsx`);
    } catch {
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
        String(m.fridayLiturgy),
        String(m.tasbeeha),
        String(m.familyMeeting)
      ]);

      autoTable(doc, {
        head: [['Name', 'Friday Liturgy', 'Tasbeeha', 'Family Meeting']],
        body
      });

      doc.save(`family_${this.selectedFamily || 'my'}_attendance.pdf`);
    } catch {
      this.message.add({ severity: 'error', summary: 'Export failed', detail: 'PDF export failed' });
    }
  }

}
