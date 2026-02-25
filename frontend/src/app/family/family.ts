
import { Component, OnInit, inject } from '@angular/core';
import { FamilyService } from '../services/family.service';
import { AdminService } from '../services/admin.service';
import { AuthService } from '../services/auth.service';
import { MessageService } from 'primeng/api';
import { AttendanceService } from '../services/attendance.service';
import { ConfirmationService } from 'primeng/api';

type Member = {
  id: number;
  fullName: string;
  role: string;
  deaconFamily: string;
  address?: string;
  phoneNumber?: string;
  guardiansPhone?: string;
  // backward compatible fields (present count)
  fridayLiturgy: number;
  tasbeeha: number;
  familyMeeting: number;

  // new fields (present/total)
  fridayLiturgyPresent?: number;
  fridayLiturgyTotal?: number;
  tasbeehaPresent?: number;
  tasbeehaTotal?: number;
  familyMeetingPresent?: number;
  familyMeetingTotal?: number;
};

type AttendanceRow = {
  id: number;
  type: 'FRIDAY_LITURGY' | 'TASBEEHA' | 'FAMILY_MEETING';
  date: string;
  time?: string;
  createdAt?: string;
  status?: 'PRESENT' | 'ABSENT';
  takenBy?: { id: number; fullName: string; role: string } | null;
};

@Component({
  selector: 'app-family',
  standalone: false,
  templateUrl: './family.html',
  styleUrls: ['./family.css'],
  providers: [MessageService, ConfirmationService]
})
export class FamilyComponent implements OnInit {

  // Angular templates لا تدعم type-cast زي (t as any)،
  // فبنحط اللست دي هنا بنوع مضبوط.
  readonly allAttendanceTypes: AttendanceRow['type'][] = [
    'TASBEEHA',
    'FRIDAY_LITURGY',
    'FAMILY_MEETING'
  ];
  private familySvc = inject(FamilyService);
  private adminSvc = inject(AdminService);
  private auth = inject(AuthService);
  private message = inject(MessageService);
  private attendanceSvc = inject(AttendanceService);
  private confirmService = inject(ConfirmationService);

  selectedIds = new Set<number>();
  resetMode = false;



  me: any;
  members: Member[] = [];
  families: string[] = [];
  selectedFamily = '';
  loading = false;

  detailsFor: Member | null = null;
  details: AttendanceRow[] = [];
  detailsType: '' | 'FRIDAY_LITURGY' | 'TASBEEHA' | 'FAMILY_MEETING' = '';

