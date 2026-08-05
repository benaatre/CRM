import { toArabicDigits, formatDateTime, RIYADH_TZ } from "@/lib/format";
import { ksaHourOf } from "@/lib/ksa-time";

/**
 * صياغات نصّية خاصة بتطبيق الجوال.
 *
 * ⚠️ الأرقام العربية لها مصدر واحد في النظام هو `@/lib/format` — نعيد تصديره هنا
 * للراحة بلا تكرار المنطق (نسخة ثانية تعني اختلافًا صامتًا يومًا ما).
 */
export { toArabicDigits };

/* ===== وقت دقيق بتوقيت الرياض (ميلادي · أرقام عربية) ===== */

/** مفتاح اليوم (YYYY-MM-DD) بتوقيت الرياض — نسخة (app)/audit وm/audit حرفيًا. */
function riyadhDayKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: RIYADH_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}
function shiftDayKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

/**
 * «اليوم ٣:٤٥ م» / «أمس ١١:٢٠ ص» / تاريخ كامل للأقدم — صياغة عرض بحتة
 * (نفس منطق `auditWhen` في شاشة سجل التدقيق). تُستخدم لـ«آخر ظهور».
 */
export function exactWhen(date: Date | string | null | undefined, now: Date = new Date()): string {
  if (!date) return "لم يظهر بعد";
  const d = typeof date === "string" ? new Date(date) : date;
  const todayKey = riyadhDayKey(now);
  const key = riyadhDayKey(d);
  const time = new Intl.DateTimeFormat("ar-SA-u-nu-arab", {
    calendar: "gregory", timeZone: RIYADH_TZ, hour: "numeric", minute: "2-digit",
  }).format(d);
  if (key === todayKey) return `اليوم ${time}`;
  if (key === shiftDayKey(todayKey, -1)) return `أمس ${time}`;
  return formatDateTime(d);
}

/** تحية حسب ساعة الرياض: صباحًا قبل ١٢ ظهرًا، وإلا مساءً. */
export function greeting(date: Date = new Date()): string {
  return ksaHourOf(date) < 12 ? "صباح الخير" : "مساء الخير";
}

/**
 * أساس عدّاد الانتظار: `daysWaiting` تُحسب من آخر تواصل إن وُجد وكان أحدث من
 * الإسناد، وإلا من الإسناد (lib/assignment.ts:waitingSince). فالنص لازم يتبع
 * الأساس — «معك من اليوم» لعميل تواصلت معه اليوم وهو معك من شهور نصٌّ كاذب.
 */
export type WaitingBasis = "contact" | "assign";

export function waitingBasisOf(lead: {
  lastContact: Date | null;
  assignedAt: Date | null;
}): WaitingBasis {
  if (!lead.lastContact) return "assign";
  if (lead.assignedAt && lead.lastContact <= lead.assignedAt) return "assign";
  return "contact";
}

/** عدد الأيام بصياغة عربية سليمة (مفرد/مثنّى/جمع قلّة/تمييز مفرد منصوب). */
function daysPhrase(d: number, one: string, two: string, few: string, many: string): string {
  if (d === 1) return one;
  if (d === 2) return two;
  if (d <= 10) return `${toArabicDigits(d)} ${few}`;
  return `${toArabicDigits(d)} ${many}`;
}

/**
 * مدة منقضية بأنسب وحدة (دقيقة/ساعة/يوم) — لسطر الرؤية «أقدمهم ينتظر من …».
 * عرض فقط؛ لا يدخل في أي منطق.
 */
export function elapsedLabel(from: Date, now: Date = new Date()): string {
  const mins = Math.max(1, Math.floor((now.getTime() - from.getTime()) / 60_000));
  if (mins < 60) return `${toArabicDigits(mins)} دقيقة`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours === 1 ? "ساعة" : hours === 2 ? "ساعتين" : hours <= 10 ? `${toArabicDigits(hours)} ساعات` : `${toArabicDigits(hours)} ساعة`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "يوم" : days === 2 ? "يومين" : days <= 10 ? `${toArabicDigits(days)} أيام` : `${toArabicDigits(days)} يومًا`;
}

/**
 * نص عدّاد الانتظار — يتبع أساسه لا يخمّنه:
 * `contact` ⟵ «آخر تواصل اليوم / قبل ٣ أيام» · `assign` ⟵ «معك من اليوم / ٣ أيام».
 */
export function waitingLabel(days: number, basis: WaitingBasis = "assign"): string {
  const d = Math.max(0, Math.floor(days));
  if (basis === "contact") {
    if (d === 0) return "آخر تواصل اليوم";
    if (d === 1) return "آخر تواصل أمس";
    return `آخر تواصل قبل ${daysPhrase(d, "يوم", "يومين", "أيام", "يومًا")}`;
  }
  if (d === 0) return "معك من اليوم";
  return `معك من ${daysPhrase(d, "يوم", "يومين", "أيام", "يومًا")}`;
}
