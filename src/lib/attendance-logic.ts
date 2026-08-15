import { KSA_OFFSET_MS, ksaDayKey } from "@/lib/ksa-time";

/**
 * منطق حساب الدوام المحدد — المرحلة ٢.
 *
 * «الـ ٨ ساعات» هي العمود: لكل موظف بداية مخصصة وعدد ساعات، والاستثناءات
 * (إجازة/استئذان/دوام معدّل) تُطبَّق هنا في مكان واحد فتتفق كل الشاشات
 * (البصم، اللوحة، الملف، الكرون) على نفس الأرقام.
 *
 * وحدة نقيّة (بلا "server-only" وبلا Prisma) — تصلح للخادم والسكربتات معًا،
 * على نمط `ksa-time.ts` و`geofence.ts`. تستقبل بيانات جاهزة ولا تستعلم بنفسها.
 */

export const DEFAULT_START_MINUTES = 540; // ٩:٠٠ صباحًا
export const DEFAULT_SHIFT_MINUTES = 480; // ٨ ساعات

/** رموز أيام الأسبوع كما تُخزَّن في weekendDays — الفهرس يطابق ksaDayOfWeek (٠=الأحد). */
export const WEEKDAY_CODES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
export type WeekdayCode = (typeof WEEKDAY_CODES)[number];

/** "FRI,SAT" ← مجموعة فهارس أيام الإجازة الأسبوعية. رموز غريبة تُتجاهل. */
export function parseWeekendDays(raw: string): Set<number> {
  const out = new Set<number>();
  for (const code of raw.split(",")) {
    const i = WEEKDAY_CODES.indexOf(code.trim().toUpperCase() as WeekdayCode);
    if (i >= 0) out.add(i);
  }
  return out;
}

/** الشكل الأدنى لدوام الموظف المحدد — null يعني الافتراضي (٩:٠٠/٨ ساعات). */
export type ScheduleLike = { startMinutes: number; shiftMinutes: number } | null | undefined;

/** الشكل الأدنى للاستثناء كما تحتاجه الحسبة — نفس أسماء أعمدة Prisma. */
export type ExceptionLike = {
  type: "FULL_DAY_LEAVE" | "HOURS_EXCUSE" | "MODIFIED_SHIFT";
  dateFrom: Date;
  dateTo: Date;
  excuseUntilMinutes: number | null;
  modifiedShiftMinutes: number | null;
};

/** مفتاح اليوم لعمود @db.Date (مخزَّن منتصف ليل UTC) — لا يمرّ على إزاحة الرياض. */
export function dateColumnKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** هل الاستثناء يشمل اليوم `dayKey` (YYYY-MM-DD)؟ الحدان داخلان. */
export function exceptionCoversDay(ex: ExceptionLike, dayKey: string): boolean {
  return dateColumnKey(ex.dateFrom) <= dayKey && dayKey <= dateColumnKey(ex.dateTo);
}

/** دوام الموظف الفعّال ليوم معيّن بعد تطبيق استثناءات ذلك اليوم. */
export type EffectiveDay = {
  /** بداية دوامه المعلنة (دقائق من منتصف ليل الرياض) */
  startMinutes: number;
  /** هدف اليوم بالدقائق (MODIFIED_SHIFT يبدّله) */
  targetMinutes: number;
  /** بداية محاسبة التأخير — HOURS_EXCUSE يؤخّرها إلى excuseUntilMinutes */
  accountStartMinutes: number;
  isWeekend: boolean;
  /** إجازة يوم كامل معتمدة */
  onLeave: boolean;
  hasExcuse: boolean;
  modifiedShift: boolean;
};

/**
 * يحسب الدوام الفعّال ليوم: يبدأ من `AttendanceSchedule` (أو الافتراضي)، ثم
 * يطبّق استثناءات اليوم — الغياب لا يُحتسب مع FULL_DAY_LEAVE، والتأخير لا
 * يُحتسب قبل excuseUntilMinutes مع HOURS_EXCUSE.
 */
export function effectiveDay(
  schedule: ScheduleLike,
  exceptions: ExceptionLike[],
  dayKey: string,
  dayOfWeek: number,
  weekend: Set<number>,
): EffectiveDay {
  const startMinutes = schedule?.startMinutes ?? DEFAULT_START_MINUTES;
  let targetMinutes = schedule?.shiftMinutes ?? DEFAULT_SHIFT_MINUTES;
  let accountStartMinutes = startMinutes;
  let onLeave = false;
  let hasExcuse = false;
  let modifiedShift = false;

  for (const ex of exceptions) {
    if (!exceptionCoversDay(ex, dayKey)) continue;
    if (ex.type === "FULL_DAY_LEAVE") onLeave = true;
    else if (ex.type === "HOURS_EXCUSE" && ex.excuseUntilMinutes != null) {
      hasExcuse = true;
      accountStartMinutes = Math.max(accountStartMinutes, ex.excuseUntilMinutes);
    } else if (ex.type === "MODIFIED_SHIFT" && ex.modifiedShiftMinutes != null) {
      modifiedShift = true;
      targetMinutes = ex.modifiedShiftMinutes;
    }
  }

  return {
    startMinutes,
    targetMinutes,
    accountStartMinutes,
    isWeekend: weekend.has(dayOfWeek),
    onLeave,
    hasExcuse,
    modifiedShift,
  };
}

/** هل بصمة الحضور متأخرة؟ دقيقة الدخول بالرياض > بداية المحاسبة + العتبة. */
export function isLateCheckIn(
  checkInMinutesOfDay: number,
  eff: EffectiveDay,
  lateThresholdMinutes: number,
): boolean {
  return checkInMinutesOfDay > eff.accountStartMinutes + lateThresholdMinutes;
}

