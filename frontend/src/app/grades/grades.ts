import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { MessageService } from 'primeng/api';
import { forkJoin } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { GradesService, GradeColumn, SheetView, MyGradesView, SheetPayload, ResultTerm } from '../services/grades.service';
import { FamilyService } from '../services/family.service';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { normalizeAssignmentRole, normalizeRole } from '../shared/role-utils';
import { createPdfText, ensureDejaVuFont } from '../shared/pdf-utils';

@Component({
  selector: 'app-grades',
  templateUrl: './grades.html',
  styleUrls: ['./grades.css'],
  standalone: false,
  providers: [MessageService]
})
export class GradesComponent implements OnInit, OnDestroy {
  private auth = inject(AuthService);
  private gradesSvc = inject(GradesService);
  private familySvc = inject(FamilyService);
  private msg = inject(MessageService);

  me: any = null;
  viewMode: 'SERVANT' | 'MAKHDOM' = 'MAKHDOM';

  familyChoices: string[] = [];
  selectedFamilyBase = '';
  selectedTerm: ResultTerm = 'FIRST';

  sheet: SheetView | null = null;
  columns: GradeColumn[] = [];
  columnMeta: Record<string, { title: string; max: string }> = {};
  members: Array<{ id: number; fullName: string; values: Record<string, string> }> = [];
  rankedMembers: Array<{ id: number; fullName: string; values: Record<string, string> }> = [];

  bothFirstSheet: SheetView | null = null;
  bothSecondSheet: SheetView | null = null;
  bothFirstColumns: GradeColumn[] = [];
  bothFirstMembers: Array<{ id: number; fullName: string; values: Record<string, string> }> = [];
  bothSecondColumns: GradeColumn[] = [];
  bothSecondMembers: Array<{ id: number; fullName: string; values: Record<string, string> }> = [];

  rankViewEnabled = false;
  topThreeMemberIds = new Set<number>();
  rankByMemberId = new Map<number, number>();
  combinedTopThreeMemberIds = new Set<number>();
  combinedRankByMemberId = new Map<number, number>();
  combinedMembers: Array<{ id: number; fullName: string; firstTotal: number; secondTotal: number; allTotal: number }> = [];
  canEdit = false;
  canPublish = false;
  saving = false;
  publishing = false;
  familyMenuLocked = false;
  autoSavePending = false;
  lastSavedAt: string | null = null;
  private readonly titleMetaSeparator = '::max::';
  private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private hasUnsavedChanges = false;
  private readonly autoSaveDelayMs = 1200;

  my: MyGradesView | null = null;
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

  ngOnDestroy(): void {
    this.clearAutoSaveTimer();
  }

  private mainFamily(name: string): string {
    if (!name) return '';
    const f = String(name).trim();
    if (f.endsWith(' أ')) return f.slice(0, -2).trim();
    if (f.endsWith(' ب')) return f.slice(0, -2).trim();
    return f;
  }

  private normRole(v: any): string {
    return normalizeRole(v);
  }

  private assignmentsOf(entity: any): Array<{ familyName: string; role: string }> {
    const assignments = Array.isArray(entity?.familyAssignments) ? entity.familyAssignments : [];
    return assignments
      .map((x: any) => ({
        familyName: String(x?.familyName || '').trim(),
        role: normalizeAssignmentRole(x, entity?.role)
      }))
      .filter((x: any) => !!x.familyName);
  }

  private servantBasesFromMe(): string[] {
    const set = new Set<string>();
    const add = (x: any) => {
      const b = this.mainFamily(String(x || '').trim());
      if (b && b.toUpperCase() !== 'SYSTEM') set.add(b);
    };
    for (const assignment of this.assignmentsOf(this.me)) add(assignment.familyName);
    return Array.from(set);
  }

  private hasAnyAminOsraScope(): boolean {
    const roles = this.assignmentsOf(this.me).map((x) => x.role);
    return roles.includes('AMIN_OSRA');
  }

  private hasAminOsraScopeForBase(base: string): boolean {
    const b = this.mainFamily(String(base || '').trim()).toUpperCase();
    for (const x of this.assignmentsOf(this.me)) {
      const fb = this.mainFamily(String(x.familyName || '').trim()).toUpperCase();
      const r = x.role;
      if (fb && fb === b && r === 'AMIN_OSRA') return true;
    }
    return false;
  }

