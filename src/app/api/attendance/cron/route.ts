import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isCronAuthorized } from "@/lib/cron-auth";
import { DAY_MS, dayStartKSA, ksaDayKey, ksaDayOfWeek, ksaMinutesOfDay } from "@/lib/ksa-time";
import { formatTime } from "@/lib/format";
import { getAttendanceSettings } from "@/lib/data/attendance";
import {
  activeWorkedMinutes,
  effectiveDay,
  minutesToDate,
  momentOfActiveTarget,
} from "@/lib/attendance-logic";
import { effectiveConfigsFor, mergeConfig } from "@/lib/attendance-config";
import {
  PAUSE_REMINDER_TEXT,
  arrivalMissedText,
  durationArabic,
  noResponseStopText,
  noShowText,
  verifyMissedText,
} from "@/lib/attendance-notify";
import { dayDateOf, ensureAttendanceDay } from "@/lib/data/attendance";
import {
  AUTO_CALL_ON_SUSTAINED_OUTZONE,
  createConditionalCall,
  hasPulseImmunity,
} from "@/lib/attendance-conditional";
import { notify, ownerIds } from "@/lib/notify";
import { TRACKED_ROLES } from "@/lib/auth-guards";

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
 *   +) تذكير البصم (دفعة الختام): فتحت نافذته ولا بصمة ولا قرار → push «تذكير الحضور» مرة باليوم.
 *   +) الاحتساب الحر (الدفعة ب): قصّ الهدف أُلغي — الإضافي يُحسب، وسقف أمان
 *      الجلسة الوحيد maxSessionMinutes بإقفال MAX_CAP.
 *   +) فلسفة النبض الحاكم (الدفعة أ): حصانة النبض تُسقط كل نداء آلي لمن نبضته
 *      داخل النطاق طازجة (عدّاد pulseImmunity بالرد)، وتنبيهات قرار المالك
 *      (attendance.pulse_alert) بدل النداء العشوائي المعطَّل.
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

/** عدّاد مشترك لتخطيات القاعدة الذهبية — يظهر في رد الكرون بمفتاح pulseImmunity. */
type ImmunityCounter = { count: number };

/**
 * ١) إرسال النداءات التي حان وقتها — فقط لمن ما زال مداومًا، **ولا نداء لموظف
 * في حالة توقف** (عدّاده واقف أصلًا — يبقى النداء معلّقًا حتى يرجع).
 * نداء الوصول (ARRIVAL) له نصّه الخاص «وصلت المشروع؟».
 */
