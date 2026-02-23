import { Component, OnInit, inject } from '@angular/core';
import { FamilyService } from '../services/family.service';
import { AuthService } from '../services/auth.service';
import { MessageService } from 'primeng/api';

type Member = {
  id: number;
  fullName: string;
  role: string;
  deaconFamily: string;
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

  /** UI selection for export */
  selected?: boolean;
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
  selector: 'app-family-attendance',
  standalone: false,
  templateUrl: './family-attendance.html',
  styleUrls: ['./family-attendance.css'],
  providers: [MessageService]
})
export class FamilyAttendanceComponent implements OnInit {

  // Angular templates لا تدعم type-cast زي (t as any)،
  // فبنحط اللست دي هنا بنوع مضبوط.
  readonly allAttendanceTypes: AttendanceRow['type'][] = [
    'TASBEEHA',
    'FRIDAY_LITURGY',
    'FAMILY_MEETING'
  ];
  private familySvc = inject(FamilyService);
  private auth = inject(AuthService);
  private message = inject(MessageService);

  me: any;
  members: Member[] = [];
  families: string[] = [];
  selectedFamily = '';
  loading = false;

  // export selection mode
  exportMode = false;
  pendingExport: 'excel' | 'pdf' | '' = '';
  selectAll = false;

  // attendance details modal
  detailsFor: Member | null = null;
  details: AttendanceRow[] = [];
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
  

toggleSelectAll() {
  this.members.forEach((m) => (m.selected = this.selectAll));
}

onMemberSelectionChange() {
  const any = this.members.some((m) => !!m.selected);
  if (!any) {
    this.selectAll = false;
    return;
  }
  this.selectAll = this.members.every((m) => !!m.selected);
}

private getSelectedMembers(): Member[] {
  return (this.members || []).filter((m) => !!m.selected);
}

private async fetchDetailsForMembers(members: Member[], famParam?: string): Promise<any[]> {
  const { firstValueFrom } = await import('rxjs');
  const arr: any[] = [];
  for (const m of members) {
    try {
      arr.push(await firstValueFrom(this.familySvc.memberDetails(m.id, famParam)));
    } catch {
      arr.push({});
    }
  }
  return arr;
}

private async fetchAttendanceForMembers(members: Member[], famParam?: string): Promise<AttendanceRow[][]> {
  const { firstValueFrom } = await import('rxjs');
  const out: AttendanceRow[][] = [];
  for (const m of members) {
    try {
      const rows = await firstValueFrom(this.familySvc.memberAttendance(m.id, famParam));
      out.push(((rows as any) || []) as AttendanceRow[]);
    } catch {
      out.push([]);
    }
  }
  return out;
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
      next: (d) => (this.details = (d as any) || []),
      error: () => (this.details = [])
    });
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

    // لو التوتال مش موجود لسه (قبل تحديث الباك), اعرض الرقم القديم بس
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
  // 1st click -> enter selection mode
  if (!this.exportMode) {
    this.exportMode = true;
    this.pendingExport = 'excel';
    this.message.add({ severity: 'info', summary: 'Select members', detail: 'اختر الأكونتات ثم اضغط Export Excel مرة أخرى' });
    return;
  }

  // in selection mode but another export is pending
  if (this.pendingExport && this.pendingExport !== 'excel') {
    this.pendingExport = 'excel';
    this.message.add({ severity: 'info', summary: 'Select members', detail: 'اختر الأكونتات ثم اضغط Export Excel مرة أخرى' });
    return;
  }

  try {
    const XLSX = await import('xlsx');

    const selected = this.getSelectedMembers();
    if (!selected.length) {
      this.message.add({ severity: 'warn', summary: 'Select members', detail: 'اختر على الأقل عضو واحد' });
      return;
    }

    const famParam = this.isAminKhedmaOrDev() ? this.selectedFamily : undefined;
    const detailsArr = await this.fetchDetailsForMembers(selected, famParam);
    const attArr = await this.fetchAttendanceForMembers(selected, famParam);

    // One row per attendance record (present/absent) with full member info.
    const rows: any[] = [];
    selected.forEach((m, idx) => {
      const d = detailsArr[idx] || {};
      const fam = (d.deaconFamily ?? m.deaconFamily) || '';
      const phone = d.phoneNumber ?? '';
      const records = attArr[idx] || [];

      if (!records.length) {
        rows.push({
          Name: m.fullName,
          Role: m.role,
          Family: fam,
          Phone: phone,
          Type: '',
          EventDate: '',
          Status: '',
          RecordedAt: '',
          TakenBy: ''
        });
        return;
      }

      records.forEach((r) => {
        rows.push({
          Name: m.fullName,
          Role: m.role,
          Family: fam,
          Phone: phone,
          Type: r.type,
          EventDate: r.date || '',
          Status: r.status || '',
          RecordedAt: r.createdAt || '',
          TakenBy: r.takenBy?.fullName ? `${r.takenBy.fullName} (${r.takenBy.role || ''})` : ''
        });
      });
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Records');
    XLSX.writeFile(wb, 'members_attendance.xlsx');

    // reset export mode after success
    this.exportMode = false;
    this.pendingExport = '';
    this.selectAll = false;
    this.members.forEach((m) => (m.selected = false));
  } catch {
    this.message.add({ severity: 'error', summary: 'Export failed', detail: 'Excel export failed' });
  }
}


  
async exportPdf() {
  // 1st click -> enter selection mode
  if (!this.exportMode) {
    this.exportMode = true;
    this.pendingExport = 'pdf';
    this.message.add({ severity: 'info', summary: 'Select members', detail: 'اختر الأكونتات ثم اضغط Export PDF مرة أخرى' });
    return;
  }

  if (this.pendingExport && this.pendingExport !== 'pdf') {
    this.pendingExport = 'pdf';
    this.message.add({ severity: 'info', summary: 'Select members', detail: 'اختر الأكونتات ثم اضغط Export PDF مرة أخرى' });
    return;
  }

  try {
    const jsPDF = (await import('jspdf')).default;
    const autoTable = (await import('jspdf-autotable')).default;

    const selected = this.getSelectedMembers();
    if (!selected.length) {
      this.message.add({ severity: 'warn', summary: 'Select members', detail: 'اختر على الأقل عضو واحد' });
      return;
    }

    const famParam = this.isAminKhedmaOrDev() ? this.selectedFamily : undefined;
    const detailsArr = await this.fetchDetailsForMembers(selected, famParam);
    const attArr = await this.fetchAttendanceForMembers(selected, famParam);

    // NOTE: jsPDF default fonts do not render Arabic correctly.
    // Keep PDF labels in English to avoid garbled output.
    const doc = new jsPDF({ orientation: 'landscape' });
    doc.setFontSize(14);
    doc.text('Members Attendance (details)', 14, 14);
    doc.setFontSize(10);

    let y = 20;
    for (let idx = 0; idx < selected.length; idx++) {
      const m = selected[idx];
      const d = detailsArr[idx] || {};
      const fam = (d.deaconFamily ?? m.deaconFamily) || '';
      const phone = d.phoneNumber || '';
      const records = attArr[idx] || [];

      doc.setFontSize(12);
      doc.text(`${m.fullName} (${m.role})`, 14, y);
      y += 6;
      doc.setFontSize(10);
      doc.text(`Family: ${fam}`, 14, y);
      doc.text(`Phone: ${phone}`, 120, y);
      y += 4;

      const body = (records.length ? records : ([] as AttendanceRow[])).map((r) => [
        r.type,
        r.date || '',
        r.status || '',
        r.createdAt || '',
        r.takenBy?.fullName ? `${r.takenBy.fullName}` : ''
      ]);

      autoTable(doc, {
        startY: y,
        head: [['Type', 'Event date', 'Status', 'Recorded at', 'Taken by']],
        body: body.length ? body : [['', '', '', '', '']],
        theme: 'grid',
        styles: { fontSize: 9 }
      });

      // @ts-ignore
      y = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 10 : y + 20;
      if (y > 180) {
        doc.addPage();
        y = 14;
      }
    }

    doc.save('members_attendance.pdf');

    this.exportMode = false;
    this.pendingExport = '';
    this.selectAll = false;
    this.members.forEach((m) => (m.selected = false));
  } catch {
    this.message.add({ severity: 'error', summary: 'Export failed', detail: 'PDF export failed' });
  }
}


}
