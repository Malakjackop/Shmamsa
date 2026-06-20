import { Component, OnInit, inject } from '@angular/core';
import { MessageService } from 'primeng/api';
import { AuthService, AuthUser } from '../services/auth.service';
import { FamilyMemberDetails, FamilyMemberSummary, FamilyService } from '../services/family.service';
import { CustomField, DevSettingsService } from '../services/dev-settings.service';
import {
  DEFAULT_IFTEKAD_SETTINGS,
  IftekadService,
  IftekadSettings,
  IftekadVisitRecord
} from '../services/iftekad.service';
import { customFieldHasTarget } from '../shared/custom-field-display';
import { assignmentRolesOf, normalizeRole } from '../shared/role-utils';

type IftekadColor = 'green' | 'yellow' | 'red';

type IftekadMember = FamilyMemberSummary & {
  id: number;
  fullName: string;
  selected?: boolean;
  lastIftekadDate?: string | null;
  iftekadColor?: IftekadColor;
  iftekadStatusText?: string;
  isBirthdayToday?: boolean;
};

type WhatsAppPreview = {
  member: IftekadMember;
  phone: string;
  message: string;
  url: string;
};

type VisitCompanionOption = {
  label: string;
  value: number;
};

@Component({
  selector: 'app-iftekad',
  standalone: false,
  templateUrl: './iftekad.html',
  styleUrls: ['./iftekad.css'],
  providers: [MessageService]
})
export class IftekadComponent implements OnInit {
  private auth = inject(AuthService);
  private familySvc = inject(FamilyService);
  private iftekadSvc = inject(IftekadService);
  private devSettingsSvc = inject(DevSettingsService);
  private message = inject(MessageService);

  me: AuthUser | null = null;
  families: string[] = [];
  selectedFamily = '';

  members: IftekadMember[] = [];
  filteredMembers: IftekadMember[] = [];
  gradeOptions: string[] = [];
  selectedSchoolGrade = '';
  selectedRoleFilter: '' | 'SERVANTS' | 'MEMBERS' = '';
  searchText = '';
  selectAll = false;
  selectionMode = false;
  loading = false;

  settings: IftekadSettings = { ...DEFAULT_IFTEKAD_SETTINGS };
  settingsOpen = false;
  savingSettings = false;
  settingsDraft: IftekadSettings = { ...DEFAULT_IFTEKAD_SETTINGS };
  iftekadCardFields: CustomField[] = [];

  profileFor: IftekadMember | null = null;
  profile: FamilyMemberDetails = null;
  profileLoading = false;
  visits: IftekadVisitRecord[] = [];
  visitsLoading = false;

  todayMaxDate = this.endOfToday();
  visitDate: Date | null = this.todayDate();
  selectedVisitCompanionIds: number[] = [];
  visitCompanionOptions: VisitCompanionOption[] = [];
  visitCompanionsLoading = false;
  visitDescription = '';
  visitSaving = false;

  whatsappOpen = false;
  whatsappTemplate = 'ازيك يا {name}، مستنيينك تيجي النهارده ❤️';
  whatsappPreviews: WhatsAppPreview[] = [];
  whatsappSendIndex: number | null = null;

  ngOnInit(): void {
    this.auth.getUserData(true).subscribe({
      next: (u) => {
        this.me = u;
        this.loadSettings();
        this.loadIftekadCardFields();
        this.initFamiliesAndMembers();
      },
      error: () => {
        this.me = null;
        this.loadSettings();
        this.loadIftekadCardFields();
        this.loadMembers();
      }
    });
  }

  trackByMember = (_: number, member: IftekadMember) => member.id;
  trackByVisit = (_: number, visit: IftekadVisitRecord) => visit.id;

  private normalizedRoles(): string[] {
    const roles = new Set<string>();
    const primary = normalizeRole(this.me?.role, this.me?.roleCode);
    if (primary) roles.add(primary);
    for (const role of assignmentRolesOf(this.me)) roles.add(role);
    return Array.from(roles);
  }

