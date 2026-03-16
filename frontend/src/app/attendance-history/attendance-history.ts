import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AttendanceService } from '../services/attendance.service';
import { MessageService } from 'primeng/api';

type HistoryItem = {
  id: number;
  date: string;
  time: string;
  type: string;
  status?: 'PRESENT' | 'ABSENT' | string;
  takenBy?: string | null;
};

type TypeGroup = {
  type: string;
  rows: HistoryItem[];
};

type MonthGroup = {
  key: string;
  title: string;
  year?: number | null;
  typeGroups: TypeGroup[];
};

@Component({
  selector: 'app-attendance-history',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './attendance-history.html',
  styleUrls: ['./attendance-history.css'],
  providers: [MessageService]
})
export class AttendanceHistoryComponent implements OnInit {
  private attendanceSvc = inject(AttendanceService);
  private message = inject(MessageService);

  loading = false;
  items: HistoryItem[] = [];
  monthGroups: MonthGroup[] = [];
  expandedMonths = new Set<string>();

  ngOnInit(): void {
    this.load();
  }

  labelType(t: string): string {
    switch (t) {
      case 'FRIDAY_LITURGY':
        return 'قداس';
      case 'TASBEEHA':
        return 'التسبحة';
      case 'FAMILY_MEETING':
        return 'الأسرة';
      case 'MARMARKOS_KHORS':
        return 'خورس مارمرقس';
      case 'ATHANASIUS_KHORS':
        return 'خورس أثناسيوس';
      default:
        return t;
    }
  }

  labelStatus(s?: string): string {
    if (s === 'PRESENT') return 'حاضر';
    if (s === 'ABSENT') return 'غائب';
    return '-';
  }

