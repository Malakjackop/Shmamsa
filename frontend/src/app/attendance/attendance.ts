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

  // Calendar (servants can choose which day to submit for)
  selectedDate: Date | null = null;
  minDate!: Date;
  maxDate!: Date;
  disabledDays: number[] = [0, 1, 2, 3]; // Sun..Wed disabled (allow Thu/Fri/Sat)
  firstDayOfWeek = 1; // Monday

  selectedType: AttendanceType = 'FRIDAY_LITURGY';

  typeOptions: { value: AttendanceType; label: string }[] = [];

  families: string[] = [];
  selectedFamily = ''; 

  members: PickUser[] = [];

  globalResults: PickUser[] = [];

  searchText = '';
  private searchTimer: any = null;
  searching = false;
  selected: PickUser[] = [];

  ngOnInit() {
    if (!isPlatformBrowser(this.platformId)) return;

    this.auth.getUserData().subscribe((u) => {
      this.me = u;
      this.initCalendarRules();
      this.loadFamilies();
    });
  }

  private initCalendarRules() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Week starts Monday
    const day = today.getDay(); // 0..6
    const diffToMonday = (day + 6) % 7; // Monday => 0, Sunday => 6
    const monday = new Date(today);
    monday.setDate(today.getDate() - diffToMonday);

    const canOverrideWeekClose =
      ['AMIN_OSRA', 'AMIN_KHEDMA', 'DEVELOPER'].includes((this.me?.role || '').toUpperCase());

    // لو أمين أسرة/أمين خدمة/Developer: يقدر يسجل لأي يوم فات (بس خميس/جمعة/سبت)
    // غير كده: من Monday بتاع الأسبوع الحالي لحد النهارده
    this.minDate = canOverrideWeekClose ? new Date(2020, 0, 1) : monday;
    this.maxDate = today;
    // Pick default date: today if allowed; otherwise the latest allowed day within this week up to today.
    const allowed = (d: Date) => {
      const dow = d.getDay();
      return dow === 4 || dow === 5 || dow === 6; // Thu/Fri/Sat
    };

    let d = new Date(today);
    if (allowed(d)) {
      this.selectedDate = d;
    } else {
      // walk backwards within this week
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
    if (dow === 4) {
      this.selectedType = 'FAMILY_MEETING';
      this.typeOptions = [{ value: 'FAMILY_MEETING', label: 'اجتماع الأسرة' }];
    } else if (dow === 5) {
      this.selectedType = 'FRIDAY_LITURGY';
      this.typeOptions = [{ value: 'FRIDAY_LITURGY', label: 'قداس الجمعة' }];
    } else if (dow === 6) {
      this.selectedType = 'TASBEEHA';
      this.typeOptions = [{ value: 'TASBEEHA', label: 'تسبحة' }];
    } else {
      // Not allowed day (should be blocked by UI). Keep safe.
      this.typeOptions = [];
    }
  }

  private toIsoDate(d: Date): string {
    // yyyy-MM-dd
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
    this.familySvc.families().subscribe({
      next: (f) => (this.families = f || []),
      error: () => (this.families = [])
    });
  }

  private loadMembersForFamily() {
    // In attendance page we want the list to include everyone in the family (including the logged-in servant).
    this.familySvc.members(this.selectedFamily, true).subscribe({
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

  prettyRole(role?: string): string {
    const r = (role || '').toUpperCase();
    switch (r) {
      case 'MAKHDOM':
        return 'مخدوم';
      case 'KHADIM':
        return 'خادم';
      case 'AMIN_OSRA':
        return 'أمين أسرة';
      case 'AMIN_KHEDMA':
        return 'أمين خدمة';
      case 'DEVELOPER':
        return 'Developer';
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

    this.attendance.scanToken(token).subscribe({
      next: (u) => {
        const pu = this.toPickUser(u);
        if (!pu?.id) return;
        if (this.isSelected(pu.id)) return;
        this.selected = [...this.selected, pu];
      },
      error: () => {
        this.message.add({ severity: 'warn', summary: 'Invalid QR', detail: 'This QR is not valid or user not found' });
      }
    });
  }

  submit() {
    if (!this.selectedDate) {
      this.message.add({ severity: 'warn', summary: 'No date', detail: 'اختار يوم (خميس/جمعة/سبت) من التقويم' });
      return;
    }

    const users = this.selected.map((x) => ({ id: x.id, username: x.username }));
    const canOverrideWeekClose =
      ['AMIN_OSRA', 'AMIN_KHEDMA', 'DEVELOPER'].includes((this.me?.role || '').toUpperCase());

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
        this.message.add({
          severity: 'success',
          summary: 'Saved',
          detail: `Date: ${res?.date || iso} | حضور: +${created} | تحويل غياب→حضور: ${updated} | غياب اتعمل: ${absent} | Skipped: ${skipped}`
        });
        this.selected = [];
      },
      error: (err) => {
        this.message.add({ severity: 'error', summary: 'Error', detail: err?.error?.error || 'Failed' });
      }
    });
  }
}
