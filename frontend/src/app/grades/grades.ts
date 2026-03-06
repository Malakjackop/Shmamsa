import { Component, OnInit, inject } from '@angular/core';
import { MessageService } from 'primeng/api';
import { AuthService } from '../services/auth.service';
import { GradesService, GradeColumn, SheetView, MyGradesView, SheetPayload } from '../services/grades.service';
import { FamilyService } from '../services/family.service';

@Component({
  selector: 'app-grades',
  templateUrl: './grades.html',
  styleUrls: ['./grades.css'],
  standalone:false,
  providers: [MessageService]
})
export class GradesComponent implements OnInit {
  private auth = inject(AuthService);
  private gradesSvc = inject(GradesService);
  private familySvc = inject(FamilyService);
  private msg = inject(MessageService);

  me: any = null;

  viewMode: 'SERVANT' | 'MAKHDOM' = 'MAKHDOM';

  // servant mode
  familyChoices: string[] = [];
  selectedFamilyBase: string = '';
  sheet: SheetView | null = null;
  columns: GradeColumn[] = [];
  columnMeta: Record<string, { title: string; max: string }> = {};
  members: Array<{ id: number; fullName: string; values: Record<string,string> }> = [];
  rankedMembers: Array<{ id: number; fullName: string; values: Record<string,string> }> = [];
  rankViewEnabled = false;
  topThreeMemberIds = new Set<number>();
  rankByMemberId = new Map<number, number>();
  canEdit = false;
  canPublish = false;
  saving = false;
  publishing = false;
  private readonly titleMetaSeparator = '::max::';

  // makhdom mode
  my: MyGradesView | null = null;

  // confirmation modal (makhdom)
  showSchoolResultDialog = false;
  confirmingSchoolResult = false;
  selectedStudyYear = '';

  ngOnInit(): void {
    this.auth.getUserData(true).subscribe({
      next: (u) => {
        this.me = u;
        this.initMode();
      },
      error: () => {
        this.me = null;
        this.initMode();
      }
    });
  }

  private mainFamily(name: string): string {
    if (!name) return '';
    const f = String(name).trim();
    // نفس منطق backend: يشيل ( أ / ب )
    if (f.endsWith(' أ')) return f.slice(0, -2).trim();
    if (f.endsWith(' ب')) return f.slice(0, -2).trim();
    return f;
  }

  private normRole(v: any): string {
    const raw = String(v ?? '').trim();
    if (!raw) return '';
    const upper = raw.toUpperCase();

    // Arabic variants
    const ar = raw.replace(/\s+/g, ' ').trim();
    if (
      [
        'امين اسرة',
        'امين الاسرة',
        'أمين أسرة',
        'أمين الاسرة',
        'امين الأسرة',
        'أمين الأسرة',
        'امين اسرة'
      ].includes(ar)
    )
      return 'AMIN_OSRA';
    if (
      [
        'امين الخدمة',
        'امين الخدمه',
        'أمين الخدمة',
        'أمين الخدمه',
        'امين خدمه',
        'أمين خدمه'
      ].includes(ar)
    )
      return 'AMIN_KHEDMA';

    if (upper.startsWith('ROLE_')) return upper.substring(5);
    return upper;
  }

  private servantBasesFromMe(): string[] {
    const set = new Set<string>();
    const add = (x: any) => {
      const b = this.mainFamily(String(x || '').trim());
      if (b && b.toUpperCase() !== 'SYSTEM') set.add(b);
    };
    add(this.me?.deaconFamily);
    add(this.me?.deaconFamily2);
    add(this.me?.deaconFamily3);
    add(this.me?.deaconFamily4);
    return Array.from(set);
  }

