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
  khorsYear?: number;
  servingScope?: string;
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
  khorsYear?: number;
  servingScope?: string;

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
  'خورس البابا اثناسيوس'
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

marmarkosYearTargets: { label: string; value: string }[] = [
  { label: 'خورس مارمرقس (سنه اوله)', value: 'KHORS:MARMARKOS:YEAR:1' },
  { label: 'خورس مارمرقس (سنه تانيه)', value: 'KHORS:MARMARKOS:YEAR:2' },
  { label: 'خورس مارمرقس (سنه تالته)', value: 'KHORS:MARMARKOS:YEAR:3' },
  { label: 'خورس مارمرقس (سنه رابعه)', value: 'KHORS:MARMARKOS:YEAR:4' },
  { label: 'خورس مارمرقس (سنه خامسه)', value: 'KHORS:MARMARKOS:YEAR:5' },
  { label: 'طلب نقل لخورس البابا اثناسيوس', value: 'KHORS_REQUEST:ATHANASIUS' }
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
        this.loadFamilyLists();
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
      this.selectedFamilyView = '';
      this.targetFamily = this.makhdomFamilies.find(x => x !== mineBase) || (this.makhdomFamilies[0] || '');
      this.targetRole = 'KHADIM';
      return;
    }

    if (this.isKhadim()) {
  this.mode = 'MAKHDOM';
  this.selectedFamilyView = '';
  this.targetFamily = this.makhdomFamilies[0] || '';
  return;
}

    this.mode = 'MAKHDOM';
    this.selectedFamilyView = '';
    this.targetFamily = this.makhdomFamilies.find(x => x !== mineBase) || (this.makhdomFamilies[0] || '');
  }


  private loadFamilyLists() {
    // ✅ Use backend to return the right families for the logged-in user (especially KHADIM)
    this.familySvc.families().subscribe({
      next: (list) => {
        if (Array.isArray(list) && list.length) {
          this.servantFamilies = list as any;
          // keep selection valid
          if (!this.selectedFamilyView || !this.servantFamilies.some(x => (x || '').trim() === (this.selectedFamilyView || '').trim())) {
            this.selectedFamilyView = '';
          }
          // if Marmarkos view, ensure target is set
          if (this.isMarmarkosView()) {
            this.targetFamily = this.marmarkosYearTargets[0]?.value || '';
          }
        }
      },
      error: () => {}
    });
  }

  private loadMembers() {
    this.loading = true;

    let famParam: string | undefined = undefined;

    if (this.isAminKhedmaOrDev() || this.isKhadim()) {
      if (this.isAminKhedmaOrDev() && this.mode === 'SERVANT') {
        famParam = 'SERVANTS';
      } else {
        famParam = this.selectedFamilyView ? this.selectedFamilyView : undefined;
      }
    }

    this.familySvc.members(famParam).subscribe({
      next: (m) => {
        let list = (m as any) || [];
        if (this.mode === 'MAKHDOM' && this.isPapaAthanasiusView()) {
          list = list.filter((x: any) => !this.isTransferVisitor(x));
        }

        if (this.isAminKhedmaOrDev()) {
  if (this.mode === 'MAKHDOM') {

    if (!this.isChoirSelection()) {
      list = list.filter((x: any) => String(x?.role || '').trim().toUpperCase() === 'MAKHDOM');
    }
  }
  if (this.mode === 'SERVANT') {
    const ok = new Set(['KHADIM', 'AMIN_OSRA', 'AMIN_KHEDMA']);
    list = list.filter((x: any) => ok.has(String(x?.role || '').trim().toUpperCase()));
  }
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
  if (x === 'ATHANASIUS') return 'خورس البابا اثناسيوس';
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
  // ✅ Choir year column is only for MAKHDOM view
  if (this.mode === 'MAKHDOM' && this.isMarmarkosView()) {
    const yr = (m as any).khorsYear || 1;
    return this.levelLabel(yr);
  }

  const role = String(m.role || '').trim().toUpperCase();
  const isServantRole = role === 'KHADIM' || role === 'AMIN_OSRA' || role === 'AMIN_KHEDMA';

  const baseFamily = (m.deaconFamily || '').trim();
  const khCode = String((m as any).khors || '').trim().toUpperCase();
  const kh = this.khorsLabel(khCode);
  const scope = String((m as any).servingScope || '').trim().toUpperCase();

  // ✅ For servants: show الأسرة if he's serving family (BOTH), show الخورس only if KHORS_ONLY
  if (isServantRole) {
    if (scope === 'KHORS_ONLY' || this.isChoirBucket(baseFamily)) {
      if (khCode === 'ATHANASIUS' && kh) return kh;
      const lvl = this.levelLabel((m as any).khorsYear);
      return kh ? (lvl ? `${kh} (${lvl})` : kh) : baseFamily;
    }
    return baseFamily;
  }

  // ✅ For مخدومين: keep old behavior (show choir if exists, else family)
  if (khCode === 'ATHANASIUS' && kh) return kh;
  const lvl = this.levelLabel((m as any).khorsYear);
  if (kh) return lvl ? `${kh} (${lvl})` : kh;
  return baseFamily;
}

private isChoirBucket(base: string): boolean {
  const x = (base || '').trim();
  return x === 'خورس مارمرقس' || x === 'خورس البابا اثناسيوس';
}

// NOTE: not private because it's used in the template
isPapaAthanasiusView(): boolean {
  const x = (this.selectedFamilyView || '').trim();
  return x === 'خورس البابا اثناسيوس';
}

// زوار النقل: غالبًا بيتسجلوا كـ "زوار" داخل واحدة من حقول الأسرة
private isTransferVisitor(m: any): boolean {
  const fields = [m?.deaconFamily, m?.deaconFamily2, m?.deaconFamily3, m?.deaconFamily4]
    .map((x: any) => String(x || '').trim());

  const joined = fields.join(' | ');
  // استبعاد واسع لتغطية اختلافات الكتابة
  if (joined.includes('زوار') || joined.includes('زائر')) {
    // لو في كلمة "نقل" يبقى أكيد زوار النقل
    if (joined.includes('نقل')) return true;
    // أو لو مكتوبة صراحة
    if (joined.includes('زوار النقل')) return true;
  }

  // احتياط: لو فيه role مخصوص
  const role = String(m?.role || '').trim().toUpperCase();
  if (role === 'ZAYER' || role === 'VISITOR' || role === 'TRANSFER_VISITOR') return true;

  return false;
}

isMarmarkosView(): boolean {
  return (this.selectedFamilyView || '').trim() === 'خورس مارمرقس';
}


isChoirSelection(): boolean {
  const x = (this.selectedFamilyView || '').trim();
  return this.isChoirBucket(x);
}

removeFromChoir(m: Member) {
  const kh = (this.selectedFamilyView || '').trim();
  if (!kh || !this.isChoirSelection()) return;

  this.confirm.confirm({
    header: 'تأكيد الحذف',
    message: `إخراج "${m.fullName}" من ${kh} ؟`,
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'حذف',
    rejectLabel: 'إلغاء',
    accept: () => {
      this.familySvc.removeFromKhors(m.id, kh).subscribe({
        next: () => {
          this.message.add({ severity: 'success', summary: 'تم', detail: 'تم إخراج العضو من الخورس' });
          this.loadMembers();
        },
        error: (err) => {
          this.message.add({ severity: 'error', summary: 'Error', detail: err?.error?.error || 'Delete failed' });
        }
      });
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
    if (this.isMarmarkosView()) {
  this.targetFamily = this.marmarkosYearTargets[0]?.value || '';
}
    this.loadMembers();
  }

  startTransfer() {
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
}
