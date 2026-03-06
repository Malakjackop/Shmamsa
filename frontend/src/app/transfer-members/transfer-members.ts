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
  deaconFamilyRole?: string;
  deaconFamilyRole2?: string;
  deaconFamilyRole3?: string;
  deaconFamilyRole4?: string;
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

  private readonly preferredFamilyOrder: string[] = [
    'اسرة السمائين',
    'اسرة القديس ابانوب',
    'اسرة القديس ديسقورس',
    'اسرة القديس سيدهم بشاي',
    'اسرة القديس اسكلابيوس',
    'اسرة القديس البابا كيرلس',
    'اسرة القديس الانبا ابرام',
    'اسرة القديس اسطفانوس',
    'خورس مارمرقس',
    'خورس البابا اثناسيوس'
  ];

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
  'خورس البابا اثناسيوس'
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
viewFamilies: string[] = []; 

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
  extraFamilies: Array<{ family: string; role: 'KHADIM' | 'AMIN_OSRA' | 'AMIN_KHEDMA' | 'MAKHDOM' }> = [];
  targetRole: 'KHADIM' | 'MAKHDOM' | 'AMIN_OSRA' | 'AMIN_KHEDMA' = 'KHADIM';

  ngOnInit() {
    this.auth.getUserData().subscribe({
      next: (u) => {
        this.me = u;
        this.bootstrapDefaults();
        this.loadFamilyLists();
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
  return this.me?.role === 'AMIN_OSRA' || this.isScopedAminOsraForSelected();
}

private normRole(v: any): string {
  return String(v || '')
    .trim()
    .toUpperCase()
    .replace(/^ROLE_/, '')
    .replace(/\s+/g, '_');
}

  private bootstrapDefaults() {
    this.servantFamilies = this.sortFamiliesByPreferredOrder(this.servantFamilies);
    this.makhdomFamilies = this.sortFamiliesByPreferredOrder(this.makhdomFamilies);

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

  private normalizeFamilyName(value: any): string {
    return String(value || '')
      .trim()
      .replace(/[أإآ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  private canonicalFamilyName(value: any): string {
    const raw = String(value || '').trim();
    const n = this.normalizeFamilyName(raw);

    if (!n) return '';
    if (n.includes('خورس') && n.includes('مار') && n.includes('مرقس')) return 'خورس مارمرقس';
    if (n.includes('خورس') && n.includes('اثناسيوس')) return 'خورس البابا اثناسيوس';
    if (n.includes('سمائ')) return 'اسرة السمائين';
    if (n.includes('ابانوب')) return 'اسرة القديس ابانوب';
    if (n.includes('ديسقورس')) return 'اسرة القديس ديسقورس';
    if (n.includes('سيدهم') || n.includes('بشاي')) return 'اسرة القديس سيدهم بشاي';
    if (n.includes('اسكلابيوس')) return 'اسرة القديس اسكلابيوس';
    if (n.includes('كيرلس')) {
      if (/\bا\b|[(\[]\s*ا\s*[)\]]/i.test(n)) return 'اسرة القديس البابا كيرلس أ';
      if (/\bب\b|[(\[]\s*ب\s*[)\]]/i.test(n)) return 'اسرة القديس البابا كيرلس ب';
      return 'اسرة القديس البابا كيرلس';
    }
    if (n.includes('ابرام')) {
      if (/\bا\b|[(\[]\s*ا\s*[)\]]/i.test(n)) return 'اسرة القديس الانبا ابرام أ';
      if (/\bب\b|[(\[]\s*ب\s*[)\]]/i.test(n)) return 'اسرة القديس الانبا ابرام ب';
      return 'اسرة القديس الانبا ابرام';
    }
    if (n.includes('اسطفانوس') || n.includes('استفانوس')) {
      if (/\bا\b|[(\[]\s*ا\s*[)\]]/i.test(n)) return 'اسرة القديس اسطفانوس أ';
      if (/\bب\b|[(\[]\s*ب\s*[)\]]/i.test(n)) return 'اسرة القديس اسطفانوس ب';
      return 'اسرة القديس اسطفانوس';
    }

    return raw;
  }

  private familyOrderKey(family: string): string {
    return this.canonicalFamilyName(family);
  }

  private sortFamiliesByPreferredOrder(families: string[]): string[] {
    const cleaned = (families || [])
      .map((x) => this.canonicalFamilyName(x))
      .filter(Boolean);
    const deduped = Array.from(new Set(cleaned));
    const orderMap = new Map(
      this.preferredFamilyOrder.map((name, index) => [this.normalizeFamilyName(name), index])
    );

    return [...deduped].sort((a, b) => {
      const aKey = this.familyOrderKey(a);
      const bKey = this.familyOrderKey(b);
      const aOrder = orderMap.get(this.normalizeFamilyName(aKey));
      const bOrder = orderMap.get(this.normalizeFamilyName(bKey));

      if (aOrder != null && bOrder != null) {
        if (aOrder !== bOrder) return aOrder - bOrder;
        return a.localeCompare(b, 'ar');
      }
      if (aOrder != null) return -1;
      if (bOrder != null) return 1;
      return a.localeCompare(b, 'ar');
    });
  }

  private loadFamilyLists() {
    this.familySvc.families().subscribe({
      next: (list) => {
        this.servantFamilies = this.sortFamiliesByPreferredOrder(this.servantFamilies);
        this.makhdomFamilies = this.sortFamiliesByPreferredOrder(this.makhdomFamilies);

        if (this.isAminKhedmaOrDev()) {
          this.viewFamilies = this.sortFamiliesByPreferredOrder([...this.servantFamilies]);
        } else if (this.hasAnyScopedAminOsra()) {
          this.viewFamilies = this.sortFamiliesByPreferredOrder(this.getAminOsraFamilies());
        } else if (this.isKhadim()) {
          const mine = [
            this.me?.deaconFamily,
            this.me?.deaconFamily2,
            this.me?.deaconFamily3,
            this.me?.deaconFamily4,
          ]
            .map((x: any) => this.canonicalFamilyName(x))
            .filter((x: string) => !!x);

          this.viewFamilies = this.sortFamiliesByPreferredOrder(Array.from(new Set(mine)));
        } else {
          this.viewFamilies = this.sortFamiliesByPreferredOrder([...this.servantFamilies]);
        }

        if (Array.isArray(list) && list.length) {
          this.viewFamilies = this.sortFamiliesByPreferredOrder([
            ...this.viewFamilies,
            ...(list as any[]).map((x) => this.canonicalFamilyName(x))
          ]);
        }

        const first = this.viewFamilies[0] || '';
        if (!this.selectedFamilyView) this.selectedFamilyView = first;

        const ok = this.viewFamilies.some(
          (x) => String(x || '').trim() === String(this.selectedFamilyView || '').trim()
        );
        if (!ok) this.selectedFamilyView = first;

        if (this.isMarmarkosView()) {
          this.targetFamily = this.marmarkosYearTargets[0]?.value || '';
        }

        this.loadMembers();
      },
      error: () => {}
    });
  }
  private loadMembers() {
    this.loading = true;

    let famParam: string | undefined = undefined;

    if (this.isAminKhedmaOrDev() || this.isKhadim() || this.isAminOsra()) {
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
          // ✅ Amin Osra can transfer/view MAKHDOM only within his family
          list = list.filter((x: any) => String(x?.role || '').trim().toUpperCase() === 'MAKHDOM');
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


private familyRoleFor(m: Member, fam: string): string {
  const f = String(fam || '').trim();
  const slots: Array<[string | undefined, string | undefined]> = [
    [m.deaconFamily, (m as any).deaconFamilyRole],
    [m.deaconFamily2, (m as any).deaconFamilyRole2],
    [m.deaconFamily3, (m as any).deaconFamilyRole3],
    [m.deaconFamily4, (m as any).deaconFamilyRole4],
  ];
  for (const [sf, sr] of slots) {
    if (String(sf || '').trim() && String(sf || '').trim().toLowerCase() === f.toLowerCase()) {
      return this.getRoleLabel(String(sr || '').trim().toUpperCase());
    }
  }
  return '';
}

private familyWithRole(m: Member, fam: string): string {
  const r = this.familyRoleFor(m, fam);
  return r ? `${fam} (${r})` : fam;
}

displayFamily(m: Member): string {
  // ✅ Choir year column is only for MAKHDOM view (when viewing Marmarkos bucket)
  if (this.mode === 'MAKHDOM' && this.isMarmarkosView()) {
    const yr = (m as any).khorsYear || 1;
    return this.levelLabel(yr);
  }

  const role = String(m.role || '').trim().toUpperCase();
  const isServantRole = role === 'KHADIM' || role === 'AMIN_OSRA' || role === 'AMIN_KHEDMA';

  // ✅ collect all الأسرة assignments (up to 4) and dedupe
  const rawFamilies = [m.deaconFamily, m.deaconFamily2, m.deaconFamily3, m.deaconFamily4]
    .map(x => String(x || '').trim())
    .filter(x => !!x && x.toUpperCase() !== 'SYSTEM' && !this.isChoirBucket(x));

  const families: string[] = [];
  for (const f of rawFamilies) {
    if (!families.includes(f)) families.push(f);
  }

  const khCode = String((m as any).khors || '').trim().toUpperCase();
  const kh = this.khorsLabel(khCode);
  const scope = String((m as any).servingScope || '').trim().toUpperCase();

  const khLabel = (() => {
    if (!kh) return '';
    if (khCode === 'ATHANASIUS') return kh;
    const lvl = this.levelLabel((m as any).khorsYear);
    return lvl ? `${kh} (${lvl})` : kh;
  })();

  // ✅ For servants: show كل الأسر + الخورس (لو موجود) خصوصًا لو KHORS_ONLY
  if (isServantRole) {
    const parts: string[] = [];
    parts.push(...families.map(f => this.familyWithRole(m, f)));

    // show khors when:
    // - servant is KHORS_ONLY
    // - or he actually has a khors code
    // - or his base family was a choir bucket
    const baseFamily = String(m.deaconFamily || '').trim();
    const shouldShowKhors = (scope === 'KHORS_ONLY' || scope === 'BOTH') && !!khLabel;
    if (shouldShowKhors && khLabel && !parts.includes(khLabel)) parts.push(khLabel);

    // fallback: لو مفيش أي حاجة رجع الأسرة الأساسية (حتى لو كانت خورس bucket)
    if (!parts.length) return baseFamily || '—';

    return parts.join(' + ');
  }

  const parts: string[] = [];
  parts.push(...families.map(f => this.familyWithRole(m, f)));
  if (khLabel && !parts.includes(khLabel)) parts.push(khLabel);
  return parts.length ? parts.join(' + ') : (String(m.deaconFamily || '').trim() || '—');
}

private isChoirBucket(base: string): boolean {
  const x = (base || '').trim();
  return x === 'خورس مارمرقس' || x === 'خورس البابا اثناسيوس';
}

isPapaAthanasiusView(): boolean {
  if (this.mode !== 'MAKHDOM') return false;
  const x = (this.selectedFamilyView || '').trim();
  return x === 'خورس البابا اثناسيوس';
}

private isTransferVisitor(m: any): boolean {
  const fields = [m?.deaconFamily, m?.deaconFamily2, m?.deaconFamily3, m?.deaconFamily4]
    .map((x: any) => String(x || '').trim());

  const joined = fields.join(' | ');
  if (joined.includes('زوار') || joined.includes('زائر')) {
    if (joined.includes('نقل')) return true;
    if (joined.includes('زوار النقل')) return true;
  }

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
        const extraAssignmentsToSend = (this.isAminKhedmaOrDev() && this.mode === 'SERVANT')
          ? this.extraFamilies
              .map(x => ({ family: String(x?.family || '').trim(), role: String(x?.role || 'KHADIM').trim().toUpperCase() }))
              .filter(x => !!x.family)
          : undefined;
        this.familySvc.transferMembers(ids, this.targetFamily, roleToSend, undefined, extraAssignmentsToSend).subscribe({
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

  private myRoleForFamily(fam: string): string {
  const f = String(fam || '').trim().toLowerCase();
  const slots: Array<[string | undefined, string | undefined]> = [
    [this.me?.deaconFamily, this.me?.deaconFamilyRole || this.me?.role],
    [this.me?.deaconFamily2, this.me?.deaconFamilyRole2],
    [this.me?.deaconFamily3, this.me?.deaconFamilyRole3],
    [this.me?.deaconFamily4, this.me?.deaconFamilyRole4],
  ];

  for (const [sf, sr] of slots) {
    if (String(sf || '').trim().toLowerCase() === f) {
      return this.normRole(sr);
    }
  }
  return '';
}

private isScopedAminOsraForSelected(): boolean {
  const fam = (this.selectedFamilyView || '').trim();
  if (!fam) return false;
  return this.myRoleForFamily(fam) === 'AMIN_OSRA';
}

private getAminOsraFamilies(): string[] {
  const slots: Array<[string | undefined, string | undefined]> = [
    [this.me?.deaconFamily, this.me?.deaconFamilyRole || this.me?.role],
    [this.me?.deaconFamily2, this.me?.deaconFamilyRole2],
    [this.me?.deaconFamily3, this.me?.deaconFamilyRole3],
    [this.me?.deaconFamily4, this.me?.deaconFamilyRole4],
  ];

  const res: string[] = [];
  for (const [fam, role] of slots) {
    const f = this.canonicalFamilyName(fam);
    if (!f) continue;

    const r = this.normRole(role);
    if (r === 'AMIN_OSRA') {
      if (!res.includes(f)) res.push(f);
    }
  }
  return res;
}

private hasAnyScopedAminOsra(): boolean {
  return this.getAminOsraFamilies().length > 0;
}


  addExtraFamily() {
    if (!this.canAddExtraFamily()) return;
    this.extraFamilies.push({ family: '', role: 'KHADIM' });
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
    const fam = (vals[idx] || '').trim();
    if (!fam) return '—';
    return this.familyWithRole(m, fam);
  }

  getRoleLabel(role: string): string {
    if (role === 'MAKHDOM') return 'مخدوم';
    if (role === 'KHADIM') return 'خادم';
    if (role === 'AMIN_OSRA') return 'امين اسرة';
    if (role === 'AMIN_KHEDMA') return 'امين خدمة';
    if (role === 'DEVELOPER' || role === 'DEV' || role.toLowerCase() === 'dev') return 'dev';
    return role;
  }
}

