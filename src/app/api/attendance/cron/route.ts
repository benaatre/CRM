import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isCronAuthorized } from "@/lib/cron-auth";
import { DAY_MS, dayStartKSA, ksaDayKey, ksaDayOfWeek, ksaMinutesOfDay } from "@/lib/ksa-time";
import { formatTime } from "@/lib/format";
import { getAttendanceSettings } from "@/lib/data/attendance";
import { activeWorkedMinutes, effectiveDay, minutesToDate, parseWeekendDays } from "@/lib/attendance-logic";
import {
  PAUSE_REMINDER_TEXT,
  arrivalMissedText,
  durationArabic,
  noResponseStopText,
  noShowText,
  verifyMissedText,
} from "@/lib/attendance-notify";
import { dayDateOf, ensureAttendanceDay } from "@/lib/data/attendance";
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

  // تقدير نهاية النافذة الصالحة للنداء العشوائي — بداية الجلسة + الهدف − حرس النهاية.
  const schedules = await prisma.attendanceSchedule.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, shiftMinutes: true },
  });
  const shiftByUser = new Map(schedules.map((s) => [s.userId, s.shiftMinutes]));
  const sessionsById = new Map(
    (
      await prisma.attendanceSession.findMany({
        where: { id: { in: due.map((v) => v.sessionId).filter((x): x is string => !!x) } },
        select: { id: true, startedAt: true },
      })
    ).map((s) => [s.id, s]),
  );

  let sent = 0;
  for (const v of due) {
    // انصرف أو أُقفلت جلسته قبل إرسال النداء — النداء صار بلا معنى.
    if (!onDuty.has(v.userId)) {
      await prisma.attendanceVerification.delete({ where: { id: v.id } });
      continue;
    }
    // موقوف — يبقى PENDING ويُرسل بعد رجوعه في نداء الكرون التالي.
    if (paused.has(v.userId)) continue;

    /*
     * ===== التحقق الذكي (الدفعة الرابعة) — للنداء العشوائي فقط =====
     * نشاط خلال نافذة الهدوء (بصمة/تغيير موقع/فحص صامت داخل النطاق/إجراء CRM/
     * رد سابق) يقوم مقام التحقق: يؤجَّل النداء بدل إرساله. وما تجاوز نهاية
     * النافذة الصالحة (بداية الجلسة + الدوام − حرس النهاية) يُحذف.
     */
    if (v.kind === "RANDOM") {
      const session = v.sessionId ? sessionsById.get(v.sessionId) : undefined;
      const shift = shiftByUser.get(v.userId) ?? 480;
      const windowEnd = session
        ? session.startedAt.getTime() + (shift - settings.verificationEndGuardMinutes) * 60_000
        : null;
      if (windowEnd !== null && now.getTime() > windowEnd) {
        await prisma.attendanceVerification.delete({ where: { id: v.id } });
        continue;
      }
      const since = new Date(now.getTime() - settings.verificationQuietWindowMinutes * 60_000);
      if (await hasRecentActivity(v.userId, since)) {
        const nextAt = new Date(now.getTime() + Math.round(settings.verificationQuietWindowMinutes / 2) * 60_000);
        if (windowEnd !== null && nextAt.getTime() > windowEnd) {
          await prisma.attendanceVerification.delete({ where: { id: v.id } });
        } else {
          await prisma.attendanceVerification.update({ where: { id: v.id }, data: { scheduledAt: nextAt } });
        }
        continue;
      }
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
      v.kind === "ARRIVAL"
        ? "وصلت المشروع؟ — أكّد موقعك"
        : v.kind === "ESCALATED"
          ? "نداء تحقق ثانٍ — أكّد موقعك الآن وإلا يتوقف عدّادك"
          : "نداء تحقق — اضغط «أنا بالموقع» وكمّل شغلك",
      `افتح التطبيق وأكّد موقعك خلال ${durationArabic(settings.verificationWindowMinutes)}`,
      "/m",
    );
    sent++;
  }
  return sent;
}

/**
 * نشاط حديث يقوم مقام التحقق — بصمة/تغيير موقع، فحص صامت **داخل النطاق**،
 * إجراء CRM (بلا ASSIGNMENT — توزيع آلي)، أو رد على نداء سابق.
 */
async function hasRecentActivity(userId: string, since: Date): Promise<boolean> {
  const [ev, silent, act, resp] = await Promise.all([
    prisma.attendanceEvent.findFirst({ where: { userId, timestamp: { gte: since } }, select: { id: true } }),
    prisma.attendanceSilentCheck.findFirst({
      where: { userId, at: { gte: since }, outOfZone: false },
      select: { id: true },
    }),
    prisma.activity.findFirst({
      where: { userId, createdAt: { gte: since }, type: { not: "ASSIGNMENT" } },
      select: { id: true },
    }),
    prisma.attendanceVerification.findFirst({ where: { userId, respondedAt: { gte: since } }, select: { id: true } }),
  ]);
  return Boolean(ev || silent || act || resp);
}

