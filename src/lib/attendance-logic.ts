import { DAY_MS, KSA_OFFSET_MS, ksaDayKey } from "@/lib/ksa-time";

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
export type ScheduleLike =
  | { startMinutes: number; shiftMinutes: number; startWindowEndMinutes?: number | null }
  | null
  | undefined;

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
  /** بداية دوامه المعلنة (دقائق من منتصف ليل الرياض) — مع النافذة: أولها */
  startMinutes: number;
  /** نهاية نافذة البداية المرنة (الدوام الواقعي) — بلا نافذة تساوي startMinutes */
  windowEndMinutes: number;
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
  /*
   * النافذة المرنة (الدوام الواقعي — قرار ٢): التأخير لا يُحتسب إلا بعد نهاية
   * نافذة البداية — البدء بأي لحظة داخلها حق مكفول بلا وسم. null = لا نافذة.
   */
  const windowEndMinutes = Math.max(startMinutes, schedule?.startWindowEndMinutes ?? startMinutes);
  let accountStartMinutes = windowEndMinutes;
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
    windowEndMinutes,
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
  | "REMOTE" // يوم «عن بُعد» — قياس نشاط لا ساعات، ولا يُحتسب غيابًا
  | "PENDING" // اليوم الجاري ولم يداوم بعد — ليست غيابًا بعد
  | "WEEKEND"; // إجازة أسبوعية

export function dayStatus(args: {
  eff: EffectiveDay;
  workedMinutes: number;
  hasSession: boolean;
  hasOpenSession: boolean;
  isToday: boolean;
  isPast: boolean;
  /** وضع اليوم المنطقي (الدفعة الرابعة) — REMOTE يطغى على الغياب. */
  dayMode?: "ONSITE" | "REMOTE" | "LEAVE" | null;
}): DayStatus {
  const { eff, workedMinutes, hasSession, hasOpenSession, isToday, isPast } = args;
  if (eff.isWeekend) return "WEEKEND";
  if (eff.onLeave || args.dayMode === "LEAVE") return "LEAVE";
  if (args.dayMode === "REMOTE") return "REMOTE";
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

/**
 * أيام مدى [fromKey, toKey] بتوقيت الرياض حتى `until` — تعميم monthDaysKSA
 * لفلتر الفترة المخصصة في لوحة المالك. مدى غير صالح أو مقلوب يرجع [].
 */
export function rangeDaysKSA(fromKey: string, toKey: string, until: Date = new Date()): MonthDay[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromKey) || !/^\d{4}-\d{2}-\d{2}$/.test(toKey)) return [];
  if (fromKey > toKey) return [];
  const untilKey = ksaDayKey(until);
  const days: MonthDay[] = [];
  // نمشي يومًا بيوم من بداية from (مقيّدين بسنة كحد أقصى — حارس من مدى خيالي).
  let cursor = new Date(`${fromKey}T00:00:00Z`).getTime();
  const last = new Date(`${toKey}T00:00:00Z`).getTime();
  if (!Number.isFinite(cursor) || !Number.isFinite(last)) return [];
  for (let i = 0; cursor <= last && i < 366; i++, cursor += DAY_MS) {
    const key = new Date(cursor).toISOString().slice(0, 10);
    if (key > untilKey) break;
    days.push({
      start: new Date(cursor - KSA_OFFSET_MS),
      key,
      dayOfWeek: new Date(cursor).getUTCDay(),
    });
  }
  return days;
}

/** حدود مدى [fromKey, toKey] بتوقيت الرياض [start, end) — للاستعلام بمدى واحد. */
export function rangeBoundsKSA(fromKey: string, toKey: string): { start: Date; end: Date } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromKey) || !/^\d{4}-\d{2}-\d{2}$/.test(toKey) || fromKey > toKey) return null;
  const start = new Date(`${fromKey}T00:00:00Z`).getTime();
  const end = new Date(`${toKey}T00:00:00Z`).getTime() + DAY_MS;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { start: new Date(start - KSA_OFFSET_MS), end: new Date(end - KSA_OFFSET_MS) };
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
 * أوقات نداءات التحقق العشوائية داخل ما تبقّى من الدوام: لا في حرس البداية
 * ولا حرس النهاية (الدفعة الرابعة: ٦٠/٤٥ دقيقة من الإعدادات). النافذة تُقسَّم
 * شرائح متساوية ونداء عشوائي داخل كل شريحة — فتتباعد النداءات بدل أن تتكدس.
 * نافذة أضيق من العدد المطلوب ترجع أقل (أو صفرًا).
 */
