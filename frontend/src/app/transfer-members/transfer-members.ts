import { Component, OnInit, inject } from '@angular/core';
import { FamilyService } from '../services/family.service';
import { AuthService } from '../services/auth.service';
import { MessageService, ConfirmationService } from 'primeng/api';

type Member = {
  id: number;
  fullName: string;
  role: string;
  deaconFamily: string;
  fridayLiturgy: number;
  tasbeeha: number;
  familyMeeting: number;
};

@Component({
  selector: 'app-transfer-members',
  standalone: false,
  templateUrl: './transfer-members.html',
  styleUrls: ['./transfer-members.css'],
  providers: [MessageService, ConfirmationService]
})
export class TransferMembersComponent implements OnInit {
  private familySvc = inject(FamilyService);
  private auth = inject(AuthService);
  private message = inject(MessageService);
  private confirm = inject(ConfirmationService);

  me: any;
  members: Member[] = [];
  loading = false;

  selecting = false;
  selectedIds = new Set<number>();

  families: string[] = [];

  selectedFamilyView = '';
  targetFamily = '';

  isAminKhedmaOrDev(): boolean {
    return this.me?.role === 'AMIN_KHEDMA' || this.me?.role === 'DEVELOPER';
  }

  ngOnInit() {
    this.auth.getUserData().subscribe({
      next: (u) => {
        this.me = u;
        this.loadFamilies();
      },
      error: () => {}
    });
  }

  private loadMembers() {
    this.loading = true;

    let famParam: string | undefined = undefined;
    if (this.isAminKhedmaOrDev()) {
      famParam = this.selectedFamilyView === 'SERVANTS' ? 'SERVANTS' : (this.selectedFamilyView || undefined);
    }

    this.familySvc.members(famParam).subscribe({
      next: (m) => {
        this.members = (m as any) || [];
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.message.add({ severity: 'error', summary: 'Error', detail: err?.error?.error || 'Failed to load members' });
      }
    });
  }

  private loadFamilies() {
    this.familySvc.families().subscribe({
      next: (f) => {
        this.families = (f || []).filter(x => !!x);

        if (this.isAminKhedmaOrDev()) {
          this.selectedFamilyView = this.families[0] || '';
        }

        const mine = (this.me?.deaconFamily || '').trim();
        this.targetFamily = this.families.find(x => x !== mine) || (this.families[0] || '');

        this.loadMembers();
      },
      error: () => {}
    });
  }

  startTransfer() {
    this.selecting = true;
    this.selectedIds.clear();
  }

  cancelSelecting() {
    this.selecting = false;
    this.selectedIds.clear();
  }

  toggleMember(id: number, checked: boolean) {
    if (checked) this.selectedIds.add(id);
    else this.selectedIds.delete(id);
  }

  doTransfer() {
    if (!this.targetFamily) {
      this.message.add({ severity: 'warn', summary: 'Choose family', detail: 'Please choose the target family.' });
      return;
    }

    if (!this.selectedIds.size) {
      this.message.add({ severity: 'warn', summary: 'No selection', detail: 'Please select at least one member.' });
      return;
    }

    const ids = Array.from(this.selectedIds);

    this.confirm.confirm({
      header: 'Confirm transfer',
      message: `Transfer ${ids.length} account(s) to "${this.targetFamily}"?`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Transfer',
      rejectLabel: 'Cancel',
      accept: () => {
        this.familySvc.transferMembers(ids, this.targetFamily).subscribe({
          next: (res) => {
            const updated = res?.updated ?? 0;
            this.message.add({ severity: 'success', summary: 'Done', detail: `Transferred: ${updated}` });
            this.cancelSelecting();
            this.loadMembers();
          },
          error: (err) => {
            this.message.add({ severity: 'error', summary: 'Error', detail: err?.error?.error || 'Transfer failed' });
          }
        });
      }
    });
  }

  onFamilyViewChange() {
    this.cancelSelecting();
    this.loadMembers();
  }
}
