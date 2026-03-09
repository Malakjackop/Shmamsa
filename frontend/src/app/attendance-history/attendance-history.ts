import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AttendanceService } from '../services/attendance.service';
import { MessageService } from 'primeng/api';
import { FormsModule } from '@angular/forms';

type HistoryItem = {
  id: number;
  date: string;
  time: string;
  type: string;
  status?: 'PRESENT' | 'ABSENT' | string;
  takenBy?: string | null;
};

@Component({
  selector: 'app-attendance-history',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './attendance-history.html',
  styleUrls: ['./attendance-history.css'],
  providers: [MessageService]
})
export class AttendanceHistoryComponent implements OnInit {
  private attendanceSvc = inject(AttendanceService);
  private message = inject(MessageService);

  loading = false;
  items: HistoryItem[] = [];

  filterType = '';
  filteredItems: HistoryItem[] = [];

  ngOnInit(): void {
    this.load();
  }

  labelType(t: string): string {
    switch (t) {
      case 'FRIDAY_LITURGY':
        return 'قداس الجمعة';
      case 'TASBEEHA':
        return 'تسبحة';
      case 'FAMILY_MEETING':
        return 'أسرة';
      case 'MARMARKOS_KHORS':
        return 'خورس مارمرقس';
      case 'ATHANASIUS_KHORS':
        return 'خورس البابا أثناسيوس';
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

    // Handles plain time from backend like HH:mm[:ss[.SSS]]
    const timeMatch = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/);
    if (timeMatch) {
      let hours = Number(timeMatch[1]);
      const minutes = timeMatch[2];
      const period = hours >= 12 ? 'pm' : 'am';
      hours = hours % 12 || 12;
      return `${hours}:${minutes} ${period}`;
    }

    // Fallback for datetime values like ISO strings
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) {
      const hours24 = date.getHours();
      const minutes = date.getMinutes().toString().padStart(2, '0');
      const period = hours24 >= 12 ? 'pm' : 'am';
      const hours12 = (hours24 % 12) || 12;
      return `${hours12}:${minutes} ${period}`;
    }

    return raw;
  }

  applyFilter() {
    if (!this.filterType) {
      this.filteredItems = [...this.items];
      return;
    }
    this.filteredItems = this.items.filter((x) => x.type === this.filterType);
  }

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

  load() {
    this.loading = true;
    this.attendanceSvc.history().subscribe({
      next: (data) => {
        const rows = this.extractHistoryRows(data);
        this.items = rows.map(this.mapHistoryItem);
        this.applyFilter();
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.items = [];
        this.filteredItems = [];
        this.message.add({ severity: 'error', summary: 'Error', detail: err?.error?.error || 'Failed to load history' });
      }
    });
  }
}