export function planVerificationTimes(
  checkInAt: Date,
  targetMinutes: number,
  perDay: number,
  random: () => number = Math.random,
  startGuardMinutes = 30,
  endGuardMinutes = 30,
): Date[] {
  const windowStart = checkInAt.getTime() + startGuardMinutes * 60_000;
  const windowEnd = checkInAt.getTime() + targetMinutes * 60_000 - endGuardMinutes * 60_000;
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

/* ═══════════ الساعات النشطة — خصم التوقف (الدفعة الثالثة) ═══════════ */

/** الشكل الأدنى لفترة التوقف — endedAt=null يعني التوقف جارٍ الآن. */
export type PauseLike = { startedAt: Date; endedAt: Date | null };

/**
 * **الدالة المشتركة الوحيدة لحساب الساعات** — كل شاشة/مسار يحسب دقائق دوام
 * يمرّ من هنا: `workedMinutes = (endedAt − startedAt) − مجموع فترات التوقف`.
 *
 * التوافق الرجعي مضمون: جلسة بلا فترات توقف = وقت متصل كما كان تمامًا.
 * التوقف المفتوح يمتد حتى `endedAt ?? now`، وكل فترة تُقصّ على حدود الجلسة
 * فلا يخصم توقفٌ خارجَها شيئًا.
 */
export function activeWorkedMinutes(
  startedAt: Date,
  endedAt: Date | null,
  pauses: PauseLike[],
  now: Date = new Date(),
): number {
  const start = startedAt.getTime();
  const end = (endedAt ?? now).getTime();
  if (end <= start) return 0;
  return Math.max(0, Math.round((end - start - pausedMsWithin(pauses, start, end, now)) / 60_000));
}

/**
 * **دقائق اليوم** (الدفعة الرابعة) — الحساب صار يوميًا لا جلسيًا: مجموع دقائق
 * كل جلسات اليوم، كل جلسة صافية من توقفاتها عبر `activeWorkedMinutes`.
 * الجلسة المغلقة يكفيها `workedMinutes` المحفوظ (صافٍ منذ الدفعة الثالثة).
 * هذي هي الدالة الوحيدة لجمع يوم — البطاقة واللوحة والملف والإجماليات كلها منها.
 */
export function sumSessionsMinutes(
  sessions: { id: string; startedAt: Date; endedAt: Date | null; workedMinutes: number | null }[],
  pausesBySession: Map<string, PauseLike[]> | undefined,
  now: Date,
): number {
  return sessions.reduce(
    (sum, s) =>
      sum +
      (s.workedMinutes ??
        (s.endedAt === null ? activeWorkedMinutes(s.startedAt, null, pausesBySession?.get(s.id) ?? [], now) : 0)),
    0,
  );
}

/** مجموع ميلي ثواني التوقف المتقاطعة مع [start, end] — للعدادات الحية. */
export function pausedMsWithin(pauses: PauseLike[], start: number, end: number, now: Date): number {
  let paused = 0;
  for (const p of pauses) {
    const ps = Math.max(p.startedAt.getTime(), start);
    const pe = Math.min((p.endedAt ?? now).getTime(), end);
    if (pe > ps) paused += pe - ps;
  }
  return paused;
}

/* ═══════════════ المحطات — «تغيير موقعي» (الدفعة الثانية) ═══════════════ */

/** الشكل الأدنى للحدث كما يحتاجه اشتقاق المحطات. */
export type StationEvent = {
  type: "CHECK_IN" | "CHECK_OUT" | "PROJECT_IN" | "PROJECT_OUT" | "LOCATION_CHANGE";
  timestamp: Date;
  locationId: string | null;
  locationName: string | null;
  /** HQ | PROJECT — من جدول المواقع؛ null لبصمة خارج النطاق */
  locationType: "HQ" | "PROJECT" | null;
  outOfZone: boolean;
};

/** نوع مقطع المحطة في خط اليوم — ذهبي للمقر، سماوي للمشروع، أحمر خارج النطاق. */
export type StationKind = "HQ" | "PROJECT" | "OUT";

/** محطة واحدة داخل الجلسة: من ← إلى (null = المحطة الحالية). */
export type Station = {
  kind: StationKind;
  locationId: string | null;
  name: string;
  from: Date;
  to: Date | null;
};

/**
 * يشتق محطات اليوم من أحداثه (مرتّبة تصاعديًا) — قاعدة معتمدة من المالك:
 * بصمة الحضور واحدة تفتح الجلسة، والتنقلات محطات داخلها لا بصمات جديدة،
 * والعدّاد لا يتوقف أثناء التنقل.
 *
 * - `CHECK_IN` يفتح أول محطة (لا يصل هنا outOfZone — البصم يرفضه قبل التسجيل).
 * - `LOCATION_CHANGE` يقفل المحطة الحالية ويفتح الجديدة؛ خارج النطاق يفتح
 *   محطة «خارج النطاق» حمراء — تُسجَّل ولا توقف الدوام.
 * - التاريخ القديم: `PROJECT_IN` يفتح محطة المشروع و`PROJECT_OUT` يرجع
 *   للمحطة التي قبلها — فيبقى سجل ما قبل نموذج المحطات مقروءًا كما هو.
 * - `CHECK_OUT` يقفل المحطة الأخيرة.
 */
export function buildStations(events: StationEvent[]): Station[] {
  const stations: Station[] = [];
  /** المحطة التي نرجع لها بعد PROJECT_OUT التاريخية. */
  let beforeProject: { kind: StationKind; locationId: string | null; name: string } | null = null;

  const open = (e: StationEvent): Station => {
    const kind: StationKind = e.outOfZone || !e.locationId ? "OUT" : (e.locationType ?? "PROJECT");
    return {
      kind,
      locationId: e.outOfZone ? null : e.locationId,
      name: kind === "OUT" ? "خارج النطاق" : (e.locationName ?? "موقع غير معروف"),
      from: e.timestamp,
      to: null,
    };
  };
  const closeLast = (at: Date) => {
    const last = stations[stations.length - 1];
    if (last && last.to === null) last.to = at;
  };

  for (const e of events) {
    if (e.type === "CHECK_IN") {
      closeLast(e.timestamp);
      beforeProject = null;
      stations.push(open(e));
    } else if (e.type === "LOCATION_CHANGE") {
      const last = stations[stations.length - 1];
      // نفس الموقع مرة ثانية — لا محطة جديدة، البقاء أبلغ من التكرار.
      if (last && last.to === null && !e.outOfZone && last.locationId === e.locationId) continue;
      closeLast(e.timestamp);
      beforeProject = null;
      if (stations.length > 0) stations.push(open(e));
    } else if (e.type === "PROJECT_IN") {
      const last = stations[stations.length - 1];
      if (last && last.to === null) {
        beforeProject = { kind: last.kind, locationId: last.locationId, name: last.name };
      }
      closeLast(e.timestamp);
      if (stations.length > 0) stations.push(open(e));
    } else if (e.type === "PROJECT_OUT") {
      closeLast(e.timestamp);
      if (beforeProject && stations.length > 0) {
        stations.push({ ...beforeProject, from: e.timestamp, to: null });
        beforeProject = null;
      }
    } else if (e.type === "CHECK_OUT") {
      closeLast(e.timestamp);
      beforeProject = null;
    }
  }

  return stations;
}

/** عدد زيارات المشاريع من المحطات (محطات PROJECT) — للبلاطة وصف الإحصاءات. */
export function countProjectVisits(stations: Station[]): number {
  return stations.filter((s) => s.kind === "PROJECT").length;
}

/** دقائق خارج المقر (مشاريع + خارج النطاق) حتى `now` — لصف «خارج المقر». */
export function minutesAwayFromHQ(stations: Station[], now: Date): number {
  return Math.round(
    stations
      .filter((s) => s.kind !== "HQ")
      .reduce((sum, s) => sum + Math.max(0, (s.to ?? now).getTime() - s.from.getTime()), 0) / 60_000,
  );
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