  private hasAnyRole(...wanted: string[]): boolean {
    const roles = this.normalizedRoles();
    return wanted.map((x) => normalizeRole(x)).some((role) => roles.includes(role));
  }

  isAminKhedmaOrDev(): boolean {
    return this.hasAnyRole('AMIN_KHEDMA', 'DEVELOPER', 'DEV');
  }

  isKhadim(): boolean {
    return this.hasAnyRole('KHADIM');
  }

  canSelectFamily(): boolean {
    return this.isAminKhedmaOrDev() || this.isKhadim();
  }

  canEditSettings(): boolean {
    return this.isAminKhedmaOrDev();
  }

  selectedMembersCount(): number {
    return this.selectedMembers().length;
  }

  handleWhatsAppButton(): void {
    if (!this.selectionMode && this.selectedMembersCount() === 0) {
      this.selectionMode = true;
      return;
    }

    if (this.selectedMembersCount() === 0) {
      this.message.add({ severity: 'warn', summary: 'تنبيه', detail: 'اختار شخص واحد على الأقل الأول' });
      return;
    }

    this.openWhatsAppPanel();
  }

  cancelSelectionMode(): void {
    this.selectionMode = false;
    this.clearSelection();
  }

  minYellowMonths(): number {
    return Math.max(1, Number(this.settingsDraft.greenMaxMonths || 0) + 1);
  }

  private initFamiliesAndMembers(): void {
    if (!this.canSelectFamily()) {
      this.loadMembers();
      return;
    }

    this.familySvc.families().subscribe({
      next: (families) => {
        this.families = (families || []).filter(Boolean);
        if (!this.selectedFamily && this.families.length) this.selectedFamily = this.families[0];
        this.loadMembers();
      },
      error: () => {
        this.families = [];
        this.loadMembers();
      }
    });
  }

  private loadSettings(): void {
    this.iftekadSvc.getSettings().subscribe({
      next: (settings) => {
        this.settings = this.normalizeSettings(settings);
        if (this.settingsOpen) this.resetSettingsDraft();
        this.applyMemberDecorations();
      },
      error: () => {
        this.settings = { ...DEFAULT_IFTEKAD_SETTINGS };
        this.applyMemberDecorations();
      }
    });
  }

  private normalizeSettings(settings: Partial<IftekadSettings> | null | undefined): IftekadSettings {
    const green = Math.max(0, Number(settings?.greenMaxMonths ?? DEFAULT_IFTEKAD_SETTINGS.greenMaxMonths));
    const yellowRaw = Math.max(0, Number(settings?.yellowMaxMonths ?? DEFAULT_IFTEKAD_SETTINGS.yellowMaxMonths));
    const yellow = Math.max(green, yellowRaw);

    return {
      greenMaxMonths: green,
      yellowMaxMonths: yellow,
      cardFields: Array.isArray(settings?.cardFields) ? settings!.cardFields : [...DEFAULT_IFTEKAD_SETTINGS.cardFields]
    };
  }

  private loadIftekadCardFields(): void {
    this.devSettingsSvc.getEnabledFields().subscribe({
      next: (fields) => {
        this.iftekadCardFields = (fields || []).filter((field) => customFieldHasTarget(field, 'IFTEKAD'));
      },
      error: () => {
        this.iftekadCardFields = [];
      }
    });
  }

  onFamilyChange(): void {
    this.closeProfile();
    this.whatsappPreviews = [];
    this.clearSelection();
    this.loadMembers();
  }

  loadMembers(): void {
    this.loading = true;
    this.members = [];
    this.filteredMembers = [];
    const family = this.canSelectFamily() ? this.selectedFamily : undefined;

    this.familySvc.members(family, false).subscribe({
      next: (rows) => {
        this.members = (rows || [])
          .filter((row) => row?.id)
          .map((row) => this.toIftekadMember(row));
        this.rebuildGradeOptions();
        this.applyMemberDecorations();
        this.applyFilters();
        this.loadLastVisitDates();
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.message.add({ severity: 'error', summary: 'خطأ', detail: err?.error?.error || 'فشل تحميل البيانات' });
      }
    });
  }

