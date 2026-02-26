import { Component, OnInit, inject } from '@angular/core';
import { FamilyService } from '../services/family.service';
import { AuthService } from '../services/auth.service';
import { MessageService, ConfirmationService } from 'primeng/api';

type Member = {
  id: number;
  fullName: string;
  role: string;
  deaconFamily: string;
  deaconFamily2?: string;
  deaconFamily3?: string;
  deaconFamily4?: string;
  fridayLiturgy: number;
  tasbeeha: number;
  familyMeeting: number;
};

type TransferMode = 'MAKHDOM' | 'SERVANT';

@Component({
  selector: 'app-transfer-members',
  standalone: false,
  templateUrl: './transfer-members.html',
  styleUrls: ['./transfer-members.css'],
  providers: [MessageService, ConfirmationService]
})
export class TransferMembersComponent implements OnInit {
  private familySvc = inject(FamilyService);
  private auth = inject(AuthService);
  private message = inject(MessageService);
  private confirm = inject(ConfirmationService);

  me: any;
  members: Member[] = [];
  loading = false;

  selecting = false;
  selectedIds = new Set<number>();

  /** ✅ Registration lists (same as Register page) */
  servantFamilies: string[] = [
    'اسرة السمائين',
    'اسرة القديس ابانوب',
    'اسرة القديس ديسقورس',
    'اسرة القديس سيدهم بشاي',
    'اسرة القديس اسكلابيوس',
    'اسرة القديس البابا كيرلس',
    'اسرة القديس الانبا ابرام',
    'اسرة القديس اسطفانوس',
    'خورس مارمرقس',
    'خورس الانبا اثناسيوس'
  ];

  makhdomFamilies: string[] = [
    'اسرة السمائين',
    'اسرة القديس ابانوب',
    'اسرة القديس ديسقورس',
    'اسرة القديس سيدهم بشاي',
    'اسرة القديس اسكلابيوس',
    'اسرة القديس البابا كيرلس أ',
    'اسرة القديس البابا كيرلس ب',
    'اسرة القديس الانبا ابرام أ',
    'اسرة القديس الانبا ابرام ب',
    'اسرة القديس اسطفانوس أ',
    'اسرة القديس اسطفانوس ب'
  ];

  /** ✅ For AMIN_KHEDMA+ */
  mode: TransferMode = 'MAKHDOM';
  // Which family I am currently viewing (only for MAKHDOM mode)
  selectedFamilyView = '';
  // Target family (varies by mode)
  targetFamily = '';
  // Optional second family for SERVANT mode (AMIN_KHEDMA/DEV only)
  // ✅ Dynamic extra families (2..4 in backend; UI can show + add/remove)
  extraFamilies: string[] = [];
  // Target role (only for SERVANT mode)
  targetRole: 'KHADIM' | 'MAKHDOM' | 'AMIN_OSRA' | 'AMIN_KHEDMA' = 'KHADIM';

  ngOnInit() {
    this.auth.getUserData().subscribe({
      next: (u) => {
        this.me = u;
        this.bootstrapDefaults();
        this.loadMembers();
      },
      error: () => {}
    });
  }

  isAminKhedmaOrDev(): boolean {
    return this.me?.role === 'AMIN_KHEDMA' || this.me?.role === 'DEVELOPER';
  }

  isAminOsra(): boolean {
    return this.me?.role === 'AMIN_OSRA';
  }

  private bootstrapDefaults() {
    // ✅ Defaults:
    // - AMIN_KHEDMA/DEV: start with MAKHDOM mode, view first servant-family, target first makhdom-family
    // - AMIN_OSRA: can only move MAKHDOM from his own family; choose a default target (first makhdom family different from mine)
    const mineBase = (this.me?.deaconFamily || '').trim();

    if (this.isAminKhedmaOrDev()) {
      this.mode = 'MAKHDOM';
      this.selectedFamilyView = this.servantFamilies[0] || '';
      this.targetFamily = this.makhdomFamilies.find(x => x !== mineBase) || (this.makhdomFamilies[0] || '');
      this.targetRole = 'KHADIM';
      return;
    }

    // AMIN_OSRA
    this.mode = 'MAKHDOM';
    this.selectedFamilyView = ''; // locked by backend anyway
    this.targetFamily = this.makhdomFamilies.find(x => x !== mineBase) || (this.makhdomFamilies[0] || '');
  }

  /** ✅ Load members list depending on role+mode */
  private loadMembers() {
    this.loading = true;

    let famParam: string | undefined = undefined;

    if (this.isAminKhedmaOrDev()) {
      if (this.mode === 'SERVANT') {
        famParam = 'SERVANTS'; // backend special bucket for servants
      } else {
        famParam = this.selectedFamilyView || undefined; // base families
      }
    }

    this.familySvc.members(famParam).subscribe({
      next: (m) => {
        let list = (m as any) || [];
        // ✅ Client-side filter by mode
        if (this.isAminKhedmaOrDev()) {
          if (this.mode === 'MAKHDOM') list = list.filter((x: any) => x?.role === 'MAKHDOM');
          if (this.mode === 'SERVANT') list = list.filter((x: any) => x?.role === 'KHADIM' || x?.role === 'AMIN_OSRA' || x?.role === 'AMIN_KHEDMA');
        } else if (this.isAminOsra()) {
          // backend already returns MAKHDOM only
        }
        this.members = list;
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.message.add({ severity: 'error', summary: 'Error', detail: err?.error?.error || 'Failed to load members' });
      }
    });
  }

