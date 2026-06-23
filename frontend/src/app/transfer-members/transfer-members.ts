import { Component, OnInit, inject, HostListener } from '@angular/core';
import { FamilyService } from '../services/family.service';
import { AuthService, FamilyOption } from '../services/auth.service';
import { MessageService, ConfirmationService } from 'primeng/api';
import { normalizeAssignmentRole, normalizeRole, roleLabel } from '../shared/role-utils';
import { DEFAULT_FAMILY_ORDER, canonicalFamilyName, sortFamiliesByPreferredOrder } from '../shared/family-utils';
import { forkJoin } from 'rxjs';
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

  transferredMap = new Map<number, Set<string>>();

  get hasPendingTransfers(): boolean {
    return this.transferredMap.size > 0;
  }

  pendingMainMembers: Member[] = [];

  get totalPending(): number {
    let count = this.pendingMainMembers.length;
    this.extraFamilies.forEach(ef => count += ef.members.length);
    return count;
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
    if (this.mode === 'SERVANT') {
      const ok = new Set(['KHADIM', 'AMIN_OSRA', 'AMIN_KHEDMA']);
      return this.targetFamilyMembers.filter(m => ok.has(normalizeRole(m.role)));
    }
    return this.targetFamilyMembers;
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

        this.servantFamilies = this.sortFamiliesByPreferredOrder(servantFromApi.length ? servantFromApi : this.servantFamilies);
        this.makhdomFamilies = this.sortFamiliesByPreferredOrder(memberFromApi.length ? memberFromApi : this.makhdomFamilies);

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
        if (mode === 'MAKHDOM' && this.isPapaAthanasiusView()) {
          list = list.filter((x: any) => !this.isTransferVisitor(x));
        }

        if (this.isAminKhedmaOrDev()) {
  if (mode === 'MAKHDOM') {

    if (!this.isChoirSelection()) {
      list = list.filter((x: any) => normalizeRole(x?.role) === 'MAKHDOM');
    }
  }
  if (mode === 'SERVANT') {
    const ok = new Set(['KHADIM', 'AMIN_OSRA', 'AMIN_KHEDMA']);
    list = list.filter((x: any) => ok.has(normalizeRole(x?.role)));
  }
        } else if (this.isKhadim()) {
          list = list.filter((x: any) => normalizeRole(x?.role) === 'MAKHDOM');
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
  const selected = this.canonicalFamilyName(fam);
  const assignments = this.assignmentsOf(m);
  for (const assignment of assignments) {
    if (this.canonicalFamilyName(assignment.familyName) === selected) {
      return this.getRoleLabel(assignment.role);
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
  const x = (this.selectedFamilyView || '').trim();
  return x === 'خورس البابا اثناسيوس';
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
          this.message.add({ severity: 'error', summary: 'خطأ', detail: err?.error?.error || 'فشل في المسح' });
        }
      });
    }
  });
}


  onModeChange() {
    this.pendingMainMembers = [];
    this.extraFamilies = [];
    this.targetFamilyMembers = [];
    this.targetFamilyCache.clear();

    if (this.mode === 'MAKHDOM') {
      this.selectedFamilyView = this.selectedFamilyView || (this.servantFamilies[0] || '');
      this.targetRole = 'MAKHDOM';
    } else {
      this.targetRole = 'KHADIM';
    }

    this.loadMembers();
    this.loadTargetFamilyMembers();
  }

  onFamilyViewChange() {
    this.loadMembers();
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

    mainIds.forEach(id => this.trackTransfer(id, this.targetFamily));
    this.extraFamilies.forEach(ef => {
      if (ef.family) ef.members.forEach(mId => this.trackTransfer(mId, ef.family));
    });
    this.saveTransferredMap();

    this.message.add({ severity: 'success', summary: 'تم الحفظ', detail: `تم حفظ التوزيع مؤقتاً، اضغط "نقل" لتأكيد النقل` });
    this.pendingMainMembers = [];
    this.extraFamilies.forEach(ef => ef.members = []);
  }

  executeAll() {
    if (this.totalPending === 0) return;

    const count = this.totalPending;
    const targetLabel = this.targetFamily || 'الأسرة الهدف';
    const msg = `نقل ${count} خادم الي "${targetLabel}"؟`;

    this.confirm.confirm({
      header: 'تأكيد النقل',
      message: msg,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'نقل',
      rejectLabel: 'الغاء',
      accept: () => {
        const mainIds = this.pendingMainMembers.map(m => m.id);
        const roleToSend = this.isAminKhedmaOrDev() ? this.targetRole : undefined;
        const extraAssignments = this.extraFamilies
          .filter(ef => ef.family && ef.members.length)
          .map(ef => ({ family: ef.family, role: ef.role || 'KHADIM' }));

        this.familySvc.transferMembers(
          mainIds,
          this.targetFamily,
          roleToSend,
          undefined,
          extraAssignments.length ? extraAssignments : undefined,
          ''
        ).subscribe({
          next: (res) => {
            const updated = res?.updated ?? 0;
            mainIds.forEach(id => this.trackTransfer(id, this.targetFamily));
            this.extraFamilies.forEach(ef => {
              if (ef.family) ef.members.forEach(mId => this.trackTransfer(mId, ef.family));
            });
            this.message.add({ severity: 'success', summary: 'تم النقل', detail: `تم نقل ${updated} خادم` });
            this.pendingMainMembers = [];
            this.extraFamilies.forEach(ef => ef.members = []);
            this.loadMembers();
            this.loadTargetFamilyMembers();
            this.transferredMap.clear();
            localStorage.removeItem('transfer_pending');
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
    return ['transferSelectedDrop', ...this.extraDropListIds()];
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

    this.pendingMainMembers.push(member);
  }

  removePendingMain(memberId: number) {
    this.pendingMainMembers = this.pendingMainMembers.filter(m => m.id !== memberId);
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
  }

  private trackTransfer(memberId: number, family: string) {
    if (!this.transferredMap.has(memberId)) {
      this.transferredMap.set(memberId, new Set());
    }
    this.transferredMap.get(memberId)!.add(family);
  }

  private saveTransferredMap() {
    const obj: Record<number, string[]> = {};
    this.transferredMap.forEach((families, id) => {
      obj[id] = Array.from(families);
    });
    localStorage.setItem('transfer_pending', JSON.stringify(obj));
  }

  private loadTransferredMap() {
    try {
      const raw = localStorage.getItem('transfer_pending');
      if (!raw) return;
      const obj = JSON.parse(raw) as Record<number, string[]>;
      this.transferredMap.clear();
      for (const [id, families] of Object.entries(obj)) {
        this.transferredMap.set(Number(id), new Set(families));
      }
    } catch {
      localStorage.removeItem('transfer_pending');
    }
  }

  transferredFamilies(memberId: number): string[] {
    return Array.from(this.transferredMap.get(memberId) || []);
  }

  transferredCount(memberId: number): number {
    return this.transferredMap.get(memberId)?.size ?? 0;
  }

  availableMainFamilies(): string[] {
    return this.servantFamilies.filter(f => f !== this.selectedFamilyView);
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
    return this.isAminKhedmaOrDev();
  }

  onTargetFamilyChange() {
    this.loadTargetFamilyMembers();
  }

  openDistribution() {
    this.distributionOpen = true;
    this.distributionFamilies = [...this.servantFamilies];
    const buildData = (list: Member[]) => list.map(s => {
      const existing = this.assignmentsOf(s)
        .filter(x => !this.isChoirBucket(x.familyName))
        .map(x => ({ targetFamily: x.familyName, targetRole: x.role, pending: false }));
      const transferredFamilies = this.transferredMap.get(s.id);
      const transfers = transferredFamilies
        ? Array.from(transferredFamilies).map(fam => ({ targetFamily: fam, targetRole: 'KHADIM', pending: true }))
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
    for (const item of this.distributionData) {
      if (item.servant.id === s.id) {
        return item.assignments.some(a => a.targetFamily === fam && a.pending);
      }
    }
    return false;
  }

  getDistServantsForFamily(fam: string): Member[] {
    const seen = new Set<number>();
    const result: Member[] = [];
    for (const item of this.distributionData) {
      for (const a of item.assignments) {
        if (a.targetFamily === fam && !seen.has(item.servant.id)) {
          seen.add(item.servant.id);
          result.push(item.servant);
        }
      }
    }
    return result;
  }

  getDistServantRole(s: Member): string {
    for (const item of this.distributionData) {
      if (item.servant.id === s.id && item.assignments.length) {
        return item.assignments[0].targetRole;
      }
    }
    return s.role;
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