  private initMode() {
    const role = normalizeRole(this.me?.role) || 'MAKHDOM';
    const servantOrAbove = ['KHADIM', 'AMIN_OSRA', 'AMIN_KHEDMA', 'DEVELOPER'].includes(role) || this.hasAnyAminOsraScope();
    this.viewMode = servantOrAbove ? 'SERVANT' : 'MAKHDOM';

    if (this.viewMode === 'MAKHDOM') {
      this.loadMyGrades();
      return;
    }

    const bases = this.servantBasesFromMe();
    if (['AMIN_KHEDMA', 'DEVELOPER'].includes(role)) {
      this.familySvc.families().subscribe({
        next: (f) => {
          const list = (f || []).map((x: any) => this.mainFamily(x)).filter(Boolean);
          this.familyChoices = Array.from(new Set(list));
          this.selectedFamilyBase = this.familyChoices[0] || '';
          this.refreshPerms();
          if (this.selectedFamilyBase) this.loadServantView();
        },
        error: () => {
          this.familyChoices = bases;
          this.selectedFamilyBase = bases[0] || '';
          this.refreshPerms();
          if (this.selectedFamilyBase) this.loadServantView();
        }
      });
    } else {
      this.familyChoices = (bases.length ? bases : [this.mainFamily(this.assignmentsOf(this.me)[0]?.familyName || '')]).filter(Boolean);
      this.selectedFamilyBase = this.familyChoices[0] || '';
      this.refreshPerms();
      if (this.selectedFamilyBase) this.loadServantView();
    }
  }

  private refreshPerms() {
    const role = normalizeRole(this.me?.role) || 'MAKHDOM';
    this.canEdit = ['KHADIM', 'AMIN_OSRA', 'AMIN_KHEDMA', 'DEVELOPER'].includes(role) || this.hasAnyAminOsraScope();
    this.canPublish = ['AMIN_KHEDMA', 'DEVELOPER'].includes(role) || (role === 'AMIN_OSRA' && this.mainFamily(this.assignmentsOf(this.me)[0]?.familyName || '') === this.selectedFamilyBase) || this.hasAminOsraScopeForBase(this.selectedFamilyBase);
  }

  onServantTermChange(): void {
    this.loadServantView();
  }

  getFamilyLabel(family: string): string {
    return String(family || '').trim() || '-';
  }

  selectGradeFamily(family: string): void {
    this.familyMenuLocked = true;
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    if (this.selectedFamilyBase === family) return;
    this.selectedFamilyBase = family;
    this.loadServantView();
  }

  unlockFamilyMenu(): void {
    this.familyMenuLocked = false;
  }

  onFamilyMenuEnter(): void {
    this.familyMenuLocked = false;
  }

  loadServantView(): void {
    if (!this.selectedFamilyBase) return;
    this.refreshPerms();

    if (this.selectedTerm === 'BOTH') {
      forkJoin({
        first: this.gradesSvc.getSheet(this.selectedFamilyBase, 'FIRST'),
        second: this.gradesSvc.getSheet(this.selectedFamilyBase, 'SECOND')
      }).subscribe({
        next: ({ first, second }) => {
          this.resetAutoSaveState();
          this.sheet = null;
          this.bothFirstSheet = first;
          this.bothSecondSheet = second;
          this.bothFirstColumns = (first.columns || []).map((c) => ({ ...c }));
          this.bothSecondColumns = (second.columns || []).map((c) => ({ ...c }));
          this.bothFirstMembers = (first.members || []).map((m) => ({ id: m.id, fullName: m.fullName, values: { ...(m.values || {}) } }));
          this.bothSecondMembers = (second.members || []).map((m) => ({ id: m.id, fullName: m.fullName, values: { ...(m.values || {}) } }));
          this.columns = [];
          this.members = [];
          this.rankedMembers = [];
          this.rebuildCombinedMembersView();
        },
        error: () => this.msg.add({ severity: 'error', summary: 'خطأ', detail: 'فشل تحميل الدرجات' })
      });
      return;
    }

    this.bothFirstSheet = null;
    this.bothSecondSheet = null;
    this.bothFirstColumns = [];
    this.bothSecondColumns = [];
    this.bothFirstMembers = [];
    this.bothSecondMembers = [];

    this.gradesSvc.getSheet(this.selectedFamilyBase, this.selectedTerm).subscribe({
      next: (s) => {
        this.resetAutoSaveState();
        this.sheet = s;
        this.lastSavedAt = s.updatedAt || null;
        this.columns = (s.columns || []).map((c) => ({ id: c.id, title: c.title }));
        this.columnMeta = {};
        for (const c of this.columns) this.columnMeta[c.id] = this.parseColumnTitle(c.title);
        this.members = (s.members || []).map((m) => ({ id: m.id, fullName: m.fullName, values: { ...(m.values || {}) } }));
        this.rankViewEnabled = false;
        this.rebuildMembersView();
      },
      error: () => {
        this.msg.add({ severity: 'error', summary: 'خطأ', detail: 'فشل تحميل الدرجات' });
        this.sheet = null;
        this.columns = [];
        this.members = [];
        this.rankedMembers = [];
      }
    });
  }

