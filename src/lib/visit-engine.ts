// محرّك الزيارات — ثوابت السقف الزمني على «مهتم» ودالة حساب الركود.
// نقطة الصفر = تاريخ نشر الميزة: العملاء المهتمون الراكدون قبلها يبدأ عدّهم منها
// (لا من آخر متابعتهم الفعلية) — حتى لا ينزل ٣٠٠+ عميل دفعة واحدة يوم التفعيل.

/** تاريخ نشر محرّك الزيارات (توقيت الرياض) — لا يُغيَّر بعد النشر. */
export const VISIT_ENGINE_EPOCH = new Date("2026-07-25T00:00:00+03:00");

/** ٧ أيام بلا متابعة → شارة «راكد» صفراء (قائمة التحذير). */
export const INTERESTED_STALE_WARN_DAYS = 7;

/** ١٤ يومًا بلا متابعة → تنزيل تلقائي إلى «موعد لاحق» بموعد الغد. */
export const INTERESTED_STALE_DEMOTE_DAYS = 14;

/**
 * أيام ركود عميل «مهتم»: منذ آخر متابعة (أو الإسناد/الإنشاء لو ما فيه متابعات)،
 * مع نقطة الصفر حدًّا أدنى — ما قبل نشر الميزة لا يُحتسب.
 */
export function interestedIdleDays(lastFollowupAt: Date | null, fallback: Date, now: Date = new Date()): number {
  const base = Math.max((lastFollowupAt ?? fallback).getTime(), VISIT_ENGINE_EPOCH.getTime());
  return Math.floor((now.getTime() - base) / 86_400_000);
}
