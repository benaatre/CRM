// دوال تنسيق سعودية — أرقام عربية، اختصار (٦٩٠ك / ١.٢م)، عملة ر.س، تواريخ.

import { formatDistanceToNow } from "date-fns";
import { ar } from "date-fns/locale";

const AR_DIGITS = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];

/** توقيت السعودية — تُثبَّت به كل تنسيقات الوقت/التاريخ (بغض النظر عن توقيت الخادم). */
export const RIYADH_TZ = "Asia/Riyadh";

/** عتبة «متصل الآن» — آخر نشاط أقل من ٥ دقائق. */
export const ONLINE_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * «آخر ظهور» بصيغة نسبية بالعربي عبر date-fns:
 * أقل من ٥ دقائق → «متصل الآن» · غير ذلك → «منذ ٣ ساعات» / «منذ يومين» … (بأرقام عربية).
 */
export function lastSeenAgo(date: Date | string | null | undefined): string {
  if (!date) return "لم يظهر بعد";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Date.now() - d.getTime() < ONLINE_THRESHOLD_MS) return "متصل الآن";
  return toArabicDigits(formatDistanceToNow(d, { addSuffix: true, locale: ar }));
}

export function toArabicDigits(input: string | number): string {
  return String(input).replace(/\d/g, (d) => AR_DIGITS[Number(d)]);
}

/**
 * ترتيب طبيعي لأرقام الوحدات النصّية: ٢ قبل ١٠ (وليس معجميًا "١٠" قبل "٢").
 * يدعم الأرقام والمختلط (A2 قبل A10) عبر مقارنة numeric.
 */
export function compareUnitNumbers(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });
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
    calendar: "gregory",
    timeZone: RIYADH_TZ,
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
    calendar: "gregory",
    timeZone: RIYADH_TZ,
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