  private hasAnyAminOsraScope(): boolean {
    const roles = [
      this.me?.deaconFamilyRole,
      this.me?.deaconFamilyRole2,
      this.me?.deaconFamilyRole3,
      this.me?.deaconFamilyRole4
    ].map((x: any) => this.normRole(x));
    return roles.includes('AMIN_OSRA');
  }
  private hasAminOsraScopeForBase(base: string): boolean {
    const b = this.mainFamily(String(base || '').trim()).toUpperCase();
    const fams = [
      { fam: this.me?.deaconFamily, role: this.me?.deaconFamilyRole },
      { fam: this.me?.deaconFamily2, role: this.me?.deaconFamilyRole2 },
      { fam: this.me?.deaconFamily3, role: this.me?.deaconFamilyRole3 },
      { fam: this.me?.deaconFamily4, role: this.me?.deaconFamilyRole4 },
    ];
    for (const x of fams) {
      const fb = this.mainFamily(String(x.fam || '').trim()).toUpperCase();
      const r = this.normRole(x.role);
      if (fb && fb === b && r === 'AMIN_OSRA') return true;
    }
    return false;
  }



  private initMode() {
    const role = String(this.me?.role || 'MAKHDOM').toUpperCase().trim();
    const servantOrAbove = ['KHADIM','AMIN_OSRA','AMIN_KHEDMA','DEVELOPER'].includes(role) || this.hasAnyAminOsraScope();
    this.viewMode = servantOrAbove ? 'SERVANT' : 'MAKHDOM';

    if (this.viewMode === 'MAKHDOM') {
      this.loadMyGrades();
      return;
    }

    // SERVANT
    const bases = this.servantBasesFromMe();
    // AMIN_KHEDMA / DEV ممكن يكون SYSTEM -> نجيب قائمة الأسر من endpoint families (لو متاحة)
    if (['AMIN_KHEDMA','DEVELOPER'].includes(role)) {
      this.familySvc.families().subscribe({
        next: (f) => {
          const list = (f || []).map((x) => this.mainFamily(x)).filter(Boolean);
          this.familyChoices = Array.from(new Set(list));
          this.selectedFamilyBase = this.familyChoices[0] || '';
          this.refreshPerms();
          if (this.selectedFamilyBase) this.loadSheet();
        },
        error: () => {
          this.familyChoices = bases;
          this.selectedFamilyBase = bases[0] || '';
          this.refreshPerms();
          if (this.selectedFamilyBase) this.loadSheet();
        }
      });
    } else {
      this.familyChoices = bases.length ? bases : [this.mainFamily(this.me?.deaconFamily)];
      this.familyChoices = this.familyChoices.filter(Boolean);
      this.selectedFamilyBase = this.familyChoices[0] || '';
      this.refreshPerms();
      if (this.selectedFamilyBase) this.loadSheet();
    }
  }

  private refreshPerms() {
    const role = String(this.me?.role || 'MAKHDOM').toUpperCase().trim();
    // edit: khadim+ in general (backend will enforce scope)
    this.canEdit = ['KHADIM','AMIN_OSRA','AMIN_KHEDMA','DEVELOPER'].includes(role) || this.hasAnyAminOsraScope();
    // publish: amin osra (scoped for selected family) or above
    this.canPublish = ['AMIN_KHEDMA','DEVELOPER'].includes(role) || (role === 'AMIN_OSRA' && this.mainFamily(this.me?.deaconFamily) === this.selectedFamilyBase) || this.hasAminOsraScopeForBase(this.selectedFamilyBase);
}

  loadSheet() {
    if (!this.selectedFamilyBase) return;
    this.refreshPerms();
    this.gradesSvc.getSheet(this.selectedFamilyBase).subscribe({
      next: (s) => {
        this.sheet = s;
        this.columns = (s.columns || []).map((c) => ({ id: c.id, title: c.title }));
        this.columnMeta = {};
        for (const c of this.columns) {
          this.columnMeta[c.id] = this.parseColumnTitle(c.title);
        }
        this.members = (s.members || []).map((m) => ({
          id: m.id,
          fullName: m.fullName,
          values: { ...(m.values || {}) }
        }));
        this.rankViewEnabled = false;
        this.rebuildMembersView();
      },
      error: (err: any) => {
        this.msg.add({ severity: 'error', summary: 'خطأ', detail: 'فشل تحميل الدرجات' });
        this.sheet = null;
        this.columns = [];
        this.members = [];
        this.rankedMembers = [];
        this.topThreeMemberIds.clear();
        this.rankByMemberId.clear();
      }
    });
  }

