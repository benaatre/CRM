import "server-only";
import { AttendanceEventType, Role } from "@prisma/client";
import type { AttendanceException, AttendanceSession, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { dayStartKSA, ksaDayKey, ksaDayOfWeek, ksaMinutesOfDay } from "@/lib/ksa-time";
import { formatDate, formatDateTime, formatTime } from "@/lib/format";
import {
  DEFAULT_SHIFT_MINUTES,
  DEFAULT_START_MINUTES,
  buildStations,
  countProjectVisits,
  currentMonthKSA,
  minutesAwayFromHQ,
  pausedMsWithin,
  dayStatus,
  effectiveDay,
  minutesToDate,
  monthDaysKSA,
  monthLastDayKey,
  monthRangeKSA,
  parseWeekendDays,
  rangeBoundsKSA,
  rangeDaysKSA,
  sumSessionsMinutes,
  type DayStatus,
  type EffectiveDay,
  type MonthDay,
  type PauseLike,
  type Station,
  type StationEvent,
} from "@/lib/attendance-logic";
import { DAY_MS } from "@/lib/ksa-time";

/**
 * طبقة قراءة حوكمة الدوام — مصدر واحد لإعدادات الدوام وحالة الموظف واللوحة.
 *
 * كل ما هنا قراءة على الخادم؛ منطق البصم نفسه (المطابقة والتسجيل) في
 * `app/api/attendance/punch/route.ts` وحده.
 */

/** «حاضر منذ …» يُحسب من جلسة مفتوحة، لا من آخر بصمة. */
export type AttendanceState = "none" | "in" | "out";

/** إعدادات الدوام — singleton يُنشأ عند أول قراءة بقيمه الافتراضية. */
export async function getAttendanceSettings() {
  return prisma.attendanceSettings.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });
}

/** المواقع النشطة (المقر + المشاريع) — الترتيب: المقر أولًا ثم الأحدث. */
export async function getActiveLocations() {
  return prisma.attendanceLocation.findMany({
    where: { isActive: true },
    orderBy: [{ type: "asc" }, { createdAt: "desc" }],
  });
}

/** كل المواقع (للوحة المالك) — المعطّلة تظهر لكن لا تُطابَق في البصم. */
export async function getAllLocations() {
  return prisma.attendanceLocation.findMany({
    orderBy: [{ isActive: "desc" }, { type: "asc" }, { createdAt: "desc" }],
  });
}

/**
 * حالة موظف اليوم: الجلسة المفتوحة (ولو بدأت أمس ونسي الانصراف) وإلا جلسة اليوم
 * المغلقة، مع زيارة المشروع المفتوحة إن وُجدت وآخر بصمة.
 */
export async function getMyAttendanceStatus(userId: string) {
  const dayStart = dayStartKSA();
  const now = new Date();
  const todayKey = ksaDayKey(now);

  const [openSession, daySessions, todayEvents, eff, todayVerifs, day] = await Promise.all([
    prisma.attendanceSession.findFirst({
      where: { userId, endedAt: null, voided: false },
      orderBy: { startedAt: "desc" },
    }),
    daySessionsOf(userId, todayKey),
    prisma.attendanceEvent.findMany({
      where: { userId, timestamp: { gte: dayStart } },
      orderBy: { timestamp: "desc" },
      include: { location: { select: { name: true, type: true } } },
    }),
    getEffectiveDayFor(userId),
    prisma.attendanceVerification.findMany({
      where: { userId, scheduledAt: { gte: dayStart }, status: { not: "PENDING" } },
      orderBy: { scheduledAt: "asc" },
    }),
    getAttendanceDay(userId, todayKey),
  ]);

  const todaySession = daySessions[daySessions.length - 1] ?? null;
  const closedToday = daySessions.filter((s) => s.endedAt !== null);
  const session = openSession ?? todaySession;
  const state: AttendanceState = openSession ? "in" : todaySession ? "out" : "none";

  /*
   * الحساب اليومي (الدفعة الرابعة): «الأساس» = مجموع الجلسات المغلقة اليوم
   * صافيةً — العميل يضيف عليه المنجز الحي للجلسة المفتوحة، فالعدّاد يعرض
   * **مجموع اليوم** والانصراف بالغلط ما يصفّر شيئًا.
   */
  const dayBaseMinutes = sumSessionsMinutes(closedToday, undefined, now);

  /*
   * اسم موقع الجلسة يأتي من بصمة الحضور نفسها (locationId وقتها) لا من آخر بصمة —
   * الموظف قد يبصم زيارة مشروع بعد حضوره من المقر، فآخر بصمة تكذب على البانر.
   */
  let sessionLocationName: string | null = null;
  if (session) {
    const checkIn = await prisma.attendanceEvent.findUnique({
      where: { id: session.checkInEventId },
      include: { location: { select: { name: true } } },
    });
    sessionLocationName = checkIn?.location?.name ?? null;
  }

  // زيارة المشروع مفتوحة ⟺ آخر بصمة مشروع اليوم هي دخول لا خروج.
  const lastProject = todayEvents.find(
    (e) => e.type === AttendanceEventType.PROJECT_IN || e.type === AttendanceEventType.PROJECT_OUT,
  );
  const projectOpen = lastProject?.type === AttendanceEventType.PROJECT_IN;

  const last = todayEvents[0] ?? null;

  // محطات اليوم — الاستعلام تنازلي والاشتقاق يحتاج الترتيب الزمني التصاعدي.
  const stations = stationsOfDay([...todayEvents].reverse());

  /*
   * توقفات الجلسة المفتوحة (الدفعة الثالثة): البطاقة تحسب المنجز الحي صافيًا
   * `now − startedAt − pausedMsBase − (توقف نشط؟ now − بدايته)` — نفس معادلة
   * الدالة المشتركة، مفكوكة للعميل كي يحرّك العداد بلا نداء سيرفر كل ثانية.
   */
  const openPauses = openSession
    ? await prisma.attendancePause.findMany({
        where: { sessionId: openSession.id },
        orderBy: { startedAt: "asc" },
      })
    : [];
  const activePause = openPauses.find((p) => p.endedAt === null) ?? null;
  const pausedMsBase = openSession
    ? pausedMsWithin(
        openPauses.filter((p) => p.endedAt !== null),
        openSession.startedAt.getTime(),
        now.getTime(),
        now,
      )
    : 0;

  return {
    state,
    session: session
      ? {
          startedAt: session.startedAt,
          startedAtText: formatTime(session.startedAt),
          endedAt: session.endedAt,
          endedAtText: session.endedAt ? formatTime(session.endedAt) : null,
          workedMinutes: session.workedMinutes,
          wasLate: session.wasLate,
          locationName: sessionLocationName,
        }
      : null,
    /*
     * «الـ ٨ ساعات» للبطاقة: الهدف الفعّال اليوم + نهاية دوامه (بداية جلسته +
     * الهدف). العميل يحسب المنجز/الباقي من startedAt — لا عدّاد سيرفر.
     */
    targetMinutes: eff.targetMinutes,
    /*
     * نهاية الدوام = لحظة بلوغ **مجموع اليوم** هدفه: البداية + (الهدف − أساس
     * اليوم المغلق) + المخصوم بالتوقف — فالاستئناف يقرّبها لا يصفّرها.
     */
    shiftEndText: openSession
      ? formatTime(
          new Date(
            openSession.startedAt.getTime() +
              Math.max(0, eff.targetMinutes - dayBaseMinutes) * 60_000 +
              pausedMsBase +
              (activePause ? now.getTime() - activePause.startedAt.getTime() : 0),
          ),
        )
      : null,
    /*
     * اليوم المنطقي (الدفعة الرابعة): الأساس المغلق + الوضع + الاستئناف.
     */
    dayBaseMinutes,
    sessionsToday: daySessions.length,
    day: day
      ? {
          mode: day.mode,
          wasLate: day.wasLate,
          unconfirmedMinutes: day.unconfirmedMinutes,
          autoEnded: day.autoEnded,
          remoteAuthorizerLabel: day.remoteAuthorizerLabel,
          startedText: formatTime(day.createdAt),
          firstCheckInText: day.firstCheckInAt ? formatTime(day.firstCheckInAt) : null,
        }
      : null,
    onLeaveToday: eff.onLeave,
    /*
     * التراجع عن إجازة/استئذان **ذاتيين** (شاشة الحسم): نوع القرار القائم +
     * هل عنده نبضة داخل النطاق حديثة (≤ ٥ دقائق) فيُعرض بانر «تلغي وتبصم؟».
     * استثناءات المالك (FULL_DAY_LEAVE) خارج هذا كليًا.
     */
    selfOff: await (async () => {
      if (day?.mode !== "LEAVE" || eff.onLeave) return null;
      const d = await prisma.attendanceDecision.findFirst({
        where: { userId, date: dayDateOf(todayKey), kind: { in: ["LEAVE", "EXCUSED"] }, outcome: { not: "REVOKED" } },
        orderBy: { decidedAt: "desc" },
        select: { kind: true },
      });
      if (!d) return null;
      const fresh = await prisma.attendancePulse.findFirst({
        where: { userId, inZone: true, at: { gte: new Date(now.getTime() - 5 * 60_000) } },
        orderBy: { at: "desc" },
        include: { location: { select: { name: true } } },
      });
      return {
        kind: d.kind as "LEAVE" | "EXCUSED",
        inZoneNow: fresh !== null,
        zoneName: fresh?.location?.name ?? null,
      };
    })(),
    /*
     * حالة التوقف (الدفعة الثالثة) — الأساس المخصوم + التوقف النشط إن وجد.
     */
    pausedMsBase,
    activePause: activePause
      ? {
          kind: activePause.kind,
          authorizerLabel: activePause.authorizerLabel,
          reason: activePause.reason,
          startedIso: activePause.startedAt.toISOString(),
          startedText: formatTime(activePause.startedAt),
        }
      : null,
    /*
     * محطات اليوم (الدفعة الثانية): خط اليوم متعدد المواقع + السجل القابل
     * للطي + العدادات — الاشتقاق بالسيرفر من نفس دالة اللوحة والملف.
     */
    stations: stations.map((s) => ({
      kind: s.kind,
      name: s.name,
      fromIso: s.from.toISOString(),
      fromText: formatTime(s.from),
      toIso: s.to?.toISOString() ?? null,
      toText: s.to ? formatTime(s.to) : null,
    })),
    visitsCount: countProjectVisits(stations),
    awayMinutes: minutesAwayFromHQ(stations, now),
    verifications: todayVerifs.map((v) => ({
      status: v.status,
      atIso: (v.respondedAt ?? v.sentAt ?? v.scheduledAt).toISOString(),
      atText: formatTime(v.respondedAt ?? v.sentAt ?? v.scheduledAt),
    })),
    projectOpen,
    projectLocationName: projectOpen ? (lastProject?.location?.name ?? null) : null,
    lastEvent: last
      ? {
          type: last.type,
          at: last.timestamp,
          atText: formatTime(last.timestamp),
          locationName: last.location?.name ?? null,
          outOfZone: last.outOfZone,
        }
      : null,
  };
}

