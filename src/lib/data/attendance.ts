import "server-only";
import { AttendanceEventType, Role } from "@prisma/client";
import type { AttendanceException, AttendanceSession } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { dayStartKSA, ksaDayKey, ksaDayOfWeek, ksaMinutesOfDay } from "@/lib/ksa-time";
import { formatTime } from "@/lib/format";
import {
  DEFAULT_SHIFT_MINUTES,
  DEFAULT_START_MINUTES,
  dayStatus,
  effectiveDay,
  minutesToDate,
  monthDaysKSA,
  monthLastDayKey,
  monthRangeKSA,
  parseWeekendDays,
  type DayStatus,
  type EffectiveDay,
} from "@/lib/attendance-logic";

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

  const [openSession, todaySession, todayEvents, eff] = await Promise.all([
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
      include: { location: { select: { name: true } } },
    }),
    getEffectiveDayFor(userId),
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
     * الهدف). العميل يحسب المنجز/الباقي كل دقيقة من startedAt — لا عدّاد سيرفر.
     */
    targetMinutes: eff.targetMinutes,
    shiftEndText: openSession
      ? formatTime(new Date(openSession.startedAt.getTime() + eff.targetMinutes * 60_000))
      : null,
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

/** وسوم بطاقة «مداوم الآن» — عرض فقط، ليست مخالفات. */
export type LiveState = "on" | "done" | "leave" | "none";

/**
 * لوحة «مداوم الآن»: لكل مداوم بيانات العداد (البداية/الهدف/نهاية دوامه)
 * والتقدم والوسوم؛ ولغير المداومين حالتهم (لم يسجّل/منصرف/إجازة).
 * العميل يحرّك العداد كل دقيقة من `startedAtIso` — السيرفر لا يرسل «الباقي».
 */
export async function getLiveBoard() {
  const now = new Date();
  const dayStart = dayStartKSA(now);
  const todayKey = ksaDayKey(now);

  const [users, sessions, events, schedules, settings, exceptions] = await Promise.all([
    prisma.user.findMany({
      where: { role: { in: [Role.EMPLOYEE, Role.ADMIN] }, active: true },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    }),
    prisma.attendanceSession.findMany({
      where: { OR: [{ startedAt: { gte: dayStart } }, { endedAt: null }] },
      orderBy: { startedAt: "asc" },
    }),
    prisma.attendanceEvent.findMany({
      where: { timestamp: { gte: dayStart } },
      orderBy: { timestamp: "desc" },
      include: { location: { select: { name: true } } },
    }),
    prisma.attendanceSchedule.findMany(),
    getAttendanceSettings(),
    exceptionsOverlapping(undefined, todayKey, todayKey),
  ]);

  const weekend = parseWeekendDays(settings.weekendDays);
  const dow = ksaDayOfWeek(now);
  const scheduleByUser = new Map(schedules.map((s) => [s.userId, s]));

  return users.map((u) => {
    const eff = effectiveDay(
      scheduleByUser.get(u.id),
      exceptions.filter((e) => e.userId === u.id),
      todayKey,
      dow,
      weekend,
    );

    const mine = sessions.filter((s) => s.userId === u.id);
    const open = mine.find((s) => s.endedAt === null) ?? null;
    const closedToday = mine.filter((s) => s.endedAt !== null && s.startedAt >= dayStart);

    // زيارة مشروع مفتوحة ⟺ آخر بصمة مشروع اليوم دخول لا خروج (نفس قاعدة getMyAttendanceStatus).
    const lastProject = events.find(
      (e) =>
        e.userId === u.id &&
        (e.type === AttendanceEventType.PROJECT_IN || e.type === AttendanceEventType.PROJECT_OUT),
    );
    const inProject = lastProject?.type === AttendanceEventType.PROJECT_IN;

    const state: LiveState = open ? "on" : closedToday.length > 0 ? "done" : eff.onLeave ? "leave" : "none";

    let checkInLocationName: string | null = null;
    if (open) {
      const checkInEvent = events.find((e) => e.id === open.checkInEventId);
      checkInLocationName = checkInEvent?.location?.name ?? null;
    }

    const doneMinutes = closedToday.reduce((sum, s) => sum + (s.workedMinutes ?? 0), 0);
    const lastClosed = closedToday[closedToday.length - 1] ?? null;

    return {
      id: u.id,
      name: u.name,
      role: u.role,
      state,
      targetMinutes: eff.targetMinutes,
      scheduledStartText: formatTime(minutesToDate(todayKey, eff.startMinutes)),
      // ===== مداوم الآن =====
      startedAtIso: open ? open.startedAt.toISOString() : null,
      startedAtText: open ? formatTime(open.startedAt) : null,
      endsAtText: open
        ? formatTime(new Date(open.startedAt.getTime() + eff.targetMinutes * 60_000))
        : null,
      locationName: checkInLocationName,
      wasLate: open?.wasLate ?? false,
      earlyIn: open ? ksaMinutesOfDay(open.startedAt) < eff.startMinutes : false,
      inProject,
      projectName: inProject ? (lastProject?.location?.name ?? null) : null,
      // ===== منصرف =====
      doneMinutes: state === "done" ? doneMinutes : null,
      endedAtText: lastClosed?.endedAt ? formatTime(lastClosed.endedAt) : null,
      outOfZoneToday: events.some((e) => e.userId === u.id && e.outOfZone),
    };
  });
}

