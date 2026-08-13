import "server-only";
import { AttendanceEventType, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { dayStartKSA } from "@/lib/ksa-time";
import { formatTime } from "@/lib/format";

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

  const [openSession, todaySession, todayEvents] = await Promise.all([
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
