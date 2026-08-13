/**
 * توقيت الرياض — المصدر الوحيد لحدود اليوم والأسبوع في كل النظام.
 *
 * لماذا وحدة مستقلة: كانت الإزاحة (+٣) مكرّرة في ست وحدات (leaderboard · my-log ·
 * auto-distribute · notifications/scheduled · sources · activity-report)، و«الأسبوع»
 * كان يعني شيئين مختلفين: أسبوعًا تقويميًا في لوحة الأسبوع و«آخر ١٦٨ ساعة» متدحرجة في
 * لوحة التحكم — فيرى المالك رقمين مختلفين للموظف نفسه في الشاشتين.
 *
 * السعودية بلا توقيت صيفي — الإزاحة ثابتة +٣ دائمًا، فالحساب بالإزاحة صحيح ولا يحتاج
 * مكتبة مناطق زمنية. (لو تغيّرت السياسة يومًا، التغيير هنا وحده.)
 *
 * وحدة نقيّة (بلا "server-only" وبلا Prisma) — تصلح للخادم والسكربتات معًا.
 */

/** إزاحة الرياض عن UTC بالمللي ثانية (+٣ ثابتة — لا توقيت صيفي في السعودية). */
export const KSA_OFFSET_MS = 3 * 3_600_000;
export const DAY_MS = 86_400_000;

/** بداية اليوم (٠٠:٠٠ بتوقيت الرياض) للحظة المرجعية — تُعاد كلحظة UTC. */
export function dayStartKSA(ref: Date = new Date()): Date {
  const k = new Date(ref.getTime() + KSA_OFFSET_MS);
  return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - KSA_OFFSET_MS);
}

/** بداية الأسبوع (الأحد ٠٠:٠٠ بتوقيت الرياض) — الأسبوع ميلادي ينقلب الأحد. */
export function weekStartKSA(ref: Date = new Date()): Date {
  const k = new Date(ref.getTime() + KSA_OFFSET_MS);
  return new Date(
    Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() - k.getUTCDay(), 0, 0, 0) - KSA_OFFSET_MS,
  );
}

/** نهاية الأسبوع (الأحد التالي ٠٠:٠٠ الرياض) — الحد الأعلى الحصري `lt`. */
export function weekEndKSA(ref: Date = new Date()): Date {
  return new Date(weekStartKSA(ref).getTime() + 7 * DAY_MS);
}

/** ساعة اللحظة بتوقيت الرياض (٠–٢٣). */
export function ksaHourOf(d: Date): number {
  return new Date(d.getTime() + KSA_OFFSET_MS).getUTCHours();
}

/**
 * دقائق اللحظة من منتصف ليل الرياض (٠–١٤٣٩) — لمقارنة أوقات الدوام المخزَّنة
 * كدقائق (workStartMinutes / workEndMinutes) بوقت السيرفر لا بساعة الجوال.
 */
export function ksaMinutesOfDay(d: Date): number {
  const k = new Date(d.getTime() + KSA_OFFSET_MS);
  return k.getUTCHours() * 60 + k.getUTCMinutes();
}

/** مفتاح اليوم بتوقيت الرياض (YYYY-MM-DD) — للتجميع اليومي (سقف المتابعات مثلًا). */
export function ksaDayKey(d: Date): string {
  return new Date(d.getTime() + KSA_OFFSET_MS).toISOString().slice(0, 10);
}

/** يوم الأسبوع بتوقيت الرياض (٠=الأحد … ٦=السبت) — بديل getDay() المرهون بتوقيت الجهاز. */
export function ksaDayOfWeek(d: Date): number {
  return new Date(d.getTime() + KSA_OFFSET_MS).getUTCDay();
}

/**
 * يفسّر نص تاريخ «بلا منطقة زمنية» (قيم date/time/datetime-local) كوقت حائط
 * **الرياض** — «13:00» تعني ١:٠٠ ظهرًا بالرياض أيًّا كان توقيت الخادم أو المتصفح.
 *
 * السبب: new Date("2026-08-11T13:00") تفسَّر بتوقيت البيئة المحلي، والخادم على
 * الإنتاج UTC — فكانت المواعيد تُخزَّن مزاحة +٣ ساعات. نص كامل بمنطقة (Z أو
 * إزاحة) يمرّ كما هو؛ نص غير صالح يرجع Date قيمته NaN (المستدعي يفحص كالعادة).
 */
export function parseRiyadhLocal(raw: string): Date {
  if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(raw)) return new Date(raw);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T00:00:00+03:00`);
  return new Date(`${raw}+03:00`);
}