export type MyAttendanceStatus = Awaited<ReturnType<typeof getMyAttendanceStatus>>;

/** حالة صفّ الموظف في اللوحة اللحظية. */
export type BoardStatus = "late" | "present" | "left" | "absent";

/**
 * اللوحة اللحظية للمالك — صفّ لكل من يبصم بحالته اليوم.
 *
 * قرار المالك (٢٠٢٦-٠٨-١٣): البصم لكل المستخدمين بلا استثناء عدا المالك نفسه —
 * هو المراقب لا المرصود. فالنطاق هنا EMPLOYEE + ADMIN، وهو **نفس** نطاق بطاقة
 * البصم وحارس `/api/attendance/punch`: من يبصم هو من يظهر باللوحة.
 */
export async function getAttendanceBoard() {
  const dayStart = dayStartKSA();

  const [users, sessions, events] = await Promise.all([
    prisma.user.findMany({
      where: { role: { in: [Role.EMPLOYEE, Role.ADMIN] }, active: true },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    }),
    prisma.attendanceSession.findMany({
      where: { voided: false, OR: [{ startedAt: { gte: dayStart } }, { endedAt: null }] },
      orderBy: { startedAt: "desc" },
    }),
    prisma.attendanceEvent.findMany({
      where: { timestamp: { gte: dayStart } },
      orderBy: { timestamp: "desc" },
      include: { location: { select: { name: true } } },
    }),
  ]);

  return users.map((u) => {
    const open = sessions.find((s) => s.userId === u.id && s.endedAt === null);
    const today = sessions.find((s) => s.userId === u.id && s.startedAt >= dayStart);
    const session = open ?? today;
    const last = events.find((e) => e.userId === u.id) ?? null;

    const status: BoardStatus = open
      ? session?.wasLate
        ? "late"
        : "present"
      : today
        ? "left"
        : "absent";

    return {
      id: u.id,
      name: u.name,
      role: u.role,
      status,
      startedAt: session?.startedAt ?? null,
      startedAtText: session ? formatTime(session.startedAt) : null,
      endedAtText: session?.endedAt ? formatTime(session.endedAt) : null,
      workedMinutes: session?.workedMinutes ?? null,
      wasLate: session?.wasLate ?? false,
      lastEventAtText: last ? formatTime(last.timestamp) : null,
      lastEventType: last?.type ?? null,
      lastLocationName: last?.location?.name ?? null,
      // بصمة خارج كل الدوائر اليوم — تمييز يستحق نظرة المالك.
      outOfZoneToday: events.some((e) => e.userId === u.id && e.outOfZone),
    };
  });
}

export type AttendanceBoardRow = Awaited<ReturnType<typeof getAttendanceBoard>>[number];

/* ═══════════════════ المرحلة ٢ — الدوام المحدد والاستثناءات ═══════════════════ */

/** دوام الموظف المحدد أو الافتراضي (٩:٠٠/٨ ساعات) إن لم يُضبط بعد. */
export async function getScheduleFor(userId: string) {
  const s = await prisma.attendanceSchedule.findUnique({ where: { userId } });
  return {
    startMinutes: s?.startMinutes ?? DEFAULT_START_MINUTES,
    shiftMinutes: s?.shiftMinutes ?? DEFAULT_SHIFT_MINUTES,
    // النافذة المرنة (الدوام الواقعي) — null = وقت واحد كالسابق.
    startWindowEndMinutes: s?.startWindowEndMinutes ?? null,
    isDefault: !s,
  };
}

/** استثناءات مستخدم تتقاطع مع مدى [from, to] (مفاتيح أيام YYYY-MM-DD). */
function exceptionsOverlapping(userId: string | undefined, fromKey: string, toKey: string) {
  return prisma.attendanceException.findMany({
    where: {
      ...(userId ? { userId } : {}),
      dateFrom: { lte: new Date(`${toKey}T00:00:00Z`) },
      dateTo: { gte: new Date(`${fromKey}T00:00:00Z`) },
    },
    orderBy: { dateFrom: "desc" },
  });
}

/**
 * الدوام الفعّال لموظف في يوم مرجعي (افتراضيًا: الآن) — يجمع الدوام المحدد
 * واستثناءات اليوم وأيام الإجازة الأسبوعية في `EffectiveDay` واحدة.
 */
export async function getEffectiveDayFor(userId: string, ref: Date = new Date()): Promise<EffectiveDay> {
  const dayKey = ksaDayKey(ref);
  const [schedule, settings, exceptions] = await Promise.all([
    prisma.attendanceSchedule.findUnique({ where: { userId } }),
    getAttendanceSettings(),
    exceptionsOverlapping(userId, ksaDayKey(ref), ksaDayKey(ref)),
  ]);
  return effectiveDay(schedule, exceptions, dayKey, ksaDayOfWeek(ref), parseWeekendDays(settings.weekendDays));
}

/* ═══════════ اليوم المنطقي (الدفعة الرابعة) ═══════════ */

type Db = PrismaClient | Prisma.TransactionClient;

/** لحظة عمود @db.Date ليوم رياضي — منتصف ليل UTC بمفتاح اليوم. */
export function dayDateOf(dayKey: string): Date {
  return new Date(`${dayKey}T00:00:00Z`);
}

/** يوم المستخدم المنطقي لتاريخ معيّن — null إن لم يُنشأ بعد. */
export async function getAttendanceDay(userId: string, dayKey: string) {
  return prisma.attendanceDay.findUnique({
    where: { userId_date: { userId, date: dayDateOf(dayKey) } },
  });
}

/** يضمن وجود اليوم المنطقي (ONSITE افتراضيًا) — upsert آمن ضد السباق. */
export async function ensureAttendanceDay(db: Db, userId: string, dayKey: string) {
  return db.attendanceDay.upsert({
    where: { userId_date: { userId, date: dayDateOf(dayKey) } },
    update: {},
    create: { userId, date: dayDateOf(dayKey) },
  });
}

/** جلسات يوم رياضي لمستخدم — بمفتاح اليوم (يشمل القديمة بلا dayId). */
export async function daySessionsOf(userId: string, dayKey: string) {
  const start = new Date(dayDateOf(dayKey).getTime() - 3 * 3_600_000);
  const end = new Date(start.getTime() + DAY_MS);
  return prisma.attendanceSession.findMany({
    where: { userId, startedAt: { gte: start, lt: end }, voided: false },
    orderBy: { startedAt: "asc" },
  });
}

/**
 * **دقائق اليوم** — واجهة الطبقة فوق الدالة المشتركة `sumSessionsMinutes`:
 * جلسات اليوم + توقفات المفتوح منها. كل شاشة تحتاج مجموع يوم تمرّ من هنا.
 */
