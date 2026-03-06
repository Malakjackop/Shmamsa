import { Component, OnInit, inject } from '@angular/core';
import { FamilyService } from '../services/family.service';
import { AuthService } from '../services/auth.service';
import { MessageService } from 'primeng/api';
import { AttendanceService, type AttendanceType } from '../services/attendance.service';
import { IftekadService } from '../services/iftekad.service';

type Member = {
  id: number;
  fullName: string;
  role: string;
  deaconFamily: string;

  // choir membership (used to hide choir sections inside details)
  attendKhors?: string; // MARMARKOS / ATHANASIUS / NONE / BOTH
  khors?: string; // MARMARKOS / ATHANASIUS / BOTH
  servingScope?: string;

  // iftekad
  lastIftekadDate?: string | null; // yyyy-MM-dd

  // backward compatible fields (present count)
  fridayLiturgy: number;
  tasbeeha: number;
  familyMeeting: number;

  // new fields (present/total)
  fridayLiturgyPresent?: number;
  fridayLiturgyTotal?: number;
  tasbeehaPresent?: number;
  tasbeehaTotal?: number;
  familyMeetingPresent?: number;
  familyMeetingTotal?: number;

  // choir (present/total)
  marmarkosKhorsPresent?: number;
  marmarkosKhorsTotal?: number;
  athanasiusKhorsPresent?: number;
  athanasiusKhorsTotal?: number;

  /** UI selection for export */
  selected?: boolean;
};

type AttendanceRow = {
  id: number;
  // Keep this aligned with backend enum + AttendanceService.AttendanceType
  type: AttendanceType;
  date: string;
  time?: string;
  createdAt?: string;
  status?: 'PRESENT' | 'ABSENT';
  takenBy?: { id: number; fullName: string; role: string } | null;
};

type IftekadVisitView = {
  id: number;
  memberId: number;
  visitDate: string; // yyyy-MM-dd
  description?: string | null;
  companions?: string | null;
  createdAt?: string;
  recordedBy?: { id: number; fullName: string; role: string } | null;
};

@Component({
  selector: 'app-family-attendance',
  standalone: false,
  templateUrl: './family-attendance.html',
  styleUrls: ['./family-attendance.css'],
  providers: [MessageService]
})
export class FamilyAttendanceComponent implements OnInit {

  readonly allAttendanceTypes: AttendanceRow['type'][] = [
    'TASBEEHA',
    'FRIDAY_LITURGY',
    'MARMARKOS_KHORS',
    'ATHANASIUS_KHORS',
    'FAMILY_MEETING'
  ];

  private familySvc = inject(FamilyService);
  private auth = inject(AuthService);
  private message = inject(MessageService);
  private iftekadSvc = inject(IftekadService);
  private attendanceSvc = inject(AttendanceService);

  me: any;
  members: Member[] = [];
  families: string[] = [];
  selectedFamily = '';
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
  loading = false;

  exportMode = false;
  pendingExport: 'pdf' | '' = '';
  selectAll = false;

  detailsFor: Member | null = null;
  details: AttendanceRow[] = [];
  detailsType: '' | AttendanceType = '';

  profileFor: Member | null = null;
  profile: any = null;

  // ===== Daily attendance (حضور اليوم) =====
  showDaily = false;
  dailyDate = '';
  dailyType: AttendanceType | null = null;
  dailyLoading = false;
  dailyTotal = 0;
  dailyPresentCount = 0;
  dailyAbsentCount = 0;
  dailyRecordsCount = 0;
  dailyPresent: Array<{ id: number; fullName: string; role?: string; deaconFamily?: string }> = [];
  dailyAbsent: Array<{ id: number; fullName: string; role?: string; deaconFamily?: string }> = [];

  // confirm remove (mark absent)
  showDailyRemoveConfirm = false;
  dailyRemoveTarget: { id: number; fullName: string } | null = null;
  dailyRemoveSaving = false;

  // ===== Iftekad (visitation) =====
  iftekadFor: Member | null = null;
  iftekadDate = '';
  iftekadDesc = '';
  iftekadCompanions = '';
  iftekadSaving = false;

  iftekadHistory: IftekadVisitView[] = [];
  iftekadHistoryLoading = false;

  editingVisitId: number | null = null;
  editVisitDate = '';
  editVisitDesc = '';
  editVisitCompanions = '';
  editSaving = false;

   // ✅ NEW: confirm dialog inside the page (no browser confirm)
  showDeleteConfirm = false;
  visitToDelete: IftekadVisitView | null = null;
  deleteSaving = false;

  isChoirSelected(): boolean {
    const x = String(this.selectedFamily || '').trim();
    return x === 'خورس مارمرقس' || x === 'خورس البابا اثناسيوس';
  }

  ngOnInit() {
    this.auth.getUserData().subscribe({
      next: (u) => {
        this.me = u;
        this.initFamilyMode();
      },
      error: () => {}
    });
  }

  get selectedFamilyName(): string {
    return String(this.selectedFamily || '').trim();
  }

  get isMarmarkosChoir(): boolean {
    return this.selectedFamilyName === 'خورس مارمرقس';
  }

  get isAthanasiusChoir(): boolean {
    return this.selectedFamilyName === 'خورس البابا اثناسيوس';
  }

