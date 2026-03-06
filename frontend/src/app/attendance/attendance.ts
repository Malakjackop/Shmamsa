import { Component, OnInit, inject, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { AttendanceService, AttendanceType } from '../services/attendance.service';
import { AuthService } from '../services/auth.service';
import { FamilyService } from '../services/family.service';
import { MessageService } from 'primeng/api';

type PickUser = { id: number; username?: string; fullName: string; role?: string; deaconFamily?: string };

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

  selectedType: AttendanceType = 'FRIDAY_LITURGY';

  typeOptions: { value: AttendanceType; label: string }[] = [];

  families: string[] = [];
  selectedFamily = '';
  private readonly preferredFamilyOrder: string[] = [
    'اسره السمائين',
    'اسره القديس ابانوب',
    'اسره القديس ديسقورس',
    'اسره القديس سيدهم بشاي',
    'اسره القديس اسكلابيوس',
    'اسره القديس البابا كيرلس',
    'اسره القديس الانبا ابرام',
    'اسره الديس اسطفانوس',
    'خورس مارمرقس',
    'خورس البابا اثناسيوس'
  ];

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

    this.auth.getUserData().subscribe((u) => {
      this.me = u;
      this.initCalendarRules();
      this.loadFamilies();
    });
  }


  private hasAnyAminOsraScope(): boolean {
    const norm = (v: any) => {
      const raw = String(v || '').trim();
      const up = raw.toUpperCase();
      if (!up) return '';
      if (['امين اسرة','امين الاسرة','أمين أسرة','أمين الاسره','امين الأسرة','أمين الأسرة','امين اسره'].includes(raw)) return 'AMIN_OSRA';
      if (up.startsWith('ROLE_')) return up.substring(5);
      return up;
    };
    const roles = [
      this.me?.deaconFamilyRole,
      this.me?.deaconFamilyRole2,
      this.me?.deaconFamilyRole3,
      this.me?.deaconFamilyRole4
    ].map(norm);
    return roles.includes('AMIN_OSRA');
  }

  private initCalendarRules() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);


    const day = today.getDay();
    const diffToMonday = (day + 6) % 7;
    const monday = new Date(today);
    monday.setDate(today.getDate() - diffToMonday);


    const rawRole = String(this.me?.role || '').trim();
    const roleNorm = rawRole.toUpperCase().replace(/[-\s]+/g, '_');
    const roleArNorm = rawRole
      .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
      .trim()
      .replace(/\s+/g, ' ');
    const isKhadimRole =
      ['KHADIM', 'ROLE_KHADIM'].includes(roleNorm) ||
      ['خادم'].includes(roleArNorm);

    const canOverrideWeekClose =
      ['AMIN_OSRA', 'AMIN_KHEDMA', 'DEVELOPER', 'DEV', 'ROLE_AMIN_OSRA', 'ROLE_AMIN_KHEDMA', 'ROLE_DEVELOPER'].includes(roleNorm) ||
      ['امين خدمة', 'أمين خدمة', 'امين الخدمه', 'أمين الخدمه', 'امين اسرة', 'أمين أسرة', 'امين الاسرة', 'أمين الاسره', 'امين الأسرة'].includes(roleArNorm) || this.hasAnyAminOsraScope();


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

    // الأيام المفتوحة: الخميس/الجمعة/السبت
    if (!(dow === 4 || dow === 5 || dow === 6)) {
      this.typeOptions = [];
      return;
    }

    const scopeNorm = String(this.me?.servingScope || '')
      .trim()
      .toUpperCase()
      .replace(/[-\s]+/g, '_');
    const myKhors = String(this.me?.khors || '').trim().toUpperCase();

    // المطلوب: النوع يبقى مفتوح (قداس/تسبحة/اجتماع أسرة) على كل الأيام المفتوحة
    const opts: { value: AttendanceType; label: string }[] = [
      { value: 'FRIDAY_LITURGY', label: 'قداس' },
      { value: 'TASBEEHA', label: 'تسبحة' },
      { value: 'FAMILY_MEETING', label: 'اجتماع الأسرة' }
    ];

    // حضور الخورس يظهر فقط للخادم اللي في الخورس بتاعه (حسب servingScope + khors)
    const canChoir = scopeNorm === 'KHORS_ONLY' || scopeNorm === 'BOTH';
    if (canChoir) {
      if (myKhors === 'BOTH') {
        opts.push({ value: 'MARMARKOS_KHORS', label: 'خورس مارمرقس' });
        opts.push({ value: 'ATHANASIUS_KHORS', label: 'خورس البابا اثناسيوس' });
      } else if (myKhors === 'MARMARKOS') {
        opts.push({ value: 'MARMARKOS_KHORS', label: 'خورس مارمرقس' });
      } else if (myKhors === 'ATHANASIUS') {
        opts.push({ value: 'ATHANASIUS_KHORS', label: 'خورس البابا اثناسيوس' });
      }
    }

    this.typeOptions = opts;

    // حافظ على الاختيار لو لسه موجود، وإلا اختار أول نوع
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
    // ربط نوع الخورس بالأسرة المختارة (بدون ربط بيوم معين)

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
    if (n.includes('سمائ')) return 'اسره السمائين';
    if (n.includes('ابانوب')) return 'اسره القديس ابانوب';
    if (n.includes('ديسقورس')) return 'اسره القديس ديسقورس';
    if (n.includes('سيدهم') || n.includes('بشاي')) return 'اسره القديس سيدهم بشاي';
    if (n.includes('اسكلابيوس')) return 'اسره القديس اسكلابيوس';
    if (n.includes('كيرلس')) return 'اسره القديس البابا كيرلس';
    if (n.includes('ابرام')) return 'اسره القديس الانبا ابرام';
    if (n.includes('اسطفانوس') || n.includes('استفانوس')) return 'اسره الديس اسطفانوس';

    return family;
  }

  private sortFamiliesByPreferredOrder(families: string[]): string[] {
    const cleaned = (families || []).map((x) => String(x || '').trim()).filter(Boolean);
    const orderMap = new Map(
      this.preferredFamilyOrder.map((name, index) => [this.normalizeFamilyName(name), index])
    );

    return [...cleaned].sort((a, b) => {
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

  private loadFamilies() {
    this.familySvc.families('attendance').subscribe({
      next: (f) => {
        this.families = this.sortFamiliesByPreferredOrder(f || []);
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
    deaconFamily: u?.deaconFamily
  });

  isKhadim(): boolean {
    return this.me?.role === 'KHADIM';
  }

  canSelectFamily(): boolean {
    // attendance page: allow family switching for AMIN_KHEDMA/DEV and KHADIM
    return this.me?.role === 'AMIN_KHEDMA' || this.me?.role === 'DEVELOPER' || this.isKhadim();
  }

  prettyRole(role?: string): string {
    const r = (role || '').toUpperCase();
    switch (r) {
      case 'MAKHDOM':
        return 'مخدوم';
      case 'KHADIM':
        return 'خادم';
      case 'AMIN_OSRA':
        return 'امين اسره';
      case 'AMIN_KHEDMA':
        return 'امين خدمة';
      case 'DEVELOPER':
        return 'dev';
      default:
        return role || '';
    }
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
      this.selected = this.selected.filter((x) => x.id !== u.id);
    } else {
      this.selected = [...this.selected, u];
    }
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

    this.attendance.scanToken(token).subscribe({
      next: (u) => {
        const pu = this.toPickUser(u);
        if (!pu?.id) return;

        if (this.isSelected(pu.id)) {
          this.message.add({
            severity: 'info',
            summary: 'الاسم موجود بالفعل',
            detail: `${pu.fullName} موجود بالفعل في قائمة التسجيل.`,
            life: 2500
          });
          return;
        }

        this.selected = [...this.selected, pu];
        this.message.add({
          severity: 'success',
          summary: 'تم الاسكان بنجاح',
          detail: `${pu.fullName} اتضاف تحت في قائمة التسجيل. اضغط تسجيل لحفظ الحضور.`,
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
    const roleNorm = String(this.me?.role || '')
      .trim()
      .toUpperCase()
      .replace(/[-\s]+/g, '_');

    const canOverrideWeekClose =
      ['AMIN_OSRA', 'AMIN_KHEDMA', 'DEVELOPER', 'DEV'].includes(roleNorm);

    // السماح لأمين أسرة/أمين خدمة/Developer بتسجيل الغياب حتى لو مفيش حد حاضر (قائمة فاضية)
    if (users.length === 0 && !canOverrideWeekClose) {
      this.message.add({ severity: 'warn', summary: 'No users', detail: 'اختار اسم واحد على الأقل أو اعمل Scan للـ QR' });
      return;
    }

    // في حالة اجتماع الأسرة (الخميس) لازم تختار الأسرة عشان نعرف مين نطاق التسجيل
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
        this.message.add({
          severity: 'success',
          summary: 'تم حفظ تسجيل الحضور',
          detail: `تم حفظ الحضور بنجاح ليوم ${res?.date || iso} — الحضور: ${totalPresent}، الغياب: ${absent}، بدون تغيير: ${skipped}`,          life: 4000
        });
        this.selected = [];
      },
      error: (err) => {
        this.message.add({ severity: 'error', summary: 'Error', detail: err?.error?.error || 'Failed' });
      }
    });
  }
}