  formatTime12h(value?: string): string {
    if (!value || value === '-') return '-';

    const raw = value.trim();

    const timeMatch = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/);
    if (timeMatch) {
      let hours = Number(timeMatch[1]);
      const minutes = timeMatch[2];
      const period = hours >= 12 ? 'م' : 'ص';
      hours = hours % 12 || 12;
      return `${hours}:${minutes} ${period}`;
    }

    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) {
      const hours24 = date.getHours();
      const minutes = date.getMinutes().toString().padStart(2, '0');
      const period = hours24 >= 12 ? 'م' : 'ص';
      const hours12 = (hours24 % 12) || 12;
      return `${hours12}:${minutes} ${period}`;
    }

    return raw;
  }

  formatDate(value?: string): string {
    const parsed = this.parseDateOnly(value);
    if (!parsed) return value || '-';

    return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
      day: 'numeric',
      month: 'long'
    }).format(parsed);
  }

  isExpanded(monthKey: string): boolean {
    return this.expandedMonths.has(monthKey);
  }

  toggleMonth(monthKey: string): void {
    if (this.expandedMonths.has(monthKey)) {
      this.expandedMonths.delete(monthKey);
      return;
    }
    this.expandedMonths.add(monthKey);
  }

  trackMonth = (_: number, group: MonthGroup) => group.key;
  trackTypeGroup = (_: number, group: TypeGroup) => group.type;
  trackRow = (_: number, row: HistoryItem) => row.id;

  private mapHistoryItem = (x: any): HistoryItem => ({
    id: Number(x?.id ?? x?.attendanceId ?? 0),
    date: String(x?.date ?? x?.attendanceDate ?? x?.day ?? '-'),
    time: String(x?.time ?? x?.attendanceTime ?? x?.createdAt ?? '-'),
    type: String(x?.type ?? x?.attendanceType ?? '-'),
    status: x?.status,
    takenBy: x?.takenBy ?? x?.takenByName ?? x?.servantName ?? null
  });

  private extractHistoryRows(payload: any): any[] {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== 'object') return [];

    const candidates = ['items', 'history', 'records', 'rows', 'data'];
    for (const key of candidates) {
      const value = (payload as any)[key];
      if (Array.isArray(value)) return value;
    }
    return [];
  }

  private rebuildGroups(): void {
    const sortedItems = [...this.items].sort((a, b) => this.sortHistoryRowsDesc(a, b));
    const years = new Set<number>();

    for (const item of sortedItems) {
      const date = this.parseDateOnly(item.date);
      if (date) years.add(date.getFullYear());
    }

    const shouldShowYear = years.size > 1;
    const monthMap = new Map<string, { date: Date | null; rows: HistoryItem[] }>();

    for (const item of sortedItems) {
      const date = this.parseDateOnly(item.date);
      const monthKey = date
        ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
        : 'unknown';

      if (!monthMap.has(monthKey)) {
        monthMap.set(monthKey, { date, rows: [] });
      }
      monthMap.get(monthKey)?.rows.push(item);
    }

    const monthEntries = Array.from(monthMap.entries()).sort((a, b) => {
      const aDate = a[1].date?.getTime() ?? 0;
      const bDate = b[1].date?.getTime() ?? 0;
      return bDate - aDate;
    });

    this.monthGroups = monthEntries.map(([key, entry]) => {
      const typeMap = new Map<string, HistoryItem[]>();

      for (const row of entry.rows) {
        if (!typeMap.has(row.type)) {
          typeMap.set(row.type, []);
        }
        typeMap.get(row.type)?.push(row);
      }

      const typeGroups = Array.from(typeMap.entries())
        .sort((a, b) => this.typeOrder(a[0]) - this.typeOrder(b[0]))
        .map(([type, rows]) => ({
          type,
          rows: rows.sort((a, b) => this.sortHistoryRowsDesc(a, b))
        }));

      return {
        key,
        title: this.buildMonthTitle(entry.date, shouldShowYear),
        year: entry.date?.getFullYear() ?? null,
        typeGroups
      };
    });

    if (this.monthGroups.length > 0 && this.expandedMonths.size === 0) {
      this.expandedMonths.add(this.monthGroups[0].key);
    }
  }

  private buildMonthTitle(date: Date | null, showYear: boolean): string {
    if (!date) return 'شهر غير معروف';

    const monthName = new Intl.DateTimeFormat('ar-EG', { month: 'long' }).format(date);
    return showYear ? `شهر ${monthName} ${date.getFullYear()}` : `شهر ${monthName}`;
  }

  private parseDateOnly(value?: string): Date | null {
    if (!value || value === '-') return null;

    const dateMatch = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateMatch) {
      const [, year, month, day] = dateMatch;
      return new Date(Number(year), Number(month) - 1, Number(day));
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  }

  private timeForSorting(value?: string): number {
    if (!value || value === '-') return 0;

    const raw = value.trim();
    const timeMatch = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/);
    if (timeMatch) {
      const hours = Number(timeMatch[1]);
      const minutes = Number(timeMatch[2]);
      const seconds = Number(timeMatch[3] ?? 0);
      return (hours * 3600) + (minutes * 60) + seconds;
    }

    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return (parsed.getHours() * 3600) + (parsed.getMinutes() * 60) + parsed.getSeconds();
    }

    return 0;
  }

  private sortHistoryRowsDesc(a: HistoryItem, b: HistoryItem): number {
    const dateDiff =
      (this.parseDateOnly(b.date)?.getTime() ?? 0) -
      (this.parseDateOnly(a.date)?.getTime() ?? 0);

    if (dateDiff !== 0) return dateDiff;

    const timeDiff = this.timeForSorting(b.time) - this.timeForSorting(a.time);
    if (timeDiff !== 0) return timeDiff;

    return (b.id ?? 0) - (a.id ?? 0);
  }

  private typeOrder(type: string): number {
    switch (type) {
      case 'FAMILY_MEETING':
        return 1;
      case 'FRIDAY_LITURGY':
        return 2;
        case 'MARMARKOS_KHORS':
          return 3;
          case 'TASBEEHA':
        return 4;
      case 'ATHANASIUS_KHORS':
        return 5;
      default:
        return 99;
    }
  }

  load() {
    this.loading = true;
    this.attendanceSvc.history().subscribe({
      next: (data) => {
        const rows = this.extractHistoryRows(data);
        this.items = rows.map(this.mapHistoryItem);
        this.rebuildGroups();
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.items = [];
        this.monthGroups = [];
        this.expandedMonths.clear();
        this.message.add({
          severity: 'error',
          summary: 'Error',
          detail: err?.error?.error || 'Failed to load history'
        });
      }
    });
  }
}
