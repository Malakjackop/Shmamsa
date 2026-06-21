import { Component, OnInit, inject } from '@angular/core';
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
  { label: 'طلب نقل لخورس مارمرقس', value: 'KHORS_REQUEST:MARMARKOS' }
];

  mode: TransferMode = 'MAKHDOM';
  selectedFamilyView = '';
  targetFamily = '';
  extraFamilies: Array<{ family: string; role: 'KHADIM' | 'AMIN_OSRA' | 'AMIN_KHEDMA' | 'MAKHDOM' }> = [];
  targetRole: 'KHADIM' | 'MAKHDOM' | 'AMIN_OSRA' | 'AMIN_KHEDMA' = 'KHADIM';

  targetFamilyMembers: Member[] = [];
  targetFamilyLoading = false;
  private targetFamilyCache = new Map<string, Member[]>();

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
    this.cancelSelecting();
    this.targetFamilyMembers = [];
    this.targetFamilyCache.clear();

    if (this.mode === 'MAKHDOM') {
      this.selectedFamilyView = this.selectedFamilyView || (this.servantFamilies[0] || '');
      this.targetFamily = this.targetFamily || (this.makhdomFamilies[0] || '');
    } else {
      this.targetFamily = this.servantFamilies[0] || '';
      this.extraFamilies = [];
      this.targetRole = 'KHADIM';
    }

    this.loadMembers();
    this.loadTargetFamilyMembers();
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
    this.selectedIds = new Set(this.members.map((m) => m.id));
  }

  cancelSelecting() {
    this.selecting = false;
    this.selectedIds.clear();
  }

  toggleMember(id: number, checked: boolean) {
    if (checked) this.selectedIds.add(id);
    else this.selectedIds.delete(id);
  }

  selectMemberForTransfer(member: Member) {
    if (this.selectedIds.has(member.id)) return;
    if (!this.selecting) {
      this.selecting = true;
      if (this.isMarmarkosView()) {
        this.targetFamily = this.marmarkosYearTargets[0]?.value || '';
      }
    }
    this.selectedIds.add(member.id);
  }

  isMemberSelected(member: Member): boolean {
    return this.selectedIds.has(member.id);
  }

  selectedMembers(): Member[] {
    return this.members.filter((member) => this.selectedIds.has(member.id));
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
    if (!this.selecting) {
      this.selecting = true;
      this.selectedIds.clear();
      if (this.isMarmarkosView()) {
        this.targetFamily = this.marmarkosYearTargets[0]?.value || '';
      }
    }
    if (this.selectedIds.has(member.id)) return;
    this.selectedIds.add(member.id);
  }

  onExtraFamilyDrop(event: CdkDragDrop<Member[]>, index: number) {
    if (!this.extraFamilies[index]) return;
    this.onMemberDrop(event);
  }

  doTransfer() {
    if (!this.targetFamily) {
      this.message.add({ severity: 'warn', summary: 'اختار اسره', detail: 'برجاء اختيار الاسره.' });
      return;
    }

    if (this.isAminKhedmaOrDev() && this.mode === 'SERVANT' && !this.targetRole) {
      this.message.add({ severity: 'warn', summary: 'اختار الدور', detail: 'برجاء اختيار الدور ' });
      return;
    }

    if (!this.selectedIds.size) {
      this.message.add({ severity: 'warn', summary: 'برجاء التحديد', detail: 'برجاء اختيار عضو واحد علي الاقل' });
      return;
    }

    const ids = Array.from(this.selectedIds);
    const roleLabel = this.getRoleLabel(this.targetRole);

    const msg = (this.isAminKhedmaOrDev() && this.mode === 'SERVANT')
      ? `تريد نقل  ${ids.length} مستخدم الي  "${this.targetFamily}" بدور  "${roleLabel}"؟`
      : `نقل ${ids.length} مستخدم الي  "${this.targetFamily}"؟`;

    this.confirm.confirm({
      header: 'تأكيد التحويل',
      message: msg,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'نقل',
      rejectLabel: 'الغاء',
      accept: () => {
        const roleToSend = (this.isAminKhedmaOrDev() && this.mode === 'SERVANT') ? this.targetRole : undefined;
        const extraAssignmentsToSend = (this.isAminKhedmaOrDev() && this.mode === 'SERVANT')
          ? this.extraFamilies
              .map(x => ({ family: String(x?.family || '').trim(), role: String(x?.role || 'KHADIM').trim().toUpperCase() }))
              .filter(x => !!x.family)
          : undefined;
        this.familySvc.transferMembers(ids, this.targetFamily, roleToSend, undefined, extraAssignmentsToSend, this.selectedFamilyView).subscribe({
          next: (res) => {
            const updated = res?.updated ?? 0;
            this.message.add({ severity: 'success', summary: 'نجح', detail: `تم نقل: ${updated}` });
            this.cancelSelecting();
            this.loadMembers();
          },
          error: (err) => {
            this.message.add({ severity: 'error', summary: 'خطأ', detail: err?.error?.error || 'فشل النقل' });
          }
        });
      }
    });
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
    this.extraFamilies.push({ family: '', role: 'KHADIM' });
  }

  removeExtraFamily(idx: number) {
    this.extraFamilies.splice(idx, 1);
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
    return this.isAminKhedmaOrDev() && this.mode === 'SERVANT';
  }

  onTargetFamilyChange() {
    this.loadTargetFamilyMembers();
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

