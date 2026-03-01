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
  khors?: string;
  khorsLevel?: number;
  attendKhors?: string;
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

  khors?: string;
  khorsLevel?: number;
  attendKhors?: string;

  selecting = false;
  selectedIds = new Set<number>();

  /** ✅ Registration lists (same as Register page) */
  servantFamilies: string[] = [
  'اسره السمائيين',
  'اسره القديس ابانوب',
  'اسره القديس ديسقورس',
  'اسره القديس سيدهم بشاي',
  'اسره القديس اسكلابيوس',
  'اسره البابا كيرلس',
  'اسره الانبا ابرام',
  'اسره اسطفانوس',
  'خورس مارمرقس',
  'خورس الانبا اثناسيوس'
];

  makhdomFamilies: string[] = [
  'اسره السمائيين',
  'اسره القديس ابانوب',
  'اسره القديس ديسقورس',
  'اسره القديس سيدهم بشاي',
  'اسره القديس اسكلابيوس',
  'اسره البابا كيرلس أ',
  'اسره البابا كيرلس ب',
  'اسره الانبا ابرام أ',
  'اسره الانبا ابرام ب',
  'اسره اسطفانوس أ',
  'اسره اسطفانوس ب'
];

makhdomTransferTargets: { label: string; value: string }[] = [
  { label: 'اسره السمائيين', value: 'اسره السمائيين' },
  { label: 'اسره القديس ابانوب', value: 'اسره القديس ابانوب' },
  { label: 'اسره القديس ديسقورس', value: 'اسره القديس ديسقورس' },
  { label: 'اسره القديس سيدهم بشاي', value: 'اسره القديس سيدهم بشاي' },
  { label: 'اسره القديس اسكلابيوس', value: 'اسره القديس اسكلابيوس' },
  { label: 'اسره البابا كيرلس أ', value: 'اسره البابا كيرلس أ' },
  { label: 'اسره البابا كيرلس ب', value: 'اسره البابا كيرلس ب' },
  { label: 'اسره الانبا ابرام أ', value: 'اسره الانبا ابرام أ' },
  { label: 'اسره الانبا ابرام ب', value: 'اسره الانبا ابرام ب' },
  { label: 'اسره اسطفانوس أ', value: 'اسره اسطفانوس أ' },
  { label: 'اسره اسطفانوس ب', value: 'اسره اسطفانوس ب' },
  { label: 'طلب نقل لخورس مارمرقس', value: 'KHORS_REQUEST:MARMARKOS' }
];

