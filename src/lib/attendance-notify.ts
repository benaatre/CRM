import "server-only";

import { toArabicDigits } from "@/lib/format";

/**
 * نصوص إشعارات حوكمة الدوام — النصوص الحرفية المعتمدة من المالك (المرحلة ٢).
 *
 * لا نظام تأنيث بالأسماء في المشروع، فالصيغة محايدة («داوم/سجّل/أكمل») حسب
 * قرار التصميم. كل إشعارات هذي الوحدة للمالك فقط — عدا نداء التحقق نفسه
 * (`attendance.verify`) فهو للموظف.
 */

/** مدة بالعربي: «ساعة و٢٠ دقيقة» / «ساعتين» / «٣ ساعات» / «٤٥ دقيقة». */
export function durationArabic(totalMinutes: number): string {
  const t = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(t / 60);
  const m = t % 60;
  const hs =
    h === 1 ? "ساعة" : h === 2 ? "ساعتين" : h >= 3 && h <= 10 ? `${toArabicDigits(h)} ساعات` : `${toArabicDigits(h)} ساعة`;
  const ms =
    m === 1 ? "دقيقة" : m === 2 ? "دقيقتين" : m >= 3 && m <= 10 ? `${toArabicDigits(m)} دقائق` : `${toArabicDigits(m)} دقيقة`;
  if (h === 0) return m === 0 ? "أقل من دقيقة" : ms;
  if (m === 0) return hs;
  return `${hs} و${ms}`;
}

/** مسافة بالعربي: «٣٥٠ م» تحت الكيلو، وإلا «١.٤ كم». */
export function distanceArabic(meters: number): string {
  if (meters < 1000) return `${toArabicDigits(Math.round(meters))} م`;
  const km = (meters / 1000).toFixed(1);
  return `${toArabicDigits(km.endsWith(".0") ? km.slice(0, -2) : km)} كم`;
}

/** «داوم سعود اليوم الساعة ١٠:٠٠ ص — المقر الرئيسي» */
export function checkedInText(name: string, timeText: string, locationName: string | null): string {
  return `داوم ${name} اليوم الساعة ${timeText}${locationName ? ` — ${locationName}` : ""}`;
}

/** «تأخر سعود عن دوامه ساعة و٢٠ دقيقة — حضر الآن المقر الرئيسي» */
export function lateCheckInText(name: string, lateMinutes: number, locationName: string | null): string {
  return `تأخر ${name} عن دوامه ${durationArabic(lateMinutes)} — حضر الآن${locationName ? ` ${locationName}` : ""}`;
}

/** «سعود ما سجّل حضور اليوم — مرّت ٣ ساعات على بداية دوامه» */
export function noShowText(name: string, elapsedMinutes: number): string {
  const hours = Math.floor(elapsedMinutes / 60);
  return `${name} ما سجّل حضور اليوم — مرّت ${durationArabic(hours * 60)} على بداية دوامه`;
}

/** «أكمل سعود ٨ ساعات دوام اليوم وانصرف من المقر الرئيسي» */
export function completedText(name: string, targetMinutes: number, locationName: string | null): string {
  return `أكمل ${name} ${durationArabic(targetMinutes)} دوام اليوم وانصرف${locationName ? ` من ${locationName}` : ""}`;
}

/** «مها ما استجاب لنداء التحقق خلال المهلة — آخر موقع معروف: المقر ١:٣٠ م» */
export function verifyMissedText(
  name: string,
  lastKnown: { locationName: string | null; timeText: string } | null,
): string {
  const base = `${name} ما استجاب لنداء التحقق خلال المهلة`;
  if (!lastKnown) return base;
  return `${base} — آخر موقع معروف: ${lastKnown.locationName ?? "خارج النطاق"} ${lastKnown.timeText}`;
}

/* ═══════════ الدفعة الثالثة — التوقف ونداء الوصول ═══════════ */

/** «استأذن سعود للخروج بإذن الإدارة الساعة ١:٣٠ م» / «غادر سعود موقع العمل بإذن …» */
export function pauseStartText(
  name: string,
  kind: "EXCUSED" | "LEFT",
  authorizerLabel: string,
  timeText: string,
): string {
  return kind === "EXCUSED"
    ? `استأذن ${name} للخروج بإذن ${authorizerLabel} الساعة ${timeText}`
    : `غادر ${name} موقع العمل بإذن ${authorizerLabel} الساعة ${timeText}`;
}

/** «رجع سعود وكمّل دوامه بعد ساعة و٢٠ دقيقة» */
export function pauseResumeText(name: string, pausedMinutes: number): string {
  return `رجع ${name} وكمّل دوامه بعد ${durationArabic(pausedMinutes)}`;
}

/** «سعود ما أكّد وصوله للمشروع» */
export function arrivalMissedText(name: string): string {
  return `${name} ما أكّد وصوله للمشروع`;
}

/** «انصرف سعود الساعة ٣:٣٠ م من المقر الرئيسي — قبل إكمال دوامه» (انصراف من النداء) */
export function checkoutText(
  name: string,
  timeText: string,
  locationName: string | null,
  beforeTarget: boolean,
): string {
  return `انصرف ${name} الساعة ${timeText} من ${locationName ?? "خارج النطاق"}${beforeTarget ? " — قبل إكمال دوامه" : ""}`;
}

/** تذكير الموقوف — نص واحد موحّد، للموظف نفسه. */
export const PAUSE_REMINDER_TEXT = "لا زلت مستأذنًا — رجعت؟";

/** «سعود غيّر موقعه خارج النطاق — يبعد ١.٤ كم عن مشروع السلطان ٧٩» (الدفعة الثانية) */
export function locationChangeOutOfZoneText(
  name: string,
  distanceMeters: number | null,
  targetName: string | null,
): string {
  const base = `${name} غيّر موقعه خارج النطاق`;
  if (distanceMeters == null || !targetName) return base;
  return `${base} — يبعد ${distanceArabic(distanceMeters)} عن ${targetName}`;
}

/** «سعود ردّ على نداء التحقق من خارج النطاق — يبعد ١.٤ كم عن المقر الرئيسي» */
export function verifyOutOfZoneText(
  name: string,
  distanceMeters: number | null,
  nearestName: string | null,
): string {
  const base = `${name} ردّ على نداء التحقق من خارج النطاق`;
  if (distanceMeters == null || !nearestName) return base;
  return `${base} — يبعد ${distanceArabic(distanceMeters)} عن ${nearestName}`;
}