  private toIftekadMember(row: FamilyMemberSummary): IftekadMember {
    return {
      ...row,
      id: Number(row.id),
      fullName: String(row.fullName || '').trim() || 'بدون اسم',
      selected: false,
      lastIftekadDate: null,
      iftekadColor: 'red',
      iftekadStatusText: 'لم يتم الافتقاد بعد',
      isBirthdayToday: this.isBirthdayToday(row.dateOfBirth)
    };
  }

  private loadLastVisitDates(): void {
    const ids = this.members.map((member) => member.id).filter(Boolean);
    if (!ids.length) return;

    this.iftekadSvc.lastVisitDates(ids).subscribe({
      next: (map) => {
        this.members = this.members.map((member) => ({
          ...member,
          lastIftekadDate: map?.[String(member.id)] || null
        }));
        this.applyMemberDecorations();
        this.applyFilters();
      },
      error: () => {}
    });
  }

  private applyMemberDecorations(): void {
    this.members = this.members.map((member) => {
      const color = this.colorForLastVisit(member.lastIftekadDate || null);
      return {
        ...member,
        iftekadColor: color,
        iftekadStatusText: this.statusTextForLastVisit(member.lastIftekadDate || null),
        isBirthdayToday: this.isBirthdayToday(member.dateOfBirth)
      };
    });
  }

  private rebuildGradeOptions(): void {
    this.gradeOptions = Array.from(
      new Set(
        this.members
          .map((member) => String(member.schoolGrade || '').trim())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b, 'ar'));

    if (this.selectedSchoolGrade && !this.gradeOptions.includes(this.selectedSchoolGrade)) {
      this.selectedSchoolGrade = '';
    }
  }

  applyFilters(): void {
    const grade = String(this.selectedSchoolGrade || '').trim();
    const roleFilter = this.selectedRoleFilter;
    const query = String(this.searchText || '').trim().toLowerCase();

    this.filteredMembers = this.members.filter((member) => {
      if (
        this.canSelectFamily() &&
        this.selectedFamily &&
        this.selectedRoleFilter !== 'MEMBERS' &&
        !this.memberMatchesSelectedFamily(member)
      ) return false;
      if (grade && String(member.schoolGrade || '').trim() !== grade) return false;
      if (roleFilter && !this.memberMatchesRoleFilter(member, roleFilter)) return false;
      if (query) {
        const haystack = [member.fullName, member.phoneNumber, member.guardiansPhone, member.deaconFamily, member.familyName]
          .map((x) => String(x || '').toLowerCase())
          .join(' ');
        if (!haystack.includes(query)) return false;
      }
      return true;
    });

    this.selectAll = !!this.filteredMembers.length && this.filteredMembers.every((member) => !!member.selected);
  }

  private memberMatchesSelectedFamily(member: IftekadMember): boolean {
    const selectedKey = this.familyCompareKey(this.selectedFamily);
    if (!selectedKey) return true;

    return this.memberFamilyNames(member).some((family) => {
      const key = this.familyCompareKey(family);
      return key === selectedKey || key.includes(selectedKey) || selectedKey.includes(key);
    });
  }

  private memberFamilyNames(member: IftekadMember): string[] {
    const names = [
      member.familyName,
      member.deaconFamily,
      member['deaconFamily2'],
      member['deaconFamily3'],
      member['deaconFamily4']
    ];

    const assignments = Array.isArray(member.familyAssignments) ? member.familyAssignments : [];
    for (const assignment of assignments) {
      names.push(
        assignment['familyName'] as string,
        assignment['family'] as string,
        assignment['nameAr'] as string,
        assignment['baseName'] as string
      );
    }

    return names.map((name) => String(name || '').trim()).filter(Boolean);
  }