export async function dayWorkedMinutes(userId: string, dayKey: string, now: Date = new Date()): Promise<number> {
  const sessions = await daySessionsOf(userId, dayKey);
  const open = sessions.filter((s) => s.endedAt === null);
  const pausesBySession = new Map<string, PauseLike[]>();
  if (open.length > 0) {
    const pauses = await prisma.attendancePause.findMany({
      where: { sessionId: { in: open.map((s) => s.id) } },
      select: { sessionId: true, startedAt: true, endedAt: true },
    });
    for (const p of pauses) {
      const list = pausesBySession.get(p.sessionId) ?? [];
      list.push({ startedAt: p.startedAt, endedAt: p.endedAt });
      pausesBySession.set(p.sessionId, list);
    }
  }
  return sumSessionsMinutes(sessions, pausesBySession, now);
}

/** حالة بلاطة «البلاط الموحّد» — سبع حالات بألوان هالتها (remote من الدفعة الرابعة). */
export type TileState = "on" | "late" | "paused" | "remote" | "miss" | "exc" | "done";

/** أوضاع الأيام غير الموقعية لكل مستخدم ضمن مدى — لسجلات لا تحسب REMOTE غيابًا. */
async function dayModesByUserMap(
  fromKey: string,
  toKey: string,
  userId?: string,
): Promise<Map<string, Map<string, "ONSITE" | "REMOTE" | "LEAVE">>> {
  const rows = await prisma.attendanceDay.findMany({
    where: {
      ...(userId ? { userId } : {}),
      date: { gte: dayDateOf(fromKey), lte: dayDateOf(toKey) },
      mode: { not: "ONSITE" },
    },
    select: { userId: true, date: true, mode: true },
  });
  const out = new Map<string, Map<string, "ONSITE" | "REMOTE" | "LEAVE">>();
  for (const r of rows) {
    const inner = out.get(r.userId) ?? new Map();
    inner.set(r.date.toISOString().slice(0, 10), r.mode);
    out.set(r.userId, inner);
  }
  return out;
}

/** حدث Prisma بحقول الموقع ⟵ شكل اشتقاق المحطات النقي. */
function toStationEvent(e: {
  type: AttendanceEventType;
  timestamp: Date;
  locationId: string | null;
  outOfZone: boolean;
  location: { name: string; type: "HQ" | "PROJECT" } | null;
}): StationEvent {
  return {
    type: e.type,
    timestamp: e.timestamp,
    locationId: e.locationId,
    locationName: e.location?.name ?? null,
    locationType: e.location?.type ?? null,
    outOfZone: e.outOfZone,
  };
}

/** المحطات المشتقة من أحداث يوم لمستخدم — نقطة الاشتقاق الوحيدة في الطبقة. */
export function stationsOfDay(
  events: Parameters<typeof toStationEvent>[0][],
): Station[] {
  return buildStations(events.map(toStationEvent));
}

/**
 * لوحة «مداوم الآن» — البلاط الموحّد: بلاطة لكل موظف أيًّا كانت حالته.
 *
 * وضعان: اليوم (لحظي — مؤشرات الشريط المباشر + بيانات العداد والمحطة الحالية
 * وسلسلة الغياب) أو فترة `[fromKey, toKey]` (ملخّص المدى لكل موظف). العميل
 * يحرّك العدادات من `*Iso` — السيرفر لا يرسل «الباقي» يشيخ بين تحديثين.
 */