/**
 * حالة اليوم في سجل الأيام. `LATE` ليست حالة بل وسم إضافي يُعرض بجانبها،
 * و`WEEKEND` تُستثنى من العرض والحساب.
 */
export type DayStatus =
  | "COMPLETED" // أنجز الهدف
  | "PARTIAL" // داوم أقل من الهدف
  | "OPEN" // جلسة مفتوحة الآن (اليوم فقط)
  | "ABSENT" // يوم عمل ماضٍ بلا جلسة وبلا إجازة
  | "LEAVE" // إجازة معتمدة
  | "PENDING" // اليوم الجاري ولم يداوم بعد — ليست غيابًا بعد
  | "WEEKEND"; // إجازة أسبوعية

export function dayStatus(args: {
  eff: EffectiveDay;
  workedMinutes: number;
  hasSession: boolean;
  hasOpenSession: boolean;
  isToday: boolean;
  isPast: boolean;
}): DayStatus {
  const { eff, workedMinutes, hasSession, hasOpenSession, isToday, isPast } = args;
  if (eff.isWeekend) return "WEEKEND";
  if (eff.onLeave) return "LEAVE";
  if (hasOpenSession) return "OPEN";
  if (hasSession) return workedMinutes >= eff.targetMinutes ? "COMPLETED" : "PARTIAL";
  if (isToday) return "PENDING";
  if (isPast) return "ABSENT";
  return "PENDING";
}

/** يوم واحد من أيام شهر بتوقيت الرياض. */
export type MonthDay = {
  key: string; // YYYY-MM-DD
  /** لحظة بداية اليوم (٠٠:٠٠ رياض) كـUTC */
  start: Date;
  dayOfWeek: number; // ٠=الأحد … ٦=السبت
};

/**
 * أيام شهر `YYYY-MM` بتوقيت الرياض حتى `until` (افتراضيًا: اليوم) — لا نولّد
 * أيامًا مستقبلية في السجل. يرجّع [] لشهر غير صالح.
 */
export function monthDaysKSA(month: string, until: Date = new Date()): MonthDay[] {
  if (!/^\d{4}-\d{2}$/.test(month)) return [];
  const [y, m] = month.split("-").map(Number);
  if (m < 1 || m > 12) return [];
  const untilKey = ksaDayKey(until);
  const days: MonthDay[] = [];
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  for (let d = 1; d <= count; d++) {
    const key = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (key > untilKey) break;
    days.push({
      start: new Date(new Date(`${key}T00:00:00Z`).getTime() - KSA_OFFSET_MS),
      key,
      dayOfWeek: new Date(`${key}T00:00:00Z`).getUTCDay(),
    });
  }
  return days;
}

/** حدود شهر `YYYY-MM` بتوقيت الرياض [start, end) — للاستعلام بمدى واحد. */
export function monthRangeKSA(month: string): { start: Date; end: Date } | null {
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  const [y, m] = month.split("-").map(Number);
  if (m < 1 || m > 12) return null;
  return {
    start: new Date(Date.UTC(y, m - 1, 1) - KSA_OFFSET_MS),
    end: new Date(Date.UTC(y, m, 1) - KSA_OFFSET_MS),
  };
}

/** مفتاح آخر يوم في شهر YYYY-MM (مثل 2026-02-28) — لا "٣١" ثابتة تكسر فبراير. */
export function monthLastDayKey(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

/** الشهر الجاري بتوقيت الرياض بصيغة YYYY-MM. */
export function currentMonthKSA(ref: Date = new Date()): string {
  return ksaDayKey(ref).slice(0, 7);
}

/**
 * أوقات نداءات التحقق العشوائية داخل ما تبقّى من الدوام: لا في أول ٣٠ دقيقة
 * ولا آخر ٣٠ دقيقة. النافذة تُقسَّم شرائح متساوية ونداء عشوائي داخل كل شريحة —
 * فتتباعد النداءات بدل أن تتكدس. نافذة أضيق من العدد المطلوب ترجع أقل (أو صفرًا).
 */
export function planVerificationTimes(
  checkInAt: Date,
  targetMinutes: number,
  perDay: number,
  random: () => number = Math.random,
): Date[] {
  const GUARD_MS = 30 * 60_000;
  const windowStart = checkInAt.getTime() + GUARD_MS;
  const windowEnd = checkInAt.getTime() + targetMinutes * 60_000 - GUARD_MS;
  const span = windowEnd - windowStart;
  if (perDay <= 0 || span <= 0) return [];
  // كل نداء يحتاج ٥ دقائق مساحة على الأقل حتى لا تتلاصق النداءات في نافذة قصيرة.
  const n = Math.min(perDay, Math.max(1, Math.floor(span / (5 * 60_000))));
  const slice = span / n;
  const times: Date[] = [];
  for (let i = 0; i < n; i++) {
    times.push(new Date(windowStart + slice * i + random() * slice));
  }
  return times;
}

/** «٤:٣٥» — دقائق ⟵ نص ساعات:دقائق (بأرقام لاتينية؛ التعريب عند العرض). */
export function minutesToHM(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

/** دقائق من منتصف الليل ⟵ لحظة UTC لذلك الوقت في يوم رياضي معيّن. */
export function minutesToDate(dayKey: string, minutes: number): Date {
  return new Date(new Date(`${dayKey}T00:00:00Z`).getTime() - KSA_OFFSET_MS + minutes * 60_000);
}