  profileFor: Member | null = null;
  profile: any = null;

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
        this.resetMode = false;
        this.selectedIds.clear();
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
    this.detailsType = '';
    this.reloadDetails();
  }

  reloadDetails() {
    if (!this.detailsFor) return;
    const famParam = this.isAminKhedmaOrDev() ? this.selectedFamily : undefined;

    this.familySvc.memberAttendance(this.detailsFor.id, famParam, this.detailsType || undefined).subscribe({
      next: (d) => (this.details = this.filterOutArchivedRows((d as any) || [])),
      error: () => (this.details = [])
    });
  }

  private filterOutArchivedRows(rows: any[]): AttendanceRow[] {
    return (Array.isArray(rows) ? rows : []).filter((r) => !this.isArchivedRow(r)) as AttendanceRow[];
  }

  private isArchivedRow(row: any): boolean {
    const isTrue = (v: any) => {
      const s = String(v ?? '').trim().toLowerCase();
      return v === true || v === 1 || s === 'true' || s === 'yes' || s === 'y';
    };

    const hasArchiveRef =
      row?.archiveId !== null && row?.archiveId !== undefined && row?.archiveId !== 0;

    return (
      isTrue(row?.archived) ||
      isTrue(row?.isArchived) ||
      isTrue(row?.inArchive) ||
      isTrue(row?.isInArchive) ||
      !!row?.archive ||
      !!row?.archiveName ||
      !!row?.archivedAt ||
      !!row?.archiveDate ||
      hasArchiveRef
    );
  }

  // ===== UI helpers =====
  countLabel(m: Member, kind: 'FRIDAY_LITURGY' | 'TASBEEHA' | 'FAMILY_MEETING'): string {
    const fallbackPresent =
      kind === 'FRIDAY_LITURGY' ? m.fridayLiturgy : kind === 'TASBEEHA' ? m.tasbeeha : m.familyMeeting;

    const present =
      kind === 'FRIDAY_LITURGY'
        ? m.fridayLiturgyPresent ?? fallbackPresent
        : kind === 'TASBEEHA'
          ? m.tasbeehaPresent ?? fallbackPresent
          : m.familyMeetingPresent ?? fallbackPresent;

    const total =
      kind === 'FRIDAY_LITURGY'
        ? m.fridayLiturgyTotal
        : kind === 'TASBEEHA'
          ? m.tasbeehaTotal
          : m.familyMeetingTotal;

    if (total == null) return String(present ?? 0);
    return `${present ?? 0}/${total}`;
  }

  titleForType(t: AttendanceRow['type']): string {
    if (t === 'TASBEEHA') return 'تسبحة';
    if (t === 'FRIDAY_LITURGY') return 'قداس الجمعة';
    return 'اجتماع الأسرة';
  }

  filteredDetails(t: AttendanceRow['type']): AttendanceRow[] {
    return (this.details || []).filter((d) => d?.type === t);
  }

  closeDetails() {
    this.detailsFor = null;
    this.details = [];
    this.detailsType = '';
  }

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
        address: m.address,
        phoneNumber: m.phoneNumber,
        guardiansPhone: m.guardiansPhone,
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
        m.address || '',
        m.phoneNumber || '',
        m.guardiansPhone || '',
        String(m.fridayLiturgy),
        String(m.tasbeeha),
        String(m.familyMeeting)
      ]);
      

      autoTable(doc, {
        head: [['Name', 'Role', 'Address', 'Phone', "Father's phone", 'Friday Liturgy', 'Tasbeeha', 'Family Meeting']],
        body
      });

      doc.save(`family_${this.selectedFamily || 'my'}_members.pdf`);
    } catch {
      this.message.add({ severity: 'error', summary: 'Export failed', detail: 'PDF export failed' });
    }
  }
  onResetButton() {
  // أول ضغطة: فعّل وضع الاختيار واظهر الـ checkboxes
  if (!this.resetMode) {
    this.resetMode = true;
    this.selectedIds.clear();
    this.message.add({ severity: 'info', summary: 'Select members', detail: 'اختار الناس اللي عايز تصفّر حضورهم' });
    return;
  }

  // تاني ضغطة (بعد ما تختار): نفّذ reset
  this.resetAttendance();
}

cancelResetMode() {
  this.resetMode = false;
  this.selectedIds.clear();
}

isSelected(id: number): boolean {
  return this.selectedIds.has(id);
}

get allSelected(): boolean {
  return this.members?.length > 0 && this.members.every((m) => this.selectedIds.has(m.id));
}

toggleSelectAll(ev: any) {
  if (!this.resetMode) return;
  const checked = !!ev?.target?.checked;

  this.selectedIds.clear();
  if (checked) {
    for (const m of this.members) this.selectedIds.add(m.id);
  }
}

toggleSelectOne(member: Member, ev: any) {
  if (!this.resetMode) return;
  const checked = !!ev?.target?.checked;

  if (checked) this.selectedIds.add(member.id);
  else this.selectedIds.delete(member.id);
}

resetAttendance() {
  const ids = Array.from(this.selectedIds);
  if (ids.length === 0) {
    this.message.add({ severity: 'warn', summary: 'No selection', detail: 'اختار عضو واحد على الأقل' });
    return;
  }

  this.confirmService.confirm({
    header: 'Confirm Reset',
    icon: 'pi pi-exclamation-triangle',
    message: `هل أنت متأكد؟ سيتم مسح كل سجل الحضور (قداس/تسبحة/اجتماع) لـ ${ids.length} عضو.`,
    acceptLabel: 'Confirm',
    rejectLabel: 'Cancel',
    accept: () => {
      this.attendanceSvc.resetAttendance(ids).subscribe({
        next: () => {
          this.message.add({ severity: 'success', summary: 'Done', detail: 'Attendance reset successfully' });
          this.resetMode = false;
          this.selectedIds.clear();
          this.loadMembers();
        },
        error: (err) => {
          this.message.add({
            severity: 'error',
            summary: 'Reset failed',
            detail: err?.error?.message || err?.error?.error || 'Failed'
          });
        }
      });
    }
  });
}
}