export async function getLiveBoard(range?: { fromKey: string; toKey: string } | null) {
  if (range) return getRangeBoard(range.fromKey, range.toKey);

  const now = new Date();
  const dayStart = dayStartKSA(now);
  const todayKey = ksaDayKey(now);
  const month = currentMonthKSA(now);
  const monthRange = monthRangeKSA(month)!;
  // نافذة السلسلة والإحصاءات: بداية الشهر أو ٣٠ يومًا للوراء — الأبعد.
  const histStart = new Date(Math.min(monthRange.start.getTime(), dayStart.getTime() - 30 * DAY_MS));
  const histFromKey = ksaDayKey(histStart);

  const [users, sessions, events, schedules, settings, exceptions, verifications, pauses, dayRows] = await Promise.all([
    prisma.user.findMany({
      where: { role: { in: [Role.EMPLOYEE, Role.ADMIN] }, active: true },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    }),
    // جلسات النافذة التاريخية كلها + أي جلسة مفتوحة (ولو بدأت قبلها)
    prisma.attendanceSession.findMany({
      where: { voided: false, OR: [{ startedAt: { gte: histStart } }, { endedAt: null }] },
      orderBy: { startedAt: "asc" },
    }),
    prisma.attendanceEvent.findMany({
      where: { timestamp: { gte: dayStart } },
      orderBy: { timestamp: "asc" },
      include: { location: { select: { name: true, type: true } } },
    }),
    prisma.attendanceSchedule.findMany(),
    getAttendanceSettings(),
    exceptionsOverlapping(undefined, histFromKey, todayKey),
    prisma.attendanceVerification.findMany({
      where: { scheduledAt: { gte: dayStart } },
      orderBy: { scheduledAt: "asc" },
    }),
    prisma.attendancePause.findMany({
      where: { session: { endedAt: null } },
      orderBy: { startedAt: "asc" },
    }),
    prisma.attendanceDay.findMany({ where: { date: dayDateOf(todayKey) } }),
  ]);

  const weekend = parseWeekendDays(settings.weekendDays);
  const dow = ksaDayOfWeek(now);
  const scheduleByUser = new Map(schedules.map((s) => [s.userId, s]));
  const monthDays = monthDaysKSA(month, now);
  const pausesBySession = new Map<string, PauseLike[]>();
  for (const p of pauses) {
    const list = pausesBySession.get(p.sessionId) ?? [];
    list.push({ startedAt: p.startedAt, endedAt: p.endedAt });
    pausesBySession.set(p.sessionId, list);
  }
  const dayRowByUser = new Map(dayRows.map((d) => [d.userId, d]));
  const monthModes = await dayModesByUserMap(histFromKey, todayKey);

  /*
   * قياس «عن بُعد» (الدفعة الرابعة) — فترات الفتح وعدد الإجراءات لبلاطة المالك:
   * تُجلب لمن يومهم REMOTE فقط. عدد الإجراءات من جدول Activity القائم بلا
   * ASSIGNMENT (توزيع آلي لا فعل موظف — قرار المالك).
   */
  const remoteIds = dayRows.filter((d) => d.mode === "REMOTE").map((d) => d.userId);
  const [remoteWindows, remoteActions] = remoteIds.length
    ? await Promise.all([
        prisma.appActivityWindow.findMany({
          where: { date: dayDateOf(todayKey), userId: { in: remoteIds } },
          orderBy: { openedAt: "asc" },
        }),
        prisma.activity.groupBy({
          by: ["userId"],
          where: { userId: { in: remoteIds }, createdAt: { gte: dayStart }, type: { not: "ASSIGNMENT" } },
          _count: { _all: true },
        }),
      ])
    : [[], []];
  const actionsByUser = new Map(remoteActions.map((a) => [a.userId, a._count._all]));

  const rows = users.map((u) => {
    const myExceptions = exceptions.filter((e) => e.userId === u.id);
    const eff = effectiveDay(scheduleByUser.get(u.id), myExceptions, todayKey, dow, weekend);

    const mine = sessions.filter((s) => s.userId === u.id);
    const open = mine.find((s) => s.endedAt === null) ?? null;
    const todaySessions = mine.filter((s) => s.startedAt >= dayStart || s.endedAt === null);
    const closedToday = todaySessions.filter((s) => s.endedAt !== null);
    const myEvents = events.filter((e) => e.userId === u.id);

    // توقف الجلسة المفتوحة (الدفعة الثالثة) — الأساس المخصوم + التوقف النشط.
    const openPauses = open ? (pauses.filter((p) => p.sessionId === open.id) ?? []) : [];
    const activePause = openPauses.find((p) => p.endedAt === null) ?? null;
    const pausedMsBase = open
      ? pausedMsWithin(
          openPauses.filter((p) => p.endedAt !== null),
          open.startedAt.getTime(),
          now.getTime(),
          now,
        )
      : 0;

    // ===== المحطات: المحطة الحالية + عدد الزيارات =====
    const stations = stationsOfDay(myEvents);
    const current = open ? ([...stations].reverse().find((s) => s.to === null) ?? null) : null;
    const visitsCount = countProjectVisits(stations);

    // ===== إحصاءات الشهر الجاري (نفس مصدر ملف الموظف — buildMonthLog) =====
    const monthLog = buildDaysLog({
      days: monthDays,
      now,
      schedule: scheduleByUser.get(u.id),
      exceptions: myExceptions,
      sessions: mine.filter((s) => s.startedAt >= monthRange.start),
      weekend,
      pausesBySession,
      dayModesByKey: monthModes.get(u.id),
    });
    const monthStats = summarizeMonth(monthLog);

    // ===== سلسلة الغياب المتتالي: أيام عمل ماضية بلا جلسة، من أمس للوراء =====
    const daysByKey = new Map(
      buildDaysLog({
        days: rangeDaysKSA(histFromKey, todayKey, now),
        now,
        schedule: scheduleByUser.get(u.id),
        exceptions: myExceptions,
        sessions: mine,
        weekend,
        pausesBySession,
        dayModesByKey: monthModes.get(u.id),
      }).map((d) => [d.key, d] as const),
    );
    let absenceStreak = 0;
    for (let t = dayStart.getTime() - DAY_MS; t >= histStart.getTime(); t -= DAY_MS) {
      const d = daysByKey.get(ksaDayKey(new Date(t)));
      if (!d) break;
      if (d.status === "WEEKEND" || d.status === "LEAVE") continue; // لا تقطع السلسلة ولا تُحتسب
      if (d.status === "ABSENT") absenceStreak++;
      else break;
    }

    // آخر حضور معروف داخل النافذة (قبل اليوم).
    const lastPast = [...mine].reverse().find((s) => s.startedAt < dayStart) ?? null;

    // ===== نداءات التحقق اليوم =====
    const myVerifs = verifications.filter((v) => v.userId === u.id);
    const verification = {
      total: myVerifs.length,
      confirmed: myVerifs.filter((v) => v.status === "CONFIRMED").length,
      missed: myVerifs.filter((v) => v.status === "MISSED").length,
      outOfZone: myVerifs.filter((v) => v.status === "OUT_OF_ZONE").length,
    };

    /*
     * ===== حالة البلاطة (الدفعة الرابعة) =====
     * التوقف يتقدم على المداومة، ووضع اليوم (عن بُعد/إجازة) يتقدم على «لم
     * يسجّل» و«الغياب» — الموظف عن بُعد لا يظهر متغيبًا أبدًا.
     */
    const dayRow = dayRowByUser.get(u.id) ?? null;
    const state: TileState = open
      ? activePause
        ? "paused"
        : open.wasLate || dayRow?.wasLate
          ? "late"
          : "on"
      : dayRow?.mode === "REMOTE"
        ? "remote"
        : closedToday.length > 0
          ? "done"
          : dayRow?.mode === "LEAVE" || eff.onLeave || eff.isWeekend || eff.hasExcuse || eff.modifiedShift
            ? "exc"
            : "miss";

    // «الأساس» اليومي: مجموع الجلسات المغلقة اليوم — العداد الحي يضيف عليه.
    const doneMinutes = sumSessionsMinutes(closedToday, undefined, now);
    const lastClosed = closedToday[closedToday.length - 1] ?? null;
    const firstToday = todaySessions[0] ?? null;
    const checkInMin = firstToday ? ksaMinutesOfDay(firstToday.startedAt) : null;
    const todayException = myExceptions.find((e) => exceptionCoversToday(e, todayKey)) ?? null;
    const leaveException =
      todayException?.type === "FULL_DAY_LEAVE" ? todayException : null;

    // ===== قياس «عن بُعد» — فترات الفتح والإجراءات (للمالك فقط) =====
    const myWindows = dayRow?.mode === "REMOTE" ? remoteWindows.filter((w) => w.userId === u.id) : [];
    const OPEN_GAP_MS = 5 * 60_000;
    let longestGapMs = 0;
    for (let i = 1; i < myWindows.length; i++) {
      const gap = myWindows[i].openedAt.getTime() - (myWindows[i - 1].closedAt?.getTime() ?? myWindows[i].openedAt.getTime());
      if (gap > longestGapMs) longestGapMs = gap;
    }
    const lastWindow = myWindows[myWindows.length - 1] ?? null;
    const trailingGap = lastWindow?.closedAt ? now.getTime() - lastWindow.closedAt.getTime() : 0;
    if (trailingGap > OPEN_GAP_MS && trailingGap > longestGapMs) longestGapMs = trailingGap;
    const remote =
      dayRow?.mode === "REMOTE"
        ? {
            authorizerLabel: dayRow.remoteAuthorizerLabel,
            startedText: formatTime(dayRow.createdAt),
            activeMinutes: Math.round(
              myWindows.reduce((s, w) => s + Math.max(0, (w.closedAt?.getTime() ?? w.openedAt.getTime()) - w.openedAt.getTime()), 0) /
                60_000,
            ),
            windowsCount: myWindows.length,
            actionsCount: actionsByUser.get(u.id) ?? 0,
            longestGapMinutes: Math.round(longestGapMs / 60_000),
            windows: myWindows.map((w) => ({
              openedIso: w.openedAt.toISOString(),
              openedText: formatTime(w.openedAt),
              closedIso: w.closedAt?.toISOString() ?? null,
              closedText: w.closedAt ? formatTime(w.closedAt) : null,
              current: w.closedAt !== null && now.getTime() - w.closedAt.getTime() <= OPEN_GAP_MS,
            })),
          }
        : null;

    return {
      id: u.id,
      name: u.name,
      role: u.role,
      state,
      // رأس البلاطة: دوامه المحدد أو وقت حضوره
      targetMinutes: eff.targetMinutes,
      scheduledStartText: formatTime(minutesToDate(todayKey, eff.startMinutes)),
      startedAtText: open
        ? formatTime(open.startedAt)
        : todaySessions[0]
          ? formatTime(todaySessions[0].startedAt)
          : null,
      // مداوم/متأخر/موقوف — الحساب يومي: الأساس المغلق + الجلسة الحية.
      startedAtIso: open ? open.startedAt.toISOString() : null,
      dayBaseMinutes: doneMinutes,
      // نهاية الدوام = بلوغ **مجموع اليوم** هدفه، وتتأخر بمقدار التوقف.
      endsAtText: open
        ? formatTime(
            new Date(
              open.startedAt.getTime() +
                Math.max(0, eff.targetMinutes - doneMinutes) * 60_000 +
                pausedMsBase +
                (activePause ? now.getTime() - activePause.startedAt.getTime() : 0),
            ),
          )
        : null,
      pausedMsBase,
      activePause: activePause
        ? {
            kind: activePause.kind,
            authorizerLabel: activePause.authorizerLabel,
            startedIso: activePause.startedAt.toISOString(),
            startedText: formatTime(activePause.startedAt),
          }
        : null,
      // التأخير من **أول حضور** فقط (الدفعة الرابعة) — الاستئناف لا يولّده.
      lateMinutes:
        (dayRow?.wasLate || firstToday?.wasLate) && checkInMin != null
          ? Math.max(0, checkInMin - eff.accountStartMinutes)
          : null,
      earlyIn: firstToday ? (checkInMin ?? 0) < eff.startMinutes : false,
      station: current
        ? { kind: current.kind, name: current.name, sinceIso: current.from.toISOString() }
        : null,
      visitsCount,
      // لم يسجّل
      accountStartIso: minutesToDate(todayKey, eff.accountStartMinutes).toISOString(),
      lastSeenText: lastPast
        ? `${formatDate(lastPast.startedAt)} — ${formatTime(lastPast.startedAt)}`
        : null,
      absenceStreak,
      // مستثنى
      exceptionType: eff.onLeave
        ? ("FULL_DAY_LEAVE" as const)
        : eff.isWeekend && !open && closedToday.length === 0
          ? ("WEEKEND" as const)
          : todayException?.type ?? null,
      // أنهى دوامه
      doneMinutes,
      endedAtText: lastClosed?.endedAt ? formatTime(lastClosed.endedAt) : null,
      // توسعة معلنة (لوحة المالك): الجلسة أقفلها الكرون لا الموظف → وسم «جلسة لم تُغلق».
      autoClosed: lastClosed?.autoClosed ?? false,
      // ===== الدفعة الرابعة =====
      unconfirmedMinutes: dayRow?.unconfirmedMinutes ?? 0,
      autoEnded: dayRow?.autoEnded ?? false,
      remote,
      leave: leaveException
        ? {
            typeLabel:
              leaveException.leaveType === "SICK"
                ? "مرضية"
                : leaveException.leaveType === "OFFICIAL"
                  ? "رسمية"
                  : leaveException.leaveType === "PERSONAL"
                    ? "ظرف خاص"
                    : "إجازة",
            toKey: leaveException.dateTo.toISOString().slice(0, 10),
            toText: formatDate(leaveException.dateTo),
            selfDeclared: leaveException.selfDeclared,
          }
        : null,
      // مشترك
      monthStats,
      verification,
      outOfZoneToday: myEvents.some((e) => e.outOfZone),
    };
  });

  // الترتيب المعتمد: متأخر → مداوم → موقوف → عن بُعد → لم يسجّل (الأكثر تأخيرًا أولًا) → مستثنى → أنهى.
  const order: Record<TileState, number> = { late: 0, on: 1, paused: 2, remote: 3, miss: 4, exc: 5, done: 6 };
  rows.sort((a, b) =>
    order[a.state] !== order[b.state]
      ? order[a.state] - order[b.state]
      : a.state === "miss"
        ? a.accountStartIso.localeCompare(b.accountStartIso)
        : a.name.localeCompare(b.name, "ar"),
  );

  // ===== مؤشرات الشريط المباشر الخمسة =====
  const onDuty = rows.filter((r) => r.state === "on" || r.state === "late");
  const lateRows = rows.filter((r) => r.lateMinutes != null && r.lateMinutes > 0);
  const nowMs = now.getTime();
  // المنجز الحي صافيًا من التوقف — نفس معادلة الدالة المشتركة مفكوكة.
  const liveMinutes = (r: (typeof rows)[number]) =>
    r.startedAtIso
      ? Math.max(
          0,
          Math.floor(
            (nowMs -
              new Date(r.startedAtIso).getTime() -
              r.pausedMsBase -
              (r.activePause ? nowMs - new Date(r.activePause.startedIso).getTime() : 0)) /
              60_000,
          ),
        )
      : 0;
  const totalMinutesToday = rows.reduce((sum, r) => sum + r.doneMinutes + liveMinutes(r), 0);
  const attendedCount = rows.filter((r) => r.doneMinutes > 0 || r.startedAtIso).length;

  return {
    mode: "today" as const,
    nowIso: now.toISOString(),
    summary: {
      onDuty: onDuty.length,
      lateCount: lateRows.length,
      avgLateMinutes: lateRows.length
        ? Math.round(lateRows.reduce((s, r) => s + (r.lateMinutes ?? 0), 0) / lateRows.length)
        : 0,
      missCount: rows.filter((r) => r.state === "miss").length,
      inProjects: rows.filter((r) => r.station?.kind === "PROJECT").length,
      visitsToday: rows.reduce((s, r) => s + r.visitsCount, 0),
      totalMinutesToday,
      avgMinutesToday: attendedCount ? Math.round(totalMinutesToday / attendedCount) : 0,
    },
    rows,
  };
}

