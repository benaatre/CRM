import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isCronAuthorized } from "@/lib/cron-auth";
import { dayStartKSA, ksaDayKey, ksaDayOfWeek, ksaMinutesOfDay } from "@/lib/ksa-time";
import { formatTime } from "@/lib/format";
import { getAttendanceSettings } from "@/lib/data/attendance";
import { activeWorkedMinutes, effectiveDay, minutesToDate, parseWeekendDays } from "@/lib/attendance-logic";
import {
  PAUSE_REMINDER_TEXT,
  arrivalMissedText,
  durationArabic,
  noShowText,
  verifyMissedText,
} from "@/lib/attendance-notify";
import { notify, ownerIds } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * كرون حوكمة الدوام — يُنادى كل ٥ دقائق من كرون Hostinger (تعبير الكرون: نجمة/5):
 *   curl -s -X POST -H "x-cron-secret: YOUR_SECRET" https://crm.benaatre.com/api/attendance/cron
 *
 * المهام الخمس في كل نداء:
 *   ١) نداءات PENDING حان وقتها → إرسال push للموظف وتحويلها SENT بمهلة رد.
 *   ٢) نداءات SENT تجاوزت مهلتها → MISSED + إشعار المالك.
 *   ٣) «لم يداوم»: يوم عمل مرّت noShowAfterMinutes من بداية دوامه بلا جلسة → إشعار المالك مرة باليوم.
 *   ٤) إقفال الجلسات المنسية (autoClosed) عند نهاية نافذة الشركة/الدوام الشخصي.
 *   ٥) تذكير الموقوف «لا زلت مستأذنًا — رجعت؟» بعد ساعة، ومرة ثانية أخيرة بعد ساعة إضافية.
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

/**
 * ١) إرسال النداءات التي حان وقتها — فقط لمن ما زال مداومًا، **ولا نداء لموظف
 * في حالة توقف** (عدّاده واقف أصلًا — يبقى النداء معلّقًا حتى يرجع).
 * نداء الوصول (ARRIVAL) له نصّه الخاص «وصلت المشروع؟».
 */
async function sendDueVerifications(now: Date, settings: Settings): Promise<number> {
  const due = await prisma.attendanceVerification.findMany({
    where: { status: "PENDING", scheduledAt: { lte: now } },
  });
  if (due.length === 0) return 0;

  const userIds = [...new Set(due.map((v) => v.userId))];
  const [openSessions, activePauses] = await Promise.all([
    prisma.attendanceSession.findMany({
      where: { endedAt: null, userId: { in: userIds } },
      select: { userId: true },
    }),
    prisma.attendancePause.findMany({
      where: { endedAt: null, userId: { in: userIds }, session: { endedAt: null } },
      select: { userId: true },
    }),
  ]);
  const onDuty = new Set(openSessions.map((s) => s.userId));
  const paused = new Set(activePauses.map((p) => p.userId));

  let sent = 0;
  for (const v of due) {
    // انصرف أو أُقفلت جلسته قبل إرسال النداء — النداء صار بلا معنى.
    if (!onDuty.has(v.userId)) {
      await prisma.attendanceVerification.delete({ where: { id: v.id } });
      continue;
    }
    // موقوف — يبقى PENDING ويُرسل بعد رجوعه في نداء الكرون التالي.
    if (paused.has(v.userId)) continue;

    const deadlineAt = new Date(now.getTime() + settings.verificationWindowMinutes * 60_000);
    await prisma.attendanceVerification.update({
      where: { id: v.id },
      data: { status: "SENT", sentAt: now, deadlineAt },
    });
    await notify(
      prisma,
      [v.userId],
      "attendance.verify",
      v.kind === "ARRIVAL" ? "وصلت المشروع؟ — أكّد موقعك" : "نداء تحقق — أكّد موقعك الآن",
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
    // نداء الوصول الفائت له نصّه الخاص — «ما أكّد وصوله للمشروع».
    await notify(
      prisma,
      await ownerIds(prisma),
      "attendance.verify_missed",
      v.kind === "ARRIVAL"
        ? arrivalMissedText(v.user.name)
        : verifyMissedText(
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

    /*
     * توقف جارٍ عند الإقفال (الدفعة الثالثة): يُقفل عند **لحظة بدئه** ولا
     * يُحتسب بعده وقت نشط — فتُقفل الجلسة نفسها عند بداية التوقف، والدقائق
     * عبر الدالة المشتركة (خصم التوقفات المغلقة الأسبق).
     */
    const pauses = await prisma.attendancePause.findMany({ where: { sessionId: s.id } });
    const openPause = pauses.find((p) => p.endedAt === null) ?? null;
    const closeMoment = openPause
      ? Math.min(closeAt, openPause.startedAt.getTime())
      : closeAt;
    const endDate = new Date(closeMoment);

    await prisma.$transaction(async (tx) => {
      if (openPause) {
        await tx.attendancePause.update({
          where: { id: openPause.id },
          data: { endedAt: openPause.startedAt, autoClosed: true },
        });
      }
      await tx.attendanceSession.update({
        where: { id: s.id },
        data: {
          endedAt: endDate,
          workedMinutes: activeWorkedMinutes(
            s.startedAt,
            endDate,
            pauses
              .filter((p) => p.endedAt !== null)
              .map((p) => ({ startedAt: p.startedAt, endedAt: p.endedAt })),
            endDate,
          ),
          autoClosed: true,
        },
      });
      await tx.attendanceVerification.deleteMany({ where: { userId: s.userId, status: "PENDING" } });
    });
    closed++;
  }
  return closed;
}

/**
 * ٥) تذكير الموقوف (الإضافة): بعد ٦٠ دقيقة من بدء التوقف — «لا زلت مستأذنًا —
 * رجعت؟» للموظف نفسه، ومرة ثانية وأخيرة بعد ٦٠ دقيقة إضافية. الشرط
 * `elapsed ≥ 60×(remindersSent+1)` يضمن المباعدة والحد معًا، ولا تذكير بعد
 * إقفال التوقف أو الجلسة.
 */
async function remindPaused(now: Date): Promise<number> {
  const open = await prisma.attendancePause.findMany({
    where: { endedAt: null, remindersSent: { lt: 2 }, session: { endedAt: null } },
  });

  let reminded = 0;
  for (const p of open) {
    const elapsedMinutes = (now.getTime() - p.startedAt.getTime()) / 60_000;
    if (elapsedMinutes < 60 * (p.remindersSent + 1)) continue;
    await prisma.attendancePause.update({
      where: { id: p.id },
      data: { remindersSent: p.remindersSent + 1 },
    });
    // الإشعار يفتح التطبيق على الرئيسية حيث بطاقة الدوام وزر «رجعت — كمّل دوامي».
    await notify(prisma, [p.userId], "attendance.pause_reminder", PAUSE_REMINDER_TEXT, undefined, "/m");
    reminded++;
  }
  return reminded;
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
    remindPaused(now),
  ]);
  const names = ["verifySent", "verifyMissed", "noShow", "autoClosed", "pauseReminders"] as const;
  const counts = { verifySent: 0, verifyMissed: 0, noShow: 0, autoClosed: 0, pauseReminders: 0 };
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