  addColumn() {
    if (!this.canEdit || this.selectedTerm === 'BOTH') return;
    const id = 'c_' + Math.random().toString(16).slice(2, 10);
    this.columns.push({ id, title: '' });
    this.columnMeta[id] = { title: '', max: '' };
    this.members = this.members.map((m) => ({ ...m, values: { ...(m.values || {}), [id]: '' } }));
    this.rebuildMembersView();
    this.scheduleAutoSave();
  }

  removeColumn(colId: string): void {
    if (!this.canEdit || this.selectedTerm === 'BOTH') return;
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
    this.scheduleAutoSave();
  }

  toggleTopRanksView(): void {
    this.rankViewEnabled = !this.rankViewEnabled;
    if (this.selectedTerm === 'BOTH') {
      this.rebuildCombinedMembersView();
    } else {
      this.rebuildMembersView();
    }
  }

  onMemberValueChange(): void {
    this.rebuildMembersView();
    this.scheduleAutoSave();
  }

  isTopThreeMember(memberId: number): boolean {
    return this.rankViewEnabled && this.topThreeMemberIds.has(memberId);
  }

  getDisplayedRank(memberId: number, fallbackRank: number): number {
    return this.rankViewEnabled ? (this.rankByMemberId.get(memberId) ?? fallbackRank) : fallbackRank;
  }

  setColumnTitle(colId: string, title: string): void {
    const meta = this.columnMeta[colId] || { title: '', max: '' };
    meta.title = String(title ?? '');
    this.columnMeta[colId] = meta;
    this.scheduleAutoSave();
  }

  setColumnMax(colId: string, max: string): void {
    const meta = this.columnMeta[colId] || { title: '', max: '' };
    meta.max = String(max ?? '');
    this.columnMeta[colId] = meta;
    this.scheduleAutoSave();
  }

  autoSaveStatusText(): string {
    if (this.selectedTerm === 'BOTH' || this.viewMode !== 'SERVANT' || !this.canEdit) return '';
    if (this.saving) return 'جاري الحفظ...';
    if (this.autoSavePending) return 'سيتم الحفظ تلقائيًا...';
    if (this.lastSavedAt) return `آخر حفظ: ${new Date(this.lastSavedAt).toLocaleString('ar-EG')}`;
    return 'الحفظ التلقائي مفعل';
  }

  private scheduleAutoSave(): void {
    if (!this.canEdit || !this.selectedFamilyBase || this.selectedTerm === 'BOTH') return;
    this.hasUnsavedChanges = true;
    this.autoSavePending = true;
    this.clearAutoSaveTimer();
    this.autoSaveTimer = setTimeout(() => {
      this.autoSaveTimer = null;
      this.persistSheet(false);
    }, this.autoSaveDelayMs);
  }

  private clearAutoSaveTimer(): void {
    if (!this.autoSaveTimer) return;
    clearTimeout(this.autoSaveTimer);
    this.autoSaveTimer = null;
  }

  private resetAutoSaveState(): void {
    this.clearAutoSaveTimer();
    this.autoSavePending = false;
    this.hasUnsavedChanges = false;
  }

  private buildPayload(): SheetPayload {
    const cols: GradeColumn[] = this.columns.map((c) => {
      const meta = this.columnMeta[c.id] || { title: '', max: '' };
      return { id: c.id, title: this.composeColumnTitle(meta.title, meta.max) };
    });
    const rows: Record<string, Record<string, string>> = {};
    for (const m of this.members) {
      rows[String(m.id)] = {};
      for (const c of cols) rows[String(m.id)][c.id] = String(m.values?.[c.id] ?? '');
    }
    return { columns: cols, rows };
  }

