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
  takenBy?: string | null;
};

@Component({
  selector: 'app-attendance-history',
  standalone: true,
  imports: [CommonModule,FormsModule],
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
      case 'FRIDAY_LITURGY': return 'قداس الجمعة';
      case 'TASBEEHA': return 'تسبحة';
      case 'FAMILY_MEETING': return 'أسرة';
      default: return t;
    }
  }

  applyFilter() {
  if (!this.filterType) {
    this.filteredItems = [...this.items];
    return;
  }
  this.filteredItems = this.items.filter(x => x.type === this.filterType);
}


load() {
  this.loading = true;
  this.attendanceSvc.history().subscribe({
    next: (data) => {
      this.items = (data as any) || [];
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