  addColumn() {
    if (!this.canEdit) return;
    const id = 'c_' + Math.random().toString(16).slice(2, 10);
    this.columns.push({ id, title: '' });
    this.columnMeta[id] = { title: '', max: '' };
    // add empty values for all members
    this.members = this.members.map((m) => {
      m.values[id] = '';
      return m;
    });
    this.rebuildMembersView();
  }

  removeColumn(colId: string): void {
    if (!this.canEdit) return;
    if (this.columns.length <= 1) {
      this.msg.add({ severity: 'warn', summary: 'تنبيه', detail: 'لا يمكن حذف آخر عمود' });
      return;
    }
    this.columns = this.columns.filter((c) => c.id !== colId);
    delete this.columnMeta[colId];
    this.members = this.members.map((m) => {
      const nextValues = { ...(m.values || {}) };
      delete nextValues[colId];
      return { ...m, values: nextValues };
    });
    this.rebuildMembersView();
  }

  toggleTopRanksView(): void {
    this.rankViewEnabled = !this.rankViewEnabled;
    this.rebuildMembersView();
  }

  onMemberValueChange(): void {
    this.rebuildMembersView();
  }

  isTopThreeMember(memberId: number): boolean {
    if (!this.rankViewEnabled) return false;
    return this.topThreeMemberIds.has(memberId);
  }

  getDisplayedRank(memberId: number, fallbackRank: number): number {
    if (!this.rankViewEnabled) return fallbackRank;
    return this.rankByMemberId.get(memberId) ?? fallbackRank;
  }

  setColumnTitle(colId: string, title: string): void {
    const meta = this.columnMeta[colId] || { title: '', max: '' };
    meta.title = String(title ?? '');
    this.columnMeta[colId] = meta;
  }

  setColumnMax(colId: string, max: string): void {
    const meta = this.columnMeta[colId] || { title: '', max: '' };
    meta.max = String(max ?? '');
    this.columnMeta[colId] = meta;
  }

  private buildPayload(): SheetPayload {
    const cols: GradeColumn[] = this.columns.map((c) => {
      const meta = this.columnMeta[c.id] || { title: '', max: '' };
      return { id: c.id, title: this.composeColumnTitle(meta.title, meta.max) };
    });
    const rows: Record<string, Record<string, string>> = {};
    for (const m of this.members) {
      const uid = String(m.id);
      rows[uid] = {};
      for (const c of cols) {
        rows[uid][c.id] = String(m.values?.[c.id] ?? '');
      }
    }
    return { columns: cols, rows };
  }

  formatColumnTitleForView(rawTitle: string): string {
    return this.parseColumnTitle(rawTitle).title || '-';
  }

  formatColumnMaxForView(rawTitle: string): string {
    return this.parseColumnTitle(rawTitle).max;
  }

  rowTotal(values: Record<string, string> | undefined): number {
    if (!values) return 0;
    let total = 0;
    for (const c of this.columns) {
      total += this.parseNumber(values[c.id]);
    }
    return total;
  }

  rowTotalForColumns(values: Record<string, string> | undefined, cols: GradeColumn[] | undefined): number {
    if (!values || !cols?.length) return 0;
    let total = 0;
    for (const c of cols) {
      total += this.parseNumber(values[c.id]);
    }
    return total;
  }

  columnsMaxTotal(): number {
    let total = 0;
    for (const c of this.columns) {
      const maxVal = this.columnMeta[c.id]?.max || '';
      total += this.parseNumber(maxVal);
    }
    return total;
  }

