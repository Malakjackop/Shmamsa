import { Component, OnInit, inject, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { AttendanceService, AttendanceType } from '../services/attendance.service';
import { AuthService } from '../services/auth.service';
import { FamilyService } from '../services/family.service';
import { MessageService } from 'primeng/api';

type PickUser = { id: number; username?: string; fullName: string; deaconFamily?: string };

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

  selectedType: AttendanceType = 'FRIDAY_LITURGY';

  // Families (base names, بدون أ/ب)
  families: string[] = [];
  selectedFamily = ''; // '' => كل الأسر

  // Members when a family is selected
  members: PickUser[] = [];

  // Global search results when no family is selected
  globalResults: PickUser[] = [];

  searchText = '';
  private searchTimer: any = null;
  searching = false;

  // Selected users (from list OR QR scan)
  selected: PickUser[] = [];

  ngOnInit() {
    if (!isPlatformBrowser(this.platformId)) return;

    this.auth.getUserData().subscribe((u) => {
      this.me = u;
      this.loadFamilies();
    });
  }

  toggleScan() {
    this.scanning = !this.scanning;
  }

  onFamilyChange() {
    // reset lists
    this.members = [];
    this.globalResults = [];

    if (this.selectedFamily) {
      this.loadMembersForFamily();
    } else {
      // No family => global search mode; if user already typed search, run it
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

    // لو محدد أسرة => البحث يكون local filter (مفيش call للباك)
    if (this.selectedFamily) return;

    // لو مش محدد أسرة => بحث في كل الأسر من الباك
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
    this.familySvc.members(this.selectedFamily).subscribe({
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
    deaconFamily: u?.deaconFamily
  });

  // اللي بيتعرض في الليست
  get displayedMembers(): PickUser[] {
    const q = (this.searchText || '').trim().toLowerCase();

    if (this.selectedFamily) {
      // search داخل الأسرة
      if (!q) return this.members;
      return this.members.filter((m) => (m.fullName || '').toLowerCase().includes(q));
    }

    // search في كل الأسر (results جاية من backend)
    return this.globalResults;
  }

  // ---------- Selection ----------
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

  // ---------- QR ----------
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

  // ---------- Submit ----------
  submit() {
    const users = this.selected.map((x) => ({ id: x.id, username: x.username }));
    if (users.length === 0) {
      this.message.add({ severity: 'warn', summary: 'No users', detail: 'اختار اسم واحد على الأقل أو اعمل Scan للـ QR' });
      return;
    }

    this.attendance.submit(users, this.selectedType).subscribe({
      next: (res) => {
        this.message.add({
          severity: 'success',
          summary: 'Saved',
          detail: `Created: ${res.created}, Skipped: ${res.skipped}`
        });
        this.selected = [];
      },
      error: (err) => {
        this.message.add({ severity: 'error', summary: 'Error', detail: err?.error?.error || 'Failed' });
      }
    });
  }
}
