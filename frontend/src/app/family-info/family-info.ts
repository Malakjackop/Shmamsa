import { Component, OnInit, inject } from '@angular/core';
import { FamilyService } from '../services/family.service';
import { AdminService } from '../services/admin.service';
import { AuthService } from '../services/auth.service';
import { MessageService, ConfirmationService } from 'primeng/api';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

type Member = {
  id: number;
  fullName: string;
  role: string;
  deaconFamily: string;
  address?: string;
  phoneNumber?: string;
  guardiansPhone?: string;
  /** shown in table */
  schoolGrade?: string;
  /** UI selection for export */
  selected?: boolean;
};

@Component({
  selector: 'app-family-info',
  standalone: false,
  templateUrl: './family-info.html',
  styleUrls: ['./family-info.css'],
  providers: [MessageService, ConfirmationService]
})
export class FamilyInfoComponent implements OnInit {
  private familySvc = inject(FamilyService);
  private adminSvc = inject(AdminService);
  private auth = inject(AuthService);
  private message = inject(MessageService);
  private confirm = inject(ConfirmationService);

  me: any;
  members: Member[] = [];
  families: string[] = [];
  selectedFamily = '';
  loading = false;

  selectAll = false;

  /** When true, the page shows selection checkboxes and waits for confirm export. */
  exportMode = false;
  /** Which export action is pending confirmation while in exportMode. */
  pendingExport: 'pdf' | null = null;

  // (legacy) profile modal state kept for backward-compat, not used now
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

  canDeleteAccounts(): boolean {
    return this.me?.role === 'AMIN_OSRA' || this.me?.role === 'AMIN_KHEDMA' || this.me?.role === 'DEVELOPER';
  }

