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
  canEdit = false;
  canPublish = false;
  saving = false;
  publishing = false;
  private readonly titleMetaSeparator = '::max::';

  // makhdom mode
  my: MyGradesView | null = null;

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
        'أمين الاسره',
        'امين الأسرة',
        'أمين الأسرة',
        'امين اسره'
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
      },
      error: (err: any) => {
        this.msg.add({ severity: 'error', summary: 'خطأ', detail: 'فشل تحميل الدرجات' });
        this.sheet = null;
        this.columns = [];
        this.members = [];
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
      next: (v) => this.my = v,
      error: () => this.my = { familyBase: this.mainFamily(this.me?.deaconFamily), columns: [], values: {}, publishedAt: null }
    });
  }
}
