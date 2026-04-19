import { CustomField } from '../services/dev-settings.service';

export type CustomFieldEntry = {
  label: string;
  value: string;
};

const SYSTEM_FIELD_DEFAULT_SHOW_IN: Record<string, string[]> = {
  fullName: ['PROFILE', 'FAMILY_INFO'],
  username: ['FAMILY_INFO'],
  email: ['PROFILE', 'FAMILY_INFO'],
  phoneNumber: ['PROFILE', 'FAMILY_INFO'],
  address: ['PROFILE', 'FAMILY_INFO'],
  nationalId: ['FAMILY_INFO'],
  dateOfBirth: ['FAMILY_INFO'],
  gender: ['FAMILY_INFO'],
  deaconDegree: ['PROFILE', 'FAMILY_INFO'],
  deaconFamily: ['FAMILY_INFO'],
  khors: ['FAMILY_INFO'],
  status: ['PROFILE', 'FAMILY_INFO'],
  studyType: ['PROFILE', 'FAMILY_INFO'],
  schoolName: ['PROFILE', 'FAMILY_INFO'],
  schoolGrade: ['PROFILE', 'FAMILY_INFO'],
  universityName: ['PROFILE', 'FAMILY_INFO'],
  faculty: ['PROFILE', 'FAMILY_INFO'],
  universityGrade: ['PROFILE', 'FAMILY_INFO'],
  graduatedFrom: ['PROFILE', 'FAMILY_INFO'],
  graduateJob: ['PROFILE', 'FAMILY_INFO'],
  isWorking: ['FAMILY_INFO'],
  workDetails: ['PROFILE', 'FAMILY_INFO'],
  guardiansPhone: ['PROFILE', 'FAMILY_INFO'],
  guardianRelation: ['PROFILE', 'FAMILY_INFO']
};

export function parseShowInTargets(showIn?: string | null): string[] {
  return Array.from(new Set(
    String(showIn || '')
      .split(',')
      .map(target => target.trim().toUpperCase())
      .filter(target => !!target && target !== 'NONE')
  ));
}

export function getSystemFieldDefaultShowIn(fieldKey?: string | null): string[] {
  return [...(SYSTEM_FIELD_DEFAULT_SHOW_IN[String(fieldKey || '').trim()] || [])];
}

export function effectiveShowInTargets(
  fieldOrShowIn: Pick<CustomField, 'fieldKey' | 'isSystem' | 'showIn' | 'showInConfigured'> | string | null | undefined
): string[] {
  if (typeof fieldOrShowIn === 'string' || fieldOrShowIn == null) {
    return parseShowInTargets(fieldOrShowIn);
  }

  const configuredTargets = parseShowInTargets(fieldOrShowIn.showIn);
  if (configuredTargets.length) {
    return configuredTargets;
  }

  if (fieldOrShowIn.isSystem && !fieldOrShowIn.showInConfigured) {
    return getSystemFieldDefaultShowIn(fieldOrShowIn.fieldKey);
  }

  return [];
}

export function customFieldHasTarget(
  fieldOrShowIn: Pick<CustomField, 'fieldKey' | 'isSystem' | 'showIn' | 'showInConfigured'> | string | null | undefined,
  target: string
): boolean {
  return effectiveShowInTargets(fieldOrShowIn).includes(String(target || '').trim().toUpperCase());
}

export function buildVisibleCustomFieldEntries(
  fields: CustomField[],
  values: Record<string, unknown> | null | undefined,
  target: string
): CustomFieldEntry[] {
  const safeValues = values || {};

  return (fields || [])
    .filter(field => !!field?.fieldKey && !!field?.labelAr)
    .filter(field => customFieldHasTarget(field, target))
    .map(field => ({
      label: field.labelAr,
      value: String(safeValues[field.fieldKey] ?? '').trim()
    }))
    .filter(entry => entry.value !== '');
}