  get showMarmarkosColumn(): boolean {
    return this.isMarmarkosChoir;
  }

  get showAthanasiusColumn(): boolean {
    return this.isAthanasiusChoir;
  }

  isAminKhedmaOrDev(): boolean {
    return this.me?.role === 'AMIN_KHEDMA' || this.me?.role === 'DEVELOPER';
  }

  isKhadim(): boolean {
    return this.me?.role === 'KHADIM';
  }

  canSelectFamily(): boolean {
    return this.isAminKhedmaOrDev() || this.isKhadim();
  }

  private initFamilyMode() {
    if (this.canSelectFamily()) {
      this.familySvc.families().subscribe({
        next: (f) => {
          this.families = this.sortFamiliesByPreferredOrder(f || []);
          if (this.families.length) {
            this.selectedFamily = this.families[0];
            this.loadMembers();
          }
        },
        error: () => {
          this.families = [];
          this.selectedFamily = '';
          this.loadMembers();
        }
      });
    } else {
      this.selectedFamily = this.me?.deaconFamily;
      this.loadMembers();
    }
  }

  private normalizeFamilyName(value: any): string {
    return String(value || '')
      .trim()
      .replace(/[أإآ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  private familyOrderKey(family: string): string {
    const n = this.normalizeFamilyName(family);

    if (n.includes('خورس') && n.includes('مار') && n.includes('مرقس')) return 'خورس مارمرقس';
    if (n.includes('خورس') && n.includes('اثناسيوس')) return 'خورس البابا اثناسيوس';
    if (n.includes('سمائ')) return 'اسرة السمائين';
    if (n.includes('ابانوب')) return 'اسرة القديس ابانوب';
    if (n.includes('ديسقورس')) return 'اسرة القديس ديسقورس';
    if (n.includes('سيدهم') || n.includes('بشاي')) return 'اسرة القديس سيدهم بشاي';
    if (n.includes('اسكلابيوس')) return 'اسرة القديس اسكلابيوس';
    if (n.includes('كيرلس')) return 'اسرة القديس البابا كيرلس';
    if (n.includes('ابرام')) return 'اسرة القديس الانبا ابرام';
    if (n.includes('اسطفانوس') || n.includes('استفانوس')) return 'اسرة القديس اسطفانوس';

    return family;
  }

  private sortFamiliesByPreferredOrder(families: string[]): string[] {
    const cleaned = (families || []).map((x) => this.familyOrderKey(String(x || '').trim())).filter(Boolean);
    const deduped = Array.from(new Set(cleaned));
    const orderMap = new Map(
      this.preferredFamilyOrder.map((name, index) => [this.normalizeFamilyName(name), index])
    );

    return [...deduped].sort((a, b) => {
      const aKey = this.familyOrderKey(a);
      const bKey = this.familyOrderKey(b);
      const aOrder = orderMap.get(this.normalizeFamilyName(aKey));
      const bOrder = orderMap.get(this.normalizeFamilyName(bKey));

      if (aOrder != null && bOrder != null) return aOrder - bOrder;
      if (aOrder != null) return -1;
      if (bOrder != null) return 1;
      return a.localeCompare(b, 'ar');
    });
  }

  onFamilyChange() {
    this.loadMembers();
  }

  loadMembers() {
    this.loading = true;
    const famParam = this.canSelectFamily() ? this.selectedFamily : undefined;

    this.familySvc.members(famParam).subscribe({
      next: (m) => {
        this.members = (m as any) || [];
        this.refreshIftekadLastDates();
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.message.add({ severity: 'error', summary: 'Error', detail: err?.error?.error || 'Failed to load' });
      }
    });
  }

  private refreshIftekadLastDates() {
    const ids = (this.members || []).map((x) => x?.id).filter((x) => x != null) as number[];
    if (!ids.length) return;

    this.iftekadSvc.lastVisitDates(ids).subscribe({
      next: (map: any) => {
        const m = (map as any) || {};
        this.members.forEach((mem) => {
          const key = String(mem.id);
          (mem as any).lastIftekadDate = m[key] || null;
        });
      },
      error: () => {
        this.members.forEach((mem) => ((mem as any).lastIftekadDate = null));
      }
    });
  }

  toggleSelectAll() {
    this.members.forEach((m) => (m.selected = this.selectAll));
  }

  onMemberSelectionChange() {
    const any = this.members.some((m) => !!m.selected);
    if (!any) {
      this.selectAll = false;
      return;
    }
    this.selectAll = this.members.every((m) => !!m.selected);
  }

  private getSelectedMembers(): Member[] {
    return (this.members || []).filter((m) => !!m.selected);
  }

  private async fetchDetailsForMembers(members: Member[], famParam?: string): Promise<any[]> {
    const { firstValueFrom } = await import('rxjs');
    const arr: any[] = [];
    for (const m of members) {
      try {
        arr.push(await firstValueFrom(this.familySvc.memberDetails(m.id, famParam)));
      } catch {
        arr.push({});
      }
    }
    return arr;
  }

  private async fetchAttendanceForMembers(members: Member[], famParam?: string): Promise<AttendanceRow[][]> {
    const { firstValueFrom } = await import('rxjs');
    const out: AttendanceRow[][] = [];
    for (const m of members) {
      try {
        const rows = await firstValueFrom(this.familySvc.memberAttendance(m.id, famParam));
        out.push(((rows as any) || []) as AttendanceRow[]);
      } catch {
        out.push([]);
      }
    }
    return out;
  }

  openDetails(member: Member) {
    this.detailsFor = member;
    this.detailsType = '';
    this.reloadDetails();
  }

  reloadDetails() {
    if (!this.detailsFor) return;

    // لو نوع الفلتر مش مسموح للعضو ده (مثلا مش في خورس) رجّعه للكل
    if (this.detailsType && !this.isAttendanceTypeAllowedForMember(this.detailsFor, this.detailsType)) {
      this.detailsType = '';
    }

    const famParam = this.canSelectFamily() ? this.selectedFamily : undefined;

    this.familySvc.memberAttendance(this.detailsFor.id, famParam, this.detailsType || undefined).subscribe({
      next: (d) => (this.details = this.filterOutArchivedRows((d as any) || [])),
      error: () => (this.details = [])
    });
  }

  private filterOutArchivedRows(rows: any[]): AttendanceRow[] {
    return (Array.isArray(rows) ? rows : []).filter((r) => !this.isArchivedRow(r)) as AttendanceRow[];
  }

  private isArchivedRow(row: any): boolean {
    const isTrue = (v: any) => {
      const s = String(v ?? '').trim().toLowerCase();
      return v === true || v === 1 || s === 'true' || s === 'yes' || s === 'y';
    };
    const hasArchiveRef = row?.archiveId !== null && row?.archiveId !== undefined && row?.archiveId !== 0;

    return (
      isTrue(row?.archived) ||
      isTrue(row?.isArchived) ||
      isTrue(row?.inArchive) ||
      isTrue(row?.isInArchive) ||
      !!row?.archive ||
      !!row?.archiveName ||
      !!row?.archivedAt ||
      !!row?.archiveDate ||
      hasArchiveRef
    );
  }

  countLabel(
    m: Member,
    kind: 'FRIDAY_LITURGY' | 'MARMARKOS_KHORS' | 'ATHANASIUS_KHORS' | 'TASBEEHA' | 'FAMILY_MEETING'
  ): string {
    const fallbackPresent =
      kind === 'FRIDAY_LITURGY'
        ? m.fridayLiturgy
        : kind === 'MARMARKOS_KHORS'
          ? (m as any).marmarkosKhorsPresent
          : kind === 'ATHANASIUS_KHORS'
            ? (m as any).athanasiusKhorsPresent
            : kind === 'TASBEEHA'
              ? m.tasbeeha
              : m.familyMeeting;

    const present =
      kind === 'FRIDAY_LITURGY'
        ? m.fridayLiturgyPresent ?? fallbackPresent
        : kind === 'MARMARKOS_KHORS'
          ? (m as any).marmarkosKhorsPresent ?? fallbackPresent
          : kind === 'ATHANASIUS_KHORS'
            ? (m as any).athanasiusKhorsPresent ?? fallbackPresent
            : kind === 'TASBEEHA'
              ? m.tasbeehaPresent ?? fallbackPresent
              : m.familyMeetingPresent ?? fallbackPresent;

    const total =
      kind === 'FRIDAY_LITURGY'
        ? m.fridayLiturgyTotal
        : kind === 'MARMARKOS_KHORS'
          ? (m as any).marmarkosKhorsTotal
          : kind === 'ATHANASIUS_KHORS'
            ? (m as any).athanasiusKhorsTotal
            : kind === 'TASBEEHA'
              ? m.tasbeehaTotal
              : m.familyMeetingTotal;

    // لو التوتال مش موجود لسه (قبل تحديث الباك), اعرض الرقم القديم بس
    if (total == null) return String(present ?? 0);
    return `${present ?? 0}/${total}`;
  }

  titleForType(t: AttendanceRow['type']): string {
    if (t === 'TASBEEHA') return 'تسبحة';
    if (t === 'FRIDAY_LITURGY') return 'قداس الجمعة';
    if (t === 'MARMARKOS_KHORS') return 'خورس مارمرقس';
    if (t === 'ATHANASIUS_KHORS') return 'خورس البابا اثناسيوس';
    return 'اجتماع الأسرة';
  }

  private statusAr(v?: AttendanceRow['status'] | string): string {
    const s = (v || '').toUpperCase();
    if (s === 'PRESENT') return 'حاضر';
    if (s === 'ABSENT') return 'غائب';
    return v || '';
  }

  private roleAr(role?: string): string {
    const r = (role || '').toUpperCase();
    if (r === 'DEVELOPER') return 'مطوّر';
    if (r === 'AMIN_KHEDMA') return 'أمين خدمة';
    if (r === 'AMIN_OSRA') return 'أمين أسرة';
    if (r === 'KHADIM') return 'خادم';
    if (r === 'MEMBER') return 'عضو';
    return role || '';
  }

  private memberChoirMembership(m: Member | any): '' | 'MARMARKOS' | 'ATHANASIUS' | 'BOTH' {
    const attend = String((m as any)?.attendKhors || '').trim().toUpperCase();
    if (attend === 'MARMARKOS') return 'MARMARKOS';
    if (attend === 'ATHANASIUS') return 'ATHANASIUS';
    if (attend === 'BOTH') return 'BOTH';

    const k = String((m as any)?.khors || '').trim().toUpperCase();
    if (k === 'MARMARKOS') return 'MARMARKOS';
    if (k === 'ATHANASIUS') return 'ATHANASIUS';
    if (k === 'BOTH') return 'BOTH';

    return '';
  }

  isAttendanceTypeAllowedForMember(member: Member, t: AttendanceType): boolean {
    if (t === 'MARMARKOS_KHORS' || t === 'ATHANASIUS_KHORS') {
      const mem = this.memberChoirMembership(member);
      if (t === 'MARMARKOS_KHORS') return mem === 'MARMARKOS' || mem === 'BOTH';
      return mem === 'ATHANASIUS' || mem === 'BOTH';
    }
    return true;
  }

  visibleAttendanceTypes(): AttendanceRow['type'][] {
    if (!this.detailsFor) return this.allAttendanceTypes;
    return this.allAttendanceTypes.filter((t) => this.isAttendanceTypeAllowedForMember(this.detailsFor!, t as any));
  }

  filteredDetails(t: AttendanceRow['type']): AttendanceRow[] {
    return (this.details || []).filter((d) => d?.type === t);
  }

  closeDetails() {
    this.detailsFor = null;
    this.details = [];
    this.detailsType = '';
  }

  // ===== Profile =====
  openProfile(member: Member) {
    this.profileFor = member;
    this.profile = null;
    const famParam = this.canSelectFamily() ? this.selectedFamily : undefined;

    this.familySvc.memberDetails(member.id, famParam).subscribe({
      next: (p) => (this.profile = p),
      error: () => (this.profile = null)
    });
  }

  closeProfile() {
    this.profileFor = null;
    this.profile = null;
  }

  // ===== Daily attendance (حضور اليوم) =====

  canEditDailyAttendance(): boolean {
    const r = String(this.me?.role || '').trim().toUpperCase();
    return r === 'KHADIM' || r === 'AMIN_OSRA' || r === 'AMIN_KHEDMA' || r === 'DEVELOPER' || r === 'DEV';
  }

  openDailyAttendance() {
    this.showDaily = true;
    this.setDailyToday();
    this.dailyType = this.defaultDailyTypeForDate(this.dailyDate);
    this.reloadDaily();
  }

  closeDailyAttendance() {
    this.showDaily = false;
    this.dailyLoading = false;
    this.dailyDate = '';
    this.dailyType = null;
    this.dailyTotal = 0;
    this.dailyPresentCount = 0;
    this.dailyAbsentCount = 0;
    this.dailyRecordsCount = 0;
    this.dailyPresent = [];
    this.dailyAbsent = [];
    this.showDailyRemoveConfirm = false;
    this.dailyRemoveTarget = null;
    this.dailyRemoveSaving = false;
  }

  setDailyToday() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    this.dailyDate = `${yyyy}-${mm}-${dd}`;
  }

  private dailyFamilyParam(): string | undefined {
    if (this.canSelectFamily()) return this.selectedFamily;
    return this.me?.deaconFamily;
  }

  private canShowDailyKhorsTypes(): boolean {
    const selected = String(this.selectedFamily || '').trim();
    if (selected === 'خورس مارمرقس' || selected === 'خورس البابا اثناسيوس') return true;

    const role = String(this.me?.role || '').trim().toUpperCase();
    if (role !== 'KHADIM') return false;

    const scope = String(this.me?.servingScope || '').trim().toUpperCase();
    if (scope === 'KHORS_ONLY' || scope === 'BOTH') return true;

    const kh = String(this.me?.khors || '').trim().toUpperCase();
    return kh === 'MARMARKOS' || kh === 'ATHANASIUS' || kh === 'BOTH';
  }

  dailyTypeOptions(): AttendanceType[] {
    const base: AttendanceType[] = ['FRIDAY_LITURGY', 'TASBEEHA', 'FAMILY_MEETING'];
    if (this.canShowDailyKhorsTypes()) {
      base.push('MARMARKOS_KHORS', 'ATHANASIUS_KHORS');
    }
    return base;
  }

  private defaultDailyTypeForDate(dateIso: string): AttendanceType | null {
    const options = this.dailyTypeOptions();
    if (!dateIso) return options[0] || null;

    const d = new Date(`${dateIso}T00:00:00`);
    if (isNaN(d.getTime())) return options[0] || null;
    const dow = d.getDay();

    if (dow === 4) return options.includes('FAMILY_MEETING') ? 'FAMILY_MEETING' : (options[0] || null);
    if (dow === 5) {
      if (this.isMarmarkosChoir && options.includes('MARMARKOS_KHORS')) return 'MARMARKOS_KHORS';
      if (this.isAthanasiusChoir && options.includes('ATHANASIUS_KHORS')) return 'ATHANASIUS_KHORS';
      if (options.includes('FRIDAY_LITURGY')) return 'FRIDAY_LITURGY';
    }
    if (dow === 6) return options.includes('TASBEEHA') ? 'TASBEEHA' : (options[0] || null);

    return options[0] || null;
  }

  dailyTypeLabel(t: AttendanceType | null): string {
    if (!t) return '';
    if (t === 'FRIDAY_LITURGY') return 'قداس الجمعة';
    if (t === 'MARMARKOS_KHORS') return 'خورس مارمرقس';
    if (t === 'ATHANASIUS_KHORS') return 'خورس البابا اثناسيوس';
    if (t === 'TASBEEHA') return 'تسبحة';
    if (t === 'FAMILY_MEETING') return 'اجتماع الأسرة';
    return t;
  }

  onDailyDateChange() {
    if (!this.dailyType) {
      this.dailyType = this.defaultDailyTypeForDate(this.dailyDate);
    }
    this.reloadDaily();
  }

  onDailyTypeChange() {
    this.reloadDaily();
  }

  reloadDaily() {
    if (!this.showDaily) return;
    if (!this.dailyDate) {
      this.dailyType = null;
      this.dailyPresent = [];
      this.dailyAbsent = [];
      this.dailyTotal = 0;
      this.dailyPresentCount = 0;
      this.dailyAbsentCount = 0;
      this.dailyRecordsCount = 0;
      return;
    }

    const t = this.dailyType;
    if (!t) {
      this.dailyPresent = [];
      this.dailyAbsent = [];
      this.dailyTotal = 0;
      this.dailyPresentCount = 0;
      this.dailyAbsentCount = 0;
      this.dailyRecordsCount = 0;
      this.message.add({ severity: 'warn', summary: 'تنبيه', detail: 'اختار نوع الحضور' });
      return;
    }

    this.dailyLoading = true;
    const fam = this.dailyFamilyParam();
    this.attendanceSvc.daily(this.dailyDate, t, fam).subscribe({
      next: (res: any) => {
        const familyTotal = Number(this.members?.length || 0);

        this.dailyPresentCount = Number(res?.presentCount || 0);
        this.dailyAbsentCount = Number(res?.absentCount || 0);
        this.dailyRecordsCount = Number(res?.recordsCount || 0);
        this.dailyPresent = (res?.present || []) as any;
        this.dailyAbsent = (res?.absent || []) as any;

        // المجموع = إجمالي أفراد الأسرة المعروضة
        this.dailyTotal = familyTotal > 0 ? familyTotal : Number(res?.total || 0);

        // لو لا يوجد أي تسجيلات في اليوم ده، لا نعرض غياب (غالبًا مفيش اجتماع)
        if (this.dailyRecordsCount === 0) {
          this.dailyAbsent = [];
          this.dailyAbsentCount = 0;
        }

        this.dailyLoading = false;
      },
      error: (err: any) => {
        this.dailyLoading = false;
        this.dailyPresent = [];
        this.dailyAbsent = [];
        this.dailyTotal = 0;
        this.dailyPresentCount = 0;
        this.dailyAbsentCount = 0;
        this.dailyRecordsCount = 0;
        this.message.add({ severity: 'error', summary: 'Error', detail: err?.error?.error || 'Failed to load' });
      }
    });
  }

  askDailyMarkAbsent(p: { id: number; fullName: string }) {
    if (!this.dailyType || !this.dailyDate) return;
    if (!this.canEditDailyAttendance()) return;
    this.dailyRemoveTarget = { id: p.id, fullName: p.fullName };
    this.showDailyRemoveConfirm = true;
  }

  cancelDailyRemove() {
    this.showDailyRemoveConfirm = false;
    this.dailyRemoveTarget = null;
    this.dailyRemoveSaving = false;
  }

  confirmDailyRemove() {
    if (!this.dailyType || !this.dailyDate || !this.dailyRemoveTarget) return;
    const fam = this.dailyFamilyParam();
    this.dailyRemoveSaving = true;
    this.attendanceSvc.markAbsent(this.dailyRemoveTarget.id, this.dailyDate, this.dailyType, fam).subscribe({
      next: () => {
        this.dailyRemoveSaving = false;
        this.cancelDailyRemove();
        this.message.add({ severity: 'success', summary: 'تم', detail: 'تم إلغاء الحضور وتسجيله غياب' });
        this.reloadDaily();
      },
      error: (err: any) => {
        this.dailyRemoveSaving = false;
        this.message.add({ severity: 'error', summary: 'Error', detail: err?.error?.error || 'Failed' });
      }
    });
  }

  // ===== Iftekad =====
  openIftekad(member: Member) {
    this.iftekadFor = member;
    this.iftekadDesc = '';
    this.iftekadCompanions = '';
    this.iftekadDate = '';

    this.editingVisitId = null;
    this.editVisitDate = '';
    this.editVisitDesc = '';
    this.editVisitCompanions = '';
    this.editSaving = false;

    this.loadIftekadHistory(member.id);
  }

  closeIftekad() {
    this.iftekadFor = null;
    this.iftekadDesc = '';
    this.iftekadCompanions = '';
    this.iftekadDate = '';
    this.iftekadSaving = false;

    this.iftekadHistory = [];
    this.iftekadHistoryLoading = false;

    this.editingVisitId = null;
    this.editVisitDate = '';
    this.editVisitDesc = '';
    this.editVisitCompanions = '';
    this.editSaving = false;
  }

  setIftekadToday() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    this.iftekadDate = `${yyyy}-${mm}-${dd}`;
  }

  private loadIftekadHistory(memberId: number) {
    this.iftekadHistoryLoading = true;
    this.iftekadHistory = [];

    this.iftekadSvc.getVisits(memberId).subscribe({
      next: (rows: any) => {
        this.iftekadHistory = ((rows as any) || []) as IftekadVisitView[];
        this.iftekadHistoryLoading = false;
        this.refreshLastIftekadFromHistory();
      },
      error: () => {
        this.iftekadHistory = [];
        this.iftekadHistoryLoading = false;
        this.refreshLastIftekadFromHistory();
      }
    });
  }

  private refreshLastIftekadFromHistory() {
    if (!this.iftekadFor) return;
    const last = (this.iftekadHistory && this.iftekadHistory.length) ? this.iftekadHistory[0].visitDate : null;
    (this.iftekadFor as any).lastIftekadDate = last;
    const idx = this.members.findIndex((x) => x.id === this.iftekadFor!.id);
    if (idx >= 0) (this.members[idx] as any).lastIftekadDate = last;
  }

  needsIftekadAttention(member: Member): boolean {
    const s = String((member as any)?.lastIftekadDate || '').trim();
    if (!s) return true;

    const last = new Date(`${s}T00:00:00`);
    if (isNaN(last.getTime())) return true;

    const threshold = new Date();
    threshold.setHours(0, 0, 0, 0);
    threshold.setMonth(threshold.getMonth() - 3);
    return last.getTime() < threshold.getTime();
  }

  saveIftekad() {
    if (!this.iftekadFor) return;
    if (!this.iftekadDate) {
      this.message.add({ severity: 'warn', summary: 'تنبيه', detail: 'اختار التاريخ أولاً' });
      return;
    }

    this.iftekadSaving = true;
    this.iftekadSvc
      .createVisit({
        memberId: this.iftekadFor.id,
        date: this.iftekadDate,
        description: this.iftekadDesc || undefined,
        companions: this.iftekadCompanions || undefined
      })
      .subscribe({
        next: (created: any) => {
          // update last date (for red dot)
          (this.iftekadFor as any).lastIftekadDate = this.iftekadDate;
          const idx = this.members.findIndex((x) => x.id === this.iftekadFor!.id);
          if (idx >= 0) (this.members[idx] as any).lastIftekadDate = this.iftekadDate;

          // add to history instantly
          if (created) {
            const row: IftekadVisitView = {
              id: created.id,
              memberId: created.memberId,
              visitDate: created.visitDate,
              description: created.description,
              companions: created.companions,
              createdAt: created.createdAt,
              recordedBy: created.recordedBy
            };
            this.iftekadHistory = [row, ...(this.iftekadHistory || [])];
          } else {
            this.loadIftekadHistory(this.iftekadFor!.id);
          }

          this.message.add({ severity: 'success', summary: 'تم', detail: 'تم تسجيل الافتقاد' });
          this.iftekadSaving = false;

          // clear optional fields after save
          this.iftekadDesc = '';
          this.iftekadCompanions = '';
        },
        error: (err: any) => {
          this.iftekadSaving = false;
          this.message.add({ severity: 'error', summary: 'Error', detail: err?.error?.error || 'Failed to save' });
        }
      });
  }

  startEditVisit(v: IftekadVisitView) {
    this.editingVisitId = v.id;
    this.editVisitDate = v.visitDate || '';
    this.editVisitDesc = (v.description || '') as string;
    this.editVisitCompanions = (v.companions || '') as string;
  }

  cancelEditVisit() {
    this.editingVisitId = null;
    this.editVisitDate = '';
    this.editVisitDesc = '';
    this.editVisitCompanions = '';
    this.editSaving = false;
  }

 saveEditVisit(v: IftekadVisitView) {
  if (!this.iftekadFor) return;
  if (!this.editVisitDate) {
    this.message.add({ severity: 'warn', summary: 'تنبيه', detail: 'اختار التاريخ أولاً' });
    return;
  }

  this.editSaving = true;

  // ✅ القيم اللي المفروض تتسجل بعد التعديل
  const expected = {
    date: this.editVisitDate,
    description: (this.editVisitDesc || '').trim(),
    companions: (this.editVisitCompanions || '').trim()
  };

  this.iftekadSvc
    .updateVisit(v.id, {
      date: expected.date,
      description: expected.description || undefined,
      companions: expected.companions || undefined
    })
    .subscribe({
      next: () => {
        // ✅ نجاح طبيعي
        this.message.add({ severity: 'success', summary: 'تم', detail: 'تم تعديل الافتقاد' });
        this.editSaving = false;
        this.cancelEditVisit();
        this.loadIftekadHistory(this.iftekadFor!.id); // يحدّث السجل فوراً
      },
      error: (err: any) => {
        // ✅ هنا بدل ما نطلع Error وخلاص.. نتأكد هل اتعدّل فعلاً
        this.verifyVisitUpdatedAfterError(v.id, expected, err);
      }
    });
  }
  private verifyVisitUpdatedAfterError(
  visitId: number,
  expected: { date: string; description: string; companions: string },
  originalErr: any
) {
  if (!this.iftekadFor) {
    this.editSaving = false;
    this.message.add({ severity: 'error', summary: 'Error', detail: 'Failed to update' });
    return;
  }

  // نعمل Reload للسجل من الباك
  this.iftekadSvc.getVisits(this.iftekadFor.id).subscribe({
    next: (rows: any) => {
      this.iftekadHistory = ((rows as any) || []) as IftekadVisitView[];

      const found = (this.iftekadHistory || []).find((x) => x.id === visitId);

      const norm = (v: any) => String(v ?? '').trim();

      // ✅ لو لقينا نفس الزيارة ومتسجلة بالقيم الجديدة يبقى التعديل حصل فعلاً
      const ok =
        !!found &&
        norm(found.visitDate) === norm(expected.date) &&
        norm(found.description) === norm(expected.description) &&
        norm(found.companions) === norm(expected.companions);

      if (ok) {
        // ✅ التعديل حصل.. اعرض Success بدل Error
        this.message.add({ severity: 'success', summary: 'تم', detail: 'تم تعديل الافتقاد' });
        this.editSaving = false;
        this.cancelEditVisit();
        this.refreshLastIftekadFromHistory(); // علشان النقطة الحمرا
      } else {
        // ❌ فعلاً فشل
        this.editSaving = false;
        this.message.add({
          severity: 'error',
          summary: 'Error',
          detail: originalErr?.error?.error || originalErr?.message || 'Failed to update'
        });
      }
    },
    error: () => {
      this.editSaving = false;
      this.message.add({
        severity: 'error',
        summary: 'Error',
        detail: originalErr?.error?.error || originalErr?.message || 'Failed to update'
      });
    }
  });
}

  // ✅ open confirm dialog
  askDeleteVisit(v: IftekadVisitView) {
    this.visitToDelete = v;
    this.showDeleteConfirm = true;
    this.deleteSaving = false;
  }

  cancelDelete() {
    this.showDeleteConfirm = false;
    this.visitToDelete = null;
    this.deleteSaving = false;
  }

  confirmDelete() {
    if (!this.iftekadFor || !this.visitToDelete) return;

    this.deleteSaving = true;
    this.iftekadSvc.deleteVisit(this.visitToDelete.id).subscribe({
      next: () => {
        this.message.add({ severity: 'success', summary: 'تم', detail: 'تم مسح الافتقاد' });
        this.deleteSaving = false;
        this.showDeleteConfirm = false;
        this.visitToDelete = null;
        this.loadIftekadHistory(this.iftekadFor!.id);
      },
      error: (err: any) => {
        // ✅ Same parsing edge-case safeguard
        if (err && err.status === 200) {
          this.message.add({ severity: 'success', summary: 'تم', detail: 'تم مسح الافتقاد' });
          this.deleteSaving = false;
          this.showDeleteConfirm = false;
          this.visitToDelete = null;
          this.loadIftekadHistory(this.iftekadFor!.id);
          return;
        }

        this.deleteSaving = false;
        this.message.add({ severity: 'error', summary: 'Error', detail: err?.error?.error || 'Failed to delete' });
      }
    });
  }

  formatRecordedAt(dateStr?: string): string {
    if (!dateStr) return '';

    let s = String(dateStr).trim();

    s = s.replace(/(\.\d{3})\d+/, '$1');

    const d = new Date(s);
    if (isNaN(d.getTime())) return dateStr;

    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();

    const minutes = String(d.getMinutes()).padStart(2, '0');

    const h24 = d.getHours();
    const ampmRaw = h24 >= 12 ? 'م' : 'ص';
    const LRM = '\u200E';
    const ampm = `${LRM}${ampmRaw}${LRM}`;
    const h12 = h24 % 12 || 12;

    return `${day}/${month}/${year} - ${h12}:${minutes} ${ampm}`;
  }

  // ===== Export =====
  async exportPdf() {
    // 1st click -> enter selection mode
    if (!this.exportMode) {
      this.exportMode = true;
      this.pendingExport = 'pdf';
      this.message.add({ severity: 'info', summary: 'Select members', detail: 'اختر الأكونتات ثم اضغط Export PDF مرة أخرى' });
      return;
    }

    if (this.pendingExport && this.pendingExport !== 'pdf') {
      this.pendingExport = 'pdf';
      this.message.add({ severity: 'info', summary: 'Select members', detail: 'اختر الأكونتات ثم اضغط Export PDF مرة أخرى' });
      return;
    }

    try {
      const jsPDF = (await import('jspdf')).default;
      const autoTable = (await import('jspdf-autotable')).default;

      // Load Arabic-capable font (DejaVuSans) so Arabic text doesn't become garbled.
      // Keep direction LTR to avoid "mirrored" text.
      const ensureDejaVu = async (doc: any) => {
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
          // If font loading fails, PDF still generates (Arabic may not render correctly)
        }
      };

      const selected = this.getSelectedMembers();
      if (!selected.length) {
        this.message.add({ severity: 'warn', summary: 'Select members', detail: 'اختر على الأقل عضو واحد' });
        return;
      }

      const famParam = this.canSelectFamily() ? this.selectedFamily : undefined;
      const detailsArr = await this.fetchDetailsForMembers(selected, famParam);
      const attArr = await this.fetchAttendanceForMembers(selected, famParam);

      const doc = new jsPDF({ orientation: 'landscape' });
      await ensureDejaVu(doc);
      const hasArabic = (s: string) => /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(s);
      const processArabic =
        (doc as any).processArabic ||
        ((jsPDF as any)?.API?.processArabic
          ? (text: string) => (jsPDF as any).API.processArabic(text)
          : null);
      const pdfText = (v: any) => {
        const s = (v ?? '') + '';
        if (!s) return '';
        if (!hasArabic(s)) return s;
        return typeof processArabic === 'function' ? processArabic(s) : s;
      };
      const pageRight = doc.internal.pageSize.getWidth() - 14;
      doc.setFontSize(14);
      doc.text(pdfText('تفاصيل حضور الأعضاء'), pageRight, 14, { align: 'right' });
      doc.setFontSize(10);

      let y = 20;
      for (let idx = 0; idx < selected.length; idx++) {
        const m = selected[idx];
        const d = detailsArr[idx] || {};
        const fam = (d.deaconFamily ?? m.deaconFamily) || '';
        const phone = d.phoneNumber || '';
        const records = attArr[idx] || [];

        doc.setFontSize(12);
        doc.text(pdfText(`${m.fullName} (${this.roleAr(m.role)})`), pageRight, y, { align: 'right' });
        y += 6;
        doc.setFontSize(10);
        doc.text(pdfText(`الأسرة: ${fam}`), pageRight, y, { align: 'right' });
        doc.text(pdfText(`الهاتف: ${phone}`), pageRight - 110, y, { align: 'right' });
        y += 4;

        // Group by Type and merge the Type cell (rowSpan) so each type appears once.
        const body: any[] = [];
        if (records.length) {
          const sorted = [...records].sort((a, b) => {
            const t = (a.type || '').localeCompare(b.type || '');
            if (t !== 0) return t;
            return (a.date || '').localeCompare(b.date || '');
          });

          const groups = new Map<string, AttendanceRow[]>();
          sorted.forEach((r) => {
            const key = r.type || '';
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(r);
          });

          for (const [type, list] of groups) {
            list.forEach((r, i) => {
              // IMPORTANT: With rowSpan, subsequent rows must NOT include a placeholder cell
              // for the spanned column, otherwise cells shift into wrong columns.
              if (i === 0) {
                const typeCell = {
                  content: pdfText(this.titleForType(type as AttendanceRow['type'])),
                  rowSpan: list.length,
                  styles: { valign: 'middle', fontStyle: 'bold', font: 'DejaVu', halign: 'right' }
                };
                body.push([
                  typeCell,
                  pdfText(r.date || ''),
                  pdfText(this.statusAr(r.status)),
                  pdfText(this.formatRecordedAt(r.createdAt)),
                  r.takenBy?.fullName ? pdfText(`${r.takenBy.fullName}`) : ''
                ]);
              } else {
                body.push([
                  pdfText(r.date || ''),
                  pdfText(this.statusAr(r.status)),
                  pdfText(this.formatRecordedAt(r.createdAt)),
                  r.takenBy?.fullName ? pdfText(`${r.takenBy.fullName}`) : ''
                ]);
              }
            });
          }
        }

        autoTable(doc, {
          startY: y,
          head: [[pdfText('النوع'), pdfText('تاريخ المناسبة'), pdfText('الحالة'), pdfText('وقت التسجيل'), pdfText('المسجّل')]],
          body: body.length ? body : [['', '', '', '', '']],
          theme: 'grid',
          margin: { left: 14, right: 14 },
          tableWidth: doc.internal.pageSize.getWidth() - 28,
          tableLineColor: [120, 120, 120],
          tableLineWidth: 0.25,
          styles: {
            fontSize: 9,
            font: 'DejaVu',
            halign: 'right',
            lineColor: [145, 145, 145],
            lineWidth: 0.2
          },
          headStyles: {
            lineColor: [90, 90, 90],
            lineWidth: 0.3,
            textColor: [255, 255, 255]
          },
          bodyStyles: {
            lineColor: [150, 150, 150],
            lineWidth: 0.2
          },
          columnStyles: {
            0: { cellWidth: (doc.internal.pageSize.getWidth() - 28) * 0.24 },
            1: { cellWidth: (doc.internal.pageSize.getWidth() - 28) * 0.18 },
            2: { cellWidth: (doc.internal.pageSize.getWidth() - 28) * 0.12 },
            3: { cellWidth: (doc.internal.pageSize.getWidth() - 28) * 0.22 },
            4: { cellWidth: (doc.internal.pageSize.getWidth() - 28) * 0.24 }
          }
        });

        // @ts-ignore
        y = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 10 : y + 20;
        if (y > 180) {
          doc.addPage();
          y = 14;
        }
      }

      doc.save('members_attendance.pdf');

      this.exportMode = false;
      this.pendingExport = '';
      this.selectAll = false;
      this.members.forEach((m) => (m.selected = false));
    } catch {
      this.message.add({ severity: 'error', summary: 'Export failed', detail: 'PDF export failed' });
    }
  }
}

