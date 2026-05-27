import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MessageService, ConfirmationService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import { DialogModule } from 'primeng/dialog';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { RouterModule } from '@angular/router';

import { DevSettingsService } from '../services/dev-settings.service';

interface RoleSettings {
  id?: number;
  name: string;
  displayNameAr: string;
  sortOrder: number;
  active: boolean;
  permissions: string;
}

@Component({
  selector: 'app-role-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    ToastModule,
    DialogModule,
    ConfirmDialogModule
  ],
  providers: [MessageService, ConfirmationService],
  templateUrl: './role-settings.html',
  styleUrls: ['./role-settings.css']
})
export class RoleSettingsComponent implements OnInit {
  private svc = inject(DevSettingsService);
  private msg = inject(MessageService);
  private confirm = inject(ConfirmationService);

  roles: RoleSettings[] = [];
  allPermissions: string[] = [];
  loading = true;

  dialogVisible = false;
  dialogMode: 'create' | 'edit' = 'create';
  editingRole: Partial<RoleSettings> = {};
  selectedPermissions: string[] = [];

  permissionLabels: Record<string, string> = {
    VIEW_ATTENDANCE: 'عرض الحضور',
    TAKE_ATTENDANCE: 'تسجيل الحضور',
    VIEW_FAMILY_INFO: 'عرض بيانات الأسر',
    MANAGE_FAMILY_INFO: 'تعديل بيانات الأسر',
    MANAGE_EVENTS: 'إدارة المناسبات',
    MANAGE_ANNOUNCEMENTS: 'إدارة الإعلانات',
    MANAGE_IFTEKAD: 'إدارة الافتقاد',
    TRANSFER_MEMBERS: 'نقل الأعضاء',
    MANAGE_ROLES: 'إدارة الصلاحيات',
    START_NEW_YEAR: 'بدء سنة جديدة',
    MANAGE_KHORS: 'إدارة الخورس',
    VIEW_GRADES: 'عرض الدرجات',
    MANAGE_REGISTRATION_FIELDS: 'إدارة حقول التسجيل',
    MANAGE_FAMILIES: 'إدارة الأسر',
    MANAGE_SECRET_CODE: 'إدارة الكود السري',
    MANAGE_RESOURCES: 'إدارة الملفات',
    VIEW_ATTENDANCE_HISTORY: 'عرض تاريخ الحضور',
    MANAGE_ATTENDANCE_ACCESS: 'إدارة صلاحيات الحضور'
  };

  ngOnInit(): void {
    this.loadRoles();
  }

  loadRoles(): void {
    this.loading = true;
    this.svc.getAllRoles().subscribe({
      next: (roles) => {
        this.roles = roles || [];
        this.loading = false;
      },
      error: () => {
        this.msg.add({ severity: 'error', summary: 'خطأ', detail: 'فشل تحميل الأدوار' });
        this.loading = false;
      }
    });
    this.svc.getAllPermissions().subscribe({
      next: (perms) => {
        this.allPermissions = perms || [];
      }
    });
  }

  openCreate(): void {
    this.dialogMode = 'create';
    this.editingRole = {
      name: '',
      displayNameAr: '',
      active: true,
      permissions: ''
    };
    this.selectedPermissions = [];
    this.dialogVisible = true;
  }

  openEdit(r: RoleSettings): void {
    this.dialogMode = 'edit';
    this.editingRole = { ...r };
    this.selectedPermissions = (r.permissions || '')
      .split(',')
      .map(p => p.trim())
      .filter(Boolean);
    this.dialogVisible = true;
  }

