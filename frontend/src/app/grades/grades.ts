import { Component, OnInit, inject } from '@angular/core';
import { MessageService } from 'primeng/api';
import { forkJoin } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { GradesService, GradeColumn, SheetView, MyGradesView, SheetPayload, ResultTerm } from '../services/grades.service';
import { FamilyService } from '../services/family.service';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

@Component({
  selector: 'app-grades',
  templateUrl: './grades.html',
  styleUrls: ['./grades.css'],
  standalone: false,
  providers: [MessageService]
})
export class GradesComponent implements OnInit {
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
  private readonly titleMetaSeparator = '::max::';

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

  private mainFamily(name: string): string {
    if (!name) return '';
    const f = String(name).trim();
    if (f.endsWith(' أ')) return f.slice(0, -2).trim();
    if (f.endsWith(' ب')) return f.slice(0, -2).trim();
    return f;
  }

  private normRole(v: any): string {
    const raw = String(v ?? '').trim();
    if (!raw) return '';
    const upper = raw.toUpperCase();
    const ar = raw.replace(/\s+/g, ' ').trim();
    if (['امين اسرة', 'امين الاسرة', 'أمين أسرة', 'أمين الاسرة', 'امين الأسرة', 'أمين الأسرة'].includes(ar)) return 'AMIN_OSRA';
    if (['امين الخدمة', 'امين الخدمه', 'أمين الخدمة', 'أمين الخدمه', 'امين خدمه', 'أمين خدمه'].includes(ar)) return 'AMIN_KHEDMA';
    if (upper.startsWith('ROLE_')) return upper.substring(5);
    return upper;
  }

