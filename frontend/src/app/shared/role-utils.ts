export type NormalizedRole =
  | 'MAKHDOM'
  | 'KHADIM'
  | 'AMIN_OSRA'
  | 'AMIN_KHEDMA'
  | 'DEVELOPER'
  | '';

const ROLE_CODE_MAP: Record<number, Exclude<NormalizedRole, '' | 'DEVELOPER'>> = {
  1: 'AMIN_KHEDMA',
  2: 'AMIN_OSRA',
  3: 'KHADIM',
  4: 'MAKHDOM'
};

const AMIN_OSRA_AR = new Set([
  'امين اسرة',
  'امين الاسرة',
  'أمين أسرة',
  'أمين الاسرة',
  'امين الأسرة',
  'أمين الأسرة'
]);

const AMIN_KHEDMA_AR = new Set([
  'امين خدمة',
  'امين الخدمه',
  'أمين خدمة',
  'أمين الخدمه',
  'امين الخدمة',
  'أمين الخدمة',
  'امين خدمه',
  'أمين خدمه'
]);

function normalizeRoleToken(raw: string): NormalizedRole {
  const upper = raw.toUpperCase().replace(/^ROLE_/, '').replace(/[-\s]+/g, '_');
  if (!upper) return '';
  if (upper === 'DEV') return 'DEVELOPER';
  if (upper.includes('DEVELOPER')) return 'DEVELOPER';
  if (upper.includes('AMIN_KHEDMA')) return 'AMIN_KHEDMA';
  if (upper.includes('AMIN_OSRA')) return 'AMIN_OSRA';
  if (upper.includes('KHADIM')) return 'KHADIM';
  if (upper.includes('MAKHDOM') || upper.includes('MEMBER')) return 'MAKHDOM';
  return upper as NormalizedRole;
}

export function normalizeRole(value: any, roleCode?: any): NormalizedRole {
  const numericCode = Number(roleCode ?? value);
  if (Number.isFinite(numericCode) && ROLE_CODE_MAP[numericCode]) {
    return ROLE_CODE_MAP[numericCode];
  }

  const raw = String(value ?? '').trim();
  if (!raw) return '';

  if (AMIN_OSRA_AR.has(raw)) return 'AMIN_OSRA';
  if (AMIN_KHEDMA_AR.has(raw)) return 'AMIN_KHEDMA';
  return normalizeRoleToken(raw);
}

export function normalizeAssignmentRole(assignment: any, fallbackRole?: any): NormalizedRole {
  return normalizeRole(assignment?.role, assignment?.roleCode) || normalizeRole(fallbackRole);
}

export function assignmentRolesOf(entity: any): NormalizedRole[] {
  const assignments = Array.isArray(entity?.familyAssignments) ? entity.familyAssignments : [];
  return assignments
    .map((assignment: any) => normalizeAssignmentRole(assignment, entity?.role))
    .filter((role: NormalizedRole): role is Exclude<NormalizedRole, ''> => !!role);
}

export function hasRole(value: any, allowed: string[], roleCode?: any): boolean {
  const role = normalizeRole(value, roleCode);
  return allowed.map((item) => normalizeRole(item)).includes(role);
}

export function roleLabel(role: any, roleCode?: any): string {
  switch (normalizeRole(role, roleCode)) {
    case 'MAKHDOM':
      return 'مخدوم';
    case 'KHADIM':
      return 'خادم';
    case 'AMIN_OSRA':
      return 'امين اسرة';
    case 'AMIN_KHEDMA':
      return 'امين خدمة';
    case 'DEVELOPER':
      return 'dev';
    default:
      return String(role ?? '').trim();
  }
}