async function sendDueVerifications(now: Date, settings: Settings, immunity: ImmunityCounter): Promise<number> {
  const due = await prisma.attendanceVerification.findMany({
    where: { status: "PENDING", scheduledAt: { lte: now } },
  });
  if (due.length === 0) return 0;

  const userIds = [...new Set(due.map((v) => v.userId))];
  // إعدادات فعلية لكل موظف (ملف الموظف الحي) — «مراقبة/معفى» لا تصله نداءات.
  const configs = await effectiveConfigsFor(userIds, now);
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
    // بدّله المالك لوضع بلا إلزام بعد الجدولة — النداءات المعلقة تُحذف.
    if (configs.get(v.userId)?.enforced === false) {
      await prisma.attendanceVerification.delete({ where: { id: v.id } });
      continue;
    }
    // انصرف أو أُقفلت جلسته قبل إرسال النداء — النداء صار بلا معنى.
    if (!onDuty.has(v.userId)) {
      await prisma.attendanceVerification.delete({ where: { id: v.id } });
      continue;
    }
    // موقوف — يبقى PENDING ويُرسل بعد رجوعه في نداء الكرون التالي.
    if (paused.has(v.userId)) continue;

    /*
     * القاعدة الذهبية (النبض الحاكم): نبضة داخل النطاق طازجة = إثبات حضور —
     * النداء يُتخطى (يبقى PENDING لدورة قادمة؛ منطق نهاية النافذة يحذفه إن
     * فات). اليدوي MANUAL مستثنى عمدًا — قرار المالك المباشر ينفذ دائمًا.
     */
    if (v.kind !== "MANUAL" && (await hasPulseImmunity(v.userId, now))) {
      immunity.count++;
      continue;
    }

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
      if (await hasRecentActivity(v.userId, since, settings.quietWindowCountsCrm)) {
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
 * أو رد على نداء سابق. إجراءات CRM لا تُحتسب افتراضيًا (الدوام الواقعي قرار ٩:
 * الرقمي لا يعوّض الجسدي) — إلا لو أرجعها المالك بإعداد quietWindowCountsCrm.
 */
async function hasRecentActivity(userId: string, since: Date, countCrm: boolean): Promise<boolean> {
  const [ev, silent, act, resp] = await Promise.all([
    prisma.attendanceEvent.findFirst({ where: { userId, timestamp: { gte: since } }, select: { id: true } }),
    prisma.attendanceSilentCheck.findFirst({
      where: { userId, at: { gte: since }, outOfZone: false },
      select: { id: true },
    }),
    countCrm
      ? prisma.activity.findFirst({
          where: { userId, createdAt: { gte: since }, type: { not: "ASSIGNMENT" } },
          select: { id: true },
        })
      : Promise.resolve(null),
    prisma.attendanceVerification.findFirst({ where: { userId, respondedAt: { gte: since } }, select: { id: true } }),
  ]);
  return Boolean(ev || silent || act || resp);
}

/** ٢) النداءات التي فاتت مهلتها → MISSED + إشعار المالك بآخر موقع معروف. */
async function expireMissedVerifications(now: Date, immunity: ImmunityCounter): Promise<number> {
  const expired = await prisma.attendanceVerification.findMany({
    where: { status: "SENT", deadlineAt: { lt: now } },
    include: { user: { select: { name: true } } },
  });

  // إعدادات فعلية دفعة واحدة — تصعيد وإشعارات الفوات حسب وضع/تخصيص كل موظف.
  const expiredConfigs = await effectiveConfigsFor([...new Set(expired.map((v) => v.userId))], now);

  for (const v of expired) {
    // بدّله المالك لوضع بلا إلزام والنداء SENT معلق — يُلغى بلا تصعيد ولا إيقاف عدّاد.
    if (expiredConfigs.get(v.userId)?.enforced === false) {
      await prisma.attendanceVerification.delete({ where: { id: v.id } });
      continue;
    }
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
      // القاعدة الذهبية: نبضة داخل النطاق طازجة تُسقط التصعيد — الحضور مثبت.
      if (stillOn && (await hasPulseImmunity(v.userId, now))) {
        immunity.count++;
        continue;
      }
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
     * CONDITIONAL فائت (قانون ٩): لا تصعيد ثانٍ — «لم يرد خلال المهلة = يتوقف
     * عدّاده» فورًا، بوقت غير مؤكَّد **من آخر إثبات موقع** لا من فوات النداء.
     */
    if (v.kind === "CONDITIONAL") {
      const openSession = await prisma.attendanceSession.findFirst({
        where: { userId: v.userId, endedAt: null },
      });
      if (openSession) {
        const alreadyPaused = await prisma.attendancePause.findFirst({
          where: { sessionId: openSession.id, endedAt: null },
          select: { id: true },
        });
        if (!alreadyPaused) {
          const unconfirmedFrom = openSession.lastZoneProofAt ?? v.sentAt ?? now;
          const unconfirmedMinutes = Math.max(0, Math.round((now.getTime() - unconfirmedFrom.getTime()) / 60_000));
          await prisma.$transaction(async (tx) => {
            await tx.attendancePause.create({
              data: {
                sessionId: openSession.id,
                userId: v.userId,
                kind: "NO_RESPONSE",
                authorizerLabel: "النظام — نداء مشروط بلا رد",
                startedAt: now,
              },
            });
            const day = await ensureAttendanceDay(tx, v.userId, ksaDayKey(now));
            await tx.attendanceDay.update({
              where: { id: day.id },
              data: { unconfirmedMinutes: day.unconfirmedMinutes + unconfirmedMinutes },
            });
            await tx.attendanceVerification.deleteMany({ where: { userId: v.userId, status: "PENDING" } });
          });
          if (expiredConfigs.get(v.userId)?.notifyMissedCall !== false) {
            await notify(
              prisma,
              await ownerIds(prisma),
              "attendance.verify_missed",
              noResponseStopText(v.user.name, formatTime(now)),
              undefined,
              `/employees/${v.userId}`,
            );
          }
        }
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
          if (expiredConfigs.get(v.userId)?.notifyMissedCall !== false) {
            await notify(
              prisma,
              await ownerIds(prisma),
              "attendance.verify_missed",
              noResponseStopText(v.user.name, formatTime(now)),
              undefined,
              `/employees/${v.userId}`,
            );
          }
        }
      }
      continue;
    }

    // ARRIVAL/MANUAL — إشعار المالك كما كان (إلا لو أطفأه لهذا الموظف).
    if (expiredConfigs.get(v.userId)?.notifyMissedCall === false) continue;
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
  const dow = ksaDayOfWeek(now);
  const nowMinutes = ksaMinutesOfDay(now);

  const [users, schedules, exceptions, sessions] = await Promise.all([
    prisma.user.findMany({
      where: { role: { in: TRACKED_ROLES }, active: true },
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
    // إعدادات الموظف الفعلية: «مراقبة/معفى» لا غياب عنه، وعطلته المخصصة تُحترم.
    const cfg = mergeConfig(settings, scheduleByUser.get(u.id) ?? null, now);
    if (!cfg.enforced) continue;
    const eff = effectiveDay(
      scheduleByUser.get(u.id),
      exceptions.filter((e) => e.userId === u.id),
      todayKey,
      dow,
      cfg.weekendSet,
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
 * ١٠) تذكير البصم (الركيزة الثالثة): موظف مرصود مُلزَم فتحت نافذة بدايته ولا
 * بصمة دخول اليوم ولا قرار حسم قائم ولا إجازة/عطلة/يوم غير «في الموقع» →
 * push للموظف نفسه يفتح التطبيق (فالنبضة تبصم له تلقائيًا). مرة واحدة يوميًا
 * لكل موظف عبر صف الإشعار نفسه — نفس آلية dedup «لم يداوم» حرفيًا.
 */
async function remindPunchIn(now: Date, settings: Settings): Promise<number> {
  const todayKey = ksaDayKey(now);
  const dayStart = dayStartKSA(now);
  const dow = ksaDayOfWeek(now);
  const nowMinutes = ksaMinutesOfDay(now);
  // خارج نافذة الشركة كلها لا تذكير — بعد الإقفال يفوت الغرض، وقبلها لم يبدأ أحد.
  if (nowMinutes < settings.workStartMinutes || nowMinutes >= settings.workEndMinutes) return 0;

  const [users, schedules, exceptions, sessions, decisions, dayRows] = await Promise.all([
    prisma.user.findMany({
      where: { role: { in: TRACKED_ROLES }, active: true },
      select: { id: true },
    }),
    prisma.attendanceSchedule.findMany(),
    prisma.attendanceException.findMany({
      where: {
        dateFrom: { lte: new Date(`${todayKey}T00:00:00Z`) },
        dateTo: { gte: new Date(`${todayKey}T00:00:00Z`) },
      },
    }),
    prisma.attendanceSession.findMany({
      where: { voided: false, OR: [{ startedAt: { gte: dayStart } }, { endedAt: null }] },
      select: { userId: true },
    }),
    // قرار حسم قائم اليوم (بالطريق/إجازة/مستأذن/عن بُعد غير متراجَع عنه) — أجاب فلا نذكّره.
    prisma.attendanceDecision.findMany({
      where: {
        date: dayDateOf(todayKey),
        OR: [{ outcome: null }, { outcome: { not: "REVOKED" } }],
      },
      select: { userId: true },
    }),
    prisma.attendanceDay.findMany({
      where: { date: dayDateOf(todayKey), mode: { not: "ONSITE" } },
      select: { userId: true },
    }),
  ]);

  const scheduleByUser = new Map(schedules.map((s) => [s.userId, s]));
  const attended = new Set(sessions.map((s) => s.userId));
  const decided = new Set(decisions.map((d) => d.userId));
  const offSite = new Set(dayRows.map((d) => d.userId));

  let reminded = 0;
  for (const u of users) {
    if (attended.has(u.id) || decided.has(u.id) || offSite.has(u.id)) continue;
    // «مراقبة/معفى» بلا تذكير — التذكير يعد ببصم تلقائي وهو لSTRICT حصرًا.
    const cfg = mergeConfig(settings, scheduleByUser.get(u.id) ?? null, now);
    if (!cfg.enforced) continue;
    const eff = effectiveDay(
      scheduleByUser.get(u.id),
      exceptions.filter((e) => e.userId === u.id),
      todayKey,
      dow,
      cfg.weekendSet,
    );
    if (eff.isWeekend || eff.onLeave) continue;
    // نافذة بدايته لم تفتح بعد — التذكير عند أول كرون بعد فتحها.
    if (nowMinutes < eff.startMinutes) continue;

    // مرة واحدة يوميًا: صف إشعار اليوم بنفس النوع للموظف نفسه يعني ذُكِّر.
    const already = await prisma.notification.findFirst({
      where: { userId: u.id, type: "attendance.punch_reminder", createdAt: { gte: dayStart } },
      select: { id: true },
    });
    if (already) continue;

    await notify(
      prisma,
      [u.id],
      "attendance.punch_reminder",
      "تذكير الحضور",
      settings.autoPunchEnabled
        ? "دوامك بدأ — افتح التطبيق ويتسجّل حضورك تلقائي"
        : "دوامك بدأ — افتح التطبيق وسجّل حضورك",
      "/m",
    );
    reminded++;
  }
  return reminded;
}

/**
 * ١١) تنبيهات القرار (فلسفة النبض الحاكم — الدفعة أ): بدل العشوائي الأعمى،
 * المالك يُنبَّه عند حالتين لموظف مداوم غير محصون بنبضه:
 *   أ) خروج مؤكَّد مستمر: آخر نبضة محكومة خارج النطاق + مضى على آخر إثبات
 *      موقع ≥ settings.maxOutOfZoneMinutes.
 *   ب) انقطاع إثبات ≥ settings.heartbeatGapMinutes لجلسة مفتوحة.
 * الإشعار يفتح `/attendance/{userId}` حيث زر «أرسل نداء تحقق الآن» = زر القرار.
 * تهدئة: تنبيه واحد لكل موظف/حالة كل ٦٠ دقيقة (صف الإشعار نفسه — نمط «لم يداوم»).
 * ومع مفتاح «النداء التلقائي عند الخروج المؤكد» (م٣-٣، إيقاف حاليًا): الحالة أ
 * ترسل نداءً تلقائيًا واحدًا بدل التنبيه.
 */
async function alertOwnerDecisions(now: Date, settings: Settings): Promise<number> {
  const open = await prisma.attendanceSession.findMany({
    where: { endedAt: null, voided: false },
    include: { pauses: { where: { endedAt: null }, select: { id: true } } },
  });
  if (open.length === 0) return 0;

  const todayKey = ksaDayKey(now);
  const offSite = new Set(
    (
      await prisma.attendanceDay.findMany({
        where: { date: dayDateOf(todayKey), mode: { not: "ONSITE" } },
        select: { userId: true },
      })
    ).map((d) => d.userId),
  );
  const userIds = [...new Set(open.map((s) => s.userId))];
  const configs = await effectiveConfigsFor(userIds, now);
  const names = new Map(
    (
      await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
    ).map((u) => [u.id, u.name]),
  );
  const owners = await ownerIds(prisma);

  let acted = 0;
  for (const s of open) {
    if (s.pauses.length > 0) continue; // موقوف — عدّاده واقف، حالته معروضة أصلًا
    if (offSite.has(s.userId)) continue;
    if (configs.get(s.userId)?.enforced === false) continue;
    if (await hasPulseImmunity(s.userId, now)) continue; // محصون — القاعدة الذهبية

    const lastJudged = await prisma.attendancePulse.findFirst({
      where: { userId: s.userId, inZone: { not: null } },
      orderBy: { at: "desc" },
      select: { inZone: true, at: true },
    });
    const outMinutes = Math.round((now.getTime() - (s.lastZoneProofAt ?? s.startedAt).getTime()) / 60_000);
    const gapMinutes = Math.round((now.getTime() - (s.lastAliveAt ?? s.startedAt).getTime()) / 60_000);

    const state: "out" | "gap" | null =
      lastJudged?.inZone === false && outMinutes >= settings.maxOutOfZoneMinutes
        ? "out"
        : gapMinutes >= settings.heartbeatGapMinutes
          ? "gap"
          : null;
    if (!state) continue;

    // م٣-٣: عند تفعيل النداء التلقائي للخروج المؤكد — نداء واحد بسقوف اليوم بدل التنبيه.
    if (state === "out" && AUTO_CALL_ON_SUSTAINED_OUTZONE) {
      const sent = await createConditionalCall({
        userId: s.userId,
        sessionId: s.id,
        reason: "OUT_ZONE",
        now,
        windowMinutes: settings.conditionalWindowMinutes,
        cooldownMinutes: settings.conditionalCooldownMinutes,
        maxPerDay: settings.maxConditionalPerDay,
        title: `لسه خارج النطاق من ${durationArabic(outMinutes)}؟ أكّد موقعك`,
        body: `رد خلال ${durationArabic(settings.conditionalWindowMinutes)}`,
      });
      if (sent) acted++;
      continue;
    }

    const name = names.get(s.userId) ?? "موظف";
    const marker = state === "out" ? "خارج النطاق" : "منقطع";
    const title =
      state === "out"
        ? `نبض ${name} خارج النطاق من ${durationArabic(outMinutes)}`
        : `نبض ${name} منقطع من ${durationArabic(gapMinutes)}`;

    const already = await prisma.notification.findFirst({
      where: {
        type: "attendance.pulse_alert",
        link: `/attendance/${s.userId}`,
        title: { contains: marker },
        createdAt: { gte: new Date(now.getTime() - 60 * 60_000) },
      },
      select: { id: true },
    });
    if (already) continue;

    await notify(prisma, owners, "attendance.pulse_alert", title, undefined, `/attendance/${s.userId}`);
    acted++;
  }
  return acted;
}

/**
 * ٧) سقف أمان الجلسة (الاحتساب الحر — الدفعة ب): قصّ الهدف أُلغي — الجلسة
 * تستمر بعد الهدف ويُحسب الإضافي ذهبيًا. الحارس الوحيد: جلسة تجاوز نشاطُها
 * settings.maxSessionMinutes → إقفال بنمط الإقفال القانوني حرفيًا (آخر إثبات
 * حياة + السماحية، بسقف لحظة بلوغ السقف رياضيًا) بوسم closedBy="MAX_CAP".
 */
async function enforceMaxSession(now: Date, settings: Settings): Promise<number> {
  const open = await prisma.attendanceSession.findMany({
    where: { endedAt: null, voided: false },
    include: { pauses: true },
  });
  if (open.length === 0) return 0;

  const capConfigs = await effectiveConfigsFor([...new Set(open.map((s) => s.userId))], now);
  let closed = 0;
  for (const s of open) {
    const activePauses = s.pauses.map((p) => ({ startedAt: p.startedAt, endedAt: p.endedAt }));
    const live = activeWorkedMinutes(s.startedAt, now, activePauses, now);
    if (live < settings.maxSessionMinutes) continue;

    // لحظة بلوغ السقف رياضيًا — مزاحة بالتوقفات المغلقة (نفس momentOfActiveTarget).
    const capMoment = momentOfActiveTarget(
      s.startedAt,
      activePauses,
      settings.maxSessionMinutes,
    ).getTime();
    const lastProof = s.lastAliveAt ?? s.startedAt;
    const graceEnd = Math.max(s.startedAt.getTime(), lastProof.getTime() + settings.autoCloseAliveGraceMinutes * 60_000);
    const closeAt = Math.min(capMoment, graceEnd, now.getTime());

    const openPause = s.pauses.find((p) => p.endedAt === null) ?? null;
    const closeMoment = openPause ? Math.min(closeAt, openPause.startedAt.getTime()) : closeAt;
    const endDate = new Date(closeMoment);
    const dayKey = ksaDayKey(s.startedAt);

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
            s.pauses
              .filter((p) => p.endedAt !== null)
              .map((p) => ({ startedAt: p.startedAt, endedAt: p.endedAt })),
            endDate,
          ),
          autoClosed: true,
          closedBy: "MAX_CAP",
        },
      });
      const zoneProof = s.lastZoneProofAt?.getTime() ?? null;
      const unconfirmed = zoneProof !== null ? Math.max(0, Math.round((closeMoment - zoneProof) / 60_000)) : 0;
      if (unconfirmed > 0) {
        const day = await ensureAttendanceDay(tx, s.userId, dayKey);
        await tx.attendanceDay.update({
          where: { id: day.id },
          data: { unconfirmedMinutes: day.unconfirmedMinutes + unconfirmed },
        });
      }
      await tx.attendanceVerification.deleteMany({ where: { userId: s.userId, status: "PENDING" } });
      if (capConfigs.get(s.userId)?.dayLockEnabled) {
        const day = await ensureAttendanceDay(tx, s.userId, dayKey);
        if (!day.lockedAt) await tx.attendanceDay.update({ where: { id: day.id }, data: { lockedAt: endDate } });
      }
    });

    const me = await prisma.user.findUnique({ where: { id: s.userId }, select: { name: true } });
    await notify(
      prisma,
      await ownerIds(prisma),
      "attendance.auto_closed",
      `${me?.name ?? "موظف"}: بلغت جلسته سقف الأمان (${durationArabic(settings.maxSessionMinutes)}) فأُقفلت آليًا`,
      undefined,
      `/attendance/${s.userId}`,
    ).catch(() => {});
    closed++;
  }
  return closed;
}

/**
 * ٤) الإغلاق القانوني (الدوام الواقعي — قراران ١ و٨): بعد نهاية نافذة الشركة
 * **كل** جلسة مفتوحة تُقفل قسرًا — لحظة الإقفال «آخر إثبات حياة + سماحية»
 * بسقف نهاية النافذة (وللجلسات القديمة بلا إثباتات: آخر حدث بصم فعلي). الفرق
 * بعد آخر إثبات موقع يُضاف لغير المؤكَّد، وإشعار المالك بالتفصيل.
 */
async function autoCloseForgotten(now: Date, settings: Settings): Promise<number> {
  const open = await prisma.attendanceSession.findMany({ where: { endedAt: null } });
  if (open.length === 0) return 0;

  const graceMs = settings.autoCloseAliveGraceMinutes * 60_000;
  // «قفل اليوم نهائيًا» لكل موظف — يُطبَّق عند الإقفال القانوني أيضًا.
  const closeConfigs = await effectiveConfigsFor([...new Set(open.map((s) => s.userId))], now);

  let closed = 0;
  for (const s of open) {
    const dayKey = ksaDayKey(s.startedAt);
    const companyEnd = minutesToDate(dayKey, settings.workEndMinutes).getTime();
    // السياج (قرار ١): الإقفال القسري يبدأ من نهاية النافذة الكلية — قبلها
    // اليوم الجاري تحكمه ر٥ (الانقطاع) وإقفال الهدف، لا هذا.
    if (now.getTime() < companyEnd) continue;

    // آخر إثبات حياة — وللقديمة (null): آخر حدث بصم فعلي ضمن الجلسة، وإلا بدايتها.
    let lastProof = s.lastAliveAt;
    if (!lastProof) {
      const lastEvent = await prisma.attendanceEvent.findFirst({
        where: { userId: s.userId, timestamp: { gte: s.startedAt } },
        orderBy: { timestamp: "desc" },
        select: { timestamp: true },
      });
      lastProof = lastEvent?.timestamp ?? s.startedAt;
    }
    const closeAt = Math.min(companyEnd, Math.max(s.startedAt.getTime(), lastProof.getTime() + graceMs));

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
          closedBy: "AUTO",
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
      /*
       * القانون ٨: ما بعد آخر إثبات موقع «غير مؤكَّد» — الفرق بين لحظة الإقفال
       * وآخر إثبات موقع يُضاف لغير مؤكَّد اليوم (إن كان موجبًا).
       */
      const zoneProof = s.lastZoneProofAt?.getTime() ?? null;
      const unconfirmed =
        zoneProof !== null ? Math.max(0, Math.round((closeMoment - zoneProof) / 60_000)) : 0;
      if (unconfirmed > 0) {
        const day = await ensureAttendanceDay(tx, s.userId, dayKey);
        await tx.attendanceDay.update({
          where: { id: day.id },
          data: { unconfirmedMinutes: day.unconfirmedMinutes + unconfirmed },
        });
      }
      await tx.attendanceVerification.deleteMany({ where: { userId: s.userId, status: "PENDING" } });
      if (closeConfigs.get(s.userId)?.dayLockEnabled) {
        const day = await ensureAttendanceDay(tx, s.userId, dayKey);
        if (!day.lockedAt) await tx.attendanceDay.update({ where: { id: day.id }, data: { lockedAt: endDate } });
      }
    });

    // إشعار المالك بالتفصيل (قرار ١٢) — best-effort.
    const me = await prisma.user.findUnique({ where: { id: s.userId }, select: { name: true } });
    await notify(
      prisma,
      await ownerIds(prisma),
      "attendance.auto_closed",
      `${me?.name ?? "موظف"}: أُقفل دوامه آليًا · آخر تواجد ${formatTime(lastProof)}`,
      undefined,
      `/attendance/${s.userId}`,
    ).catch(() => {});
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
 * ٨) قانون الانقطاع (الدوام الواقعي — قانون ٩): جلسة مفتوحة (غير موقوفة) بيوم
 * «في الموقع» انقطع إثباتها heartbeatGapMinutes → نداء CONDITIONAL فوري
 * (HEARTBEAT_GAP). التجاهل خلال conditionalWindowMinutes → توقف بوقت غير
 * مؤكَّد من آخر إثبات موقع (فرع CONDITIONAL أعلاه). داخل نافذة الشركة فقط —
 * بعدها الإغلاق القانوني هو الحاكم.
 */