  private assignmentsOf(entity: any): Array<{ familyName: string; role: string }> {
    const assignments = Array.isArray(entity?.familyAssignments) ? entity.familyAssignments : [];
    return assignments
      .map((x: any) => ({
        familyName: String(x?.familyName || '').trim(),
        role: this.normRole(x?.role)
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
    const role = String(this.me?.role || 'MAKHDOM').toUpperCase().trim();
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
    const role = String(this.me?.role || 'MAKHDOM').toUpperCase().trim();
    this.canEdit = ['KHADIM', 'AMIN_OSRA', 'AMIN_KHEDMA', 'DEVELOPER'].includes(role) || this.hasAnyAminOsraScope();
    this.canPublish = ['AMIN_KHEDMA', 'DEVELOPER'].includes(role) || (role === 'AMIN_OSRA' && this.mainFamily(this.assignmentsOf(this.me)[0]?.familyName || '') === this.selectedFamilyBase) || this.hasAminOsraScopeForBase(this.selectedFamilyBase);
  }

  onServantTermChange(): void {
    this.loadServantView();
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
        this.sheet = s;
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

  private async ensureDejaVuFont(doc: any): Promise<void> {
    try {
      if (typeof doc.setR2L === 'function') doc.setR2L(false);
      if (doc.__hasDejaVu) {
        doc.setFont('DejaVu', 'normal');
        return;
      }

      const res = await fetch('assets/fonts/DejaVuSans.ttf');
      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);

      doc.addFileToVFS('DejaVuSans.ttf', base64);
      doc.addFont('DejaVuSans.ttf', 'DejaVu', 'normal');
      doc.__hasDejaVu = true;
      doc.setFont('DejaVu', 'normal');
    } catch {
      // keep export working even if font loading fails
    }
  }

  private pdfText(doc: any, value: any): string {
    const s = String(value ?? '');
    if (!s) return '';
    const hasArabic = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(s);
    if (!hasArabic) return s;

    const processArabic =
      doc?.processArabic ||
      ((jsPDF as any)?.API?.processArabic
        ? (text: string) => (jsPDF as any).API.processArabic(text)
        : null);

    return typeof processArabic === 'function' ? processArabic(s) : s;
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
    await this.ensureDejaVuFont(doc);

    if (this.selectedTerm === 'BOTH') {
      doc.setFontSize(16);
      doc.text(this.pdfText(doc, `الدرجات - ${this.selectedFamilyBase || ''}`), 40, 40);
      doc.setFontSize(11);
      doc.text(this.pdfText(doc, 'الترم الأول'), 40, 70);

      autoTable(doc, {
        startY: 80,
        head: [[
          this.pdfText(doc, 'م'),
          this.pdfText(doc, 'الاسم'),
          ...(this.bothFirstColumns || []).map((c) => this.pdfText(doc, this.formatColumnTitleForView(c.title))),
          this.pdfText(doc, 'المجموع')
        ]],
        body: (this.bothFirstMembers || []).map((m, i) => [
          String(i + 1),
          this.pdfText(doc, m.fullName),
          ...(this.bothFirstColumns || []).map((c) => this.pdfText(doc, m.values?.[c.id] || '-')),
          String(this.rowTotalForColumns(m.values, this.bothFirstColumns))
        ]),
        styles: { fontSize: 9, halign: 'center', font: 'DejaVu' },
        headStyles: { halign: 'center', font: 'DejaVu' }
      });

      const y = (doc as any).lastAutoTable.finalY + 20;
      doc.text(this.pdfText(doc, 'الترم الثاني'), 40, y);

      autoTable(doc, {
        startY: y + 10,
        head: [[
          this.pdfText(doc, 'م'),
          this.pdfText(doc, 'الاسم'),
          ...(this.bothSecondColumns || []).map((c) => this.pdfText(doc, this.formatColumnTitleForView(c.title))),
          this.pdfText(doc, 'المجموع')
        ]],
        body: (this.bothSecondMembers || []).map((m, i) => [
          String(i + 1),
          this.pdfText(doc, m.fullName),
          ...(this.bothSecondColumns || []).map((c) => this.pdfText(doc, m.values?.[c.id] || '-')),
          String(this.rowTotalForColumns(m.values, this.bothSecondColumns))
        ]),
        styles: { fontSize: 9, halign: 'center', font: 'DejaVu' },
        headStyles: { halign: 'center', font: 'DejaVu' }
      });

      doc.save(`grades-${this.selectedFamilyBase || 'family'}-both.pdf`);
      return;
    }

    if (!this.sheet) return;

    autoTable(doc, {
      startY: 100,
      head: [[
        this.pdfText(doc, 'م'),
        this.pdfText(doc, 'الاسم'),
        ...(this.columns || []).map((c) => this.pdfText(doc, this.formatColumnTitleForView(c.title))),
        this.pdfText(doc, 'المجموع')
      ]],
      body: (this.rankedMembers?.length ? this.rankedMembers : this.members).map((m, i) => [
        String(i + 1),
        this.pdfText(doc, m.fullName),
        ...(this.columns || []).map((c) => this.pdfText(doc, m.values?.[c.id] || '-')),
        String(this.rowTotal(m.values))
      ]),
      styles: { fontSize: 9, halign: 'center', font: 'DejaVu' },
      headStyles: { halign: 'center', font: 'DejaVu' }
    });

    doc.save(`grades-${this.selectedFamilyBase || 'family'}-${this.selectedTerm.toLowerCase()}.pdf`);
  }

  async exportMyResultPdf(): Promise<void> {
    if (this.viewMode !== 'MAKHDOM' || !this.my) return;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    await this.ensureDejaVuFont(doc);

    doc.setFontSize(16);
    doc.text(this.pdfText(doc, `الدرجات - ${this.me?.fullName || ''}`), 40, 40);

    autoTable(doc, {
      startY: 80,
      head: [[
        this.pdfText(doc, 'الاسم'),
        ...(this.my.firstColumns || []).map((c) => this.pdfText(doc, this.formatColumnTitleForView(c.title))),
        this.pdfText(doc, 'مجموع الترم الأول')
      ]],
      body: [[
        this.pdfText(doc, this.me?.fullName || 'أنا'),
        ...(this.my.firstColumns || []).map((c) => this.pdfText(doc, this.my?.firstValues?.[c.id] || '-')),
        String(this.rowTotalForColumns(this.my?.firstValues, this.my?.firstColumns))
      ]],
      styles: { fontSize: 10, halign: 'center', font: 'DejaVu' },
      headStyles: { halign: 'center', font: 'DejaVu' }
    });

    const y = (doc as any).lastAutoTable.finalY + 20;
    autoTable(doc, {
      startY: y,
      head: [[
        this.pdfText(doc, 'الاسم'),
        ...(this.my.secondColumns || []).map((c) => this.pdfText(doc, this.formatColumnTitleForView(c.title))),
        this.pdfText(doc, 'مجموع الترم الثاني')
      ]],
      body: [[
        this.pdfText(doc, this.me?.fullName || 'أنا'),
        ...(this.my.secondColumns || []).map((c) => this.pdfText(doc, this.my?.secondValues?.[c.id] || '-')),
        String(this.rowTotalForColumns(this.my?.secondValues, this.my?.secondColumns))
      ]],
      styles: { fontSize: 10, halign: 'center', font: 'DejaVu' },
      headStyles: { halign: 'center', font: 'DejaVu' }
    });

    doc.save(`grades-${this.me?.fullName || 'result'}.pdf`);
  }

  save() {
    if (!this.canEdit || !this.selectedFamilyBase || this.selectedTerm === 'BOTH') return;
    this.saving = true;
    this.gradesSvc.saveSheet(this.selectedFamilyBase, this.selectedTerm, this.buildPayload()).subscribe({
      next: () => {
        this.saving = false;
        this.msg.add({ severity: 'success', summary: 'تم', detail: 'تم الحفظ' });
        this.loadServantView();
      },
      error: () => {
        this.saving = false;
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


