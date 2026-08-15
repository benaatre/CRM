import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isCronAuthorized } from "@/lib/cron-auth";
import { dayStartKSA, ksaDayKey, ksaDayOfWeek, ksaMinutesOfDay } from "@/lib/ksa-time";
import { formatTime } from "@/lib/format";
import { getAttendanceSettings } from "@/lib/data/attendance";
import { effectiveDay, minutesToDate, parseWeekendDays } from "@/lib/attendance-logic";
import { durationArabic, noShowText, verifyMissedText } from "@/lib/attendance-notify";
import { notify, ownerIds } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * كرون حوكمة الدوام — يُنادى كل ٥ دقائق من كرون Hostinger (تعبير الكرون: نجمة/5):
 *   curl -s -X POST -H "x-cron-secret: YOUR_SECRET" https://crm.benaatre.com/api/attendance/cron
 *
 * المهام الأربع في كل نداء:
 *   ١) نداءات PENDING حان وقتها → إرسال push للموظف وتحويلها SENT بمهلة رد.
 *   ٢) نداءات SENT تجاوزت مهلتها → MISSED + إشعار المالك.
 *   ٣) «لم يداوم»: يوم عمل مرّت noShowAfterMinutes من بداية دوامه بلا جلسة → إشعار المالك مرة باليوم.
 *   ٤) إقفال الجلسات المنسية (autoClosed) عند نهاية نافذة الشركة/الدوام الشخصي.
 *
 * الحماية: هيدر `x-cron-secret` يطابق CRON_SECRET (حسب التصميم المعتمد)،
 * ويُقبل أيضًا `Authorization: Bearer` كبقية مسارات الكرون في الريبو.
 */