  saveRole(): void {
    if (!this.editingRole.name?.trim()) {
      this.msg.add({ severity: 'warn', summary: 'تنبيه', detail: 'اسم الدور مطلوب' });
      return;
    }
    if (!this.editingRole.displayNameAr?.trim()) {
      this.msg.add({ severity: 'warn', summary: 'تنبيه', detail: 'الاسم بالعربي مطلوب' });
      return;
    }

    if (this.dialogMode === 'create') {
      const nameRegex = /^[A-Z][A-Z0-9_]*$/;
      if (!nameRegex.test(this.editingRole.name.trim())) {
        this.msg.add({ severity: 'warn', summary: 'تنبيه', detail: 'اسم الدور يجب أن يكون حروف إنجليزية كبيرة وأرقام و _ فقط' });
        return;
      }

      const payload = {
        name: this.editingRole.name.trim(),
        displayNameAr: this.editingRole.displayNameAr.trim(),
        permissions: this.selectedPermissions.join(',')
      };
      this.svc.createRole(payload).subscribe({
        next: () => {
          this.msg.add({ severity: 'success', summary: 'تم', detail: 'تم إنشاء الدور بنجاح' });
          this.dialogVisible = false;
          this.loadRoles();
        },
        error: (err) => {
          const detail = err?.error?.message || 'فشل إنشاء الدور';
          this.msg.add({ severity: 'error', summary: 'خطأ', detail });
        }
      });
    } else {
      const payload = {
        displayNameAr: this.editingRole.displayNameAr?.trim(),
        active: this.editingRole.active,
        permissions: this.selectedPermissions.join(',')
      };
      this.svc.updateRole(this.editingRole.id!, payload).subscribe({
        next: () => {
          this.msg.add({ severity: 'success', summary: 'تم', detail: 'تم تعديل الدور بنجاح' });
          this.dialogVisible = false;
          this.loadRoles();
        },
        error: (err) => {
          const detail = err?.error?.message || 'فشل تعديل الدور';
          this.msg.add({ severity: 'error', summary: 'خطأ', detail });
        }
      });
    }
  }

  toggleActive(r: RoleSettings): void {
    this.svc.updateRole(r.id!, { active: !r.active, displayNameAr: r.displayNameAr, permissions: r.permissions }).subscribe({
      next: () => {
        r.active = !r.active;
        const status = r.active ? 'مفعل' : 'معطل';
        this.msg.add({ severity: 'info', summary: 'تم', detail: `الدور ${status}` });
      },
      error: () => {
        this.msg.add({ severity: 'error', summary: 'خطأ', detail: 'فشل تحديث الحالة' });
      }
    });
  }

  deleteRole(r: RoleSettings): void {
    this.confirm.confirm({
      message: `هل أنت متأكد من حذف الدور "${r.displayNameAr}"؟`,
      header: 'تأكيد الحذف',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'حذف',
      rejectLabel: 'إلغاء',
      accept: () => {
        this.svc.deleteRole(r.id!).subscribe({
          next: () => {
            this.msg.add({ severity: 'success', summary: 'تم', detail: 'تم حذف الدور' });
            this.loadRoles();
          },
          error: (err) => {
            const detail = err?.error?.message || 'فشل حذف الدور';
            this.msg.add({ severity: 'error', summary: 'خطأ', detail });
          }
        });
      }
    });
  }

  moveUp(index: number): void {
    if (index <= 0) return;
    const ids = this.roles.map(r => r.id!);
    const tmp = ids[index];
    ids[index] = ids[index - 1];
    ids[index - 1] = tmp;
    this.svc.reorderRoles(ids).subscribe({
      next: () => this.loadRoles(),
      error: () => this.msg.add({ severity: 'error', summary: 'خطأ', detail: 'فشل حفظ الترتيب' })
    });
  }

  moveDown(index: number): void {
    if (index >= this.roles.length - 1) return;
    const ids = this.roles.map(r => r.id!);
    const tmp = ids[index];
    ids[index] = ids[index + 1];
    ids[index + 1] = tmp;
    this.svc.reorderRoles(ids).subscribe({
      next: () => this.loadRoles(),
      error: () => this.msg.add({ severity: 'error', summary: 'خطأ', detail: 'فشل حفظ الترتيب' })
    });
  }

  hasPermission(perm: string): boolean {
    return this.selectedPermissions.includes(perm);
  }

  togglePermission(perm: string, checked: boolean): void {
    if (checked) {
      if (!this.selectedPermissions.includes(perm)) {
        this.selectedPermissions = [...this.selectedPermissions, perm];
      }
    } else {
      this.selectedPermissions = this.selectedPermissions.filter(p => p !== perm);
    }
  }

  permissionLabel(perm: string): string {
    return this.permissionLabels[perm] || perm;
  }
}