  /** Hide delete button for self and (extra safety) for DEVELOPER accounts. */
  canDeleteMember(m: Member): boolean {
    if (!this.canDeleteAccounts()) return false;
    if (!m) return false;
    if (this.me?.id && m.id === this.me.id) return false;
    if ((m.role || '').toUpperCase() === 'DEVELOPER') return false;
    return true;
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
        this.members = ((m as any) || []).map((x: any) => ({ ...x, selected: false }));
        this.selectAll = false;
        // ✅ old UX: basic fields visible, full profile only via button
        // we still need school grade, so fetch minimal fields once.
        this.loadBasicFieldsForAllMembers(famParam);
      },
      error: (err) => {
        this.loading = false;
        this.message.add({ severity: 'error', summary: 'Error', detail: err?.error?.error || 'Failed to load' });
      }
    });
  }

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

  private loadBasicFieldsForAllMembers(famParam?: string) {
    if (!this.members?.length) {
      this.loading = false;
      return;
    }

    const calls = this.members.map((mem) =>
      this.familySvc.memberDetails(mem.id, famParam).pipe(catchError(() => of(null)))
    );

    forkJoin(calls).subscribe({
      next: (detailsArr) => {
        this.members = this.members.map((mem, idx) => {
          const details = detailsArr[idx] || null;
          return {
            ...mem,
            // keep common fields in sync
            address: details?.address ?? mem.address,
            phoneNumber: details?.phoneNumber ?? mem.phoneNumber,
            guardiansPhone: details?.guardiansPhone ?? mem.guardiansPhone,
            schoolGrade: details?.schoolGrade ?? mem.schoolGrade
          };
        });
        this.loading = false;
      },
      error: () => {
        // still show basic list
        this.loading = false;
      }
    });
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

  deleteMember(member: Member) {
    if (!this.canDeleteMember(member)) return;

    this.confirm.confirm({
      header: 'Confirm Delete',
      icon: 'pi pi-exclamation-triangle',
      message: `Delete account for ${member.fullName}? This cannot be undone.`,
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.familySvc.deleteMember(member.id).subscribe({
          next: () => {
            this.message.add({ severity: 'success', summary: 'Deleted', detail: 'Account deleted' });
            this.members = (this.members || []).filter((m) => m.id !== member.id);
            if (this.profileFor?.id === member.id) {
              this.closeProfile();
            }
          },
          error: (err) => {
            this.message.add({
              severity: 'error',
              summary: 'Error',
              detail: err?.error?.error || 'Failed to delete'
            });
          }
        });
      }
    });
  }

  async exportPdf() {
    // 1st click -> enter selection mode
    if (!this.exportMode) {
      this.exportMode = true;
      this.pendingExport = 'pdf';
      this.message.add({ severity: 'info', summary: 'Select members', detail: 'Choose members then press Export PDF again' });
      return;
    }

    // in selection mode but another export is pending
    if (this.pendingExport && this.pendingExport !== 'pdf') {
      this.pendingExport = 'pdf';
      this.message.add({ severity: 'info', summary: 'Select members', detail: 'Choose members then press Export PDF again' });
      return;
    }

    try {
      const jsPDF = (await import('jspdf')).default;
      const autoTable = (await import('jspdf-autotable')).default;

      const selected = this.getSelectedMembers();
      if (!selected.length) {
        this.message.add({ severity: 'warn', summary: 'Select members', detail: 'Please select at least one member' });
        return;
      }

      const famParam = this.isAminKhedmaOrDev() ? this.selectedFamily : undefined;
      const detailsArr = await this.fetchDetailsForMembers(selected, famParam);

      // Use landscape layout and avoid a super-wide table (which breaks rendering).
      const doc = new jsPDF({ orientation: 'landscape' });
      doc.setFontSize(14);
      doc.text('Members Info', 14, 14);
      doc.setFontSize(10);
      if (this.selectedFamily && /^[\x00-\x7F]+$/.test(this.selectedFamily)) {
        // jsPDF default fonts don't support Arabic shaping well; only print ASCII safely.
        doc.text(`Family: ${this.selectedFamily}`, 14, 22);
      }

      let y = 28;
      selected.forEach((m, idx) => {
        const d = detailsArr[idx] || {};

        doc.setFontSize(12);
        doc.text(`${m.fullName} (${m.role})`, 14, y);
        y += 4;

// NOTE: jsPDF default fonts don't support Arabic shaping well.
// To avoid garbled text, we omit any values that contain non-ASCII characters.
const safe = (v: any) => {
  const s = (v ?? '') + '';
  return /^[\x00-\x7F]*$/.test(s) ? s : '';
};

const toYesNo = (v: any) => {
  if (v === true) return 'Yes';
  if (v === false) return 'No';
  return safe(v);
};

const addUnique = (map: Map<string, string>, key: string, value: any) => {
  const val = safe(value);
  if (!val) return;
  if (!map.has(key)) map.set(key, val);
};

const kvMap = new Map<string, string>();

addUnique(kvMap, 'Phone', d.phoneNumber ?? m.phoneNumber);
addUnique(kvMap, "Father's phone", d.guardiansPhone ?? m.guardiansPhone);
addUnique(kvMap, 'Address', d.address ?? m.address);
addUnique(kvMap, 'School grade', d.schoolGrade ?? m.schoolGrade);

addUnique(kvMap, 'Username', d.username);
addUnique(kvMap, 'Email', d.email);
addUnique(kvMap, 'National ID', d.nationalId);
addUnique(kvMap, 'Degree', d.deaconDegree);
addUnique(kvMap, 'Relation', d.guardianRelation);
addUnique(kvMap, 'DOB', d.dateOfBirth);
addUnique(kvMap, 'Gender', d.gender);
addUnique(kvMap, 'Status', d.status);
addUnique(kvMap, 'Study type', d.studyType);
addUnique(kvMap, 'School name', d.schoolName);
addUnique(kvMap, 'University name', d.universityName);
addUnique(kvMap, 'Faculty', d.faculty);
addUnique(kvMap, 'University grade', d.universityGrade);
addUnique(kvMap, 'Job', d.graduateJob);
addUnique(kvMap, 'Working', toYesNo(d.isWorking));
addUnique(kvMap, 'Work details', d.workDetails);

// ✅ Tuple safe output (no TS2322)
const kv: [string, string][] = Array.from(kvMap.entries()) as [string, string][];

        autoTable(doc, {
          startY: y,
          head: [['Field', 'Value']],
          body: kv,
          theme: 'grid',
          styles: { fontSize: 9, cellPadding: 2, overflow: 'linebreak' },
          columnStyles: {
            0: { cellWidth: 45 },
            1: { cellWidth: 220 }
          },
          margin: { left: 14, right: 14 }
        });

        // @ts-ignore (autotable attaches lastAutoTable)
        y = (doc as any).lastAutoTable.finalY + 10;

        // New page if needed
        if (y > 180 && idx < selected.length - 1) {
          doc.addPage();
          y = 20;
        }
      });

      doc.save(`family_${this.selectedFamily || 'my'}_members_info.pdf`);

      // exit export mode after success
      this.exitExportMode();
    } catch {
      this.message.add({ severity: 'error', summary: 'Export failed', detail: 'PDF export failed' });
    }
  }

  cancelExport() {
    this.exitExportMode();
  }

  private exitExportMode() {
    this.exportMode = false;
    this.pendingExport = null;
    this.selectAll = false;
    this.members.forEach((m) => (m.selected = false));
  }

  private fetchDetailsForMembers(list: Member[], famParam?: string): Promise<any[]> {
    if (!list?.length) return Promise.resolve([]);

    const calls = list.map((mem) => this.familySvc.memberDetails(mem.id, famParam).pipe(catchError(() => of({}))));

    return new Promise((resolve) => {
      forkJoin(calls).subscribe({
        next: (arr) => resolve(arr as any[]),
        error: () => resolve([])
      });
    });
  }
}
