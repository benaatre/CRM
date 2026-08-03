import { toArabicDigits } from "@/lib/format";
import { ksaHourOf } from "@/lib/ksa-time";

/**
 * صياغات نصّية خاصة بتطبيق الجوال.
 *
 * ⚠️ الأرقام العربية لها مصدر واحد في النظام هو `@/lib/format` — نعيد تصديره هنا
 * للراحة بلا تكرار المنطق (نسخة ثانية تعني اختلافًا صامتًا يومًا ما).
 */
export { toArabicDigits };

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
