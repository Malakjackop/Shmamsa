import { Component, OnInit, inject, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { AttendanceService, AttendanceType } from '../services/attendance.service';
import { AuthService } from '../services/auth.service';
import { FamilyService } from '../services/family.service';
import { MessageService } from 'primeng/api';
import { assignmentRolesOf, normalizeRole, roleLabel } from '../shared/role-utils';
import { DEFAULT_FAMILY_ORDER, sortFamiliesByPreferredOrder } from '../shared/family-utils';

type PickUser = {
  id: number;
  username?: string;
  fullName: string;
  role?: string;
  familyName?: string;
  deaconFamily?: string;
  familyAssignments?: Array<{ familyId?: number; familyName?: string; roleCode?: number; role?: string; assignmentOrder?: number }>;
};

@Component({
  selector: 'app-attendance',
  standalone: false,
  templateUrl: './attendance.html',
  styleUrls: ['./attendance.css'],
  providers: [MessageService]
})
export class AttendanceComponent implements OnInit {
  private attendance = inject(AttendanceService);
  private auth = inject(AuthService);
  private familySvc = inject(FamilyService);
  private message = inject(MessageService);

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {}

  me: any;
  scanning = false;

  selectedDate: Date | null = null;
  minDate!: Date;
  maxDate!: Date;
  disabledDays: number[] = [0, 1, 2, 3];
  firstDayOfWeek = 1; // Monday
  arDateLocale = {
    firstDayOfWeek: 6,
    dayNames: ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'],
    dayNamesShort: ['أحد','اثن','ثلا','أرب','خم','جم','سبت'],
    dayNamesMin: ['ح','ن','ث','ر','خ','ج','س'],
    monthNames: ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'],
    monthNamesShort: ['ينا','فبر','مار','أبر','ماي','يون','يول','أغس','سبت','أكت','نوف','ديس'],
    today: 'اليوم',
    clear: 'مسح'
  };


  selectedType: AttendanceType = 'FRIDAY_LITURGY';

  typeOptions: { value: AttendanceType; label: string }[] = [];

  families: string[] = [];
  selectedFamily = '';
  private readonly preferredFamilyOrder = DEFAULT_FAMILY_ORDER;

  members: PickUser[] = [];

  globalResults: PickUser[] = [];

  searchText = '';
  private searchTimer: any = null;
  searching = false;
  selected: PickUser[] = [];
  private lastScannedToken = '';
  private lastScannedAt = 0;

  ngOnInit() {
    if (!isPlatformBrowser(this.platformId)) return;

    this.auth.getUserData(true).subscribe((u) => {
      this.me = u;
      this.initCalendarRules();
      this.loadFamilies();
    });
  }


  private hasAnyAminOsraScope(): boolean {
    return assignmentRolesOf(this.me).includes('AMIN_OSRA');
  }

  private hasAnyAminPrivilegeScope(): boolean {
    const roles = assignmentRolesOf(this.me);
    return roles.includes('AMIN_OSRA') || roles.includes('AMIN_KHEDMA');
  }

  private initCalendarRules() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);


    const day = today.getDay();
    const diffToMonday = (day + 6) % 7;
    const monday = new Date(today);
    monday.setDate(today.getDate() - diffToMonday);


    const roleNorm = normalizeRole(this.me?.role);
    const isKhadimRole = roleNorm === 'KHADIM';

    const canOverrideWeekClose =
      ['AMIN_OSRA', 'AMIN_KHEDMA', 'DEVELOPER'].includes(roleNorm) || this.hasAnyAminPrivilegeScope();


    if (canOverrideWeekClose) {
      this.minDate = new Date(2000, 0, 1);
      this.maxDate = today;
    } else if (isKhadimRole) {
      const thursday = new Date(monday);
      thursday.setDate(monday.getDate() + 3);
      const saturday = new Date(monday);
      saturday.setDate(monday.getDate() + 5);

      if (day >= 1 && day <= 3) {
        this.minDate = today;
        this.maxDate = today;
      } else {
        this.minDate = thursday;
        this.maxDate = day === 0 ? saturday : today;
      }
    } else {
      this.minDate = monday;
      this.maxDate = today;
    }
    const allowed = (d: Date) => {
      const dow = d.getDay();
      return dow === 4 || dow === 5 || dow === 6;
    };

    let d = new Date(today);
    if (allowed(d)) {
      this.selectedDate = d;
    } else {
      let found: Date | null = null;
      for (let i = 0; i < 7; i++) {
        const x = new Date(today);
        x.setDate(today.getDate() - i);
        if (!canOverrideWeekClose && x < monday) break;
        if (canOverrideWeekClose && x < this.minDate) break;
        if (allowed(x)) {
          found = x;
          break;
        }
      }
      this.selectedDate = found;
    }

    this.onDateChange();
  }




  onDateChange() {
    if (!this.selectedDate) {
      this.typeOptions = [];
      return;
    }

    const d = new Date(this.selectedDate);
    d.setHours(0, 0, 0, 0);
    const dow = d.getDay();

    if (!(dow === 4 || dow === 5 || dow === 6)) {
      this.typeOptions = [];
      return;
    }

    const scopeNorm = String(this.me?.servingScope || '')
      .trim()
      .toUpperCase()
      .replace(/[-\s]+/g, '_');
    const myKhors = String(this.me?.khors || '').trim().toUpperCase();

    const opts: { value: AttendanceType; label: string }[] = [
      { value: 'FRIDAY_LITURGY', label: 'قداس' },
      { value: 'TASBEEHA', label: 'تسبحة' },
      { value: 'FAMILY_MEETING', label: 'اجتماع الأسرة' }
    ];

const roleNorm = normalizeRole(this.me?.role);

const isAminKhedmaOrDev =
  ['AMIN_KHEDMA', 'DEVELOPER'].includes(roleNorm);

const canChoir = isAminKhedmaOrDev || scopeNorm === 'KHORS_ONLY' || scopeNorm === 'BOTH';

if (canChoir) {
  if (isAminKhedmaOrDev || myKhors === 'BOTH') {
    opts.push({ value: 'MARMARKOS_KHORS', label: 'خورس مارمرقس' });
    opts.push({ value: 'ATHANASIUS_KHORS', label: 'خورس البابا اثناسيوس' });
  } else if (myKhors === 'MARMARKOS') {
    opts.push({ value: 'MARMARKOS_KHORS', label: 'خورس مارمرقس' });
  } else if (myKhors === 'ATHANASIUS') {
    opts.push({ value: 'ATHANASIUS_KHORS', label: 'خورس البابا اثناسيوس' });
  }
}

    this.typeOptions = opts;

    const exists = opts.some((o) => o.value === this.selectedType);
    this.selectedType = (exists ? this.selectedType : (opts[0]?.value || 'FRIDAY_LITURGY')) as AttendanceType;

    this.syncFamilyWithType();
  }

  onTypeChange() {
    this.syncFamilyWithType();
  }

  private syncFamilyWithType() {
    if (!this.selectedDate) return;
    const d = new Date(this.selectedDate);
    d.setHours(0, 0, 0, 0);

    if (this.selectedType === 'MARMARKOS_KHORS') {
      this.selectedFamily = 'خورس مارمرقس';
      this.loadMembersForFamily();
    } else if (this.selectedType === 'ATHANASIUS_KHORS') {
      this.selectedFamily = 'خورس البابا اثناسيوس';
      this.loadMembersForFamily();
    }
  }

  private toIsoDate(d: Date): string {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  toggleScan() {
    this.scanning = !this.scanning;
  }

  onFamilyChange() {
    this.members = [];
    this.globalResults = [];

    if (this.selectedFamily) {
      this.loadMembersForFamily();
    } else {
      const q = this.searchText.trim();
      if (q) this.runSearch();
    }
  }

  onSearchChange(v: string) {
    this.searchText = v;

    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.runSearch(), 250);
  }

  private runSearch() {
    const q = (this.searchText || '').trim();

    if (this.selectedFamily) return;
    if (!q) {
      this.globalResults = [];
      return;
    }

    this.searching = true;
    this.familySvc.search(q).subscribe({
      next: (list) => {
        this.globalResults = (list as any[])?.map(this.toPickUser) || [];
        this.searching = false;
      },
      error: () => {
        this.globalResults = [];
        this.searching = false;
      }
    });
  }

  private loadFamilies() {
    this.familySvc.families('attendance').subscribe({
      next: (f) => {
        this.families = sortFamiliesByPreferredOrder(f || [], this.preferredFamilyOrder);
        if (!this.selectedFamily && this.families.length) {
          this.selectedFamily = this.families[0];
          this.loadMembersForFamily();
        }
      },
      error: () => (this.families = [])
    });
  }

  private loadMembersForFamily() {
    this.familySvc.members(this.selectedFamily, true, 'attendance').subscribe({
      next: (m) => (this.members = (m as any[])?.map(this.toPickUser) || []),
      error: (err) => {
        this.members = [];
        this.message.add({ severity: 'error', summary: 'Error', detail: err?.error?.error || 'Failed to load' });
      }
    });
  }

  private toPickUser = (u: any): PickUser => ({
    id: Number(u?.id),
    username: u?.username,
    fullName: u?.fullName,
    role: u?.role,
    familyName: this.familyLabel(u),
    deaconFamily: u?.deaconFamily,
    familyAssignments: u?.familyAssignments
  });

  familyLabel(entity: any): string {
    const assignments = Array.isArray(entity?.familyAssignments) ? entity.familyAssignments : [];
    return assignments
      .map((x: any) => String(x?.familyName || '').trim())
      .filter(Boolean)
      .join(' + ') || String(entity?.deaconFamily || '').trim();
  }

  isKhadim(): boolean {
    return normalizeRole(this.me?.role) === 'KHADIM';
  }

  canSelectFamily(): boolean {
    return ['AMIN_KHEDMA', 'DEVELOPER'].includes(normalizeRole(this.me?.role)) || this.isKhadim() || this.hasAnyAminPrivilegeScope();
  }

  prettyRole(role?: string): string {
    return roleLabel(role);
  }

  get displayedMembers(): PickUser[] {
    const q = (this.searchText || '').trim().toLowerCase();

    if (this.selectedFamily) {
      if (!q) return this.members;
      return this.members.filter((m) => (m.fullName || '').toLowerCase().includes(q));
    }

    return this.globalResults;
  }

  isSelected(id: number): boolean {
    return this.selected.some((x) => x.id === id);
  }

  toggleSelect(u: PickUser) {
    if (!u?.id) return;

    if (this.isSelected(u.id)) {
      return;
    }

    this.selected = [...this.selected, u];
  }

  remove(id: number) {
    this.selected = this.selected.filter((x) => x.id !== id);
  }