  columnsMaxTotalForColumns(cols: GradeColumn[] | undefined): number {
    if (!cols?.length) return 0;
    let total = 0;
    for (const c of cols) {
      total += this.parseNumber(this.parseColumnTitle(c.title).max);
    }
    return total;
  }

  private parseColumnTitle(rawTitle: string): { title: string; max: string } {
    const raw = String(rawTitle ?? '');
    const parts = raw.split(this.titleMetaSeparator);
    if (parts.length < 2) {
      return { title: raw, max: '' };
    }
    return {
      title: parts[0] ?? '',
      max: parts.slice(1).join(this.titleMetaSeparator)
    };
  }

  private composeColumnTitle(title: string, max: string): string {
    const cleanTitle = String(title ?? '').trim();
    const cleanMax = String(max ?? '').trim();
    if (!cleanMax) return cleanTitle;
    return `${cleanTitle}${this.titleMetaSeparator}${cleanMax}`;
  }

  private parseNumber(input: string | null | undefined): number {
    const raw = String(input ?? '').trim();
    if (!raw) return 0;
    const normalizedDigits = raw.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
    const cleaned = normalizedDigits.replace(/,/g, '.').replace(/[^\d.\-]/g, '');
    const val = Number(cleaned);
    return Number.isFinite(val) ? val : 0;
  }

  private rebuildMembersView(): void {
    const ranked = [...this.members].sort((a, b) => {
      const totalDiff = this.rowTotal(b.values) - this.rowTotal(a.values);
      if (totalDiff !== 0) return totalDiff;
      return a.fullName.localeCompare(b.fullName, 'ar');
    });

    const rankMap = new Map<number, number>();
    const highlightedIds = new Set<number>();
    let lastTotal: number | null = null;
    let currentRank = 0;

    for (const m of ranked) {
      const total = this.rowTotal(m.values);
      if (lastTotal === null || total !== lastTotal) {
        currentRank += 1;
        lastTotal = total;
      }
      rankMap.set(m.id, currentRank);
      if (currentRank <= 3) {
        highlightedIds.add(m.id);
      }
    }

    this.rankByMemberId = rankMap;
    this.topThreeMemberIds = highlightedIds;
    this.rankedMembers = this.rankViewEnabled ? ranked : [...this.members];
  }
  save() {
    if (!this.canEdit || !this.selectedFamilyBase) return;
    this.saving = true;
    const payload = this.buildPayload();
    this.gradesSvc.saveSheet(this.selectedFamilyBase, payload).subscribe({
      next: () => {
        this.saving = false;
        this.msg.add({ severity: 'success', summary: 'تم', detail: 'تم الحفظ' });
        this.loadSheet();
      },
      error: (err: any) => {
        this.saving = false;
        this.msg.add({ severity: 'error', summary: 'خطأ', detail: 'فشل الحفظ' });
      }
    });
  }

  publish() {
    if (!this.canPublish || !this.selectedFamilyBase) return;
    this.publishing = true;
    this.gradesSvc.publishSheet(this.selectedFamilyBase).subscribe({
      next: () => {
        this.publishing = false;
        this.msg.add({ severity: 'success', summary: 'تم', detail: 'تم النشر' });
        this.loadSheet();
      },
      error: (err: any) => {
        this.publishing = false;
        this.msg.add({ severity: 'error', summary: 'خطأ', detail: 'فشل النشر (تأكد أن الحساب أمين أسرة على هذه الأسرة)' });
      }
    });
  }

  private loadMyGrades() {
    this.gradesSvc.myGrades().subscribe({
      next: (v) => {
        this.my = v;
        this.maybeAskForSchoolResult();
      },
      error: () => this.my = { familyBase: this.mainFamily(this.me?.deaconFamily), columns: [], values: {}, publishedAt: null }
    });
  }

