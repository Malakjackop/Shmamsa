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
  pendingExport: 'pdf' | '' = '';
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

    // لو التوتال مش موجود لسه (قبل تحديث الباك), اعرض الرقم القديم بس
    if (total == null) return String(present ?? 0);
    return `${present ?? 0}/${total}`;
  }

  titleForType(t: AttendanceRow['type']): string {
    if (t === 'TASBEEHA') return 'تسبحة';
    if (t === 'FRIDAY_LITURGY') return 'قداس الجمعة';
    return 'اجتماع الأسرة';
  }

  private statusAr(v?: AttendanceRow['status'] | string): string {
    const s = (v || '').toUpperCase();
    if (s === 'PRESENT') return 'حاضر';
    if (s === 'ABSENT') return 'غائب';
    return v || '';
  }

  private roleAr(role?: string): string {
    const r = (role || '').toUpperCase();
    if (r === 'DEVELOPER') return 'مطوّر';
    if (r === 'AMIN_KHEDMA') return 'أمين خدمة';
    if (r === 'AMIN_OSRA') return 'أمين أسرة';
    if (r === 'KHADIM') return 'خادم';
    if (r === 'MEMBER') return 'عضو';
    return role || '';
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

formatRecordedAt(dateStr?: string): string {
  if (!dateStr) return '';

  let s = String(dateStr).trim();

  s = s.replace(/(\.\d{3})\d+/, '$1');

  const d = new Date(s);
  if (isNaN(d.getTime())) return dateStr;

  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();

  const minutes = String(d.getMinutes()).padStart(2, '0');

const h24 = d.getHours();
const ampmRaw = h24 >= 12 ? 'م' : 'ص';
const LRM = '\u200E'; 
const ampm = `${LRM}${ampmRaw}${LRM}`;
const h12 = h24 % 12 || 12;

return `${day}/${month}/${year} - ${h12}:${minutes} ${ampm}`;
}

  // ===== Export =====
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

    // Load Arabic-capable font (DejaVuSans) so Arabic text doesn't become garbled.
    // Keep direction LTR to avoid "mirrored" text.
    const ensureDejaVu = async (doc: any) => {
      try {
        if (typeof doc.setR2L === 'function') doc.setR2L(false);
        if (doc.__hasDejaVu) {
          doc.setFont('DejaVu', 'normal');
          return;
        }

        const res = await fetch('assets/fonts/DejaVuSans.ttf');
        const buf = await res.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const base64 = btoa(binary);

        doc.addFileToVFS('DejaVuSans.ttf', base64);
        doc.addFont('DejaVuSans.ttf', 'DejaVu', 'normal');
        doc.__hasDejaVu = true;
        doc.setFont('DejaVu', 'normal');
      } catch {
        // If font loading fails, PDF still generates (Arabic may not render correctly)
      }
    };

    const selected = this.getSelectedMembers();
    if (!selected.length) {
      this.message.add({ severity: 'warn', summary: 'Select members', detail: 'اختر على الأقل عضو واحد' });
      return;
    }

    const famParam = this.isAminKhedmaOrDev() ? this.selectedFamily : undefined;
    const detailsArr = await this.fetchDetailsForMembers(selected, famParam);
    const attArr = await this.fetchAttendanceForMembers(selected, famParam);

    const doc = new jsPDF({ orientation: 'landscape' });
    await ensureDejaVu(doc);
    const hasArabic = (s: string) => /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(s);
    const processArabic =
      (doc as any).processArabic ||
      ((jsPDF as any)?.API?.processArabic
        ? (text: string) => (jsPDF as any).API.processArabic(text)
        : null);
    const pdfText = (v: any) => {
      const s = (v ?? '') + '';
      if (!s) return '';
      if (!hasArabic(s)) return s;
      return typeof processArabic === 'function' ? processArabic(s) : s;
    };
    const pageRight = doc.internal.pageSize.getWidth() - 14;
    doc.setFontSize(14);
    doc.text(pdfText('تفاصيل حضور الأعضاء'), pageRight, 14, { align: 'right' });
    doc.setFontSize(10);

    let y = 20;
    for (let idx = 0; idx < selected.length; idx++) {
      const m = selected[idx];
      const d = detailsArr[idx] || {};
      const fam = (d.deaconFamily ?? m.deaconFamily) || '';
      const phone = d.phoneNumber || '';
      const records = attArr[idx] || [];

      doc.setFontSize(12);
      doc.text(pdfText(`${m.fullName} (${this.roleAr(m.role)})`), pageRight, y, { align: 'right' });
      y += 6;
      doc.setFontSize(10);
      doc.text(pdfText(`الأسرة: ${fam}`), pageRight, y, { align: 'right' });
      doc.text(pdfText(`الهاتف: ${phone}`), pageRight - 110, y, { align: 'right' });
      y += 4;

      // Group by Type and merge the Type cell (rowSpan) so each type appears once.
      const body: any[] = [];
      if (records.length) {
        const sorted = [...records].sort((a, b) => {
          const t = (a.type || '').localeCompare(b.type || '');
          if (t !== 0) return t;
          return (a.date || '').localeCompare(b.date || '');
        });

        const groups = new Map<string, AttendanceRow[]>();
        sorted.forEach((r) => {
          const key = r.type || '';
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(r);
        });

        for (const [type, list] of groups) {
          list.forEach((r, i) => {
            // IMPORTANT: With rowSpan, subsequent rows must NOT include a placeholder cell
            // for the spanned column, otherwise cells shift into wrong columns.
            if (i === 0) {
              const typeCell = {
                content: pdfText(this.titleForType(type as AttendanceRow['type'])),
                rowSpan: list.length,
                styles: { valign: 'middle', fontStyle: 'bold' , font: 'DejaVu', halign: 'right'}
              };
              body.push([
                typeCell,
                pdfText(r.date || ''),
                pdfText(this.statusAr(r.status)),
                pdfText(this.formatRecordedAt(r.createdAt)),
                r.takenBy?.fullName ? pdfText(`${r.takenBy.fullName}`) : ''
              ]);
            } else {
              body.push([
                pdfText(r.date || ''),
                pdfText(this.statusAr(r.status)),
                pdfText(this.formatRecordedAt(r.createdAt)),
                r.takenBy?.fullName ? pdfText(`${r.takenBy.fullName}`) : ''
              ]);
            }
          });
        }
      }

      autoTable(doc, {
        startY: y,
        head: [[pdfText('النوع'), pdfText('تاريخ المناسبة'), pdfText('الحالة'), pdfText('وقت التسجيل'), pdfText('المسجّل')]],
        body: body.length ? body : [['', '', '', '', '']],
        theme: 'grid',
        margin: { left: 14, right: 14 },
        tableWidth: doc.internal.pageSize.getWidth() - 28,
        tableLineColor: [120, 120, 120],
        tableLineWidth: 0.25,
        styles: {
          fontSize: 9,
          font: 'DejaVu',
          halign: 'right',
          lineColor: [145, 145, 145],
          lineWidth: 0.2
        },
        headStyles: {
          lineColor: [90, 90, 90],
          lineWidth: 0.3,
          textColor: [255, 255, 255]
        },
        bodyStyles: {
          lineColor: [150, 150, 150],
          lineWidth: 0.2
        },
        columnStyles: {
          0: { cellWidth: (doc.internal.pageSize.getWidth() - 28) * 0.24 },
          1: { cellWidth: (doc.internal.pageSize.getWidth() - 28) * 0.18 },
          2: { cellWidth: (doc.internal.pageSize.getWidth() - 28) * 0.12 },
          3: { cellWidth: (doc.internal.pageSize.getWidth() - 28) * 0.22 },
          4: { cellWidth: (doc.internal.pageSize.getWidth() - 28) * 0.24 }
        }
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
