// مساعدات «إيقاف استقبال العملاء» — آمنة للعميل والخادم (تسميات + مدد + الوقت المتبقّي).

import { toArabicDigits } from "@/lib/format";

export type PauseReasonCode = "VACATION" | "REVIEW" | "SICK" | "BUSY";
export type PauseDurationCode = "2h" | "4h" | "today" | "manual";

/** أسباب الإيقاف (للنوافذ والعرض). */
export const PAUSE_REASONS: { code: PauseReasonCode; label: string }[] = [
  { code: "VACATION", label: "إجازة" },
  { code: "REVIEW", label: "مراجعة العملاء السابقين" },
  { code: "SICK", label: "سبب مرضي" },
  { code: "BUSY", label: "مشغول" },
];

/** مدد الإيقاف (للنوافذ). */
export const PAUSE_DURATIONS: { code: PauseDurationCode; label: string }[] = [
  { code: "2h", label: "ساعتين" },
  { code: "4h", label: "٤ ساعات" },
  { code: "today", label: "لنهاية اليوم" },
  { code: "manual", label: "حتى أرجع يدويًا" },
];

export function pauseReasonLabel(code: string | null | undefined): string {
  if (!code) return "—";
  return PAUSE_REASONS.find((r) => r.code === code)?.label ?? code;
}

/**
 * عبارة الوقت المتبقّي للرجوع — «يرجع بعد ساعة ونص» / «بعد ساعتين» / «بدون مدة».
 */
export function formatPauseRemaining(pauseUntil: Date | string | null | undefined): string {
  if (!pauseUntil) return "بدون مدة";
  const ms = new Date(pauseUntil).getTime() - Date.now();
  if (ms <= 0) return "ينتهي قريبًا";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `يرجع بعد ${toArabicDigits(mins)} دقيقة`;
  const h = Math.floor(mins / 60);
  const r = mins % 60;
  const hPart = h === 1 ? "ساعة" : h === 2 ? "ساعتين" : h <= 10 ? `${toArabicDigits(h)} ساعات` : `${toArabicDigits(h)} ساعة`;
  let rPart = "";
  if (r >= 15 && r <= 44) rPart = " ونص";
  else if (r > 0) rPart = ` و${toArabicDigits(r)} دقيقة`;
  return `يرجع بعد ${hPart}${rPart}`;
}