  formatColumnTitleForView(rawTitle: string): string {
    return this.parseColumnTitle(rawTitle).title || '-';
  }

  formatColumnMaxForView(rawTitle: string): string {
    return this.parseColumnTitle(rawTitle).max;
  }

  fullColumnLabelForView(rawTitle: string): string {
    const parsed = this.parseColumnTitle(rawTitle);
    const title = String(parsed.title || '').trim() || '-';
    const max = String(parsed.max || '').trim();
    return max ? `${title} / ${max}` : title;
  }

  currentColumnLabel(colId: string): string {
    const meta = this.columnMeta[colId] || { title: '', max: '' };
    const title = String(meta.title || '').trim() || '-';
    const max = String(meta.max || '').trim();
    return max ? `${title} / ${max}` : title;
  }

  currentTotalLabel(): string {
    const total = this.columnsMaxTotal();
    return total > 0 ? `المجموع / ${total}` : 'المجموع';
  }

  rowTotal(values: Record<string, string> | undefined): number {
    return this.rowTotalForColumns(values, this.columns);
  }

  rowTotalForColumns(values: Record<string, string> | undefined, cols: GradeColumn[] | undefined): number {
    if (!values || !cols?.length) return 0;
    let total = 0;
    for (const c of cols) total += this.parseNumber(values[c.id]);
    return total;
  }

  columnsMaxTotal(): number {
    let total = 0;
    for (const c of this.columns) total += this.parseNumber(this.columnMeta[c.id]?.max || '');
    return total;
  }

  columnsMaxTotalForColumns(cols: GradeColumn[] | undefined): number {
    if (!cols?.length) return 0;
    let total = 0;
    for (const c of cols) total += this.parseNumber(this.parseColumnTitle(c.title).max);
    return total;
  }

  private buildCombinedServantMembers(): Array<{ id: number; fullName: string; firstTotal: number; secondTotal: number; allTotal: number }> {
    const map = new Map<number, { id: number; fullName: string; firstTotal: number; secondTotal: number; allTotal: number }>();
    for (const m of this.bothFirstMembers) {
      map.set(m.id, {
        id: m.id,
        fullName: m.fullName,
        firstTotal: this.rowTotalForColumns(m.values, this.bothFirstColumns),
        secondTotal: 0,
        allTotal: this.rowTotalForColumns(m.values, this.bothFirstColumns)
      });
    }
    for (const m of this.bothSecondMembers) {
      const current = map.get(m.id) || { id: m.id, fullName: m.fullName, firstTotal: 0, secondTotal: 0, allTotal: 0 };
      current.secondTotal = this.rowTotalForColumns(m.values, this.bothSecondColumns);
      current.allTotal = current.firstTotal + current.secondTotal;
      map.set(m.id, current);
    }
    return Array.from(map.values()).sort((a, b) => b.allTotal - a.allTotal || a.fullName.localeCompare(b.fullName, 'ar'));
  }

  combinedServantMembers(): Array<{ id: number; fullName: string; firstTotal: number; secondTotal: number; allTotal: number }> {
    return this.combinedMembers;
  }

  isCombinedTopThreeMember(memberId: number): boolean {
    return this.rankViewEnabled && this.combinedTopThreeMemberIds.has(memberId);
  }

  getCombinedDisplayedRank(memberId: number, fallbackRank: number): number {
    return this.rankViewEnabled ? (this.combinedRankByMemberId.get(memberId) ?? fallbackRank) : fallbackRank;
  }

  private parseColumnTitle(rawTitle: string): { title: string; max: string } {
    const raw = String(rawTitle ?? '');
    const parts = raw.split(this.titleMetaSeparator);
    if (parts.length < 2) return { title: raw, max: '' };
    return { title: parts[0] ?? '', max: parts.slice(1).join(this.titleMetaSeparator) };
  }

  private composeColumnTitle(title: string, max: string): string {
    const cleanTitle = String(title ?? '').trim();
    const cleanMax = String(max ?? '').trim();
    return cleanMax ? `${cleanTitle}${this.titleMetaSeparator}${cleanMax}` : cleanTitle;
  }

  private parseNumber(input: string | null | undefined): number {
    const raw = String(input ?? '').trim();
    if (!raw) return 0;
    const normalizedDigits = raw.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
    const cleaned = normalizedDigits.replace(/,/g, '.').replace(/[^\d.\-]/g, '');
    const val = Number(cleaned);
    return Number.isFinite(val) ? val : 0;
  }

