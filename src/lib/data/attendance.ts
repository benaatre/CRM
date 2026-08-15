import "server-only";
import { AttendanceEventType, Role } from "@prisma/client";
import type { AttendanceException, AttendanceSession } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { dayStartKSA, ksaDayKey, ksaDayOfWeek, ksaMinutesOfDay } from "@/lib/ksa-time";
import { formatDate, formatTime } from "@/lib/format";
import {
  DEFAULT_SHIFT_MINUTES,
  DEFAULT_START_MINUTES,
  activeWorkedMinutes,
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

  const [openSession, todaySession, todayEvents, eff, todayVerifs] = await Promise.all([
    prisma.attendanceSession.findFirst({
      where: { userId, endedAt: null },
      orderBy: { startedAt: "desc" },
    }),
    prisma.attendanceSession.findFirst({
      where: { userId, startedAt: { gte: dayStart } },
      orderBy: { startedAt: "desc" },
    }),
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
  ]);

  const session = openSession ?? todaySession;
  const state: AttendanceState = openSession ? "in" : todaySession ? "out" : "none";

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
    // نهاية دوامه تتأخر بمقدار التوقف — البداية + الهدف + المخصوم حتى الآن.
    shiftEndText: openSession
      ? formatTime(
          new Date(
            openSession.startedAt.getTime() +
              eff.targetMinutes * 60_000 +
              pausedMsBase +
              (activePause ? now.getTime() - activePause.startedAt.getTime() : 0),
          ),
        )
      : null,
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
      where: { OR: [{ startedAt: { gte: dayStart } }, { endedAt: null }] },
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

/** حالة بلاطة «البلاط الموحّد» — ست حالات بألوان هالتها (paused من الدفعة الثالثة). */
export type TileState = "on" | "late" | "paused" | "miss" | "exc" | "done";

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

  const [users, sessions, events, schedules, settings, exceptions, verifications, pauses] = await Promise.all([
    prisma.user.findMany({
      where: { role: { in: [Role.EMPLOYEE, Role.ADMIN] }, active: true },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    }),
    // جلسات النافذة التاريخية كلها + أي جلسة مفتوحة (ولو بدأت قبلها)
    prisma.attendanceSession.findMany({
      where: { OR: [{ startedAt: { gte: histStart } }, { endedAt: null }] },
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

    // ===== حالة البلاطة — التوقف يتقدم على المداومة =====
    const state: TileState = open
      ? activePause
        ? "paused"
        : open.wasLate
          ? "late"
          : "on"
      : closedToday.length > 0
        ? "done"
        : eff.onLeave || eff.isWeekend || eff.hasExcuse || eff.modifiedShift
          ? "exc"
          : "miss";

    const doneMinutes = closedToday.reduce((sum, s) => sum + (s.workedMinutes ?? 0), 0);
    const lastClosed = closedToday[closedToday.length - 1] ?? null;
    const checkInMin = open ? ksaMinutesOfDay(open.startedAt) : null;
    const todayException = myExceptions.find((e) => exceptionCoversToday(e, todayKey)) ?? null;

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
      // مداوم/متأخر/موقوف
      startedAtIso: open ? open.startedAt.toISOString() : null,
      // نهاية دوامه تتأخر بمقدار التوقف المخصوم حتى الآن.
      endsAtText: open
        ? formatTime(
            new Date(
              open.startedAt.getTime() +
                eff.targetMinutes * 60_000 +
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
      lateMinutes:
        open && open.wasLate && checkInMin != null ? Math.max(0, checkInMin - eff.accountStartMinutes) : null,
      earlyIn: open ? (checkInMin ?? 0) < eff.startMinutes : false,
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
      // مشترك
      monthStats,
      verification,
      outOfZoneToday: myEvents.some((e) => e.outOfZone),
    };
  });

  // الترتيب المعتمد: متأخر → مداوم → موقوف → لم يسجّل (الأكثر تأخيرًا أولًا) → مستثنى → أنهى.
  const order: Record<TileState, number> = { late: 0, on: 1, paused: 2, miss: 3, exc: 4, done: 5 };
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
      where: { startedAt: { gte: bounds.start, lt: bounds.end } },
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

    // جلسة مفتوحة: المنجز حتى الآن صافيًا من التوقف — عبر الدالة المشتركة وحدها.
    const workedMinutes = daySessions.reduce(
      (sum, s) =>
        sum +
        (s.workedMinutes ??
          (s.endedAt === null
            ? activeWorkedMinutes(s.startedAt, null, args.pausesBySession?.get(s.id) ?? [], now)
            : 0)),
      0,
    );

    const status = dayStatus({
      eff,
      workedMinutes,
      hasSession: daySessions.length > 0,
      hasOpenSession: open !== null,
      isToday: day.key === todayKey,
      isPast: day.key < todayKey,
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

  const [sessions, events, exceptions, verifications] = await Promise.all([
    prisma.attendanceSession.findMany({
      where: { userId, startedAt: { gte: range.start, lt: range.end } },
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
  ]);

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
  });

  const locationNames = new Map(
    (await getAllLocations()).map((l) => [l.id, l.name] as const),
  );

  return {
    user: { id: user.id, name: user.name, role: user.role, active: user.active },
    month,
    schedule: {
      startMinutes: schedule?.startMinutes ?? DEFAULT_START_MINUTES,
      shiftMinutes: schedule?.shiftMinutes ?? DEFAULT_SHIFT_MINUTES,
      isDefault: !schedule,
    },
    stats: summarizeMonth(days),
    // السجل يُعرض من الأحدث للأقدم، والعطل الأسبوعية تُستثنى من العرض والحساب.
    days: days.filter((d) => d.status !== "WEEKEND").reverse(),
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

/** ملخص الفريق لشهر: أيام/ساعات/تأخير/غياب لكل موظف + بداية دوامه. */
export async function getTeamSummary(month: string) {
  const range = monthRangeKSA(month);
  if (!range) return [];
  const now = new Date();

  const [users, sessions, exceptions, schedules, settings, pausesBySession] = await Promise.all([
    prisma.user.findMany({
      where: { role: { in: [Role.EMPLOYEE, Role.ADMIN] }, active: true },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    }),
    prisma.attendanceSession.findMany({
      where: { startedAt: { gte: range.start, lt: range.end } },
      orderBy: { startedAt: "asc" },
    }),
    exceptionsOverlapping(undefined, `${month}-01`, monthLastDayKey(month)),
    prisma.attendanceSchedule.findMany(),
    getAttendanceSettings(),
    openSessionPausesMap(),
  ]);

  const weekend = parseWeekendDays(settings.weekendDays);
  const scheduleByUser = new Map(schedules.map((s) => [s.userId, s]));

  return users.map((u) => {
    const days = buildDaysLog({
      days: monthDaysKSA(month, now),
      now,
      schedule: scheduleByUser.get(u.id),
      exceptions: exceptions.filter((e) => e.userId === u.id),
      sessions: sessions.filter((s) => s.userId === u.id),
      weekend,
      pausesBySession,
    });
    const monthKey = `${month}-01`;
    return {
      id: u.id,
      name: u.name,
      role: u.role,
      startMinutes: scheduleByUser.get(u.id)?.startMinutes ?? DEFAULT_START_MINUTES,
      startText: formatTime(minutesToDate(monthKey, scheduleByUser.get(u.id)?.startMinutes ?? DEFAULT_START_MINUTES)),
      ...summarizeMonth(days),
    };
  });
}

export type TeamSummaryRow = Awaited<ReturnType<typeof getTeamSummary>>[number];