marmarkosYearTargets: { label: string; value: string }[] = [
  { label: 'خورس مارمرقس (سنه اوله)', value: 'KHORS:MARMARKOS:YEAR:1' },
  { label: 'خورس مارمرقس (سنه تانيه)', value: 'KHORS:MARMARKOS:YEAR:2' },
  { label: 'خورس مارمرقس (سنه تالته)', value: 'KHORS:MARMARKOS:YEAR:3' },
  { label: 'خورس مارمرقس (سنه رابعه)', value: 'KHORS:MARMARKOS:YEAR:4' },
  { label: 'خورس مارمرقس (سنه خامسه)', value: 'KHORS:MARMARKOS:YEAR:5' },
  { label: 'طلب نقل لخورس الانبا اثناسيوس', value: 'KHORS_REQUEST:ATHANASIUS' }
];

  mode: TransferMode = 'MAKHDOM';
  selectedFamilyView = '';
  targetFamily = '';
  extraFamilies: string[] = [];
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

  isKhadim(): boolean {
  return this.me?.role === 'KHADIM';
}

  isAminKhedmaOrDev(): boolean {
    return this.me?.role === 'AMIN_KHEDMA' || this.me?.role === 'DEVELOPER';
  }

  isAminOsra(): boolean {
    return this.me?.role === 'AMIN_OSRA';
  }

  private bootstrapDefaults() {

    const mineBase = (this.me?.deaconFamily || '').trim();

    if (this.isAminKhedmaOrDev()) {
      this.mode = 'MAKHDOM';
      this.selectedFamilyView = this.servantFamilies[0] || '';
      this.targetFamily = this.makhdomFamilies.find(x => x !== mineBase) || (this.makhdomFamilies[0] || '');
      this.targetRole = 'KHADIM';
      return;
    }
    
    if (this.isKhadim()) {
  this.mode = 'MAKHDOM';
  this.selectedFamilyView = this.servantFamilies[0] || '';
  this.targetFamily = this.makhdomFamilies[0] || '';
  return;
}

    this.mode = 'MAKHDOM';
    this.selectedFamilyView = ''; 
    this.targetFamily = this.makhdomFamilies.find(x => x !== mineBase) || (this.makhdomFamilies[0] || '');
  }

  private loadMembers() {
    this.loading = true;

    let famParam: string | undefined = undefined;

    if (this.isAminKhedmaOrDev() || this.isKhadim()) {
  if (this.isAminKhedmaOrDev() && this.mode === 'SERVANT') {
    famParam = 'SERVANTS';
  } else {
    famParam = this.selectedFamilyView || undefined;
  }
}

    // If a choir bucket is selected, show ALL members in that choir (servant + makhdom) and allow removal
    if (this.isKhorsView()) {
      const code = this.selectedKhorsCode();
      this.familySvc.khorsMembers(code).subscribe({
        next: (m) => {
          this.members = (m as any) || [];
          this.loading = false;
        },
        error: (err) => {
          this.loading = false;
          this.message.add({ severity: 'error', summary: 'Error', detail: err?.error?.error || 'Failed to load members' });
        }
      });
      return;
    }

    this.familySvc.members(famParam).subscribe({
      next: (m) => {
        let list = (m as any) || [];
        if (this.isAminKhedmaOrDev()) {
          if (this.mode === 'MAKHDOM') list = list.filter((x: any) => x?.role === 'MAKHDOM');
          if (this.mode === 'SERVANT') list = list.filter((x: any) => x?.role === 'KHADIM' || x?.role === 'AMIN_OSRA' || x?.role === 'AMIN_KHEDMA');
        } else if (this.isAminOsra()) {
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

  private khorsLabel(k?: string): string {
  const x = (k || '').toUpperCase();
  if (x === 'MARMARKOS') return 'خورس مارمرقس';
  if (x === 'ATHANASIUS') return 'خورس الانبا اثناسيوس';
  return '';
}

private levelLabel(n?: number): string {
  if (!n) return '';
  if (n === 1) return 'سنه اوله';
  if (n === 2) return 'سنه تانيه';
  if (n === 3) return 'سنه تالته';
  if (n === 4) return 'سنه رابعه';
  if (n === 5) return 'سنه خامسه';
  return `سنه ${n}`;
}

displayFamily(m: Member): string {
  const kh = this.khorsLabel((m as any).khors);
  const lvl = this.levelLabel((m as any).khorsYear);
  if (kh) return lvl ? `${kh} (${lvl})` : kh;
  return (m.deaconFamily || '').trim();
}



isMarmarkosView(): boolean {
  return (this.selectedFamilyView || '').trim() === 'خورس مارمرقس';
}

isAthanasiusView(): boolean {
  return (this.selectedFamilyView || '').trim() === 'خورس الانبا اثناسيوس';
}


isKhorsView(): boolean {
  const x = (this.selectedFamilyView || '').trim();
  return x === 'خورس مارمرقس' || x === 'خورس الانبا اثناسيوس';
}

selectedKhorsCode(): string {
  const x = (this.selectedFamilyView || '').trim();
  if (x === 'خورس مارمرقس') return 'MARMARKOS';
  if (x === 'خورس الانبا اثناسيوس') return 'ATHANASIUS';
  return '';
}

canDeleteFromKhors(): boolean {
  return this.isAminKhedmaOrDev() && this.isKhorsView();
}

removeFromKhors(m: Member) {
  const code = this.selectedKhorsCode();
  if (!code) return;

  this.confirm.confirm({
    message: `تأكيد إزالة ${m.fullName} من الخورس؟`,
    header: 'تأكيد',
    icon: 'pi pi-exclamation-triangle',
    accept: () => {
      this.familySvc.removeFromKhors(m.id, code).subscribe({
        next: () => {
          this.message.add({ severity: 'success', summary: 'Done', detail: 'تمت الإزالة' });
          this.loadMembers();
        },
        error: (err) => {
          this.message.add({ severity: 'error', summary: 'Error', detail: err?.error?.error || 'Failed' });
        }
      });
    }
  });
}


  onModeChange() {
    this.cancelSelecting();

    if (this.mode === 'MAKHDOM') {
      this.selectedFamilyView = this.selectedFamilyView || (this.servantFamilies[0] || '');
      if (this.isMarmarkosView()) {
        this.targetFamily = this.marmarkosYearTargets[0]?.value || '';
      } else {
        const allowed = this.makhdomTransferTargets.map((x) => x.value);
        if (!allowed.includes(this.targetFamily)) {
          this.targetFamily = this.makhdomTransferTargets[0]?.value || '';
        }
      }
    } else {
      this.targetFamily = this.servantFamilies[0] || '';
      this.extraFamilies = [];
      this.targetRole = 'KHADIM';
    }

    this.loadMembers();
  }

  onFamilyViewChange() {
    this.cancelSelecting();
    if (this.isMarmarkosView()) {
  this.targetFamily = this.marmarkosYearTargets[0]?.value || '';
} else {
  const allowed = this.makhdomTransferTargets.map((x) => x.value);
  if (!allowed.includes(this.targetFamily)) {
    this.targetFamily = this.makhdomTransferTargets[0]?.value || '';
  }
}
    this.loadMembers();
  }

  startTransfer() {
    if (this.isAthanasiusView()) {
      this.message.add({ severity: 'info', summary: 'غير متاح', detail: 'لا يوجد نقل بعد خورس الانبا اثناسيوس.' });
      return;
    }

    if (this.isMarmarkosView()) {
  this.targetFamily = this.marmarkosYearTargets[0]?.value || '';
}
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
    if (this.isAthanasiusView()) {
      this.message.add({ severity: 'info', summary: 'غير متاح', detail: 'لا يوجد نقل بعد خورس الانبا اثناسيوس.' });
      return;
    }

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
    const isKhorsRequest = (this.targetFamily || '').startsWith('KHORS_REQUEST:');
    const targetLabel = this.targetLabel(this.targetFamily);

    const msg = isKhorsRequest
      ? `إنشاء طلب نقل لعدد ${ids.length} عضو إلى "${targetLabel}"؟`
      : (this.isAminKhedmaOrDev() && this.mode === 'SERVANT')
      ? `Transfer ${ids.length} account(s) to "${targetLabel}" as "${roleLabel}"?`
      : `Transfer ${ids.length} account(s) to "${targetLabel}"?`;

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

  canAddExtraFamily(): boolean {
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

  targetLabel(v: string): string {
    const x = String(v || '').trim();
    if (x === 'KHORS_REQUEST:MARMARKOS') return 'خورس مارمرقس';
    if (x === 'KHORS_REQUEST:ATHANASIUS') return 'خورس الانبا اثناسيوس';
    return x;
  }
}