/** هل يغطي الاستثناء اليوم؟ (مفاتيح أعمدة @db.Date تُقارن نصًّا). */
function exceptionCoversToday(e: AttendanceException, todayKey: string): boolean {
  return (
    e.dateFrom.toISOString().slice(0, 10) <= todayKey && todayKey <= e.dateTo.toISOString().slice(0, 10)
  );
}

/** وضع الفترة: ملخّص المدى لكل موظف (ساعات/أيام/تأخير/غياب) — بلا شريط مباشر. */
async function getRangeBoard(fromKey: string, toKey: string) {
  const bounds = rangeBoundsKSA(fromKey, toKey);
  const now = new Date();
  if (!bounds) return { mode: "range" as const, fromKey, toKey, rows: [] };

  const [users, sessions, exceptions, schedules, settings, pausesBySession] = await Promise.all([
    prisma.user.findMany({
      where: { role: { in: [Role.EMPLOYEE, Role.ADMIN] }, active: true },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    }),
    prisma.attendanceSession.findMany({
      where: { startedAt: { gte: bounds.start, lt: bounds.end }, voided: false },
      orderBy: { startedAt: "asc" },
    }),
    exceptionsOverlapping(undefined, fromKey, toKey),
    prisma.attendanceSchedule.findMany(),
    getAttendanceSettings(),
    openSessionPausesMap(),
  ]);

  const weekend = parseWeekendDays(settings.weekendDays);
  const scheduleByUser = new Map(schedules.map((s) => [s.userId, s]));
  const days = rangeDaysKSA(fromKey, toKey, now);

  const rows = users.map((u) => {
    const log = buildDaysLog({
      days,
      now,
      schedule: scheduleByUser.get(u.id),
      exceptions: exceptions.filter((e) => e.userId === u.id),
      sessions: sessions.filter((s) => s.userId === u.id),
      weekend,
      pausesBySession,
    });
    return {
      id: u.id,
      name: u.name,
      role: u.role,
      scheduledStartText: formatTime(
        minutesToDate(fromKey, scheduleByUser.get(u.id)?.startMinutes ?? DEFAULT_START_MINUTES),
      ),
      targetMinutes: scheduleByUser.get(u.id)?.shiftMinutes ?? DEFAULT_SHIFT_MINUTES,
      ...summarizeMonth(log),
    };
  });

  return { mode: "range" as const, fromKey, toKey, rows };
}

export type LiveBoardPayload = Awaited<ReturnType<typeof getLiveBoard>>;
export type LiveTodayPayload = Extract<LiveBoardPayload, { mode: "today" }>;
export type LiveBoardRow = LiveTodayPayload["rows"][number];
export type RangeBoardRow = Extract<LiveBoardPayload, { mode: "range" }>["rows"][number];

/**
 * فترات توقف الجلسات المفتوحة مجمّعة على sessionId — الجلسات المغلقة يكفيها
 * `workedMinutes` المحفوظ (صافٍ منذ الدفعة الثالثة، ومتصل قبلها بلا توقفات).
 */
async function openSessionPausesMap(): Promise<Map<string, PauseLike[]>> {
  const pauses = await prisma.attendancePause.findMany({
    where: { session: { endedAt: null } },
    select: { sessionId: true, startedAt: true, endedAt: true },
  });
  const map = new Map<string, PauseLike[]>();
  for (const p of pauses) {
    const list = map.get(p.sessionId) ?? [];
    list.push({ startedAt: p.startedAt, endedAt: p.endedAt });
    map.set(p.sessionId, list);
  }
  return map;
}

/** جلسات مستخدم مجمّعة على مفتاح يوم الرياض لبداية الجلسة. */
function groupSessionsByDay(sessions: AttendanceSession[]): Map<string, AttendanceSession[]> {
  const map = new Map<string, AttendanceSession[]>();
  for (const s of sessions) {
    const key = ksaDayKey(s.startedAt);
    const list = map.get(key) ?? [];
    list.push(s);
    map.set(key, list);
  }
  return map;
}

/** محطة يوم مُهيّأة للعرض (نصوص جاهزة) — نفس شكل بطاقة الموظف حرفيًا. */
export type StationView = {
  kind: Station["kind"];
  name: string;
  fromIso: string;
  fromText: string;
  toIso: string | null;
  toText: string | null;
};

/** سطر يوم واحد في سجل الأيام. */
export type DayLogEntry = {
  key: string; // YYYY-MM-DD
  status: DayStatus;
  late: boolean;
  earlyIn: boolean;
  lateOut: boolean;
  checkInText: string | null;
  checkOutText: string | null;
  locationName: string | null;
  visitNames: string[];
  workedMinutes: number;
  targetMinutes: number;
  exceptionType: AttendanceException["type"] | null;
  /** محطات اليوم — تُعبّأ في ملف الموظف فقط (سجل التحركات لكل يوم). */
  stations: StationView[];
};

/**
 * يبني سجل أيام مدى معطى لمستخدم من بيانات مجلوبة مسبقًا — مشترك بين ملف
 * الموظف (كل التفاصيل) وملخص الفريق ولوحة البلاط (شهرًا كان أو فترة مخصصة)
 * كي لا تفترق الأرقام بين الشاشات.
 */
function buildDaysLog(args: {
  days: MonthDay[];
  now: Date;
  schedule: { startMinutes: number; shiftMinutes: number } | null | undefined;
  exceptions: AttendanceException[];
  sessions: AttendanceSession[];
  weekend: Set<number>;
  visitsByDay?: Map<string, string[]>;
  checkInLocByDay?: Map<string, string | null>;
  stationsByDay?: Map<string, StationView[]>;
  /** توقفات الجلسات المفتوحة — لحساب المنجز الحي صافيًا (الدالة المشتركة). */
  pausesBySession?: Map<string, PauseLike[]>;
  /** وضع اليوم المنطقي لكل مفتاح يوم (الدفعة الرابعة) — REMOTE لا يُحتسب غيابًا. */
  dayModesByKey?: Map<string, "ONSITE" | "REMOTE" | "LEAVE">;
}): DayLogEntry[] {
  const { now, schedule, exceptions, sessions, weekend } = args;
  const todayKey = ksaDayKey(now);
  const byDay = groupSessionsByDay(sessions);

  return args.days.map((day) => {
    const eff = effectiveDay(schedule, exceptions, day.key, day.dayOfWeek, weekend);
    const daySessions = byDay.get(day.key) ?? [];
    const open = daySessions.find((s) => s.endedAt === null) ?? null;
    const first = daySessions[0] ?? null;
    const lastClosed = [...daySessions].reverse().find((s) => s.endedAt !== null) ?? null;

    // دقائق اليوم = مجموع جلساته صافيةً — عبر دالة اليوم المشتركة وحدها.
    const workedMinutes = sumSessionsMinutes(daySessions, args.pausesBySession, now);

    const status = dayStatus({
      eff,
      workedMinutes,
      hasSession: daySessions.length > 0,
      hasOpenSession: open !== null,
      isToday: day.key === todayKey,
      isPast: day.key < todayKey,
      dayMode: args.dayModesByKey?.get(day.key) ?? null,
    });

    const shiftEndMs = first ? first.startedAt.getTime() + eff.targetMinutes * 60_000 : null;

    const exceptionType =
      exceptions.find(
        (e) =>
          e.dateFrom.toISOString().slice(0, 10) <= day.key && day.key <= e.dateTo.toISOString().slice(0, 10),
      )?.type ?? null;

    return {
      key: day.key,
      status,
      late: daySessions.some((s) => s.wasLate),
      earlyIn: first ? ksaMinutesOfDay(first.startedAt) < eff.startMinutes : false,
      lateOut:
        lastClosed?.endedAt != null && shiftEndMs != null ? lastClosed.endedAt.getTime() > shiftEndMs : false,
      checkInText: first ? formatTime(first.startedAt) : null,
      checkOutText: lastClosed?.endedAt ? formatTime(lastClosed.endedAt) : null,
      locationName: args.checkInLocByDay?.get(day.key) ?? null,
      visitNames: args.visitsByDay?.get(day.key) ?? [],
      workedMinutes,
      targetMinutes: eff.targetMinutes,
      exceptionType,
      stations: args.stationsByDay?.get(day.key) ?? [],
    };
  });
}