export type LiveBoardRow = Awaited<ReturnType<typeof getLiveBoard>>[number];

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
};

/**
 * يبني سجل أيام شهر لمستخدم من بيانات مجلوبة مسبقًا — مشترك بين ملف الموظف
 * (كل التفاصيل) وملخص الفريق (الإجماليات فقط) كي لا تفترق الأرقام بينهما.
 */
function buildMonthLog(args: {
  month: string;
  now: Date;
  schedule: { startMinutes: number; shiftMinutes: number } | null | undefined;
  exceptions: AttendanceException[];
  sessions: AttendanceSession[];
  weekend: Set<number>;
  visitsByDay?: Map<string, string[]>;
  checkInLocByDay?: Map<string, string | null>;
}): DayLogEntry[] {
  const { month, now, schedule, exceptions, sessions, weekend } = args;
  const todayKey = ksaDayKey(now);
  const byDay = groupSessionsByDay(sessions);

  return monthDaysKSA(month, now).map((day) => {
    const eff = effectiveDay(schedule, exceptions, day.key, day.dayOfWeek, weekend);
    const daySessions = byDay.get(day.key) ?? [];
    const open = daySessions.find((s) => s.endedAt === null) ?? null;
    const first = daySessions[0] ?? null;
    const lastClosed = [...daySessions].reverse().find((s) => s.endedAt !== null) ?? null;

    // جلسة مفتوحة: المنجز حتى الآن — لا ننتظر الانصراف ليتحرك الرقم.
    const workedMinutes = daySessions.reduce(
      (sum, s) =>
        sum +
        (s.workedMinutes ??
          (s.endedAt === null ? Math.max(0, Math.round((now.getTime() - s.startedAt.getTime()) / 60_000)) : 0)),
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
      include: { location: { select: { name: true } } },
    }),
    exceptionsOverlapping(userId, `${month}-01`, monthLastDayKey(month)),
    prisma.attendanceVerification.findMany({
      where: { userId, scheduledAt: { gte: range.start, lt: range.end } },
      orderBy: { scheduledAt: "desc" },
    }),
  ]);

  // زيارات المشاريع لكل يوم (أسماء بلا تكرار) + موقع بصمة الحضور لكل يوم.
  const visitsByDay = new Map<string, string[]>();
  const checkInLocByDay = new Map<string, string | null>();
  for (const e of events) {
    const key = ksaDayKey(e.timestamp);
    if (e.type === AttendanceEventType.PROJECT_IN && e.location?.name) {
      const list = visitsByDay.get(key) ?? [];
      if (!list.includes(e.location.name)) list.push(e.location.name);
      visitsByDay.set(key, list);
    }
    if (e.type === AttendanceEventType.CHECK_IN && !e.outOfZone && !checkInLocByDay.has(key)) {
      checkInLocByDay.set(key, e.location?.name ?? null);
    }
  }

  const days = buildMonthLog({
    month,
    now,
    schedule,
    exceptions,
    sessions,
    weekend: parseWeekendDays(settings.weekendDays),
    visitsByDay,
    checkInLocByDay,
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

  const [users, sessions, exceptions, schedules, settings] = await Promise.all([
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
  ]);

  const weekend = parseWeekendDays(settings.weekendDays);
  const scheduleByUser = new Map(schedules.map((s) => [s.userId, s]));

  return users.map((u) => {
    const days = buildMonthLog({
      month,
      now,
      schedule: scheduleByUser.get(u.id),
      exceptions: exceptions.filter((e) => e.userId === u.id),
      sessions: sessions.filter((s) => s.userId === u.id),
      weekend,
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