  private pdfText(doc: any, value: any): string {
    return createPdfText(doc, jsPDF)(value);
  }

  private pdfServantSingleHead(doc: any): string[] {
    const exportColumns = this.sheet?.columns || [];
    const total = this.columnsMaxTotalForColumns(exportColumns);
    return [
      this.pdfText(doc, total > 0 ? `المجموع / ${total}` : 'المجموع'),
      ...exportColumns.map((c) => this.pdfText(doc, this.fullColumnLabelForView(c.title))),
      this.pdfText(doc, 'الاسم'),
      this.pdfText(doc, 'م')
    ];
  }

  private pdfServantSingleRows(doc: any): string[][] {
    const exportColumns = this.sheet?.columns || [];
    const exportMembers = (this.sheet?.members || []).map((m) => ({
      id: m.id,
      fullName: m.fullName,
      values: { ...(m.values || {}) }
    }));
    const source = [...exportMembers].sort((a, b) => {
      const totalDiff = this.rowTotalForColumns(b.values, exportColumns) - this.rowTotalForColumns(a.values, exportColumns);
      if (totalDiff !== 0) return totalDiff;
      return a.fullName.localeCompare(b.fullName, 'ar');
    });

    return source.map((m, i) => [
      String(this.rowTotalForColumns(m.values, exportColumns)),
      ...exportColumns.map((c) => this.pdfText(doc, m.values?.[c.id] || '-')),
      this.pdfText(doc, m.fullName),
      String(i + 1)
    ]);
  }

  private pdfColumnsHead(doc: any, cols: GradeColumn[] | undefined): string[] {
    const total = this.columnsMaxTotalForColumns(cols);
    return [
      this.pdfText(doc, total > 0 ? `المجموع / ${total}` : 'المجموع'),
      ...(cols || []).map((c) => this.pdfText(doc, this.fullColumnLabelForView(c.title))),
      this.pdfText(doc, 'الاسم'),
      this.pdfText(doc, 'م')
    ];
  }