/** إجماليات شهر من سجل أيامه — أيام دوام/دقائق/تأخير/غياب. */
export function summarizeMonth(days: DayLogEntry[]) {
  return {
    workDays: days.filter((d) => d.status === "COMPLETED" || d.status === "PARTIAL" || d.status === "OPEN").length,
    totalMinutes: days.reduce((s, d) => s + d.workedMinutes, 0),
    lateDays: days.filter((d) => d.late).length,
    absentDays: days.filter((d) => d.status === "ABSENT").length,
  };
}

/**
 * ملف الموظف لشهر: رأس الإحصاءات + دوامه المحدد + سجل الأيام + استثناءات
 * الشهر + نداءات تحقق الشهر.
 */
export async function getEmployeeFile(userId: string, month: string) {
  const range = monthRangeKSA(month);
  if (!range) return null;
  const now = new Date();

  const [user, schedule, settings] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, role: true, active: true } }),
    prisma.attendanceSchedule.findUnique({ where: { userId } }),
    getAttendanceSettings(),
  ]);
  if (!user || user.role === Role.OWNER) return null;

  const [sessions, events, exceptions, verifications, monthModes, monthDayRows, silentChecks, audits] = await Promise.all([
    prisma.attendanceSession.findMany({
      where: { userId, startedAt: { gte: range.start, lt: range.end }, voided: false },
      orderBy: { startedAt: "asc" },
    }),
    prisma.attendanceEvent.findMany({
      where: { userId, timestamp: { gte: range.start, lt: range.end } },
      orderBy: { timestamp: "asc" },
      include: { location: { select: { name: true, type: true } } },
    }),
    exceptionsOverlapping(userId, `${month}-01`, monthLastDayKey(month)),
    prisma.attendanceVerification.findMany({
      where: { userId, scheduledAt: { gte: range.start, lt: range.end } },
      orderBy: { scheduledAt: "desc" },
    }),
    dayModesByUserMap(`${month}-01`, monthLastDayKey(month), userId),
    prisma.attendanceDay.findMany({
      where: { userId, date: { gte: dayDateOf(`${month}-01`), lte: dayDateOf(monthLastDayKey(month)) } },
    }),
    // الفحوص الصامتة — للمالك فقط (هذي الدالة خلف requireRole(OWNER) أصلًا).
    prisma.attendanceSilentCheck.findMany({
      where: { userId, at: { gte: range.start, lt: range.end } },
      orderBy: { at: "desc" },
      take: 200,
    }),
    // سجل التغييرات — أحدث ٥٠ حدث تدقيق يخص هذا الموظف أو استثناءاته.
    prisma.auditEvent.findMany({
      where: {
        OR: [
          { resourceType: "user", resourceId: userId },
          { resourceType: "attendance_schedule", resourceId: userId },
          { resourceType: "attendance_day", resourceId: userId },
          { resourceType: "attendance_exception" },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 80,
    }),
  ]);

  // سجل النبض الجغرافي — انتقالات اليوم (تغيّر الحكم أو الموقع) لا كل نبضة،
  // فلا ٤٠٠ سطر متكرّر. للمالك فقط، وضمن الشهر المعروض.
  const rawPulses = await prisma.attendancePulse.findMany({
    where: { userId, at: { gte: range.start, lt: range.end } },
    orderBy: { at: "asc" },
    select: { at: true, inZone: true, accuracy: true, location: { select: { name: true } } },
  });
  const pulseLog: { atText: string; dayKey: string; state: "in" | "out" | "unknown"; name: string | null; accuracy: number | null }[] = [];
  let lastKey = "";
  for (const pl of rawPulses) {
    const state = pl.inZone === true ? "in" : pl.inZone === false ? "out" : "unknown";
    const key = `${state}|${pl.location?.name ?? ""}`;
    if (key === lastKey) continue; // نفس الحالة — انتقال واحد يكفي
    lastKey = key;
    pulseLog.push({
      atText: formatTime(pl.at),
      dayKey: ksaDayKey(pl.at),
      state,
      name: pl.location?.name ?? null,
      accuracy: pl.accuracy,
    });
  }
  pulseLog.reverse(); // الأحدث أولًا

  // موقع بصمة الحضور لكل يوم + أحداث كل يوم لاشتقاق محطاته.
  const checkInLocByDay = new Map<string, string | null>();
  const eventsByDay = new Map<string, typeof events>();
  for (const e of events) {
    const key = ksaDayKey(e.timestamp);
    const list = eventsByDay.get(key) ?? [];
    list.push(e);
    eventsByDay.set(key, list);
    if (e.type === AttendanceEventType.CHECK_IN && !e.outOfZone && !checkInLocByDay.has(key)) {
      checkInLocByDay.set(key, e.location?.name ?? null);
    }
  }

  /*
   * المحطات لكل يوم (الدفعة الثانية) — نفس اشتقاق بطاقة الموظف حرفيًا، ومنها
   * تُشتق الزيارات (محطات PROJECT + زيارات PROJECT_IN التاريخية) فلا مصدران.
   */
  const stationsByDay = new Map<string, StationView[]>();
  const visitsByDay = new Map<string, string[]>();
  for (const [key, dayEvents] of eventsByDay) {
    const stations = stationsOfDay(dayEvents);
    stationsByDay.set(
      key,
      stations.map((s) => ({
        kind: s.kind,
        name: s.name,
        fromIso: s.from.toISOString(),
        fromText: formatTime(s.from),
        toIso: s.to?.toISOString() ?? null,
        toText: s.to ? formatTime(s.to) : null,
      })),
    );
    const visits = stations.filter((s) => s.kind === "PROJECT").map((s) => s.name);
    if (visits.length > 0) visitsByDay.set(key, [...new Set(visits)]);
  }

  const days = buildDaysLog({
    days: monthDaysKSA(month, now),
    now,
    schedule,
    exceptions,
    sessions,
    weekend: parseWeekendDays(settings.weekendDays),
    visitsByDay,
    checkInLocByDay,
    stationsByDay,
    pausesBySession: await openSessionPausesMap(),
    dayModesByKey: monthModes.get(userId),
  });

  // أيام الدفعة الرابعة: غير المؤكَّد والانتهاء بلا انصراف لكل يوم.
  const dayMetaByKey = new Map(
    monthDayRows.map((d) => [
      d.date.toISOString().slice(0, 10),
      { unconfirmedMinutes: d.unconfirmedMinutes, autoEnded: d.autoEnded, mode: d.mode, remoteAuthorizerLabel: d.remoteAuthorizerLabel },
    ]),
  );
  const monthUnconfirmed = monthDayRows.reduce((s, d) => s + d.unconfirmedMinutes, 0);

  const locationNames = new Map(
    (await getAllLocations()).map((l) => [l.id, l.name] as const),
  );

  /*
   * جلسات الشهر لأداة التصحيح (م٢ الثقة المتجددة) — تشمل المُبطلة عمدًا
   * (بخلاف استعلام الأيام أعلاه): المالك يحتاج يراها موسومة لا مخفية.
   * datetime-local يحتاج «رياض محلي» — نزيح ٣ ساعات ونقصّ (قاعدة gregory الصريح).
   */
  const KSA_MS = 3 * 60 * 60_000;
  const riyadhLocal = (d: Date) => new Date(d.getTime() + KSA_MS).toISOString().slice(0, 16);
  const repairSessions = (
    await prisma.attendanceSession.findMany({
      where: { userId, startedAt: { gte: range.start, lt: range.end } },
      orderBy: { startedAt: "desc" },
      take: 80,
    })
  ).map((s) => ({
    id: s.id,
    dayKey: ksaDayKey(s.startedAt),
    startedText: formatDateTime(s.startedAt),
    startedLocal: riyadhLocal(s.startedAt),
    endedText: s.endedAt ? formatTime(s.endedAt) : null,
    endedLocal: s.endedAt ? riyadhLocal(s.endedAt) : null,
    workedMinutes: s.workedMinutes,
    open: s.endedAt === null,
    autoClosed: s.autoClosed,
    closedBy: s.closedBy,
    voided: s.voided,
    // الافتراض المعروض للقفل: آخر إثبات حياة — وللقديمة null تُحسم على الخادم بآخر حدث بصم.
    lastAliveLocal: s.lastAliveAt ? riyadhLocal(s.lastAliveAt) : null,
    lastAliveText: s.lastAliveAt ? formatDateTime(s.lastAliveAt) : null,
  }));

  return {
    user: { id: user.id, name: user.name, role: user.role, active: user.active },
    month,
    schedule: {
      startMinutes: schedule?.startMinutes ?? DEFAULT_START_MINUTES,
      shiftMinutes: schedule?.shiftMinutes ?? DEFAULT_SHIFT_MINUTES,
      startWindowEndMinutes: schedule?.startWindowEndMinutes ?? null,
      isDefault: !schedule,
    },
    stats: {
      ...summarizeMonth(days),
      // الوقت غير المؤكَّد (الدفعة الرابعة) — يظهر رقمان: مؤكَّد وغير مؤكَّد.
      unconfirmedMinutes: monthUnconfirmed,
    },
    // السجل يُعرض من الأحدث للأقدم، والعطل الأسبوعية تُستثنى من العرض والحساب.
    days: days
      .filter((d) => d.status !== "WEEKEND")
      .map((d) => ({ ...d, ...(dayMetaByKey.get(d.key) ?? { unconfirmedMinutes: 0, autoEnded: false, mode: null, remoteAuthorizerLabel: null }) }))
      .reverse(),
    // جلسات الشهر لأداة التصحيح — تشمل المُبطلة موسومة (للمالك فقط).
    repairSessions,
    // سجل النبض الجغرافي — انتقالات النطاق (للمالك فقط).
    pulseLog: pulseLog.slice(0, 120),
    // الفحوص الصامتة — للمالك فقط (الصفحة خلف requireRole(OWNER)).
    silentChecks: silentChecks.map((c) => ({
      id: c.id,
      dayKey: ksaDayKey(c.at),
      atText: formatTime(c.at),
      outOfZone: c.outOfZone,
      distanceMeters: c.distanceMeters,
    })),
    // سجل التغييرات (append-only) — أحداث هذا الموظف؛ أحداث الاستثناءات تُرشَّح بهويته من الحمولة.
    audits: audits
      .filter((a) => {
        if (a.resourceType !== "attendance_exception") return true;
        const b = a.before as { userId?: string } | null;
        const f = a.after as { userId?: string } | null;
        return b?.userId === userId || f?.userId === userId;
      })
      .slice(0, 50)
      .map((a) => ({
        id: a.id,
        action: a.action,
        reason: a.reason,
        atText: formatDateTime(a.createdAt),
        actorRole: a.actorRole,
      })),
    exceptions: exceptions.map((e) => ({
      id: e.id,
      type: e.type,
      dateFromKey: e.dateFrom.toISOString().slice(0, 10),
      dateToKey: e.dateTo.toISOString().slice(0, 10),
      excuseUntilMinutes: e.excuseUntilMinutes,
      modifiedShiftMinutes: e.modifiedShiftMinutes,
      reason: e.reason,
    })),
    verifications: verifications.map((v) => ({
      id: v.id,
      status: v.status,
      scheduledAtText: formatTime(v.scheduledAt),
      dayKey: ksaDayKey(v.scheduledAt),
      respondedAtText: v.respondedAt ? formatTime(v.respondedAt) : null,
      locationName: v.locationId ? (locationNames.get(v.locationId) ?? null) : null,
      distanceMeters: v.distanceMeters,
    })),
  };
}

export type EmployeeFile = NonNullable<Awaited<ReturnType<typeof getEmployeeFile>>>;

/**
 * رادار المواقع الحية (الحضور بالرادار — ر٣) — الاستعلام المعكوس:
 * لكل موقع معتمد، من **آخر نبضته الجغرافية** كانت `inZone=true` لهذا الموقع
 * وحديثة (ضمن `radarFreshMinutes`) وله جلسة دوام مفتوحة = «حاضر بالرادار».
 *
 * يقلب المعادلة: بدل «أين الموظفون؟» → «كل موقع: من داخله الآن؟». من خرج من
 * الدائرة (آخر نبضته inZone=false) أو انقطع نبضه (أقدم من العتبة) يسقط فورًا —
 * فلا «مداوم» وهمي بنبضة قديمة. الحجم تافه (نبض الدقيقة × نافذة قصيرة).
 */
export async function getLocationRadar() {
  const settings = await getAttendanceSettings();
  const now = new Date();
  const fresh = new Date(now.getTime() - settings.radarFreshMinutes * 60_000);

  const [locations, pulses, openSessions] = await Promise.all([
    prisma.attendanceLocation.findMany({
      where: { isActive: true },
      select: { id: true, name: true, type: true },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    }),
    // نبضات النافذة كلها — مرتّبة تنازليًا فأول ظهور لكل مستخدم = أحدث نبضاته.
    prisma.attendancePulse.findMany({
      where: { at: { gte: fresh } },
      orderBy: { at: "desc" },
      select: { userId: true, at: true, inZone: true, locationId: true, user: { select: { name: true } } },
    }),
    prisma.attendanceSession.findMany({ where: { endedAt: null, voided: false }, select: { userId: true } }),
  ]);

  const onDuty = new Set(openSessions.map((s) => s.userId));
  const latestByUser = new Map<string, (typeof pulses)[number]>();
  for (const pl of pulses) if (!latestByUser.has(pl.userId)) latestByUser.set(pl.userId, pl);

  const byLocation = new Map<string, { userId: string; name: string; atText: string }[]>();
  for (const [userId, pl] of latestByUser) {
    // حاضر بالرادار: آخر نبضة داخل النطاق + جلسة مفتوحة.
    if (pl.inZone !== true || !pl.locationId || !onDuty.has(userId)) continue;
    const arr = byLocation.get(pl.locationId) ?? [];
    arr.push({ userId, name: pl.user.name ?? "—", atText: formatTime(pl.at) });
    byLocation.set(pl.locationId, arr);
  }

  const presentUserIds: string[] = [];
  for (const arr of byLocation.values()) for (const x of arr) presentUserIds.push(x.userId);

  return {
    generatedAtIso: now.toISOString(),
    radarFreshMinutes: settings.radarFreshMinutes,
    /** من يراهم النبض داخل موقع الآن — لربط «حاضر» بالبلاطة (بند ٤). */
    presentUserIds,
    locations: locations.map((l) => ({
      id: l.id,
      name: l.name,
      type: l.type,
      present: byLocation.get(l.id) ?? [],
    })),
  };
}

export type LocationRadar = Awaited<ReturnType<typeof getLocationRadar>>;

/**
 * سجل اليوم للموظف (الكرت المنسدل — التصميم الزجاجي) — جلب كسول للمالك:
 * حالة الموقع الحية + أجهزته النشطة + خط زمني مدموج للأحداث المهمة اليوم.
 *
 * النبضات المتتالية بنفس الحكم تُجمّع في مدخل واحد («داخل النطاق ٤٥د») لا
 * تُعرض كلها — الانتقالات فقط. المصادر: أحداث البصم + انتقالات النبض +
 * النداءات وردودها + القرارات + التوقفات، مرتّبة زمنيًا.
 */
export async function getEmployeeDayTimeline(userId: string, now: Date = new Date()) {
  const todayKey = ksaDayKey(now);
  const dayStart = new Date(`${todayKey}T00:00:00+03:00`);
  const settings = await getAttendanceSettings();
  const radarFresh = new Date(now.getTime() - settings.radarFreshMinutes * 60_000);

  const [events, pulses, verifs, decisions, pauses, deviceTokens, sessionDevices, locations] = await Promise.all([
    prisma.attendanceEvent.findMany({
      where: { userId, timestamp: { gte: dayStart } },
      orderBy: { timestamp: "asc" },
      include: { location: { select: { name: true, type: true } } },
    }),
    prisma.attendancePulse.findMany({
      where: { userId, at: { gte: dayStart } },
      orderBy: { at: "asc" },
      select: { at: true, inZone: true, locationId: true, location: { select: { name: true } } },
    }),
    prisma.attendanceVerification.findMany({
      where: { userId, scheduledAt: { gte: dayStart } },
      orderBy: { scheduledAt: "asc" },
      select: { kind: true, status: true, triggerReason: true, sentAt: true, respondedAt: true, scheduledAt: true },
    }),
    prisma.attendanceDecision.findMany({
      where: { userId, date: dayDateOf(todayKey) },
      orderBy: { decidedAt: "asc" },
    }),
    prisma.attendancePause.findMany({
      where: { userId, startedAt: { gte: dayStart } },
      orderBy: { startedAt: "asc" },
    }),
    // الأجهزة: توكنات FCM النشطة (تطبيق) — نبضة خلال ٣٠ دقيقة.
    prisma.deviceToken.findMany({
      where: { userId, lastSeenAt: { gte: new Date(now.getTime() - 30 * 60_000) } },
      select: { platform: true, lastSeenAt: true },
    }),
    // وصف المتصفح من session.device (AuditLog) النشط.
    prisma.auditLog.findMany({
      where: { action: "session.device", entityId: userId, createdAt: { gte: new Date(now.getTime() - 30 * 60_000) } },
      orderBy: { createdAt: "desc" },
      select: { summary: true, createdAt: true },
    }),
    getActiveLocations(),
  ]);

  // ===== حالة الموقع الحية (الرادار) =====
  const openSession = await prisma.attendanceSession.findFirst({ where: { userId, endedAt: null, voided: false }, select: { id: true } });
  const lastPulse = pulses[pulses.length - 1] ?? null;
  // مصدر واحد = الرادار: «بالموقع» نفس شرط getLocationRadar تمامًا (inZone=true + locationId +
  // جلسة مفتوحة + نبضة حديثة) فلا تناقض العلوية «بالموقع الآن». تمييز الضعف عن الانقطاع:
  // نبضة حديثة بحكم null (دقة غير كافية) = «غير دقيق»، أما غياب نبضة حديثة = «انقطع».
  const radarState: "present" | "out" | "weak" | "gap" | "off" =
    !openSession ? "off"
    : !lastPulse || lastPulse.at < radarFresh ? "gap" // جلسة مفتوحة لكن لا نبضة حديثة = انقطاع فعلي
    : lastPulse.inZone === true && lastPulse.locationId ? "present"
    : lastPulse.inZone === false ? "out"
    : "weak"; // نبضة حديثة لكن inZone=null (دقة ضعيفة/موقع IP) = موقع غير دقيق لا انقطاع
  const radarLocationName = radarState === "present" ? (lastPulse?.location?.name ?? null) : null;

  // ===== الأجهزة النشطة =====
  const devices: { kind: string; detail: string }[] = [];
  const appPlatforms = new Set(deviceTokens.map((d) => d.platform));
  if (appPlatforms.has("ios")) devices.push({ kind: "app", detail: "تطبيق آيفون" });
  if (appPlatforms.has("android")) devices.push({ kind: "app", detail: "تطبيق أندرويد" });
  // متصفح: نميّز «متصفح جوال» عن «كمبيوتر» من وصف deviceLabelFromUA (يبدأ بـ«جوال»/«كمبيوتر»).
  for (const sd of sessionDevices.slice(0, 2)) {
    devices.push({ kind: sd.summary.startsWith("جوال") ? "mobile-browser" : "computer", detail: sd.summary });
  }
  if (devices.length === 0) devices.push({ kind: "none", detail: "ما فيه جهاز نشط الآن" });

  // ===== الخط الزمني المدموج =====
  type Entry = { at: Date; icon: string; text: string; tone: "gold" | "green" | "red" | "amber" | "muted" };
  const entries: Entry[] = [];

  for (const e of events) {
    if (e.type === AttendanceEventType.CHECK_IN) {
      const auto = e.source === "AUTO_GEO";
      entries.push({ at: e.timestamp, icon: "login", tone: "green", text: `${auto ? "بصم تلقائي" : "تسجيل حضور"}${e.location ? ` · ${e.location.name}` : ""}${e.isLate ? " · متأخر" : ""}` });
    } else if (e.type === AttendanceEventType.CHECK_OUT) {
      entries.push({ at: e.timestamp, icon: "logout", tone: "muted", text: `تسجيل انصراف${e.location ? ` · ${e.location.name}` : ""}` });
    } else if (e.type === AttendanceEventType.LOCATION_CHANGE) {
      entries.push({ at: e.timestamp, icon: "pin", tone: e.outOfZone ? "red" : "gold", text: e.outOfZone ? "تغيير موقع · خارج النطاق" : `انتقل إلى ${e.location?.name ?? "موقع"}` });
    }
  }

  // انتقالات النبض فقط (تغيّر الحكم) — النبضات المتتالية مجمّعة ضمنيًا.
  let lastState: boolean | null | undefined = undefined;
  for (const pl of pulses) {
    if (pl.inZone === lastState) continue;
    lastState = pl.inZone;
    if (pl.inZone === true) entries.push({ at: pl.at, icon: "radar", tone: "green", text: `دخل نطاق ${pl.location?.name ?? "الموقع"}` });
    else if (pl.inZone === false) entries.push({ at: pl.at, icon: "radar", tone: "red", text: "خرج من النطاق" });
  }

  for (const v of verifs) {
    if (v.sentAt) entries.push({ at: v.sentAt, icon: "bell", tone: "amber", text: v.triggerReason ? "نداء تحقق مشروط" : "نداء تحقق" });
    if (v.respondedAt) {
      const ok = v.status === "CONFIRMED" || v.status === "EN_ROUTE";
      entries.push({ at: v.respondedAt, icon: ok ? "check" : "x", tone: ok ? "green" : "red", text: ok ? "أكّد موقعه" : "رد خارج النطاق" });
    }
  }

  const DECISION_TEXT: Record<string, string> = { ON_WAY: "أعلن: بالطريق", LEAVE: "أعلن: إجازة اليوم", EXCUSED: "أعلن: مستأذن", REMOTE: "أعلن: عن بُعد" };
  for (const d of decisions) {
    entries.push({ at: d.decidedAt, icon: "clock", tone: "gold", text: `${DECISION_TEXT[d.kind] ?? "قرار"}${d.authorizerLabel ? ` · بإذن ${d.authorizerLabel}` : ""}` });
    if (d.outcome === "ARRIVED_AUTO" && d.resolvedAt) entries.push({ at: d.resolvedAt, icon: "login", tone: "green", text: "وصل فبُصم تلقائيًا" });
  }

  for (const ps of pauses) {
    const label = ps.kind === "NO_RESPONSE" ? "توقف — بلا رد" : ps.kind === "LEFT" ? "توقف — مغادرة" : "توقف — استئذان";
    entries.push({ at: ps.startedAt, icon: "pause", tone: "amber", text: `${label}${ps.authorizerLabel ? ` · ${ps.authorizerLabel}` : ""}` });
    if (ps.endedAt) entries.push({ at: ps.endedAt, icon: "play", tone: "green", text: "رجع — استأنف دوامه" });
  }

  entries.sort((a, b) => a.at.getTime() - b.at.getTime());

  return {
    radar: { state: radarState, locationName: radarLocationName },
    devices,
    timeline: entries.map((e) => ({ atText: formatTime(e.at), icon: e.icon, text: e.text, tone: e.tone })),
    locationsCount: locations.length,
  };
}

export type EmployeeDayTimeline = Awaited<ReturnType<typeof getEmployeeDayTimeline>>;

/** ملخص الفريق لشهر: أيام/ساعات/تأخير/غياب لكل موظف + بداية دوامه. */
export async function getTeamSummary(month: string) {
  const range = monthRangeKSA(month);
  if (!range) return [];
  const now = new Date();

  const [users, sessions, exceptions, schedules, settings, pausesBySession, monthModes, unconfirmedAgg] =
    await Promise.all([
      prisma.user.findMany({
        where: { role: { in: [Role.EMPLOYEE, Role.ADMIN] }, active: true },
        select: { id: true, name: true, role: true },
        orderBy: { name: "asc" },
      }),
      prisma.attendanceSession.findMany({
        where: { startedAt: { gte: range.start, lt: range.end }, voided: false },
        orderBy: { startedAt: "asc" },
      }),
      exceptionsOverlapping(undefined, `${month}-01`, monthLastDayKey(month)),
      prisma.attendanceSchedule.findMany(),
      getAttendanceSettings(),
      openSessionPausesMap(),
      dayModesByUserMap(`${month}-01`, monthLastDayKey(month)),
      prisma.attendanceDay.groupBy({
        by: ["userId"],
        where: { date: { gte: dayDateOf(`${month}-01`), lte: dayDateOf(monthLastDayKey(month)) } },
        _sum: { unconfirmedMinutes: true },
      }),
    ]);

  const weekend = parseWeekendDays(settings.weekendDays);
  const scheduleByUser = new Map(schedules.map((s) => [s.userId, s]));
  const unconfirmedByUser = new Map(unconfirmedAgg.map((a) => [a.userId, a._sum.unconfirmedMinutes ?? 0]));

  return users.map((u) => {
    const days = buildDaysLog({
      days: monthDaysKSA(month, now),
      now,
      schedule: scheduleByUser.get(u.id),
      exceptions: exceptions.filter((e) => e.userId === u.id),
      sessions: sessions.filter((s) => s.userId === u.id),
      weekend,
      pausesBySession,
      dayModesByKey: monthModes.get(u.id),
    });
    const monthKey = `${month}-01`;
    const totals = summarizeMonth(days);
    const unconfirmed = Math.min(unconfirmedByUser.get(u.id) ?? 0, totals.totalMinutes);
    return {
      id: u.id,
      name: u.name,
      role: u.role,
      startMinutes: scheduleByUser.get(u.id)?.startMinutes ?? DEFAULT_START_MINUTES,
      startText: formatTime(minutesToDate(monthKey, scheduleByUser.get(u.id)?.startMinutes ?? DEFAULT_START_MINUTES)),
      ...totals,
      // نسبة التأكيد الشهرية (الدفعة الرابعة): المؤكَّد ÷ الكل.
      unconfirmedMinutes: unconfirmed,
      confirmationPct:
        totals.totalMinutes > 0 ? Math.round(((totals.totalMinutes - unconfirmed) / totals.totalMinutes) * 100) : 100,
      remoteDays: days.filter((d) => d.status === "REMOTE").length,
    };
  });
}

export type TeamSummaryRow = Awaited<ReturnType<typeof getTeamSummary>>[number];
