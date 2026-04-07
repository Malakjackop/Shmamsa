export const DEFAULT_FAMILY_ORDER: string[] = [
  'اسرة السمائين',
  'اسرة القديس ابانوب',
  'اسرة القديس ديسقورس',
  'اسرة القديس سيدهم بشاي',
  'اسرة القديس اسكلابيوس',
  'اسرة القديس البابا كيرلس',
  'اسرة القديس الانبا ابرام',
  'اسرة القديس اسطفانوس',
  'خورس مارمرقس',
  'خورس البابا اثناسيوس'
];

type CanonicalFamilyOptions = {
  keepSubFamilies?: boolean;
};

export function normalizeFamilyName(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function canonicalFamilyName(value: unknown, options: CanonicalFamilyOptions = {}): string {
  const raw = String(value || '').trim();
  const normalized = normalizeFamilyName(raw);

  if (!normalized) return '';
  if (normalized.includes('خورس') && normalized.includes('مار') && normalized.includes('مرقس')) {
    return 'خورس مارمرقس';
  }
  if (normalized.includes('خورس') && normalized.includes('اثناسيوس')) {
    return 'خورس البابا اثناسيوس';
  }
  if (normalized.includes('سمائ')) return 'اسرة السمائين';
  if (normalized.includes('ابانوب')) return 'اسرة القديس ابانوب';
  if (normalized.includes('ديسقورس')) return 'اسرة القديس ديسقورس';
  if (normalized.includes('سيدهم') || normalized.includes('بشاي')) return 'اسرة القديس سيدهم بشاي';
  if (normalized.includes('اسكلابيوس')) return 'اسرة القديس اسكلابيوس';
  if (normalized.includes('كيرلس')) {
    if (options.keepSubFamilies) {
      if (/\bا\b|[(\[]\s*ا\s*[)\]]/i.test(normalized)) return 'اسرة القديس البابا كيرلس أ';
      if (/\bب\b|[(\[]\s*ب\s*[)\]]/i.test(normalized)) return 'اسرة القديس البابا كيرلس ب';
    }
    return 'اسرة القديس البابا كيرلس';
  }
  if (normalized.includes('ابرام')) {
    if (options.keepSubFamilies) {
      if (/\bا\b|[(\[]\s*ا\s*[)\]]/i.test(normalized)) return 'اسرة القديس الانبا ابرام أ';
      if (/\bب\b|[(\[]\s*ب\s*[)\]]/i.test(normalized)) return 'اسرة القديس الانبا ابرام ب';
    }
    return 'اسرة القديس الانبا ابرام';
  }
  if (normalized.includes('اسطفانوس') || normalized.includes('استفانوس')) {
    if (options.keepSubFamilies) {
      if (/\bا\b|[(\[]\s*ا\s*[)\]]/i.test(normalized)) return 'اسرة القديس اسطفانوس أ';
      if (/\bب\b|[(\[]\s*ب\s*[)\]]/i.test(normalized)) return 'اسرة القديس اسطفانوس ب';
    }
    return 'اسرة القديس اسطفانوس';
  }

  return raw;
}

export function sortFamiliesByPreferredOrder(
  families: Array<string | null | undefined>,
  preferredOrder: string[] = DEFAULT_FAMILY_ORDER,
  options: CanonicalFamilyOptions = {}
): string[] {
  const cleaned = (families || [])
    .map((family) => canonicalFamilyName(family, options))
    .filter(Boolean);
  const deduped = Array.from(new Set(cleaned));
  const orderMap = new Map(
    preferredOrder.map((name, index) => [normalizeFamilyName(name), index])
  );

  return [...deduped].sort((a, b) => {
    const aOrder = orderMap.get(normalizeFamilyName(canonicalFamilyName(a, options)));
    const bOrder = orderMap.get(normalizeFamilyName(canonicalFamilyName(b, options)));

    if (aOrder != null && bOrder != null) {
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.localeCompare(b, 'ar');
    }
    if (aOrder != null) return -1;
    if (bOrder != null) return 1;
    return a.localeCompare(b, 'ar');
  });
}