async function checkHeartbeatGaps(now: Date, settings: Settings, immunity: ImmunityCounter): Promise<number> {
  const open = await prisma.attendanceSession.findMany({
    where: { endedAt: null, voided: false },
    include: { pauses: { where: { endedAt: null }, select: { id: true } } },
  });
  if (open.length === 0) return 0;

  const todayKey = ksaDayKey(now);
  const offSite = new Set(
    (
      await prisma.attendanceDay.findMany({
        where: { date: dayDateOf(todayKey), mode: { not: "ONSITE" } },
        select: { userId: true },
      })
    ).map((d) => d.userId),
  );

  const gapConfigs = await effectiveConfigsFor([...new Set(open.map((s) => s.userId))], now);
  let called = 0;
  for (const s of open) {
    if (s.pauses.length > 0) continue; // موقوف/مستأذن — عدّاده واقف أصلًا
    if (offSite.has(s.userId)) continue;
    if (gapConfigs.get(s.userId)?.enforced === false) continue; // مراقبة/معفى — بلا نداءات
    const companyEnd = minutesToDate(ksaDayKey(s.startedAt), settings.workEndMinutes).getTime();
    if (now.getTime() >= companyEnd) continue;

    const lastProof = s.lastAliveAt ?? s.startedAt;
    if (now.getTime() - lastProof.getTime() < settings.heartbeatGapMinutes * 60_000) continue;

    // القاعدة الذهبية — يُعدّ التخطي هنا (الحارس داخل createConditionalCall احتياط).
    if (await hasPulseImmunity(s.userId, now)) {
      immunity.count++;
      continue;
    }

    const sent = await createConditionalCall({
      userId: s.userId,
      sessionId: s.id,
      reason: "HEARTBEAT_GAP",
      now,
      windowMinutes: settings.conditionalWindowMinutes,
      cooldownMinutes: settings.conditionalCooldownMinutes,
      maxPerDay: settings.maxConditionalPerDay,
      title: "انقطع إثباتك — أكّد موقعك",
      body: `أكّد موقعك خلال ${durationArabic(settings.conditionalWindowMinutes)} عشان نكمّل دوامك`,
    });
    if (sent) called++;
  }
  return called;
}

