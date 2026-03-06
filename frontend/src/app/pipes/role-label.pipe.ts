import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'roleLabel',
  standalone: true
})
export class RoleLabelPipe implements PipeTransform {
  transform(role: any): string {
    if (role === null || role === undefined) return '';
    const raw = String(role).trim();
    if (!raw) return '';

    const up = raw.toUpperCase().replace(/[-\s]+/g, '_');

    switch (up) {
      case 'MAKHDOM':
        return 'مخدوم';
      case 'KHADIM':
        return 'خادم';
      case 'AMIN_OSRA':
        return 'امين اسرة';
      case 'AMIN_KHEDMA':
        return 'امين خدمة';
      case 'DEVELOPER':
      case 'DEV':
        return 'dev';
      default:
        return raw;
    }
  }
}