onCodeResult(resultString: string) {
  const token = (resultString || '').trim();
  if (!token) return;

  const now = Date.now();
  if (token === this.lastScannedToken && now - this.lastScannedAt < 1500) {
    return;
  }
  this.lastScannedToken = token;
  this.lastScannedAt = now;

  const iso = this.selectedDate ? this.toIsoDate(this.selectedDate) : undefined;
  const family = this.selectedType === 'FAMILY_MEETING'
    ? (this.selectedFamily || undefined)
    : undefined;

  this.attendance.scanToken(token, iso, this.selectedType, family).subscribe({
    next: (u) => {
      const pu = this.toPickUser(u);
      if (!pu?.id) return;

      if (u?.alreadyPresent) {
        this.message.add({
          severity: 'warn',
          summary: 'تم تسجيله بالفعل',
          detail: `${pu.fullName} متسجل بالفعل في نفس اليوم.`,
          life: 3500
        });
        return;
      }

      if (this.isSelected(pu.id)) {
        this.message.add({
          severity: 'warn',
          summary: 'الاسم موجود بالفعل',
          detail: `${pu.fullName} موجود بالفعل في قائمة التسجيل.`,
          life: 3000
        });
        return;
      }

      this.selected = [...this.selected, pu];

      if (u?.alreadyRecorded && u?.existingStatus === 'ABSENT') {
        this.message.add({
          severity: 'info',
          summary: 'كان مسجل غياب',
          detail: `${pu.fullName} كان متسجل غياب في نفس اليوم. اضغط تسجيل لتحويله إلى حضور.`,
          life: 3500
        });
        return;
      }

      this.message.add({
        severity: 'success',
        summary: 'تم الاسكان بنجاح',
        detail: `${pu.fullName} اتضاف في قائمة التسجيل.`,
        life: 3000
      });
    },
    error: () => {
      this.message.add({
        severity: 'warn',
        summary: 'QR غير صالح',
        detail: 'الكود غير صحيح أو العضو غير موجود.',
        life: 3000
      });
    }
  });
}

  submit() {
    if (!this.selectedDate) {
      this.message.add({ severity: 'warn', summary: 'No date', detail: 'اختار يوم (خميس/جمعة/سبت) من التقويم' });
      return;
    }

    const users = this.selected.map((x) => ({ id: x.id, username: x.username }));
    const roleNorm = normalizeRole(this.me?.role);

    const canOverrideWeekClose =
      ['AMIN_OSRA', 'AMIN_KHEDMA', 'DEVELOPER'].includes(roleNorm) || this.hasAnyAminPrivilegeScope();

    if (users.length === 0 && !canOverrideWeekClose) {
      this.message.add({ severity: 'warn', summary: 'No users', detail: 'اختار اسم واحد على الأقل أو اعمل Scan للـ QR' });
      return;
    }

    if (this.selectedType === 'FAMILY_MEETING' && !this.selectedFamily) {
      this.message.add({ severity: 'warn', summary: 'No family', detail: 'اختار الأسرة قبل التسجيل' });
      return;
    }

    const iso = this.toIsoDate(this.selectedDate);

    this.attendance.submit(users, this.selectedType, iso, this.selectedFamily || undefined).subscribe({
    next: (res) => {
      const created = res?.presentCreated ?? res?.created ?? 0;
      const updated = res?.presentUpdated ?? res?.updated ?? 0;
      const absent = res?.absentCreated ?? 0;
      const skipped = res?.skipped ?? 0;
      const totalPresent = created + updated;

      if (totalPresent === 0 && skipped > 0) {
        this.message.add({
          severity: 'warn',
          summary: 'لم يتم تسجيل حضور جديد',
          detail: `قد تم تسجيل هذا الاسم من قبل`,
          life: 4000
        });
        this.selected = [];
        return;
      }

      if (skipped > 0) {
        this.message.add({
          severity: 'warn',
          summary: 'تم الحفظ مع تجاهل مكرر',
          detail: `تم تسجيل حضور ${totalPresent}، وفيه ${skipped} متسجلين بالفعل.`,
          life: 4000
        });
        this.selected = [];
        return;
      }

      this.message.add({
        severity: 'success',
        summary: 'تم حفظ تسجيل الحضور',
        detail: `تم حفظ الحضور بنجاح ليوم ${res?.date || iso} — الحضور: ${totalPresent}`,
        life: 4000
      });
      this.selected = [];
    },
      error: (err) => {
        this.message.add({ severity: 'error', summary: 'Error', detail: err?.error?.error || 'Failed' });
      }
    });
  }
}