/**
 * ٩) مراقبة الزيارة (قرار ١٠): محطة مشروع جارية —
 *   أ) انقطع النبض ≥ ٥ دقائق → push فوري «افتح التطبيق وأكّد موقعك» (تذكير لا
 *      نداء — بلا انتظار الـ٤٥؛ مرة كل ربع ساعة كحد أقصى).
 *   ب) لا إثبات موقع من visitReverifyMinutes → نداء تحقق CONDITIONAL
 *      (VISIT_STALE) بإيقاعه الخاص — خارج سقف/تهدئة GAP عمدًا.
 */
async function watchVisits(now: Date, settings: Settings, immunity: ImmunityCounter): Promise<number> {
  const open = await prisma.attendanceSession.findMany({
    where: { endedAt: null, voided: false },
    include: { pauses: { where: { endedAt: null }, select: { id: true } } },
  });
  if (open.length === 0) return 0;

  const visitConfigs = await effectiveConfigsFor([...new Set(open.map((s) => s.userId))], now);
  let acted = 0;
  for (const s of open) {
    if (s.pauses.length > 0) continue;
    if (visitConfigs.get(s.userId)?.enforced === false) continue; // مراقبة/معفى — بلا تذكير ولا نداء

    // محطة المشروع الجارية = آخر حدث موقعي للجلسة على دائرة PROJECT داخل النطاق.
    const lastLocEvent = await prisma.attendanceEvent.findFirst({
      where: { userId: s.userId, timestamp: { gte: s.startedAt }, type: { in: ["CHECK_IN", "LOCATION_CHANGE"] } },
      orderBy: { timestamp: "desc" },
      include: { location: { select: { name: true, type: true } } },
    });
    if (!lastLocEvent || lastLocEvent.outOfZone || lastLocEvent.location?.type !== "PROJECT") continue;
    const projectName = lastLocEvent.location.name;

    // (أ) انقطاع النبض أثناء الزيارة — تذكير push فوري بعد ٥ دقائق (بلا انتظار الـ٤٥).
    const aliveGapMs = now.getTime() - (s.lastAliveAt ?? s.startedAt).getTime();
    if (aliveGapMs >= 5 * 60_000) {
      const recentReminder = await prisma.notification.findFirst({
        where: {
          userId: s.userId,
          type: "attendance.confirm_location",
          createdAt: { gte: new Date(now.getTime() - 15 * 60_000) },
        },
        select: { id: true },
      });
      if (!recentReminder) {
        await notify(
          prisma,
          [s.userId],
          "attendance.confirm_location",
          `زيارة ${projectName}: افتح التطبيق وأكّد موقعك`,
          undefined,
          "/m",
        ).catch(() => {});
        acted++;
      }
    }

    // (ب) التحقق الدوري كل visitReverifyMinutes — بلا إثبات موقع حديث.
    const proofRef = Math.max(
      s.lastZoneProofAt?.getTime() ?? 0,
      lastLocEvent.timestamp.getTime(),
    );
    if (now.getTime() - proofRef < settings.visitReverifyMinutes * 60_000) continue;
    const recentStale = await prisma.attendanceVerification.findFirst({
      where: {
        userId: s.userId,
        kind: "CONDITIONAL",
        triggerReason: "VISIT_STALE",
        createdAt: { gte: new Date(now.getTime() - settings.visitReverifyMinutes * 60_000) },
      },
      select: { id: true },
    });
    if (recentStale) continue;

    // القاعدة الذهبية — نبضة داخل النطاق طازجة تغني عن نداء الزيارة.
    if (await hasPulseImmunity(s.userId, now)) {
      immunity.count++;
      continue;
    }

    const sent = await createConditionalCall({
      userId: s.userId,
      sessionId: s.id,
      reason: "VISIT_STALE",
      now,
      windowMinutes: settings.conditionalWindowMinutes,
      cooldownMinutes: settings.conditionalCooldownMinutes,
      maxPerDay: settings.maxConditionalPerDay,
      title: `لسه بمشروع ${projectName}؟ أكّد موقعك`,
      body: `رد خلال ${durationArabic(settings.conditionalWindowMinutes)}`,
    });
    if (sent) acted++;
  }
  return acted;
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
  // عدّاد القاعدة الذهبية المشترك — كل تخطٍّ بسبب نبضة حية يُحصى هنا.
  const immunity: ImmunityCounter = { count: 0 };

  // نعزل فشل كل مهمة ونبلّغ عنه بدل ابتلاعه — نفس نمط notify-scheduled.
  const results = await Promise.allSettled([
    sendDueVerifications(now, settings, immunity),
    expireMissedVerifications(now, immunity),
    checkNoShows(now, settings),
    remindPunchIn(now, settings),
    alertOwnerDecisions(now, settings),
    enforceMaxSession(now, settings),
    autoCloseForgotten(now, settings),
    checkHeartbeatGaps(now, settings, immunity),
    watchVisits(now, settings, immunity),
    remindPaused(now),
    cleanOldPulses(now),
  ]);
  const names = ["verifySent", "verifyMissed", "noShow", "punchReminders", "decisionAlerts", "maxSession", "autoClosed", "gapCalls", "visitWatch", "pauseReminders", "pulsesCleaned"] as const;
  const counts = { verifySent: 0, verifyMissed: 0, noShow: 0, punchReminders: 0, decisionAlerts: 0, maxSession: 0, autoClosed: 0, gapCalls: 0, visitWatch: 0, pauseReminders: 0, pulsesCleaned: 0 };
  const failed: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") counts[names[i]] = r.value;
    else {
      failed.push(names[i]);
      console.error(`[attendance-cron] ${names[i]}`, r.reason);
    }
  });

  return NextResponse.json(
    { ok: failed.length === 0, ...counts, pulseImmunity: immunity.count, ...(failed.length ? { failed } : {}) },
    { status: failed.length ? 500 : 200 },
  );
}