function authorized(req: Request): boolean {
  if (isCronAuthorized(req, process.env.CRON_SECRET)) return true;
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get("x-cron-secret");
  if (!secret || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

type Settings = Awaited<ReturnType<typeof getAttendanceSettings>>;

/** ١) إرسال النداءات التي حان وقتها — فقط لمن ما زال مداومًا. */
async function sendDueVerifications(now: Date, settings: Settings): Promise<number> {
  const due = await prisma.attendanceVerification.findMany({
    where: { status: "PENDING", scheduledAt: { lte: now } },
  });
  if (due.length === 0) return 0;

  const openSessions = await prisma.attendanceSession.findMany({
    where: { endedAt: null, userId: { in: [...new Set(due.map((v) => v.userId))] } },
    select: { userId: true },
  });
  const onDuty = new Set(openSessions.map((s) => s.userId));

  let sent = 0;
  for (const v of due) {
    // انصرف أو أُقفلت جلسته قبل إرسال النداء — النداء صار بلا معنى.
    if (!onDuty.has(v.userId)) {
      await prisma.attendanceVerification.delete({ where: { id: v.id } });
      continue;
    }
    const deadlineAt = new Date(now.getTime() + settings.verificationWindowMinutes * 60_000);
    await prisma.attendanceVerification.update({
      where: { id: v.id },
      data: { status: "SENT", sentAt: now, deadlineAt },
    });
    await notify(
      prisma,
      [v.userId],
      "attendance.verify",
      "نداء تحقق — أكّد موقعك الآن",
      `افتح التطبيق وأكّد موقعك خلال ${durationArabic(settings.verificationWindowMinutes)}`,
      "/m",
    );
    sent++;
  }
  return sent;
}

/** ٢) النداءات التي فاتت مهلتها → MISSED + إشعار المالك بآخر موقع معروف. */
async function expireMissedVerifications(now: Date): Promise<number> {
  const expired = await prisma.attendanceVerification.findMany({
    where: { status: "SENT", deadlineAt: { lt: now } },
    include: { user: { select: { name: true } } },
  });

  for (const v of expired) {
    await prisma.attendanceVerification.update({ where: { id: v.id }, data: { status: "MISSED" } });
    const lastEvent = await prisma.attendanceEvent.findFirst({
      where: { userId: v.userId },
      orderBy: { timestamp: "desc" },
      include: { location: { select: { name: true } } },
    });
    await notify(
      prisma,
      await ownerIds(prisma),
      "attendance.verify_missed",
      verifyMissedText(
        v.user.name,
        lastEvent
          ? { locationName: lastEvent.location?.name ?? null, timeText: formatTime(lastEvent.timestamp) }
          : null,
      ),
      undefined,
      `/attendance/${v.userId}`,
    );
  }
  return expired.length;
}

/** ٣) «لم يداوم» — إشعار المالك مرة واحدة يوميًا لكل موظف يوم عملٍ تغيّب عن بدايته. */
async function checkNoShows(now: Date, settings: Settings): Promise<number> {
  const todayKey = ksaDayKey(now);
  const dayStart = dayStartKSA(now);
  const weekend = parseWeekendDays(settings.weekendDays);
  const dow = ksaDayOfWeek(now);
  const nowMinutes = ksaMinutesOfDay(now);

  const [users, schedules, exceptions, sessions] = await Promise.all([
    prisma.user.findMany({
      where: { role: { in: [Role.EMPLOYEE, Role.ADMIN] }, active: true },
      select: { id: true, name: true },
    }),
    prisma.attendanceSchedule.findMany(),
    prisma.attendanceException.findMany({
      where: {
        dateFrom: { lte: new Date(`${todayKey}T00:00:00Z`) },
        dateTo: { gte: new Date(`${todayKey}T00:00:00Z`) },
      },
    }),
    prisma.attendanceSession.findMany({
      where: { OR: [{ startedAt: { gte: dayStart } }, { endedAt: null }] },
      select: { userId: true },
    }),
  ]);

  const scheduleByUser = new Map(schedules.map((s) => [s.userId, s]));
  const attended = new Set(sessions.map((s) => s.userId));
  const owners = await ownerIds(prisma);

  let alerted = 0;
  for (const u of users) {
    if (attended.has(u.id)) continue;
    const eff = effectiveDay(
      scheduleByUser.get(u.id),
      exceptions.filter((e) => e.userId === u.id),
      todayKey,
      dow,
      weekend,
    );
    if (eff.isWeekend || eff.onLeave) continue;
    // الاستئذان يؤخّر بداية المحاسبة — لا ننذر «لم يداوم» وهو معذور.
    if (nowMinutes < eff.accountStartMinutes + settings.noShowAfterMinutes) continue;

    // مرة واحدة يوميًا: صف إشعار اليوم بنفس النوع والرابط يعني أُنذر عنه.
    const already = await prisma.notification.findFirst({
      where: { type: "attendance.no_show", link: `/attendance/${u.id}`, createdAt: { gte: dayStart } },
      select: { id: true },
    });
    if (already) continue;

    await notify(
      prisma,
      owners,
      "attendance.no_show",
      noShowText(u.name, nowMinutes - eff.accountStartMinutes),
      undefined,
      `/attendance/${u.id}`,
    );
    alerted++;
  }
  return alerted;
}

/**
 * ٤) إقفال الجلسات المنسية: بعد مضيّ ساعة سماح على أبعد الحدّين (نهاية نافذة
 * الشركة / نهاية دوامه المحدد) تُقفل الجلسة عند ذلك الحد لا عند «الآن» — فلا
 * تتضخم الساعات بنسيان الانصراف. ساعة السماح تحفظ «مشى متأخر» لمن انصرف فعلًا.
 */
async function autoCloseForgotten(now: Date, settings: Settings): Promise<number> {
  const GRACE_MS = 60 * 60_000;
  const open = await prisma.attendanceSession.findMany({ where: { endedAt: null } });
  if (open.length === 0) return 0;

  const weekend = parseWeekendDays(settings.weekendDays);
  const schedules = await prisma.attendanceSchedule.findMany({
    where: { userId: { in: [...new Set(open.map((s) => s.userId))] } },
  });
  const scheduleByUser = new Map(schedules.map((s) => [s.userId, s]));

  let closed = 0;
  for (const s of open) {
    const dayKey = ksaDayKey(s.startedAt);
    const exceptions = await prisma.attendanceException.findMany({
      where: {
        userId: s.userId,
        dateFrom: { lte: new Date(`${dayKey}T00:00:00Z`) },
        dateTo: { gte: new Date(`${dayKey}T00:00:00Z`) },
      },
    });
    const eff = effectiveDay(
      scheduleByUser.get(s.userId),
      exceptions,
      dayKey,
      ksaDayOfWeek(s.startedAt),
      weekend,
    );
    const personalEnd = s.startedAt.getTime() + eff.targetMinutes * 60_000;
    const companyEnd = minutesToDate(dayKey, settings.workEndMinutes).getTime();
    const closeAt = Math.max(personalEnd, companyEnd);
    if (now.getTime() < closeAt + GRACE_MS) continue;

    await prisma.$transaction(async (tx) => {
      await tx.attendanceSession.update({
        where: { id: s.id },
        data: {
          endedAt: new Date(closeAt),
          workedMinutes: Math.max(0, Math.round((closeAt - s.startedAt.getTime()) / 60_000)),
          autoClosed: true,
        },
      });
      await tx.attendanceVerification.deleteMany({ where: { userId: s.userId, status: "PENDING" } });
    });
    closed++;
  }
  return closed;
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "غير مصرّح" }, { status: 401 });
  }

  const now = new Date();
  const settings = await getAttendanceSettings();

  // نعزل فشل كل مهمة ونبلّغ عنه بدل ابتلاعه — نفس نمط notify-scheduled.
  const results = await Promise.allSettled([
    sendDueVerifications(now, settings),
    expireMissedVerifications(now),
    checkNoShows(now, settings),
    autoCloseForgotten(now, settings),
  ]);
  const names = ["verifySent", "verifyMissed", "noShow", "autoClosed"] as const;
  const counts = { verifySent: 0, verifyMissed: 0, noShow: 0, autoClosed: 0 };
  const failed: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") counts[names[i]] = r.value;
    else {
      failed.push(names[i]);
      console.error(`[attendance-cron] ${names[i]}`, r.reason);
    }
  });

  return NextResponse.json(
    { ok: failed.length === 0, ...counts, ...(failed.length ? { failed } : {}) },
    { status: failed.length ? 500 : 200 },
  );
}