  private pdfColumnsRows(
    doc: any,
    rows: Array<{ id: number; fullName: string; values: Record<string, string> }>,
    cols: GradeColumn[] | undefined
  ): string[][] {
    return (rows || []).map((m, i) => [
      String(this.rowTotalForColumns(m.values, cols)),
      ...(cols || []).map((c) => this.pdfText(doc, m.values?.[c.id] || '-')),
      this.pdfText(doc, m.fullName),
      String(i + 1)
    ]);
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
      if (currentRank <= 3) highlightedIds.add(m.id);
    }
    this.rankByMemberId = rankMap;
    this.topThreeMemberIds = highlightedIds;
    this.rankedMembers = this.rankViewEnabled ? ranked : [...this.members];
  }

  private rebuildCombinedMembersView(): void {
    const combined = this.buildCombinedServantMembers();
    const rankMap = new Map<number, number>();
    const highlightedIds = new Set<number>();
    let lastTotal: number | null = null;
    let currentRank = 0;
    for (const m of combined) {
      const total = m.allTotal;
      if (lastTotal === null || total !== lastTotal) {
        currentRank += 1;
        lastTotal = total;
      }
      rankMap.set(m.id, currentRank);
      if (currentRank <= 3) highlightedIds.add(m.id);
    }
    this.combinedRankByMemberId = rankMap;
    this.combinedTopThreeMemberIds = highlightedIds;
    this.combinedMembers = combined;
  }

  async exportServantSheetPdf(): Promise<void> {
    if (this.viewMode !== 'SERVANT') return;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    await ensureDejaVuFont(doc);

    if (this.selectedTerm === 'BOTH') {
      doc.setFontSize(16);
      doc.text(this.pdfText(doc, `الدرجات - ${this.selectedFamilyBase || ''}`), 40, 40);
      doc.setFontSize(11);
      doc.text(this.pdfText(doc, 'الترم الأول'), 40, 70);

      autoTable(doc, {
        startY: 80,
        head: [this.pdfColumnsHead(doc, this.bothFirstColumns)],
        body: this.pdfColumnsRows(doc, this.bothFirstMembers, this.bothFirstColumns),
        styles: { fontSize: 9, halign: 'center', font: 'DejaVu' },
        headStyles: { halign: 'center', font: 'DejaVu' }
      });

      const y = (doc as any).lastAutoTable.finalY + 20;
      doc.text(this.pdfText(doc, 'الترم الثاني'), 40, y);

      autoTable(doc, {
        startY: y + 10,
        head: [this.pdfColumnsHead(doc, this.bothSecondColumns)],
        body: this.pdfColumnsRows(doc, this.bothSecondMembers, this.bothSecondColumns),
        styles: { fontSize: 9, halign: 'center', font: 'DejaVu' },
        headStyles: { halign: 'center', font: 'DejaVu' }
      });

      doc.save(`grades-${this.selectedFamilyBase || 'family'}-both.pdf`);
      return;
    }

    if (!this.sheet) return;

    autoTable(doc, {
      startY: 100,
      head: [this.pdfServantSingleHead(doc)],
      body: this.pdfServantSingleRows(doc),
      styles: { fontSize: 9, halign: 'center', font: 'DejaVu' },
      headStyles: { halign: 'center', font: 'DejaVu' }
    });

    doc.save(`grades-${this.selectedFamilyBase || 'family'}-${this.selectedTerm.toLowerCase()}.pdf`);
  }

  async exportMyResultPdf(): Promise<void> {
    if (this.viewMode !== 'MAKHDOM' || !this.my) return;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    await ensureDejaVuFont(doc);

    doc.setFontSize(16);
    doc.text(this.pdfText(doc, `الدرجات - ${this.me?.fullName || ''}`), 40, 40);

    autoTable(doc, {
      startY: 80,
      head: [[
        this.pdfText(doc, this.columnsMaxTotalForColumns(this.my?.firstColumns) > 0 ? `مجموع الترم الأول / ${this.columnsMaxTotalForColumns(this.my?.firstColumns)}` : 'مجموع الترم الأول'),
        ...(this.my.firstColumns || []).map((c) => this.pdfText(doc, this.fullColumnLabelForView(c.title))),
        this.pdfText(doc, 'الاسم')
      ]],
      body: [[
        String(this.rowTotalForColumns(this.my?.firstValues, this.my?.firstColumns)),
        ...(this.my.firstColumns || []).map((c) => this.pdfText(doc, this.my?.firstValues?.[c.id] || '-')),
        this.pdfText(doc, this.me?.fullName || 'أنا')
      ]],
      styles: { fontSize: 10, halign: 'center', font: 'DejaVu' },
      headStyles: { halign: 'center', font: 'DejaVu' }
    });

    const y = (doc as any).lastAutoTable.finalY + 20;
    autoTable(doc, {
      startY: y,
      head: [[
        this.pdfText(doc, this.columnsMaxTotalForColumns(this.my?.secondColumns) > 0 ? `مجموع الترم الثاني / ${this.columnsMaxTotalForColumns(this.my?.secondColumns)}` : 'مجموع الترم الثاني'),
        ...(this.my.secondColumns || []).map((c) => this.pdfText(doc, this.fullColumnLabelForView(c.title))),
        this.pdfText(doc, 'الاسم')
      ]],
      body: [[
        String(this.rowTotalForColumns(this.my?.secondValues, this.my?.secondColumns)),
        ...(this.my.secondColumns || []).map((c) => this.pdfText(doc, this.my?.secondValues?.[c.id] || '-')),
        this.pdfText(doc, this.me?.fullName || 'أنا')
      ]],
      styles: { fontSize: 10, halign: 'center', font: 'DejaVu' },
      headStyles: { halign: 'center', font: 'DejaVu' }
    });

    doc.save(`grades-${this.me?.fullName || 'result'}.pdf`);
  }

  save() {
    this.clearAutoSaveTimer();
    this.autoSavePending = false;
    this.persistSheet(true);
  }

  private persistSheet(showToast: boolean, afterSave?: () => void): void {
    if (!this.canEdit || !this.selectedFamilyBase || this.selectedTerm === 'BOTH') return;
    if (this.saving) return;
    this.saving = true;
    this.gradesSvc.saveSheet(this.selectedFamilyBase, this.selectedTerm, this.buildPayload()).subscribe({
      next: (res: any) => {
        this.saving = false;
        this.hasUnsavedChanges = false;
        this.autoSavePending = false;
        const updatedAt = String(res?.updatedAt || new Date().toISOString());
        this.lastSavedAt = updatedAt;
        if (this.sheet) {
          this.sheet.updatedAt = updatedAt;
          this.sheet.columns = this.columns.map((c) => ({
            id: c.id,
            title: this.composeColumnTitle(this.columnMeta[c.id]?.title || '', this.columnMeta[c.id]?.max || '')
          }));
          this.sheet.members = this.members.map((m) => ({
            id: m.id,
            fullName: m.fullName,
            values: { ...(m.values || {}) }
          }));
        }
        if (showToast) this.msg.add({ severity: 'success', summary: 'تم', detail: 'تم الحفظ' });
        afterSave?.();
      },
      error: () => {
        this.saving = false;
        this.autoSavePending = false;
        this.msg.add({ severity: 'error', summary: 'خطأ', detail: 'فشل الحفظ' });
      }
    });
  }

  isSelectedTermPublished(): boolean {
    if (!this.sheet) return false;
    return this.selectedTerm === 'SECOND'
      ? !!this.sheet.secondPublishedAt
      : !!this.sheet.firstPublishedAt;
  }

  selectedTermPublishStatus(): 'Publish' | 'Draft' {
    return this.isSelectedTermPublished() ? 'Publish' : 'Draft';
  }

  publishButtonLabel(): string {
    return this.isSelectedTermPublished() ? 'إلغاء النشر' : 'نشر';
  }

  publish() {
    if (!this.canPublish || !this.selectedFamilyBase || this.selectedTerm === 'BOTH') return;
    if (this.saving) return;
    if (this.hasUnsavedChanges || this.autoSaveTimer) {
      this.clearAutoSaveTimer();
      this.autoSavePending = false;
      this.persistSheet(false, () => this.publish());
      return;
    }
    const wasPublished = this.isSelectedTermPublished();
    const nowIso = new Date().toISOString();
    this.publishing = true;
    const req$ = wasPublished
      ? this.gradesSvc.unpublishSheet(this.selectedFamilyBase, this.selectedTerm)
      : this.gradesSvc.publishSheet(this.selectedFamilyBase, this.selectedTerm);
    req$.subscribe({
      next: () => {
        this.publishing = false;
        if (this.sheet) {
          if (this.selectedTerm === 'SECOND') {
            this.sheet.secondPublishedAt = wasPublished ? null : nowIso;
          } else {
            this.sheet.firstPublishedAt = wasPublished ? null : nowIso;
          }
          this.sheet.publishedAt = this.selectedTerm === 'SECOND'
            ? (this.sheet.secondPublishedAt || this.sheet.firstPublishedAt || null)
            : (this.sheet.firstPublishedAt || this.sheet.secondPublishedAt || null);
          this.sheet.status = (this.sheet.firstPublishedAt || this.sheet.secondPublishedAt) ? 'PUBLISHED' : 'DRAFT';
        }
        this.msg.add({
          severity: 'success',
          summary: 'تم',
          detail: wasPublished ? 'تم إلغاء النشر' : 'تم النشر'
        });
        this.loadServantView();
      },
      error: (err) => {
        this.publishing = false;
        const backendDetail = err?.error?.error || err?.error?.message || '';
        const status = Number(err?.status || 0);
        let detail = backendDetail || (wasPublished ? 'فشل إلغاء النشر' : 'فشل النشر');
        if (status === 404 && wasPublished) {
          detail = 'Endpoint إلغاء النشر غير متاح على السيرفر الحالي. اعمل Restart للـ backend.';
        } else if (status > 0 && !backendDetail) {
          detail = `${detail} (HTTP ${status})`;
        }
        this.msg.add({
          severity: 'error',
          summary: 'خطأ',
          detail
        });
      }
    });
  }

  private loadMyGrades() {
    this.gradesSvc.myGrades().subscribe({
      next: (v) => {
        this.my = v;
        this.maybeAskForSchoolResult();
      },
      error: () => {
        this.my = {
          familyBase: this.mainFamily(this.assignmentsOf(this.me)[0]?.familyName || ''),
          firstPublishedAt: null,
          secondPublishedAt: null,
          firstRank: null,
          secondRank: null,
          combinedRank: null,
          firstColumns: [],
          firstValues: {},
          secondColumns: [],
          secondValues: {}
        };
      }
    });
  }

  private maybeAskForSchoolResult(): void {
    if (this.viewMode !== 'MAKHDOM') return;
    if (!this.my?.secondPublishedAt || this.isGraduate()) {
      this.showSchoolResultDialog = false;
      return;
    }
    const base = String(this.my?.familyBase || '').trim();
    const pub = String(this.my?.secondPublishedAt || '').trim();
    const lastBase = String(this.me?.lastSchoolResultFamilyBase || '').trim();
    const lastPub = String(this.me?.lastSchoolResultPublishedAt || '').trim();
    this.selectedStudyYear = this.currentStudyYear();
    this.showSchoolResultDialog = !(lastBase === base && lastPub === pub);
  }

  private normalizeArabicText(value: any): string {
    return String(value ?? '').trim().replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ').toLowerCase();
  }

  private canonicalSchoolGrade(raw: string): string {
    const value = this.normalizeArabicText(raw);
    const aliases: Record<string, string> = {
      'grade1_primary': 'اولى ابتدائي', 'اولى ابتدائي': 'اولى ابتدائي', 'اولي ابتدائي': 'اولى ابتدائي', 'اوله ابتدائي': 'اولى ابتدائي',
      'grade2_primary': 'تانيه ابتدائي', 'تانيه ابتدائي': 'تانيه ابتدائي', 'ثانيه ابتدائي': 'تانيه ابتدائي',
      'grade3_primary': 'تالته ابتدائي', 'تالته ابتدائي': 'تالته ابتدائي', 'ثالثه ابتدائي': 'تالته ابتدائي',
      'grade4_primary': 'رابعه ابتدائي', 'رابعه ابتدائي': 'رابعه ابتدائي',
      'grade5_primary': 'خامسه ابتدائي', 'خامسه ابتدائي': 'خامسه ابتدائي',
      'grade6_primary': 'سادسه ابتدائي', 'سادسه ابتدائي': 'سادسه ابتدائي',
      'grade1_prep': 'اولى اعدادي', 'اولى اعدادي': 'اولى اعدادي', 'اولي اعدادي': 'اولى اعدادي',
      'grade2_prep': 'تانيه اعدادي', 'تانيه اعدادي': 'تانيه اعدادي', 'ثانيه اعدادي': 'تانيه اعدادي',
      'grade3_prep': 'تالته اعدادي', 'تالته اعدادي': 'تالته اعدادي', 'ثالثه اعدادي': 'تالته اعدادي',
      'grade1_secondary': 'اولى ثانوي', 'اولى ثانوي': 'اولى ثانوي',
      'grade2_secondary': 'تانيه ثانوي', 'تانيه ثانوي': 'تانيه ثانوي', 'ثانيه ثانوي': 'تانيه ثانوي',
      'grade3_secondary': 'تالته ثانوي', 'تالته ثانوي': 'تالته ثانوي', 'ثالثه ثانوي': 'تالته ثانوي'
    };
    return aliases[value] || String(raw || '').trim();
  }

  private nextSchoolGrade(raw: string): string {
    const orderedGrades = ['اولى ابتدائي', 'تانيه ابتدائي', 'تالته ابتدائي', 'رابعه ابتدائي', 'خامسه ابتدائي', 'سادسه ابتدائي', 'اولى اعدادي', 'تانيه اعدادي', 'تالته اعدادي', 'اولى ثانوي', 'تانيه ثانوي', 'تالته ثانوي'];
    const current = this.canonicalSchoolGrade(raw);
    const normalizedCurrent = this.normalizeArabicText(current);
    const index = orderedGrades.findIndex((g) => this.normalizeArabicText(g) === normalizedCurrent);
    if (index === -1 || index >= orderedGrades.length - 1) return current;
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
    return this.canonicalSchoolGrade(String(this.me?.schoolGrade || '').trim());
  }

  nextSchoolStudyYear(): string {
    return this.nextSchoolGrade(String(this.me?.schoolGrade || '').trim());
  }

  hasSelectedStudyYear(): boolean {
    return !!String(this.selectedStudyYear || '').trim();
  }

  saveStudyYear(year: string): void {
    const selected = String(year || '').trim();
    if (!selected || this.confirmingSchoolResult || !this.my?.secondPublishedAt) return;
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

  hasFirstPublished(): boolean {
    return !!this.my?.firstPublishedAt;
  }

  hasSecondPublished(): boolean {
    return !!this.my?.secondPublishedAt;
  }

  canShowSecondResult(): boolean {
    return this.hasSecondPublished() && !this.showSchoolResultDialog;
  }

  combinedMyTotal(): number {
    return this.rowTotalForColumns(this.my?.firstValues, this.my?.firstColumns) + this.rowTotalForColumns(this.my?.secondValues, this.my?.secondColumns);
  }
}