  private familyCompareKey(value: unknown): string {
    return String(value || '')
      .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
      .replace(/[!؟?،,.;:()[\]{}'"`~_\-–—]/g, ' ')
      .replace(/[إأآ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/(^|\s)اسره(?=\s|$)/g, ' ')
      .replace(/(^|\s)القديس(?=\s|$)/g, ' ')
      .replace(/(^|\s)الانبا(?=\s|$)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  clearFilters(): void {
    this.searchText = '';
    this.selectedSchoolGrade = '';
    this.selectedRoleFilter = '';
    this.applyFilters();
  }

  toggleSelectAll(): void {
    const ids = new Set(this.filteredMembers.map((member) => member.id));
    this.members = this.members.map((member) => (ids.has(member.id) ? { ...member, selected: this.selectAll } : member));
    this.applyFilters();
  }

  onMemberSelectionChange(): void {
    this.selectAll = !!this.filteredMembers.length && this.filteredMembers.every((member) => !!member.selected);
  }

  onCardClick(member: IftekadMember): void {
    if (!this.selectionMode) {
      this.openProfile(member);
      return;
    }

    this.members = this.members.map((item) =>
      item.id === member.id ? { ...item, selected: !item.selected } : item
    );
    this.applyFilters();
  }

  private clearSelection(): void {
    this.selectAll = false;
    this.members = this.members.map((member) => ({ ...member, selected: false }));
    this.applyFilters();
    this.whatsappPreviews = [];
  }

  selectedMembers(): IftekadMember[] {
    return this.members.filter((member) => !!member.selected);
  }

  private memberMatchesRoleFilter(member: IftekadMember, filter: 'SERVANTS' | 'MEMBERS'): boolean {
    const primaryRole = this.normalizedIftekadRole(member.role);
    const fallbackRoles = assignmentRolesOf(member);
    const roles = new Set(primaryRole ? [primaryRole] : fallbackRoles);
    const isServant = ['KHADIM', 'AMIN_OSRA', 'AMIN_KHEDMA', 'DEVELOPER'].some((role) => roles.has(role as any));
    const isMember = primaryRole === 'MAKHDOM' || (!isServant && roles.has('MAKHDOM' as any));

    if (filter === 'MEMBERS') return isMember;
    return filter === 'SERVANTS' ? isServant : !isServant;
  }

  private normalizedIftekadRole(value: unknown): string {
    const raw = String(value || '').trim();
    const ar = raw
      .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (ar === 'مخدوم') return 'MAKHDOM';
    if (ar === 'خادم') return 'KHADIM';
    return normalizeRole(value);
  }

  openProfile(member: IftekadMember): void {
    this.profileFor = member;
    this.profile = null;
    this.visits = [];
    this.visitDate = this.todayDate();
    this.selectedVisitCompanionIds = [];
    this.visitDescription = '';
    this.profileLoading = true;
    this.visitsLoading = true;
    this.loadVisitCompanionOptions(member);

    this.familySvc.memberDetails(member.id, this.canSelectFamily() ? this.selectedFamily : undefined).subscribe({
      next: (details) => {
        if (this.profileFor?.id !== member.id) return;
        this.profile = details;
        this.profileLoading = false;
      },
      error: () => {
        if (this.profileFor?.id !== member.id) return;
        this.profile = null;
        this.profileLoading = false;
      }
    });

    this.loadVisitHistory(member.id);
  }

  closeProfile(): void {
    this.profileFor = null;
    this.profile = null;
    this.profileLoading = false;
    this.visits = [];
    this.visitsLoading = false;
    this.visitSaving = false;
    this.selectedVisitCompanionIds = [];
    this.visitCompanionOptions = [];
    this.visitCompanionsLoading = false;
  }

  private loadVisitHistory(memberId: number): void {
    this.visitsLoading = true;
    this.iftekadSvc.getVisits(memberId).subscribe({
      next: (visits) => {
        if (this.profileFor?.id !== memberId) return;
        this.visits = visits || [];
        this.visitsLoading = false;
        this.updateMemberLastVisitFromHistory(memberId);
      },
      error: () => {
        if (this.profileFor?.id !== memberId) return;
        this.visits = [];
        this.visitsLoading = false;
      }
    });
  }

  saveVisit(): void {
    if (!this.profileFor || this.visitSaving) return;
    if (!this.visitDate) {
      this.message.add({ severity: 'warn', summary: 'تنبيه', detail: 'اختار تاريخ الافتقاد' });
      return;
    }

    if (this.visitDate > this.todayMaxDate) {
      this.message.add({ severity: 'warn', summary: 'تنبيه', detail: 'لا يمكن اختيار تاريخ بعد النهارده' });
      return;
    }

    this.visitSaving = true;
    this.iftekadSvc
      .createVisit({
        memberId: this.profileFor.id,
        date: this.dateToIso(this.visitDate),
        companions: this.selectedVisitCompanionNames() || undefined,
        description: this.visitDescription || undefined
      })
      .subscribe({
        next: (created) => {
          this.visitSaving = false;
          this.message.add({ severity: 'success', summary: 'تم', detail: 'تم تسجيل الافتقاد' });
          this.visitDescription = '';
          this.selectedVisitCompanionIds = [];
          this.visits = created ? [created, ...this.visits].sort((a, b) => String(b.visitDate || '').localeCompare(String(a.visitDate || ''))) : this.visits;
          this.updateMemberLastVisitFromHistory(this.profileFor!.id);
        },
        error: (err) => {
          this.visitSaving = false;
          this.message.add({ severity: 'error', summary: 'خطأ', detail: err?.error?.error || 'فشل حفظ الافتقاد' });
        }
      });
  }

  private updateMemberLastVisitFromHistory(memberId: number): void {
    const last = (this.visits || [])
      .map((visit) => String(visit.visitDate || '').trim())
      .filter(Boolean)
      .sort((a, b) => b.localeCompare(a))[0] || null;
    this.members = this.members.map((member) =>
      member.id === memberId ? { ...member, lastIftekadDate: last } : member
    );
    if (this.profileFor?.id === memberId) {
      this.profileFor = { ...this.profileFor, lastIftekadDate: last };
    }
    this.applyMemberDecorations();
    this.applyFilters();
  }

  openSettings(): void {
    if (!this.canEditSettings()) return;
    this.resetSettingsDraft();
    this.settingsOpen = true;
  }

  closeSettings(): void {
    this.settingsOpen = false;
    this.savingSettings = false;
  }

  private resetSettingsDraft(): void {
    this.settingsDraft = {
      greenMaxMonths: this.settings.greenMaxMonths,
      yellowMaxMonths: this.settings.yellowMaxMonths,
      cardFields: [...this.settings.cardFields]
    };
  }

  private loadVisitCompanionOptions(member: IftekadMember): void {
    const family = this.canSelectFamily()
      ? this.selectedFamily
      : this.familyLabel(member);

    this.visitCompanionsLoading = true;
    this.familySvc.members(family || undefined, true, 'attendance').subscribe({
      next: (rows) => {
        if (this.profileFor?.id !== member.id) return;
        const byId = new Map<number, VisitCompanionOption>();
        for (const row of rows || []) {
          const role = normalizeRole(row.role as string | number | null | undefined);
          if (!['KHADIM', 'AMIN_OSRA', 'AMIN_KHEDMA', 'DEVELOPER'].includes(role)) continue;
          const id = Number(row.id);
          if (!id) continue;
          const name = String(row.fullName || '').trim();
          if (!name) continue;
          byId.set(id, { value: id, label: name });
        }

        const myId = Number(this.me?.['id'] || 0);
        const myName = String(this.me?.['fullName'] || this.me?.['username'] || '').trim();
        if (myId && myName && !byId.has(myId)) {
          byId.set(myId, { value: myId, label: myName });
        }

        this.visitCompanionOptions = Array.from(byId.values()).sort((a, b) => a.label.localeCompare(b.label, 'ar'));
        this.visitCompanionsLoading = false;
      },
      error: () => {
        this.visitCompanionOptions = [];
        this.visitCompanionsLoading = false;
      }
    });
  }

  private selectedVisitCompanionNames(): string {
    const selected = new Set(this.selectedVisitCompanionIds || []);
    return this.visitCompanionOptions
      .filter((option) => selected.has(option.value))
      .map((option) => option.label)
      .join('، ');
  }

  clearVisitCompanions(): void {
    this.selectedVisitCompanionIds = [];
  }

  saveSettings(): void {
    if (!this.canEditSettings() || this.savingSettings) return;

    const green = Math.max(0, Number(this.settingsDraft.greenMaxMonths || 0));
    const yellow = Math.max(0, Number(this.settingsDraft.yellowMaxMonths || 0));
    if (yellow <= green) {
      this.message.add({
        severity: 'warn',
        summary: 'تنبيه',
        detail: 'الأصفر لازم يكون أكبر من الأخضر بشهر واحد على الأقل'
      });
      return;
    }

    this.savingSettings = true;
    this.iftekadSvc
      .updateSettings({
        greenMaxMonths: green,
        yellowMaxMonths: yellow,
        cardFields: this.settings.cardFields || []
      })
      .subscribe({
        next: (settings) => {
          this.savingSettings = false;
          this.settings = this.normalizeSettings(settings);
          this.applyMemberDecorations();
          this.applyFilters();
          this.closeSettings();
          this.message.add({ severity: 'success', summary: 'تم', detail: 'تم حفظ إعدادات الافتقاد' });
        },
        error: (err) => {
          this.savingSettings = false;
          this.message.add({ severity: 'error', summary: 'خطأ', detail: err?.error?.error || 'فشل حفظ الإعدادات' });
        }
      });
  }

  openWhatsAppPanel(): void {
    this.whatsappOpen = true;
    this.buildWhatsAppPreviews();
  }

  closeWhatsAppPanel(): void {
    this.whatsappOpen = false;
    this.whatsappPreviews = [];
    this.whatsappSendIndex = null;
  }

  private buildWaUrl(phone: string, message: string): string {
    // whatsapp:// deep link — opens the desktop app directly (not the browser)
    // and pre-fills the message in the chat input
    const encoded = encodeURIComponent(message);
    return `whatsapp://send?phone=${phone}&text=${encoded}`;
  }

  buildWhatsAppPreviews(): void {
    const selected = this.selectedMembers();
    if (!selected.length) {
      this.whatsappPreviews = [];
      this.whatsappSendIndex = null;
      return;
    }

    const template = String(this.whatsappTemplate || '').trim();
    this.whatsappPreviews = selected
      .map((member) => {
        const phone = this.normalizeWhatsappPhone(this.primaryPhone(member));
        const message = this.fillTemplate(template, member);
        return {
          member,
          phone,
          message,
          url: phone ? this.buildWaUrl(phone, message) : ''
        };
      })
      .filter((item) => !!item.message);

    this.whatsappSendIndex = null;
  }

  startSequentialSend(): void {
    const valid = this.whatsappPreviews.filter((p) => !!p.url);
    if (!valid.length) {
      this.message.add({ severity: 'warn', summary: 'تنبيه', detail: 'لا يوجد أرقام صالحة للإرسال' });
      return;
    }
    this.whatsappSendIndex = 0;
    this.openCurrentInApp();
  }

  private openCurrentInApp(): void {
    const preview = this.currentSendPreview;
    if (!preview) return;
    // whatsapp:// opens the desktop app directly with the chat + pre-filled message
    window.location.href = preview.url;
  }

  get currentSendPreview(): WhatsAppPreview | null {
    const valid = this.whatsappPreviews.filter((p) => !!p.url);
    if (this.whatsappSendIndex === null || this.whatsappSendIndex >= valid.length) return null;
    return valid[this.whatsappSendIndex];
  }

  get sendProgress(): { current: number; total: number } {
    const total = this.whatsappPreviews.filter((p) => !!p.url).length;
    return { current: (this.whatsappSendIndex ?? 0) + 1, total };
  }

  goToNext(): void {
    const valid = this.whatsappPreviews.filter((p) => !!p.url);
    const next = (this.whatsappSendIndex ?? 0) + 1;
    if (next >= valid.length) {
      this.whatsappSendIndex = null;
      this.message.add({ severity: 'success', summary: 'تم ✅', detail: 'تم فتح كل الشاتات' });
    } else {
      this.whatsappSendIndex = next;
      this.openCurrentInApp();
    }
  }

  skipCurrent(): void {
    const valid = this.whatsappPreviews.filter((p) => !!p.url);
    const next = (this.whatsappSendIndex ?? 0) + 1;
    if (next >= valid.length) {
      this.whatsappSendIndex = null;
    } else {
      this.whatsappSendIndex = next;
      this.openCurrentInApp();
    }
  }

  cancelSequentialSend(): void {
    this.whatsappSendIndex = null;
  }

  // legacy — kept to avoid unused binding errors
  sendCurrentAndNext(): void { this.goToNext(); }
  skipCurrentAndNext(): void { this.skipCurrent(); }

  shownCardRows(member: IftekadMember): Array<{ label: string; value: string; isPhone?: boolean }> {
    return [
      { label: 'رقم التليفون', value: this.primaryPhone(member) || 'غير مسجل', isPhone: !!this.primaryPhone(member) },
      { label: 'آخر افتقاد', value: this.lastVisitLabel(member.lastIftekadDate || null) }
    ]
      .filter((row) => String(row.value || '').trim())
      .map(({ label, value, isPhone }) => ({ label, value, isPhone }));
  }

  private fieldDisplayValue(source: Record<string, unknown>, field: CustomField): string {
    const key = String(field.fieldKey || '').trim();
    const customFields = source['customFields'] as Record<string, unknown> | null | undefined;
    const raw = customFields?.[key] ?? source[key];

    if (key === 'dateOfBirth') return this.formatDate(raw);
    if (key === 'khors' || key === 'attendKhors') return this.khorsLabel({ ...source, khors: String(raw || '') });
    if (key === 'deaconFamily') return this.familyLabel({ ...source, deaconFamily: String(raw || source['deaconFamily'] || '') });
    if (key === 'isWorking') return this.booleanLabel(raw);
    return String(raw ?? '').trim();
  }

  detailsRows(): Array<{ label: string; value: string; isPhone?: boolean }> {
    const p = (this.profile || {}) as Record<string, unknown>;
    const member = this.profileFor || ({} as IftekadMember);
    const customFields = {
      ...((member['customFields'] as Record<string, unknown> | null | undefined) || {}),
      ...((p['customFields'] as Record<string, unknown> | null | undefined) || {})
    };
    const source = { ...member, ...p, customFields };

    return this.iftekadCardFields
      .map((field) => ({
        label: field.labelAr,
        value: this.fieldDisplayValue(source, field),
        isPhone: ['phoneNumber', 'guardiansPhone'].includes(String(field.fieldKey || '').trim())
      }))
      .map((row) => ({ ...row, value: String(row.value || '').trim() }))
      .filter((row) => !!row.value);
  }

  async copyText(value: string): Promise<void> {
    const text = String(value || '').trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      this.message.add({ severity: 'success', summary: 'تم', detail: 'تم النسخ' });
    } catch {
      this.message.add({ severity: 'error', summary: 'خطأ', detail: 'فشل النسخ' });
    }
  }

  cardClass(member: IftekadMember): string {
    return `iftekadCard--${member.iftekadColor || 'red'}`;
  }

  fieldEnabled(key: string): boolean {
    return this.iftekadCardFields.some((field) => field.fieldKey === key);
  }

  private colorForLastVisit(lastDate: string | null): IftekadColor {
    if (!lastDate) return 'red';
    const months = this.monthsSince(lastDate);
    if (months <= this.settings.greenMaxMonths) return 'green';
    if (months <= this.settings.yellowMaxMonths) return 'yellow';
    return 'red';
  }

  private statusTextForLastVisit(lastDate: string | null): string {
    if (!lastDate) return 'لم يتم الافتقاد بعد';
    const months = this.monthsSince(lastDate);
    if (months <= this.settings.greenMaxMonths) return `آخر افتقاد من ${months} شهر أو أقل`;
    if (months <= this.settings.yellowMaxMonths) return `محتاج متابعة - آخر افتقاد من ${months} شهر`;
    return `متأخر - آخر افتقاد من ${months} شهر`;
  }

  private monthsSince(dateValue: string): number {
    const d = new Date(`${dateValue}T00:00:00`);
    if (Number.isNaN(d.getTime())) return 999;
    const now = new Date();
    let months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
    if (now.getDate() < d.getDate()) months -= 1;
    return Math.max(0, months);
  }

  lastVisitLabel(lastDate: string | null): string {
    return lastDate ? this.formatDate(lastDate) : 'لا يوجد افتقاد بعد';
  }

  private primaryPhone(member: Partial<IftekadMember>): string {
    return String(member.phoneNumber || member.guardiansPhone || '').trim();
  }

  private normalizeWhatsappPhone(value: string): string {
    let digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (digits.startsWith('0') && digits.length === 11) digits = `20${digits.slice(1)}`;
    if (!digits.startsWith('20') && digits.length === 10) digits = `20${digits}`;
    return digits;
  }

  private fillTemplate(template: string, member: IftekadMember): string {
    const name = member.fullName || '';
    return String(template || '')
      .replace(/\{\{\s*name\s*\}\}/gi, name)
      .replace(/\{\s*name\s*\}/gi, name)
      .replace(/\{\s*الاسم\s*\}/gi, name)
      .trim();
  }

  familyLabel(member: Partial<IftekadMember>): string {
    return String(member.familyName || member.deaconFamily || '').trim() || 'غير محددة';
  }

  khorsLabel(member: Partial<IftekadMember>): string {
    const code = String(member.khors || '').trim().toUpperCase();
    const year = member.khorsYear ? ` - سنة ${member.khorsYear}` : '';
    if (code === 'MARMARKOS') return `خورس مارمرقس${year}`;
    if (code === 'ATHANASIUS') return `خورس البابا اثناسيوس${year}`;
    if (code === 'BOTH') return `الخورسين${year}`;
    return String(member.khors || '').trim();
  }

  formatDate(value: unknown): string {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const d = new Date(`${raw.slice(0, 10)}T00:00:00`);
    if (Number.isNaN(d.getTime())) return raw;
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${d.getFullYear()}`;
  }

  ageLabel(value: unknown): string {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const d = new Date(`${raw.slice(0, 10)}T00:00:00`);
    if (Number.isNaN(d.getTime())) return '';
    const now = new Date();
    let age = now.getFullYear() - d.getFullYear();
    const beforeBirthday = now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate());
    if (beforeBirthday) age -= 1;
    return age >= 0 ? `${age} سنة` : '';
  }

  private isBirthdayToday(value: unknown): boolean {
    const raw = String(value || '').trim();
    if (!raw) return false;
    const d = new Date(`${raw.slice(0, 10)}T00:00:00`);
    if (Number.isNaN(d.getTime())) return false;
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  }

  private todayDate(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private endOfToday(): Date {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d;
  }

  private dateToIso(value: Date): string {
    const d = new Date(value);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  }

  guardianRelationAr(value: unknown): string {
    const raw = String(value || '').trim();
    const up = raw.toUpperCase();
    if (up === 'FATHER') return 'الأب';
    if (up === 'MOTHER') return 'الأم';
    return raw;
  }

  private booleanLabel(value: unknown): string {
    const raw = String(value ?? '').trim().toLowerCase();
    if (!raw) return '';
    if (['true', '1', 'yes'].includes(raw)) return 'نعم';
    if (['false', '0', 'no'].includes(raw)) return 'لا';
    return String(value ?? '').trim();
  }
}