  onModeChange() {
    this.cancelSelecting();

    if (this.mode === 'MAKHDOM') {
      this.selectedFamilyView = this.selectedFamilyView || (this.servantFamilies[0] || '');
      this.targetFamily = this.targetFamily || (this.makhdomFamilies[0] || '');
    } else {
      this.targetFamily = this.servantFamilies[0] || '';
      this.extraFamilies = [];
      this.targetRole = 'KHADIM';
    }

    this.loadMembers();
  }

  onFamilyViewChange() {
    this.cancelSelecting();
    this.loadMembers();
  }

  startTransfer() {
    this.selecting = true;
    this.selectedIds.clear();
  }

  cancelSelecting() {
    this.selecting = false;
    this.selectedIds.clear();
  }

  toggleMember(id: number, checked: boolean) {
    if (checked) this.selectedIds.add(id);
    else this.selectedIds.delete(id);
  }

  doTransfer() {
    if (!this.targetFamily) {
      this.message.add({ severity: 'warn', summary: 'Choose family', detail: 'Please choose the target family.' });
      return;
    }

    if (this.isAminKhedmaOrDev() && this.mode === 'SERVANT' && !this.targetRole) {
      this.message.add({ severity: 'warn', summary: 'Choose role', detail: 'Please choose the target role.' });
      return;
    }

    if (!this.selectedIds.size) {
      this.message.add({ severity: 'warn', summary: 'No selection', detail: 'Please select at least one member.' });
      return;
    }

    const ids = Array.from(this.selectedIds);
    const roleLabel = this.getRoleLabel(this.targetRole);

    const msg = (this.isAminKhedmaOrDev() && this.mode === 'SERVANT')
      ? `Transfer ${ids.length} account(s) to "${this.targetFamily}" as "${roleLabel}"?`
      : `Transfer ${ids.length} account(s) to "${this.targetFamily}"?`;

    this.confirm.confirm({
      header: 'Confirm transfer',
      message: msg,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Transfer',
      rejectLabel: 'Cancel',
      accept: () => {
        const roleToSend = (this.isAminKhedmaOrDev() && this.mode === 'SERVANT') ? this.targetRole : undefined;
        const extrasToSend = (this.isAminKhedmaOrDev() && this.mode === 'SERVANT')
          ? this.extraFamilies.map(x => (x || '').trim()).filter(x => !!x)
          : undefined;
        this.familySvc.transferMembers(ids, this.targetFamily, roleToSend, extrasToSend).subscribe({
          next: (res) => {
            const updated = res?.updated ?? 0;
            this.message.add({ severity: 'success', summary: 'Done', detail: `Transferred: ${updated}` });
            this.cancelSelecting();
            this.loadMembers();
          },
          error: (err) => {
            this.message.add({ severity: 'error', summary: 'Error', detail: err?.error?.error || 'Transfer failed' });
          }
        });
      }
    });
  }

  /** UI helpers for dynamic extra families */
  canAddExtraFamily(): boolean {
    // backend currently supports up to 3 extras (2..4)
    return this.extraFamilies.length < 3;
  }

  addExtraFamily() {
    if (!this.canAddExtraFamily()) return;
    this.extraFamilies.push('');
  }

  removeExtraFamily(idx: number) {
    this.extraFamilies.splice(idx, 1);
  }

  private countExtras(m: Member): number {
    const arr = [m.deaconFamily2, m.deaconFamily3, m.deaconFamily4].filter(x => !!(x || '').trim());
    return arr.length;
  }

  maxExistingExtraCols(): number {
    if (!this.members?.length) return 0;
    return this.members.reduce((mx, m) => Math.max(mx, this.countExtras(m)), 0);
  }

  extraColIndices(): number[] {
    const n = this.maxExistingExtraCols();
    return Array.from({ length: n }, (_, i) => i);
  }

  extraFamilyValue(m: Member, idx: number): string {
    const vals = [m.deaconFamily2, m.deaconFamily3, m.deaconFamily4];
    return (vals[idx] || '').trim() || '—';
  }

  getRoleLabel(role: string): string {
    if (role === 'MAKHDOM') return 'مخدوم';
    if (role === 'KHADIM') return 'خادم';
    if (role === 'AMIN_OSRA') return 'امين اسره';
    if (role === 'AMIN_KHEDMA') return 'امين خدمة';
    if (role === 'DEVELOPER' || role === 'DEV' || role.toLowerCase() === 'dev') return 'dev';
    return role;
  }
}
