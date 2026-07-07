import { Component, OnInit, inject, HostListener } from '@angular/core';
import { FamilyService } from '../services/family.service';
import { AuthService, FamilyOption } from '../services/auth.service';
import { MessageService, ConfirmationService } from 'primeng/api';
import { normalizeAssignmentRole, normalizeRole, roleLabel } from '../shared/role-utils';
import { DEFAULT_FAMILY_ORDER, canonicalFamilyName, sortFamiliesByPreferredOrder } from '../shared/family-utils';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { CdkDragDrop } from '@angular/cdk/drag-drop';

type Member = {
  id: number;
  fullName: string;
  role: string;
  familyName?: string;
  deaconFamily: string;
  deaconFamilyRole?: string;
  fridayLiturgy: number;
  tasbeeha: number;
  familyMeeting: number;
  khors?: string;
  khorsYear?: number;
  servingScope?: string;
  familyAssignments?: Array<{ familyId?: number; familyName?: string; roleCode?: number; role?: string; assignmentOrder?: number }>;
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
  private memberCache = new Map<string, Member[]>();

  khors?: string;
  khorsYear?: number;
  servingScope?: string;

  selecting = false;
  selectedIds = new Set<number>();

  selectedSourceYear: number | null = null;
  targetChoir = '';
  removedFromTargetIds = new Set<number>();

  // For خورس مارمرقس single-panel mode
  targetMarmarkosYear = '';
  pendingMarmarkosMembers: Member[] = [];
  targetKhorsYear: number | '' = '';

  transferredMap = new Map<number, Set<string>>();
  transferRoles = new Map<string, string>();
  pendingRemovals = new Map<number, Set<string>>();

  get hasPendingTransfers(): boolean {
    return this.transferredMap.size > 0 || this.pendingRemovals.size > 0;
  }

  pendingMainMembers: Member[] = [];

  get totalPending(): number {
    let count = this.pendingMainMembers.length + this.pendingMarmarkosMembers.length;
    this.extraFamilies.forEach(ef => count += ef.members.length);
    return count;
  }

  get allSelected(): boolean {
    const list = this.filteredSourceMembers;
    if (!list.length) return false;
    if (this.isMarmarkosView()) {
      return list.every(m => this.pendingMarmarkosMembers.some(p => p.id === m.id));
    }
    return list.every(m => this.pendingMainMembers.some(p => p.id === m.id));
  }

  get showKirillosChoirPanel(): boolean {
    if (this.mode !== 'MAKHDOM') return false;
    const fam = (this.selectedFamilyView || '').trim();
    return fam.includes('كيرلس');
  }

  get showChoirRequest(): boolean {
    if (this.mode !== 'MAKHDOM') return false;
    const fam = (this.selectedFamilyView || '').trim();
    return fam.includes('كيرلس') || fam.includes('ابرام') || fam.includes('اسطفانوس');
  }

  private readonly preferredFamilyOrder = DEFAULT_FAMILY_ORDER;

  /** fallback only when family-options is unavailable */
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

familyRequestTargets: { label: string; value: string }[] = [
  { label: 'طلب نقل لخورس مارمرقس', value: 'KHORS_REQUEST:MARMARKOS' },
  { label: 'طلب نقل لخورس البابا اثناسيوس', value: 'KHORS_REQUEST:ATHANASIUS' }
];

  mode: TransferMode = 'MAKHDOM';
  selectedFamilyView = '';
  targetFamily = '';
  servantSourceFamily = '';

  get targetFamilyLabel(): string {
    const m = this.targetFamily.match(/KHORS:MARMARKOS:YEAR:(\d+)/);
    if (m) return `خورس مارمرقس - السنة ${m[1]}`;
    if (this.targetFamily === 'KHORS_REQUEST:ATHANASIUS') return 'طلب نقل لخورس البابا اثناسيوس';
    if (this.targetFamily === 'KHORS_REQUEST:MARMARKOS') return 'طلب نقل لخورس مارمرقس';
    return this.targetFamily || '';
  }

  get filteredMembers(): Member[] {
    if (this.mode !== 'SERVANT' || !this.isAminKhedmaOrDev()) return this.members;
    let list = this.members;
    if (this.servantSourceFamily) {
      list = list.filter(m => {
        const fams = this.assignmentsOf(m).map(x => x.familyName);
        return fams.includes(this.servantSourceFamily);
      });
    }
    const ok = new Set(['KHADIM', 'AMIN_OSRA', 'AMIN_KHEDMA']);
    return list.filter(m => ok.has(normalizeRole(m.role)));
  }
  extraFamilies: Array<{ family: string; role: 'KHADIM' | 'AMIN_OSRA' | 'AMIN_KHEDMA' | 'MAKHDOM'; members: number[] }> = [];
  targetRole: 'KHADIM' | 'MAKHDOM' | 'AMIN_OSRA' | 'AMIN_KHEDMA' = 'MAKHDOM';

  targetFamilyMembers: Member[] = [];

  get displayTargetMembers(): Member[] {
    let list: Member[];
    if (this.mode === 'SERVANT') {
      const ok = new Set(['KHADIM', 'AMIN_OSRA', 'AMIN_KHEDMA']);
      list = this.targetFamilyMembers.filter(m => ok.has(normalizeRole(m.role)));
    } else {
      list = this.targetFamilyMembers;
    }
    return list.filter(m => !this.removedFromTargetIds.has(m.id));
  }

  get removedAsSourceMembers(): Member[] {
    if (!this.removedFromTargetIds.size) return [];
    return this.targetFamilyMembers.filter(m => this.removedFromTargetIds.has(m.id));
  }

  get filteredSourceMembers(): Member[] {
    const base = this.mode === 'SERVANT' && this.isAminKhedmaOrDev() ? this.filteredMembers : this.members;
    const transferredIds = new Set([
      ...this.pendingMainMembers.map(m => m.id),
      ...this.pendingMarmarkosMembers.map(m => m.id),
    ]);
    const seen = new Set<number>();
    let list = [...base, ...this.removedAsSourceMembers].filter(m => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      // in SERVANT mode, keep transferred members visible (can assign to multiple families)
      if (this.mode === 'SERVANT') return true;
      return !transferredIds.has(m.id);
    });
    if (this.isMarmarkosView() && this.selectedSourceYear !== null) {
      list = list.filter(m => ((m as any).khorsYear || 1) === this.selectedSourceYear);
    }
    return list;
  }

  get marmarkosTargetOptions(): Array<{ label: string; value: string }> {
    return this.marmarkosYearTargets.filter(t => {
      if (this.selectedSourceYear === null) return true;
      const match = t.value.match(/YEAR:(\d+)/);
      if (match) return parseInt(match[1]) !== this.selectedSourceYear;
      return true;
    });
  }

  get targetFamilySelectOptions(): Array<{ label: string; value: string }> {
    if (this.mode === 'SERVANT' && this.isAminKhedmaOrDev()) {
      return this.availableMainFamilies().map(f => ({ label: f, value: f }));
    }
    return this.availableTargetFamilies().map(f => ({ label: f, value: f }));
  }
  targetFamilyLoading = false;
  private targetFamilyCache = new Map<string, Member[]>();

  distributionOpen = false;
  distributionFamilies: string[] = [];
  distributionData: Array<{ servant: Member; assignments: Array<{ targetFamily: string; targetRole: string; pending?: boolean }> }> = [];

  ngOnInit() {
    this.auth.getUserData(true).subscribe({
      next: (u) => {
        this.me = u;
        this.bootstrapDefaults();
        this.loadFamilyLists();
      },
      error: () => {}
    });
  }

  isKhadim(): boolean {
    return normalizeRole(this.me?.role) === 'KHADIM';
  }

  isAminKhedmaOrDev(): boolean {
    return ['AMIN_KHEDMA', 'DEVELOPER'].includes(normalizeRole(this.me?.role));
  }

  isAminOsra(): boolean {
    return normalizeRole(this.me?.role) === 'AMIN_OSRA' || this.isScopedAminOsraForSelected();
  }

  private normRole(v: any): string {
    return normalizeRole(v);
  }

  private assignmentsOf(entity: any): Array<{ familyName: string; role: string; roleCode?: number }> {
    const raw = Array.isArray(entity?.familyAssignments) ? entity.familyAssignments : [];
    return raw
      .map((x: any) => ({
        familyName: String(x?.familyName || '').trim(),
        role: normalizeAssignmentRole(x, entity?.role),
        roleCode: typeof x?.roleCode === 'number' ? x.roleCode : undefined
      }))
      .filter((x: any) => !!x.familyName);
  }

  private bootstrapDefaults() {
    this.servantFamilies = this.sortFamiliesByPreferredOrder(this.servantFamilies);
    this.makhdomFamilies = this.sortFamiliesByPreferredOrder(this.makhdomFamilies);

    const mineBase = this.assignmentsOf(this.me)[0]?.familyName || '';

    if (this.isAminKhedmaOrDev()) {
      this.mode = 'MAKHDOM';
      this.selectedFamilyView = '';
      this.targetRole = 'MAKHDOM';
      return;
    }

    if (this.isKhadim()) {
  this.mode = 'MAKHDOM';
  this.selectedFamilyView = '';
  return;
}

    this.mode = 'MAKHDOM';
    this.selectedFamilyView = '';
    this.targetRole = 'MAKHDOM';
  }

  private canonicalFamilyName(value: any): string {
    return canonicalFamilyName(value, { keepSubFamilies: true });
  }

  private familyNameFromOption(option: FamilyOption | null | undefined): string {
    return this.canonicalFamilyName(option?.nameAr || option?.baseName || option?.code || '');
  }

  private sortFamiliesByPreferredOrder(families: string[]): string[] {
    return sortFamiliesByPreferredOrder(families, this.preferredFamilyOrder, { keepSubFamilies: true });
  }

  private loadFamilyLists() {
    forkJoin({
      actualFamilies: this.familySvc.families(),
      servantOptions: this.auth.getFamilyOptions('SERVANT'),
      memberOptions: this.auth.getFamilyOptions('MEMBER')
    }).subscribe({
      next: ({ actualFamilies, servantOptions, memberOptions }) => {
        const servantFromApi = servantOptions
          .map((option) => this.familyNameFromOption(option))
          .filter(Boolean);
        const memberFromApi = memberOptions
          .map((option) => this.familyNameFromOption(option))
          .filter(Boolean);

        // Merge API result with fallback to ensure we never lose families that exist in the system
        const mergedServant = servantFromApi.length
          ? [...new Set([...servantFromApi, ...this.servantFamilies])]
          : this.servantFamilies;
        this.servantFamilies = this.sortFamiliesByPreferredOrder(mergedServant);

        // Always preserve sub-family variants (أ/ب) from fallback when API might collapse them
        const subFamilyVariants = this.makhdomFamilies.filter(f => /[أب]\s*$/.test(f.trim()));
        const mergedMakhdom = memberFromApi.length
          ? [...memberFromApi, ...subFamilyVariants]
          : this.makhdomFamilies;
        this.makhdomFamilies = this.sortFamiliesByPreferredOrder(mergedMakhdom);

        this.servantFamilies = this.sortFamiliesByPreferredOrder(this.servantFamilies);
        this.makhdomFamilies = this.sortFamiliesByPreferredOrder(this.makhdomFamilies);

        if (this.isAminKhedmaOrDev()) {
          this.viewFamilies = this.sortFamiliesByPreferredOrder([...this.servantFamilies]);
        } else if (this.hasAnyScopedAminOsra()) {
          this.viewFamilies = this.sortFamiliesByPreferredOrder(this.getAminOsraFamilies());
        } else if (this.isKhadim()) {
          this.viewFamilies = this.sortFamiliesByPreferredOrder(this.getServedFamilies());
        } else {
          this.viewFamilies = this.sortFamiliesByPreferredOrder([...this.servantFamilies]);
        }

        if (this.isAminKhedmaOrDev() && Array.isArray(actualFamilies) && actualFamilies.length) {
          this.viewFamilies = this.sortFamiliesByPreferredOrder([
            ...this.viewFamilies,
            ...(actualFamilies as any[]).map((x) => this.canonicalFamilyName(x))
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

        this.autoSelectTargetForAminOsra();

        this.loadMembers();
        this.prefetchServants();
        this.loadTargetFamilyMembers();
        this.loadTransferredMap();
      },
      error: () => {
        this.servantFamilies = this.sortFamiliesByPreferredOrder(this.servantFamilies);
        this.makhdomFamilies = this.sortFamiliesByPreferredOrder(this.makhdomFamilies);
        this.loadMembers();
        this.loadTargetFamilyMembers();
      }
    });
  }
  private loadMembers() {
    this.loading = true;

    const famParam = this.memberFamilyParamForCurrentMode();
    const cacheKey = this.memberCacheKey(famParam, this.mode);
    const cached = this.memberCache.get(cacheKey);
    if (cached) {
      this.members = cached;
      this.loading = false;
      return;
    }

    this.familySvc.members(famParam).subscribe({
      next: (m) => this.applyLoadedMembers(famParam, this.mode, (m as any) || []),
      error: (err) => {
        this.loading = false;
        this.message.add({ severity: 'error', summary: 'خطأ', detail: err?.error?.error || 'خطأ في تحميل الاعضاء' });
      }
    });
  }

  private memberFamilyParamForCurrentMode(): string | undefined {
    let famParam: string | undefined = undefined;
    if (this.isAminKhedmaOrDev() || this.isKhadim() || this.isAminOsra()) {
      if (this.isAminKhedmaOrDev() && this.mode === 'SERVANT') {
        famParam = 'SERVANTS';
      } else {
        famParam = this.selectedFamilyView ? this.selectedFamilyView : undefined;
      }
    }
    return famParam;
  }

  private memberCacheKey(famParam: string | undefined, mode: TransferMode): string {
    return `${mode}:${famParam || 'ALL'}`;
  }

  private applyLoadedMembers(famParam: string | undefined, mode: TransferMode, rawList: any[]) {
        let list = rawList || [];
        if (this.isAminKhedmaOrDev()) {
  if (mode === 'MAKHDOM') {

    if (!this.isChoirSelection()) {
      list = list.filter((x: any) => normalizeRole(x?.role) === 'MAKHDOM' || this.isTransferVisitor(x));
    }
  }
  if (mode === 'SERVANT') {
    const ok = new Set(['KHADIM', 'AMIN_OSRA', 'AMIN_KHEDMA']);
    list = list.filter((x: any) => ok.has(normalizeRole(x?.role)));
  }
        } else if (this.isKhadim()) {
          list = list.filter((x: any) => normalizeRole(x?.role) === 'MAKHDOM');
        } else if (this.isAminOsra()) {
          list = list.filter((x: any) => normalizeRole(x?.role) === 'MAKHDOM' || this.isTransferVisitor(x));
        }
        this.memberCache.set(this.memberCacheKey(famParam, mode), list);
        this.members = list;
        this.loading = false;
  }

  private prefetchServants() {
    if (!this.isAminKhedmaOrDev()) return;
    const key = this.memberCacheKey('SERVANTS', 'SERVANT');
    if (this.memberCache.has(key)) return;
    this.familySvc.members('SERVANTS').subscribe({
      next: (members) => {
        const previousMembers = this.members;
        const previousLoading = this.loading;
        this.applyLoadedMembers('SERVANTS', 'SERVANT', (members as any) || []);
        if (this.mode !== 'SERVANT') {
          this.members = previousMembers;
          this.loading = previousLoading;
        }
      },
      error: () => {}
    });
  }

  private khorsLabel(k?: string): string {
  const x = (k || '').toUpperCase();
  if (x === 'MARMARKOS') return 'خورس مارمرقس';
  if (x === 'ATHANASIUS') return 'خورس البابا اثناسيوس';
  return '';
}

levelLabel(n?: number): string {
  if (!n) return '';
  if (n === 1) return 'سنه اوله';
  if (n === 2) return 'سنه تانيه';
  if (n === 3) return 'سنه تالته';
  if (n === 4) return 'سنه رابعه';
  if (n === 5) return 'سنه خامسه';
  return `سنه ${n}`;
}


private familyRoleFor(m: Member, fam: string): string {
  const selected = this.canonicalFamilyName(fam);
  const assignments = this.assignmentsOf(m);
  for (const assignment of assignments) {
    if (this.canonicalFamilyName(assignment.familyName) === selected) {
      return this.getRoleLabel(assignment.role);
    }
  }
  return '';
}

targetExistingRole(m: Member): string {
  const selected = this.canonicalFamilyName(this.targetFamily);
  for (const a of this.assignmentsOf(m)) {
    if (this.canonicalFamilyName(a.familyName) === selected) {
      return a.role;
    }
  }
  return m.role;
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

  const role = normalizeRole(m.role);
  const isServantRole = role === 'KHADIM' || role === 'AMIN_OSRA' || role === 'AMIN_KHEDMA';

  // ✅ collect all الأسرة assignments and dedupe
  const rawFamilies = this.assignmentsOf(m)
    .map((x) => x.familyName)
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


  const baseFamily = this.assignmentsOf(m)[0]?.familyName || '';
    const shouldShowKhors = (scope === 'KHORS_ONLY' || scope === 'BOTH') && !!khLabel;
    if (shouldShowKhors && khLabel && !parts.includes(khLabel)) parts.push(khLabel);

    // fallback: لو مفيش أي حاجة رجع الأسرة الأساسية (حتى لو كانت خورس bucket)
    if (!parts.length) return baseFamily || '—';

    return parts.join(' + ');
  }

  const parts: string[] = [];
  parts.push(...families.map(f => this.familyWithRole(m, f)));
  if (khLabel && !parts.includes(khLabel)) parts.push(khLabel);
  return parts.length ? parts.join(' + ') : '—';
}

private isChoirBucket(base: string): boolean {
  const x = (base || '').trim();
  return x === 'خورس مارمرقس' || x === 'خورس البابا اثناسيوس';
}

isPapaAthanasiusView(): boolean {
  if (this.mode !== 'MAKHDOM') return false;
  return (this.selectedFamilyView || '').trim() === 'خورس البابا اثناسيوس';
}

private isTransferVisitor(m: any): boolean {
  const fields = this.assignmentsOf(m).map((x) => x.familyName);

  const joined = fields.join(' | ');
  if (joined.includes('زوار') || joined.includes('زائر')) {
    if (joined.includes('نقل')) return true;
    if (joined.includes('زوار النقل')) return true;
  }

  const rawRole = String(m?.role || '').trim().toUpperCase();
  if (rawRole === 'ZAYER' || rawRole === 'VISITOR' || rawRole === 'TRANSFER_VISITOR') return true;

  return false;
}

isMarmarkosView(): boolean {
  if (this.mode !== 'MAKHDOM') return false;
  return (this.selectedFamilyView || '').trim() === 'خورس مارمرقس';
}


isChoirSelection(): boolean {
  if (this.mode !== 'MAKHDOM') return false;
  return this.isChoirBucket((this.selectedFamilyView || '').trim());
}

  get marmarkosTargetYearOptions(): Array<{ label: string; value: string }> {
    return [
      { label: 'سنة أولى', value: 'KHORS:MARMARKOS:YEAR:1' },
      { label: 'سنة تانية', value: 'KHORS:MARMARKOS:YEAR:2' },
      { label: 'سنة تالتة', value: 'KHORS:MARMARKOS:YEAR:3' },
      { label: 'سنة رابعة', value: 'KHORS:MARMARKOS:YEAR:4' },
      { label: 'سنة خامسة', value: 'KHORS:MARMARKOS:YEAR:5' },
      { label: 'طلب لخورس البابا اثناسيوس', value: 'KHORS_REQUEST:ATHANASIUS' }
    ];
  }

  onMarmarkosMainDrop(event: CdkDragDrop<Member[]>) {
    const member = event.item.data as Member | undefined;
    if (!member?.id) return;
    if (!this.targetMarmarkosYear) {
      this.message.add({ severity: 'warn', summary: 'اختار السنة', detail: 'اختر السنة الهدف أولاً' });
      return;
    }
    if (this.pendingMarmarkosMembers.find(m => m.id === member.id)) return;
    this.pendingMarmarkosMembers.push(member);
  }

  removePendingMarmarkos(memberId: number) {
    this.pendingMarmarkosMembers = this.pendingMarmarkosMembers.filter(m => m.id !== memberId);
    this.untrackIfNoLongerPending(memberId);
  }

  private untrackIfNoLongerPending(memberId: number) {
    const inMain = this.pendingMainMembers.some(m => m.id === memberId);
    const inExtra = this.extraFamilies.some(ef => ef.members.includes(memberId));
    const inMarkos = this.pendingMarmarkosMembers.some(m => m.id === memberId);
    if (!inMain && !inExtra && !inMarkos) {
      this.transferredMap.delete(memberId);
      this.saveTransferredMap();
    }
  }

  onModeChange() {
    this.pendingMainMembers = [];
    this.extraFamilies = [];
    this.targetFamilyMembers = [];
    this.targetFamilyCache.clear();
    this.selectedSourceYear = null;
    this.targetChoir = '';
    this.targetMarmarkosYear = '';
    this.pendingMarmarkosMembers = [];
    this.removedFromTargetIds.clear();

    if (this.mode === 'MAKHDOM') {
      this.selectedFamilyView = this.selectedFamilyView || (this.servantFamilies[0] || '');
      this.targetRole = 'MAKHDOM';
    } else {
      this.targetRole = 'KHADIM';
    }

    this.autoSelectTargetForAminOsra();
    this.loadMembers();
    this.loadTargetFamilyMembers();
  }

  private autoSelectTargetForAminOsra(): void {
    if (!this.isAminOsra() && !this.isAminKhedmaOrDev()) return;
    if (this.mode === 'SERVANT') return;
    const fam = (this.selectedFamilyView || '').trim();
    if (!fam) return;
    const idx = this.makhdomFamilies.indexOf(fam);
    if (idx >= 0 && idx < this.makhdomFamilies.length - 1) {
      this.targetFamily = this.makhdomFamilies[idx + 1];
    }
  }

  onFamilyViewChange() {
    this.pendingMainMembers = [];
    this.pendingMarmarkosMembers = [];
    this.targetMarmarkosYear = '';
    this.selectedSourceYear = null;
    this.autoSelectTargetForAminOsra();
    this.loadMembers();
    this.loadTargetFamilyMembers();
  }

  saveAll() {
    const mainIds = this.pendingMainMembers.map(m => m.id);
    const extraAssignments = this.extraFamilies
      .filter(ef => ef.family && ef.members.length)
      .map(ef => ({
        family: ef.family,
        role: ef.role || 'KHADIM'
      }));

    if (!mainIds.length && !extraAssignments.length) return;

    const mainRole = this.targetRole || 'KHADIM';
    mainIds.forEach(id => {
      this.trackTransfer(id, this.targetFamily);
      this.transferRoles.set(`${id}:${this.targetFamily}`, mainRole);
    });
    this.extraFamilies.forEach(ef => {
      if (ef.family) ef.members.forEach(mId => {
        this.trackTransfer(mId, ef.family);
        this.transferRoles.set(`${mId}:${ef.family}`, ef.role || 'KHADIM');
      });
    });
    this.saveTransferredMap();

    this.message.add({ severity: 'success', summary: 'تم الحفظ', detail: `تم حفظ التوزيع مؤقتاً، اضغط "نقل" لتأكيد النقل` });
    this.pendingMainMembers = [];
    this.extraFamilies.forEach(ef => ef.members = []);
  }

  executeAll() {
    if (this.totalPending === 0 && !this.hasPendingTransfers) return;

    const count = this.totalPending;
    const targetLabel = this.targetFamilyLabel || 'الأسرة الهدف';
    const msg = count > 0 ? `نقل ${count} عضو الي "${targetLabel}"؟` : 'تأكيد النقلات المعلقة؟';

    this.confirm.confirm({
      header: 'تأكيد النقل',
      message: msg,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'نقل',
      rejectLabel: 'الغاء',
      accept: () => {
        if (this.totalPending === 0 && this.pendingRemovals.size === 0) {
          this.transferredMap.clear();
          this.transferRoles.clear();
          localStorage.removeItem(this.storageKey('transfer_pending'));
          localStorage.removeItem(this.storageKey('transfer_roles'));
          this.removedFromTargetIds.clear();
          this.message.add({ severity: 'info', summary: 'تم', detail: 'تم مسح النقلات المعلقة' });
          return;
        }

        const calls: ReturnType<typeof this.familySvc.transferMembers>[] = [];

        // Main panel transfer
        const mainIds = this.pendingMainMembers.map(m => m.id);
        if (mainIds.length) {
          const roleToSend = this.targetRole;
          const extraAssignments = this.extraFamilies
            .filter(ef => ef.family && ef.members.length)
            .map(ef => ({ family: ef.family, role: ef.role || 'KHADIM' }));
          if (this.targetChoir && this.mode === 'MAKHDOM') {
            extraAssignments.push({ family: this.targetChoir, role: 'MAKHDOM' });
          }
          calls.push(this.familySvc.transferMembers(mainIds, this.targetFamily, roleToSend, undefined,
            extraAssignments.length ? extraAssignments : undefined, ''));
        }

        // Extra families that aren't from main panel
        this.extraFamilies.filter(ef => ef.family).forEach(ef => {
          const ids = ef.members.filter(id => !mainIds.includes(id));
          if (ids.length) calls.push(this.familySvc.transferMembers(ids, ef.family, ef.role, undefined, undefined, ''));
        });

        // Marmarkos single-panel transfer
        if (this.pendingMarmarkosMembers.length && this.targetMarmarkosYear) {
          const ids = this.pendingMarmarkosMembers.map(m => m.id);
          calls.push(this.familySvc.transferMembers(ids, this.targetMarmarkosYear, 'MAKHDOM', undefined, undefined, ''));
        }


        // Removals (servant X'd — remove from ALL families)
        const removalCount = { n: 0 };
        this.pendingRemovals.forEach((_families, memberId) => {
          removalCount.n++;
          calls.push((this.familySvc.removeServantFromFamily(memberId, 'ALL') as any).pipe(catchError(() => of(null))));
        });

        if (!calls.length) return;

        forkJoin(calls).subscribe({
          next: () => {
            const detail = count > 0 && removalCount.n > 0
              ? `تم نقل ${count} عضو وإزالة ${removalCount.n} من أسرهم`
              : count > 0 ? `تم نقل ${count} عضو`
              : `تم إزالة ${removalCount.n} من أسرهم`;
            this.message.add({ severity: 'success', summary: 'تم', detail });
            this.pendingMainMembers = [];
            this.pendingMarmarkosMembers = [];
            this.extraFamilies.forEach(ef => ef.members = []);
            this.removedFromTargetIds.clear();
            this.pendingRemovals.clear();
            localStorage.removeItem(this.storageKey('transfer_removals'));
            this.memberCache.clear();
            this.targetFamilyCache.clear();
            this.loadMembers();
            this.loadTargetFamilyMembers();
            this.transferredMap.clear();
            this.transferRoles.clear();
            localStorage.removeItem(this.storageKey('transfer_pending'));
            localStorage.removeItem(this.storageKey('transfer_roles'));
          },
          error: (err) => {
            this.message.add({ severity: 'error', summary: 'خطأ', detail: err?.error?.error || 'فشل النقل' });
          }
        });
      }
    });
  }

  extraDropListIds(): string[] {
    return this.extraFamilies.map((_, index) => `transferExtraDrop${index}`);
  }

  connectedDropListIds(): string[] {
    const ids = ['transferSelectedDrop', ...this.extraDropListIds()];
    if (this.isMarmarkosView()) ids.push('transferMarmarkosMain');
    return ids;
  }

  onMemberDrop(event: CdkDragDrop<Member[]>) {
    const member = event.item.data as Member | undefined;
    if (!member?.id) return;

    const targetFam = String(this.targetFamily || '').trim();
    if (!targetFam) {
      this.message.add({ severity: 'warn', summary: 'اختار اسره', detail: 'برجاء اختيار الأسرة الهدف أولاً' });
      return;
    }

    if (this.pendingMainMembers.find(m => m.id === member.id)) {
      this.message.add({ severity: 'info', summary: 'موجود', detail: 'العضو موجود بالفعل في قائمة النقل' });
      return;
    }

    // Block servant from transferring to their own current family
    // (unless they were explicitly "freed" via the ↩ button)
    if (this.mode === 'SERVANT' &&
        !this.removedFromTargetIds.has(member.id) &&
        this.assignmentsOf(member).some(a =>
          this.canonicalFamilyName(a.familyName) === this.canonicalFamilyName(targetFam))) {
      this.message.add({ severity: 'error', summary: 'مسجل بالفعل', detail: `"${member.fullName}" مسجل بالفعل في ${targetFam}` });
      return;
    }

    const alreadyInFamily = this.displayTargetMembers.some(x => x.id === member.id);
    if (alreadyInFamily) {
      this.message.add({ severity: 'warn', summary: 'موجود بالفعل', detail: `"${member.fullName}" موجود بالفعل في ${targetFam}` });
    }

    this.pendingMainMembers.push(member);
  }

  removePendingMain(memberId: number) {
    this.pendingMainMembers = this.pendingMainMembers.filter(m => m.id !== memberId);
    this.untrackIfNoLongerPending(memberId);
  }

  onExtraFamilyDrop(event: CdkDragDrop<Member[]>, index: number) {
    if (!this.extraFamilies[index]) return;
    const member = event.item.data as Member | undefined;
    if (!member?.id) return;

    const targetFam = String(this.extraFamilies[index]?.family || '').trim();
    if (!targetFam) {
      this.message.add({ severity: 'warn', summary: 'اختار أسرة', detail: 'برجاء اختيار أسرة إضافية أولاً' });
      return;
    }

    const panel = this.extraFamilies[index];
    if (panel.members.includes(member.id)) {
      this.message.add({ severity: 'info', summary: 'موجود', detail: 'العضو موجود بالفعل في هذه الأسرة' });
      return;
    }

    this.extraFamilies.forEach((p, idx) => {
      if (idx !== index) p.members = p.members.filter(id => id !== member.id);
    });
    panel.members.push(member.id);
  }

  removeExtraFamilyMember(extraIdx: number, memberId: number) {
    const panel = this.extraFamilies[extraIdx];
    if (!panel) return;
    panel.members = panel.members.filter(id => id !== memberId);
    this.untrackIfNoLongerPending(memberId);
  }

  private trackTransfer(memberId: number, family: string) {
    if (!this.transferredMap.has(memberId)) {
      this.transferredMap.set(memberId, new Set());
    }
    this.transferredMap.get(memberId)!.add(family);
  }

  private storageKey(base: string): string {
    return `${base}_${this.me?.id || 'anonymous'}`;
  }

  private saveTransferredMap() {
    const obj: Record<number, string[]> = {};
    this.transferredMap.forEach((families, id) => {
      obj[id] = Array.from(families);
    });
    localStorage.setItem(this.storageKey('transfer_pending'), JSON.stringify(obj));
    const roleObj: Record<string, string> = {};
    this.transferRoles.forEach((role, key) => { roleObj[key] = role; });
    localStorage.setItem(this.storageKey('transfer_roles'), JSON.stringify(roleObj));
  }

  private loadTransferredMap() {
    try {
      const raw = localStorage.getItem(this.storageKey('transfer_pending'));
      if (!raw) return;
      const obj = JSON.parse(raw) as Record<number, string[]>;
      this.transferredMap.clear();
      for (const [id, families] of Object.entries(obj)) {
        this.transferredMap.set(Number(id), new Set(families));
      }
    } catch {
      localStorage.removeItem(this.storageKey('transfer_pending'));
    }
    try {
      const raw = localStorage.getItem(this.storageKey('transfer_roles'));
      if (raw) {
        const roleObj = JSON.parse(raw) as Record<string, string>;
        this.transferRoles.clear();
        for (const [key, role] of Object.entries(roleObj)) {
          this.transferRoles.set(key, role);
        }
      }
    } catch {
      localStorage.removeItem(this.storageKey('transfer_roles'));
    }
    try {
      const raw = localStorage.getItem(this.storageKey('transfer_removals'));
      if (!raw) return;
      const obj = JSON.parse(raw) as Record<number, string[]>;
      this.pendingRemovals.clear();
      for (const [id, families] of Object.entries(obj)) {
        this.pendingRemovals.set(Number(id), new Set(families));
      }
    } catch {
      localStorage.removeItem(this.storageKey('transfer_removals'));
    }
  }

  private savePendingRemovals() {
    const obj: Record<number, string[]> = {};
    this.pendingRemovals.forEach((fams, id) => { obj[id] = Array.from(fams); });
    localStorage.setItem(this.storageKey('transfer_removals'), JSON.stringify(obj));
  }

  transferredFamilies(memberId: number): string[] {
    return Array.from(this.transferredMap.get(memberId) || []);
  }

  transferredCount(memberId: number): number {
    return this.transferredMap.get(memberId)?.size ?? 0;
  }

  availableMainFamilies(): string[] {
    const exclude = this.mode === 'SERVANT' ? this.servantSourceFamily : this.selectedFamilyView;
    return this.servantFamilies.filter(f => !exclude || f !== exclude);
  }

  availableTargetFamilies(): string[] {
    const exclude = this.mode === 'MAKHDOM' ? this.selectedFamilyView : this.selectedFamilyView;
    return this.makhdomFamilies.filter(f => f !== exclude);
  }

  extraFamilyOptions(extraIdx: number): string[] {
    const used = new Set<string>();
    if (this.targetFamily) used.add(this.targetFamily);
    this.extraFamilies.forEach((ef, idx) => {
      if (ef.family && idx !== extraIdx) used.add(ef.family);
    });
    return this.servantFamilies.filter(f => !used.has(f));
  }

  canAddExtraFamily(): boolean {
    return true;
  }

  private myRoleForFamily(fam: string): string {
  const selected = this.canonicalFamilyName(fam);
  const assignments = this.assignmentsOf(this.me);
  for (const assignment of assignments) {
    if (this.canonicalFamilyName(assignment.familyName) === selected) {
      return assignment.role;
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
  const res: string[] = [];
  for (const assignment of this.assignmentsOf(this.me)) {
    const f = this.canonicalFamilyName(assignment.familyName);
    if (!f) continue;
    const r = assignment.role;
    if (r === 'AMIN_OSRA') {
      if (!res.includes(f)) res.push(f);
    }
  }
  return res;
}

private hasAnyScopedAminOsra(): boolean {
  return this.getAminOsraFamilies().length > 0;
}

private getServedFamilies(): string[] {
  const res: string[] = [];
  for (const assignment of this.assignmentsOf(this.me)) {
    const f = this.canonicalFamilyName(assignment.familyName);
    if (!f) continue;
    const r = assignment.role;
    if (!['KHADIM', 'AMIN_OSRA', 'AMIN_KHEDMA'].includes(r)) continue;
    if (!res.includes(f)) res.push(f);
  }
  return res;
}


  addExtraFamily() {
    if (!this.canAddExtraFamily()) return;
    this.extraFamilies.push({ family: '', role: 'KHADIM', members: [] });
  }

  setMode(m: TransferMode) {
    this.mode = m;
    this.onModeChange();
  }

  removeExtraFamily(idx: number) {
    this.extraFamilies.splice(idx, 1);
  }

  getMemberById(id: number): Member | undefined {
    return this.members.find(m => m.id === id);
  }

  private countExtras(m: Member): number {
    return Math.max(0, this.assignmentsOf(m).length - 1);
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
    const fam = this.assignmentsOf(m)[idx + 1]?.familyName || '';
    if (!fam) return '—';
    return this.familyWithRole(m, fam);
  }

  getRoleLabel(role: string): string {
    return roleLabel(role);
  }

  targetFamilyOptions(): Array<{ label: string; value: string }> {
    if (this.mode === 'SERVANT') {
      return this.servantFamilies.map(f => ({ label: f, value: f }));
    }
    if (this.isMarmarkosView()) {
      return this.marmarkosYearTargets;
    }
    const base = this.makhdomFamilies.map(f => ({ label: f, value: f }));
    return [...base, ...this.familyRequestTargets];
  }

  showRoleSelector(): boolean {
    return this.mode === 'SERVANT';
  }

  onTargetFamilyChange() {
    if (this.targetFamily === 'KHORS:MARMARKOS') {
      this.targetKhorsYear = '';
      this.targetFamilyMembers = [];
      return;
    }
    if (!this.targetFamily.startsWith('KHORS:MARMARKOS')) {
      this.targetKhorsYear = '';
    }
    this.removedFromTargetIds.clear();
    this.loadTargetFamilyMembers();
  }

  onKhorsYearChange(year: number) {
    this.targetFamily = `KHORS:MARMARKOS:YEAR:${year}`;
    this.targetKhorsYear = year;
    this.removedFromTargetIds.clear();
    this.loadTargetFamilyMembers();
  }

  setSourceYear(year: number | null) {
    this.selectedSourceYear = year;
  }

  confirmRemoveFromFamily(m: Member) {
    this.confirm.confirm({
      header: 'إزالة من الأسرة',
      message: `هتشيل "${m.fullName}" من أسرته خالص؟`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'نعم، شيله',
      rejectLabel: 'إلغاء',
      accept: () => {
        this.removedFromTargetIds.add(m.id);
        const allFamilies = this.assignmentsOf(m)
          .map(a => a.familyName)
          .filter(f => f && !this.isChoirBucket(f));
        if (allFamilies.length) {
          if (!this.pendingRemovals.has(m.id)) this.pendingRemovals.set(m.id, new Set());
          allFamilies.forEach(fam => this.pendingRemovals.get(m.id)!.add(fam));
          this.savePendingRemovals();
        }
      }
    });
  }

  removeExistingFromTarget(m: Member) {
    this.removedFromTargetIds.add(m.id);
    // Track ALL current family assignments for removal
    const allFamilies = this.assignmentsOf(m)
      .map(a => a.familyName)
      .filter(f => f && !this.isChoirBucket(f));
    // fallback to current target if no assignments resolved
    if (!allFamilies.length) {
      const fam = String(this.targetFamily || '').trim();
      if (fam && !fam.startsWith('KHORS')) allFamilies.push(fam);
    }
    if (allFamilies.length) {
      if (!this.pendingRemovals.has(m.id)) this.pendingRemovals.set(m.id, new Set());
      allFamilies.forEach(fam => this.pendingRemovals.get(m.id)!.add(fam));
      this.savePendingRemovals();
    }
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
            this.memberCache.clear();
            this.loadMembers();
          },
          error: (err) => {
            this.message.add({ severity: 'error', summary: 'خطأ', detail: err?.error?.error || 'فشل في المسح' });
          }
        });
      }
    });
  }

  selectAll() {
    if (this.allSelected) {
      this.pendingMainMembers = [];
      this.pendingMarmarkosMembers = [];
      return;
    }

    const list = this.filteredSourceMembers;

    if (this.isMarmarkosView()) {
      if (!this.targetMarmarkosYear) {
        this.message.add({ severity: 'warn', summary: 'اختار السنة', detail: 'اختر السنة الهدف أولاً' });
        return;
      }
      for (const m of list) {
        if (this.pendingMarmarkosMembers.find(x => x.id === m.id)) continue;
        this.pendingMarmarkosMembers.push(m);
      }
      return;
    }

    const targetFam = String(this.targetFamily || '').trim();
    if (!targetFam) {
      this.message.add({ severity: 'warn', summary: 'اختار أسرة', detail: 'برجاء اختيار الأسرة الهدف أولاً' });
      return;
    }
    let added = 0;
    for (const m of list) {
      if (this.pendingMainMembers.find(x => x.id === m.id)) continue;
      if (this.mode === 'SERVANT' && this.assignmentsOf(m).some(a =>
        this.canonicalFamilyName(a.familyName) === this.canonicalFamilyName(targetFam))) continue;
      const alreadyInFamily = this.displayTargetMembers.some(x => x.id === m.id);
      if (alreadyInFamily) continue;
      this.pendingMainMembers.push(m);
      added++;
    }
    if (added) this.saveTransferredMap();
  }

  openDistribution() {
    this.distributionOpen = true;
    this.distributionFamilies = [...this.servantFamilies];
    const buildData = (list: Member[]) => list.map(s => {
      const removals = this.pendingRemovals.get(s.id);
      const transferredFamilies = this.transferredMap.get(s.id);
      const hasPendingTransfer = !!transferredFamilies && transferredFamilies.size > 0;

      // If pending transfer exists, hide old assignments (they'll be replaced on نقل)
      const existing = hasPendingTransfer ? [] : this.assignmentsOf(s)
        .filter(x => !this.isChoirBucket(x.familyName))
        .filter(x => !removals || !removals.has(x.familyName))
        .map(x => ({ targetFamily: x.familyName, targetRole: x.role, pending: false }));

      const transfers = transferredFamilies
        ? Array.from(transferredFamilies).map(fam => ({
            targetFamily: fam,
            targetRole: this.transferRoles.get(`${s.id}:${fam}`) || 'KHADIM',
            pending: true
          }))
        : [];

      const combined = [...existing];
      for (const t of transfers) {
        if (!combined.some(c => c.targetFamily === t.targetFamily)) {
          combined.push(t);
        }
      }
      return { servant: s, assignments: combined };
    });
    const key = this.memberCacheKey('SERVANTS', 'SERVANT');
    const cached = this.memberCache.get(key);
    if (cached) {
      this.distributionData = buildData(cached);
      return;
    }
    this.familySvc.members('SERVANTS').subscribe({
      next: (m: any) => {
        this.distributionData = buildData(m || []);
      },
      error: () => { this.distributionData = []; }
    });
  }

  closeDistribution() {
    this.distributionOpen = false;
    this.distributionData = [];
    this.distributionFamilies = [];
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.distributionOpen) {
      this.closeDistribution();
    }
  }

  isDistPending(s: Member, fam: string): boolean {
    const cfam = this.canonicalFamilyName(fam);
    for (const item of this.distributionData) {
      if (item.servant.id === s.id) {
        return item.assignments.some(a => this.canonicalFamilyName(a.targetFamily) === cfam && a.pending);
      }
    }
    return false;
  }

  getDistServantsForFamily(fam: string): Member[] {
    const seen = new Set<number>();
    const result: Member[] = [];
    const cfam = this.canonicalFamilyName(fam);
    for (const item of this.distributionData) {
      for (const a of item.assignments) {
        if (this.canonicalFamilyName(a.targetFamily) === cfam && !seen.has(item.servant.id)) {
          seen.add(item.servant.id);
          result.push(item.servant);
        }
      }
    }
    return result;
  }

  getDistServantRole(s: Member, family: string): string {
    const cfam = this.canonicalFamilyName(family);
    for (const item of this.distributionData) {
      if (item.servant.id === s.id) {
        const match = item.assignments.find(a => this.canonicalFamilyName(a.targetFamily) === cfam);
        if (match) return match.targetRole;
        if (item.assignments.length) return item.assignments[0].targetRole;
      }
    }
    return s.role;
  }

  removeDistServant(s: Member, family: string) {
    const transferredFamilies = this.transferredMap.get(s.id);
    if (transferredFamilies) {
      transferredFamilies.delete(family);
      if (transferredFamilies.size === 0) this.transferredMap.delete(s.id);
    }
    this.transferRoles.delete(`${s.id}:${family}`);
    this.saveTransferredMap();
    // Rebuild distribution data
    this.openDistribution();
  }

  addDistAssignment(idx: number) {
    if (this.distributionData[idx]) {
      this.distributionData[idx].assignments.push({ targetFamily: '', targetRole: 'KHADIM', pending: true });
    }
  }

  removeDistAssignment(idx: number, aidx: number) {
    if (this.distributionData[idx]?.assignments.length > 1) {
      this.distributionData[idx].assignments.splice(aidx, 1);
    }
  }

  saveDistribution() {
    const calls: ReturnType<typeof this.familySvc.transferMembers>[] = [];

    for (const item of this.distributionData) {
      const valid = item.assignments.filter(a => a.targetFamily && a.pending);
      if (!valid.length) continue;

      const memberIds = [item.servant.id];
      const primary = valid[0];
      const extras = valid.slice(1).map(a => ({
        family: String(a.targetFamily).trim(),
        role: String(a.targetRole).trim().toUpperCase()
      }));

      calls.push(
        this.familySvc.transferMembers(
          memberIds,
          primary.targetFamily,
          primary.targetRole,
          undefined,
          extras.length ? extras : undefined,
          this.selectedFamilyView
        )
      );
    }

    if (!calls.length) {
      this.message.add({ severity: 'warn', summary: 'لا يوجد تغييرات', detail: 'لم يتم تحديد أي أسر' });
      return;
    }

    forkJoin(calls).subscribe({
      next: () => {
        this.message.add({ severity: 'success', summary: 'تم', detail: 'تم حفظ التوزيعة' });
        this.memberCache.delete(this.memberCacheKey('SERVANTS', 'SERVANT'));
        this.closeDistribution();
        this.loadMembers();
      },
      error: (err) => {
        this.message.add({ severity: 'error', summary: 'خطأ', detail: err?.error?.error || 'فشل في الحفظ' });
      }
    });
  }

  private loadTargetFamilyMembers() {
    const fam = this.targetFamily;
    if (!fam || fam.startsWith('KHORS')) {
      this.targetFamilyMembers = [];
      return;
    }
    if (this.isAminOsra() && !this.isAminKhedmaOrDev()) {
      this.targetFamilyMembers = [];
      return;
    }
    const cached = this.targetFamilyCache.get(fam);
    if (cached) {
      this.targetFamilyMembers = cached;
      return;
    }
    this.targetFamilyLoading = true;
    this.familySvc.members(fam).subscribe({
      next: (m: any) => {
        const list: Member[] = m || [];
        this.targetFamilyCache.set(fam, list);
        if (this.targetFamily === fam) {
          this.targetFamilyMembers = list;
        }
        this.targetFamilyLoading = false;
      },
      error: () => {
        this.targetFamilyMembers = [];
        this.targetFamilyLoading = false;
      }
    });
  }
}