  private maybeAskForSchoolResult(): void {
    if (this.viewMode !== 'MAKHDOM') return;
    if (!this.my?.publishedAt || this.isGraduate()) {
      this.showSchoolResultDialog = false;
      return;
    }

    const base = String(this.my?.familyBase || '').trim();
    const pub = String(this.my?.publishedAt || '').trim();

    const lastBase = String(this.me?.lastSchoolResultFamilyBase || '').trim();
    const lastPub = String(this.me?.lastSchoolResultPublishedAt || '').trim();

    this.selectedStudyYear = this.currentStudyYear();
    this.showSchoolResultDialog = !(lastBase === base && lastPub === pub);
  }

  private normalizeArabicText(value: any): string {
    return String(value ?? '')
      .trim()
      .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
      .replace(/[أإآ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  private canonicalSchoolGrade(raw: string): string {
    const value = this.normalizeArabicText(raw);
    const aliases: Record<string, string> = {
      'grade1_primary': 'اولى ابتدائي',
      'اولى ابتدائي': 'اولى ابتدائي',
      'اولي ابتدائي': 'اولى ابتدائي',
      'اوله ابتدائي': 'اولى ابتدائي',
      'اول ابتدائي': 'اولى ابتدائي',

      'grade2_primary': 'تانيه ابتدائي',
      'تانيه ابتدائي': 'تانيه ابتدائي',
      'ثانيه ابتدائي': 'تانيه ابتدائي',
      'ثاني ابتدائي': 'تانيه ابتدائي',
      'ثانيه ابتدائية': 'تانيه ابتدائي',
      'تانيه ابتدائية': 'تانيه ابتدائي',

      'grade3_primary': 'تالته ابتدائي',
      'تالته ابتدائي': 'تالته ابتدائي',
      'ثالثه ابتدائي': 'تالته ابتدائي',
      'ثالث ابتدائي': 'تالته ابتدائي',
      'ثالثه ابتدائية': 'تالته ابتدائي',
      'تالته ابتدائية': 'تالته ابتدائي',

      'grade4_primary': 'رابعه ابتدائي',
      'رابعه ابتدائي': 'رابعه ابتدائي',
      'رابع ابتدائي': 'رابعه ابتدائي',
      'رابعه ابتدائية': 'رابعه ابتدائي',

      'grade5_primary': 'خامسه ابتدائي',
      'خامسه ابتدائي': 'خامسه ابتدائي',
      'خامس ابتدائي': 'خامسه ابتدائي',
      'خامسه ابتدائية': 'خامسه ابتدائي',

      'grade6_primary': 'سادسه ابتدائي',
      'سادسه ابتدائي': 'سادسه ابتدائي',
      'سادس ابتدائي': 'سادسه ابتدائي',
      'سادسه ابتدائية': 'سادسه ابتدائي',

      'grade1_prep': 'اولى اعدادي',
      'اولى اعدادي': 'اولى اعدادي',
      'اولي اعدادي': 'اولى اعدادي',
      'اوله اعدادي': 'اولى اعدادي',
      'اول اعدادي': 'اولى اعدادي',
      'اولى اعدادية': 'اولى اعدادي',

      'grade2_prep': 'تانيه اعدادي',
      'تانيه اعدادي': 'تانيه اعدادي',
      'ثانيه اعدادي': 'تانيه اعدادي',
      'ثاني اعدادي': 'تانيه اعدادي',
      'ثانيه اعدادية': 'تانيه اعدادي',
      'تانيه اعدادية': 'تانيه اعدادي',

      'grade3_prep': 'تالته اعدادي',
      'تالته اعدادي': 'تالته اعدادي',
      'ثالثه اعدادي': 'تالته اعدادي',
      'ثالث اعدادي': 'تالته اعدادي',
      'ثالثه اعدادية': 'تالته اعدادي',
      'تالته اعدادية': 'تالته اعدادي',

      'grade1_secondary': 'اولى ثانوي',
      'اولى ثانوي': 'اولى ثانوي',
      'اولي ثانوي': 'اولى ثانوي',
      'اوله ثانوي': 'اولى ثانوي',
      'اول ثانوي': 'اولى ثانوي',
      'اولى ثانويه': 'اولى ثانوي',

      'grade2_secondary': 'تانيه ثانوي',
      'تانيه ثانوي': 'تانيه ثانوي',
      'ثانيه ثانوي': 'تانيه ثانوي',
      'ثاني ثانوي': 'تانيه ثانوي',
      'ثانيه ثانويه': 'تانيه ثانوي',
      'تانيه ثانويه': 'تانيه ثانوي',

      'grade3_secondary': 'تالته ثانوي',
      'تالته ثانوي': 'تالته ثانوي',
      'ثالثه ثانوي': 'تالته ثانوي',
      'ثالث ثانوي': 'تالته ثانوي',
      'ثالثه ثانويه': 'تالته ثانوي',
      'تالته ثانويه': 'تالته ثانوي'
    };
    return aliases[value] || String(raw || '').trim();
  }

  private schoolGradeMap(raw: string): string {
    return this.canonicalSchoolGrade(raw);
  }

  private nextSchoolGrade(raw: string): string {
    const orderedGrades = [
      'اولى ابتدائي',
      'تانيه ابتدائي',
      'تالته ابتدائي',
      'رابعه ابتدائي',
      'خامسه ابتدائي',
      'سادسه ابتدائي',
      'اولى اعدادي',
      'تانيه اعدادي',
      'تالته اعدادي',
      'اولى ثانوي',
      'تانيه ثانوي',
      'تالته ثانوي'
    ];

    const current = this.canonicalSchoolGrade(raw);
    const normalizedCurrent = this.normalizeArabicText(current);
    const index = orderedGrades.findIndex((g) => this.normalizeArabicText(g) === normalizedCurrent);
    if (index === -1) return current;
    if (index >= orderedGrades.length - 1) return orderedGrades[index];
    return orderedGrades[index + 1];
  }

  isGraduate(): boolean {
    const status = this.normalizeArabicText(this.me?.status);
    return status === 'graduate' || status === 'خريج';
  }

  isUniversityStudent(): boolean {
    const studyType = this.normalizeArabicText(this.me?.studyType);
    return studyType === 'university' || studyType === 'جامعه' || studyType === 'جامعة';
  }

  isSchoolStudent(): boolean {
    return !this.isGraduate() && !this.isUniversityStudent();
  }

  currentStudyYear(): string {
    if (this.isUniversityStudent()) return String(this.me?.universityGrade || '').trim();
    return this.schoolGradeMap(String(this.me?.schoolGrade || '').trim());
  }

  nextSchoolStudyYear(): string {
    return this.nextSchoolGrade(String(this.me?.schoolGrade || '').trim());
  }

  hasSelectedStudyYear(): boolean {
    return !!String(this.selectedStudyYear || '').trim();
  }

  saveStudyYear(year: string): void {
    const selected = String(year || '').trim();
    if (!selected || this.confirmingSchoolResult || !this.my?.publishedAt) return;

    this.confirmingSchoolResult = true;
    this.gradesSvc.confirmSchoolResult('PASS', this.my?.familyBase, selected).subscribe({
      next: () => {
        this.auth.refreshUser().subscribe({
          next: (u) => {
            this.me = u;
            this.selectedStudyYear = selected;
            this.confirmingSchoolResult = false;
            this.showSchoolResultDialog = false;
          },
          error: () => {
            this.confirmingSchoolResult = false;
            this.showSchoolResultDialog = false;
          }
        });
      },
      error: () => {
        this.confirmingSchoolResult = false;
        this.msg.add({ severity: 'error', summary: 'خطأ', detail: 'حصل خطأ أثناء تسجيل السنة الدراسية' });
      }
    });
  }
}








