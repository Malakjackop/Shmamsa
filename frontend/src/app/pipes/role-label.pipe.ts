import { Pipe, PipeTransform } from '@angular/core';
import { roleLabel } from '../shared/role-utils';

@Pipe({
  name: 'roleLabel',
  standalone: true
})
export class RoleLabelPipe implements PipeTransform {
  transform(role: any): string {
    return roleLabel(role);
  }
}