/** ٢) النداءات التي فاتت مهلتها → MISSED + إشعار المالك بآخر موقع معروف. */
async function expireMissedVerifications(now: Date): Promise<number> {
  const expired = await prisma.attendanceVerification.findMany({
    where: { status: "SENT", deadlineAt: { lt: now } },
    include: { user: { select: { name: true } } },
  });

  for (const v of expired) {
    await prisma.attendanceVerification.update({ where: { id: v.id }, data: { status: "MISSED" } });

    /*
     * ===== سلّم التصعيد (الدفعة الرابعة) =====
     * RANDOM فائت → لا إشعار مالك بعد: يُجدول النداء الإجباري الثاني
     * (ESCALATED) بعد escalationDelayMinutes — إن كان ما زال مداومًا.
     */
    if (v.kind === "RANDOM") {
      const stillOn = await prisma.attendanceSession.findFirst({
        where: { userId: v.userId, endedAt: null },
        select: { id: true },
      });
      if (stillOn) {
        const settings = await getAttendanceSettings();
        await prisma.attendanceVerification.create({
          data: {
            userId: v.userId,
            sessionId: v.sessionId,
            kind: "ESCALATED",
            parentId: v.id,
            scheduledAt: new Date(now.getTime() + settings.escalationDelayMinutes * 60_000),
          },
        });
      }
      continue;
    }

    /*
     * ESCALATED فائت → **إيقاف العدّاد آليًا** (NO_RESPONSE): الفترة من فوات
     * النداء الأول حتى الآن تبقى ضمن دوامه لكنها تُضاف لغير المؤكَّد، وإشعار
     * المالك بالنص الحرفي.
     */
    if (v.kind === "ESCALATED") {
      const openSession = await prisma.attendanceSession.findFirst({
        where: { userId: v.userId, endedAt: null },
      });
      if (openSession) {
        const alreadyPaused = await prisma.attendancePause.findFirst({
          where: { sessionId: openSession.id, endedAt: null },
          select: { id: true },
        });
        if (!alreadyPaused) {
          const root = v.parentId
            ? await prisma.attendanceVerification.findUnique({ where: { id: v.parentId } })
            : null;
          const unconfirmedFrom = root?.deadlineAt ?? v.sentAt ?? now;
          const unconfirmedMinutes = Math.max(0, Math.round((now.getTime() - unconfirmedFrom.getTime()) / 60_000));

          await prisma.$transaction(async (tx) => {
            await tx.attendancePause.create({
              data: {
                sessionId: openSession.id,
                userId: v.userId,
                kind: "NO_RESPONSE",
                authorizerLabel: "النظام — نداءان بلا رد",
                startedAt: now,
              },
            });
            const day = await ensureAttendanceDay(tx, v.userId, ksaDayKey(now));
            await tx.attendanceDay.update({
              where: { id: day.id },
              data: { unconfirmedMinutes: day.unconfirmedMinutes + unconfirmedMinutes },
            });
            // الجدول ما عاد يعني — الموقوف لا تصله نداءات.
            await tx.attendanceVerification.deleteMany({ where: { userId: v.userId, status: "PENDING" } });
          });
          await notify(
            prisma,
            await ownerIds(prisma),
            "attendance.verify_missed",
            noResponseStopText(v.user.name, formatTime(now)),
            undefined,
            `/attendance/${v.userId}`,
          );
        }
      }
      continue;
    }

    // ARRIVAL/MANUAL — إشعار المالك كما كان.
    const lastEvent = await prisma.attendanceEvent.findFirst({
      where: { userId: v.userId },
      orderBy: { timestamp: "desc" },
      include: { location: { select: { name: true } } },
    });
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
      // جلسة مُبطلة (SESSION_VOID) لا تعدّ حضورًا — «لم يداوم» يجب أن ينذر عنها.
      where: { voided: false, OR: [{ startedAt: { gte: dayStart } }, { endedAt: null }] },
      select: { userId: true },
    }),
  ]);

  const scheduleByUser = new Map(schedules.map((s) => [s.userId, s]));
  const attended = new Set(sessions.map((s) => s.userId));
  const owners = await ownerIds(prisma);

  // أوضاع اليوم (الدفعة الرابعة): «عن بُعد» و«إجازة» لا يُنذَر عنهما «لم يداوم».
  const dayRows = await prisma.attendanceDay.findMany({
    where: { date: dayDateOf(todayKey), mode: { not: "ONSITE" } },
    select: { userId: true },
  });
  const offSite = new Set(dayRows.map((d) => d.userId));

  let alerted = 0;
  for (const u of users) {
    if (attended.has(u.id)) continue;
    if (offSite.has(u.id)) continue;
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
      /*
       * توقف NO_RESPONSE لم يُفك حتى نهاية اليوم (الدفعة الرابعة): اليوم يُقفل
       * عند لحظة الإيقاف بوسم «انتهى بلا انصراف» في اللوحة والملف.
       */
      if (openPause?.kind === "NO_RESPONSE") {
        const day = await ensureAttendanceDay(tx, s.userId, dayKey);
        await tx.attendanceDay.update({ where: { id: day.id }, data: { autoEnded: true } });
      }
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
    // NO_RESPONSE خارج التذكير — له شاشته الخاصة «دوامك متوقف» عند فتح التطبيق.
    where: { endedAt: null, remindersSent: { lt: 2 }, kind: { not: "NO_RESPONSE" }, session: { endedAt: null } },
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

/**
 * ٦) تنظيف النبض الجغرافي (الثقة المتجددة): حذف الأقدم من ٦٠ يومًا — سياسة
 * الاحتفاظ المعلنة في تعليق AttendancePulse. رخيصة عند عدم وجود شيء.
 */
async function cleanOldPulses(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - 60 * DAY_MS);
  const res = await prisma.attendancePulse.deleteMany({ where: { at: { lt: cutoff } } });
  return res.count;
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
    cleanOldPulses(now),
  ]);
  const names = ["verifySent", "verifyMissed", "noShow", "autoClosed", "pauseReminders", "pulsesCleaned"] as const;
  const counts = { verifySent: 0, verifyMissed: 0, noShow: 0, autoClosed: 0, pauseReminders: 0, pulsesCleaned: 0 };
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
