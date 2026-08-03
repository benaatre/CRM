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
 * «معك من …» — مدّة بقاء العميل مع الموظف بصياغة عربية سليمة
 * (مفرد/مثنّى/جمع قلّة/تمييز مفرد منصوب) لا بقالب واحد جامد.
 */
export function waitingLabel(days: number): string {
  const d = Math.max(0, Math.floor(days));
  if (d === 0) return "معك من اليوم";
  if (d === 1) return "معك من يوم";
  if (d === 2) return "معك من يومين";
  if (d <= 10) return `معك من ${toArabicDigits(d)} أيام`;
  return `معك من ${toArabicDigits(d)} يومًا`;
}
