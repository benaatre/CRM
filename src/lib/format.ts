// دوال تنسيق سعودية — أرقام عربية، اختصار (٦٩٠ك / ١.٢م)، عملة ر.س، تواريخ.

const AR_DIGITS = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];

export function toArabicDigits(input: string | number): string {
  return String(input).replace(/\d/g, (d) => AR_DIGITS[Number(d)]);
}

/** اختصار الأرقام الكبيرة: 690000 → ٦٩٠ك ، 1200000 → ١.٢م */
export function formatNumberShort(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) {
    const v = n / 1_000_000;
    return toArabicDigits(trim(v)) + "م";
  }
  if (abs >= 1_000) {
    const v = n / 1_000;
    return toArabicDigits(trim(v)) + "ك";
  }
  return toArabicDigits(n);
}

function trim(v: number): string {
  // رقم عشري واحد، وبدون صفر زائد (١.٠ → ١)
  const s = v.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

/** عملة بالريال السعودي مع اختصار. */
export function formatCurrency(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${formatNumberShort(n)} ر.س`;
}

/** قيمة كاملة بفواصل + ر.س (للتفاصيل الدقيقة). */
export function formatCurrencyFull(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${toArabicDigits(n.toLocaleString("en-US"))} ر.س`;
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("ar-SA-u-nu-arab", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

/** التاريخ + الساعة (لسجل المتابعات). */
export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("ar-SA-u-nu-arab", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

/** «قبل ٣ أيام» / «اليوم» / «بكرة» — نسبيًا للحين. */
export function timeAgo(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  const diffMs = d.getTime() - Date.now();
  const day = 86_400_000;
  const days = Math.round(diffMs / day);
  if (days === 0) return "اليوم";
  if (days === 1) return "بكرة";
  if (days === -1) return "أمس";
  if (days > 1) return `بعد ${toArabicDigits(days)} يوم`;
  return `قبل ${toArabicDigits(Math.abs(days))} يوم`;
}

/** هل المتابعة مستحقّة (اليوم أو فات موعدها)؟ */
export function isFollowupDue(date: Date | string | null | undefined): boolean {
  if (!date) return false;
  const d = typeof date === "string" ? new Date(date) : date;
  return d.getTime() <= Date.now();
}
