export async function ensureDejaVuFont(doc: any): Promise<void> {
  try {
    if (typeof doc.setR2L === 'function') doc.setR2L(false);
    if (doc.__hasDejaVu) {
      doc.setFont('DejaVu', 'normal');
      return;
    }

    const res = await fetch('assets/fonts/DejaVuSans.ttf');
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);

    doc.addFileToVFS('DejaVuSans.ttf', base64);
    doc.addFont('DejaVuSans.ttf', 'DejaVu', 'normal');
    doc.__hasDejaVu = true;
    doc.setFont('DejaVu', 'normal');
  } catch {
    // Keep export working even if font loading fails.
  }
}

export function createPdfText(doc: any, jsPdfApi: any) {
  const processArabic =
    doc?.processArabic ||
    (jsPdfApi?.API?.processArabic
      ? (text: string) => jsPdfApi.API.processArabic(text)
      : null);

  return (value: any): string => {
    const text = String(value ?? '');
    if (!text) return '';

    const hasArabic = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(text);
    if (!hasArabic) return text;

    return typeof processArabic === 'function' ? processArabic(text) : text;
  };
}
