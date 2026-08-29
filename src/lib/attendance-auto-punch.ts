import "server-only";

import { AttendanceEventType, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ksaDayKey, ksaDayOfWeek, ksaMinutesOfDay } from "@/lib/ksa-time";
import { formatTime } from "@/lib/format";
import { alertRecipients, lateAlertText } from "@/lib/attendance-notify";
import {
  effectiveDay,
  isLateCheckIn,
  minutesToHM,
  parseWeekendDays,
  planVerificationTimes,
  type EffectiveDay,
} from "@/lib/attendance-logic";
import { dayDateOf, ensureAttendanceDay, getAttendanceSettings } from "@/lib/data/attendance";
import { mergeConfig } from "@/lib/attendance-config";
import { notify, ownerIds } from "@/lib/notify";

/**
 * البصم التلقائي بالنبض الجغرافي (الدوام الواقعي — قرار ٣) — ينفَّذ لحظة
 * استقبال النبضة في heartbeat/route (أدق من انتظار الكرون).
 *
 * حمايات المالك المعتمدة:
 *  (أ) نبضتان متتاليتان داخل النطاق (خلال نافذة قصيرة) — لا بصمة عابرة.
 *  (ب) idempotency صارم: قفل ذري على `AttendanceDay.firstCheckInAt` داخل
 *      المعاملة — `updateMany(where: firstCheckInAt=null)` يفوز به طلب واحد
 *      مهما تسابقت النبضات، والبصم التلقائي لأول بصمة اليوم حصرًا.
 *  (ج) قفل استشاري معاملي `pg_advisory_xact_lock` على (المستخدم + اليوم) —
 *      يسدّ ثغرة تسابق ما قبل وجود صف اليوم (تفصيلها داخل المعاملة أدناه).
 *
 * متى يستحق: موظف بلا جلسة اليوم، يوم عمل «في الموقع»، داخل نافذة بدايته —
 * أو «بالطريق» معلنة ما زالت بمهلتها (وصوله يحسمها ARRIVED_AUTO).
 */

/** نافذة اعتبار النبضتين «متتاليتين» — نبضة كل دقيقة + هامش شبكة. */
const CONSECUTIVE_WINDOW_MS = 3 * 60_000;

export type AutoPunchOutcome =
  | { punched: true; locationName: string | null; isLate: boolean }
  | { punched: false };

/** «بالطريق» النشطة الآن (لم تنته مهلتها + الهامش) — أو null. */
export async function activeOnWayDecision(userId: string, now: Date, marginMinutes: number) {
  const d = await prisma.attendanceDecision.findFirst({
    where: { userId, date: dayDateOf(ksaDayKey(now)), kind: "ON_WAY", resolvedAt: null },
    orderBy: { decidedAt: "desc" },
  });
  if (!d) return null;
  const deadline = d.decidedAt.getTime() + ((d.etaMinutes ?? 15) + marginMinutes) * 60_000;
  return now.getTime() <= deadline ? d : null;
}

/** الدوام الفعّال ليوم النبضة — نفس مصادر punch حرفيًا. */
export async function effectiveDayOf(userId: string, now: Date): Promise<EffectiveDay> {
  const todayKey = ksaDayKey(now);
  const [schedule, exceptions, settings] = await Promise.all([
    prisma.attendanceSchedule.findUnique({ where: { userId } }),
    prisma.attendanceException.findMany({
      where: {
        userId,
        dateFrom: { lte: new Date(`${todayKey}T00:00:00Z`) },
        dateTo: { gte: new Date(`${todayKey}T00:00:00Z`) },
      },
    }),
    getAttendanceSettings(),
  ]);
  // عطلة الموظف المخصصة أولًا (ملف الموظف الحي) ثم العامة.
  return effectiveDay(schedule, exceptions, todayKey, ksaDayOfWeek(now), parseWeekendDays(schedule?.weekendDays ?? settings.weekendDays));
}

/**
 * يحاول البصم التلقائي بعد نبضة داخل النطاق — يُستدعى فقط والنبضة الحالية
 * `inZone=true` ولا جلسة مفتوحة. كل الإخفاقات صامتة (النبضة نجحت أصلًا).
 */
export async function tryAutoPunch(args: {
  userId: string;
  now: Date;
  lat: number;
  lng: number;
  accuracy: number | null;
  locationId: string;
  locationName: string | null;
  distanceMeters: number;
  /**
   * سياق ما بعد النافذة (استحقاق شاشة الحسم): نبضة واحدة داخل النطاق تكفي —
   * الحاضر فعلًا يُبصم فورًا ولا تُعرض عليه الشاشة (أولوية البصم على الحسم).
   */
  singlePulse?: boolean;
}): Promise<AutoPunchOutcome> {
  const { userId, now } = args;
  const settings = await getAttendanceSettings();
  if (!settings.autoPunchEnabled) return { punched: false };

  const todayKey = ksaDayKey(now);

  // أي جلسة اليوم (حتى منصرفة) = ليست أول بصمة — البصم التلقائي لأولها فقط.
  const todaySession = await prisma.attendanceSession.findFirst({
    where: { userId, voided: false, startedAt: { gte: new Date(`${todayKey}T00:00:00+03:00`) } },
    select: { id: true },
  });
  if (todaySession) return { punched: false };

  const eff = await effectiveDayOf(userId, now);
  if (eff.isWeekend || eff.onLeave) return { punched: false };

  /*
   * الأهلية الزمنية: نافذة الشركة كلها [workStart, workEnd) — البصم المبكر حق
   * (النافذة الشخصية تحكم التأخير والحسم فقط، لا تمنع بصمًا مبكرًا)، وما بعد
   * نافذته يظل مؤهلًا حتى إقفال الشركة (بدل ظهور شاشة الحسم على الحاضر).
   */
  const nowMinutes = ksaMinutesOfDay(now);
  if (nowMinutes < settings.workStartMinutes || nowMinutes >= settings.workEndMinutes) {
    return { punched: false };
  }
  // قرار إجازة/استئذان/عن بُعد قائم اليوم يمنع البصم التلقائي (حتى يتراجع).
  const blocking = await prisma.attendanceDecision.findFirst({
    where: {
      userId,
      date: dayDateOf(todayKey),
      kind: { in: ["LEAVE", "EXCUSED", "REMOTE"] },
      outcome: { not: "REVOKED" },
    },
    select: { id: true },
  });
  if (blocking) return { punched: false };

  // الحماية (أ): نبضتان متتاليتان — إلا في سياق ما بعد النافذة (نبضة تكفي).
  if (!args.singlePulse) {
    const prevInZone = await prisma.attendancePulse.findFirst({
      where: {
        userId,
        inZone: true,
        at: { gte: new Date(now.getTime() - CONSECUTIVE_WINDOW_MS), lt: now },
      },
      select: { id: true },
    });
    if (!prevInZone) return { punched: false };
  }

  // إعدادات الموظف الفعلية — للنداءات المخصصة وحد تأخيره الشخصي (الدفعة ب).
  const schedRow = await prisma.attendanceSchedule.findUnique({ where: { userId } });
  const config = mergeConfig(settings, schedRow, now);

  const isLate = isLateCheckIn(nowMinutes, eff, config.lateThresholdMinutes);

  const punched = await prisma.$transaction(async (tx) => {
    /*
     * الحماية (ج): قفل استشاري معاملي على (المستخدم + اليوم المنطقي) — القفل
     * الذري (ب) يفترض صف AttendanceDay واحدًا، لكن نبضات متزامنة قبل وجود
     * الصف قد تُنشئ عبر ensureAttendanceDay صفوفًا متوازية يفوز كلٌّ بقفل
     * صفّه. القفل هنا يسلسل المتسابقين قبل ensureAttendanceDay، ويُفك تلقائيًا
     * بنهاية المعاملة.
     */
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`auto-punch:${userId}:${todayKey}`}, 0))`;
    // إعادة فحص «لا بصمة دخول قائمة» داخل القفل: من انتظر القفل يرى جلسة الفائز.
    const dupSession = await tx.attendanceSession.findFirst({
      where: { userId, voided: false, startedAt: { gte: new Date(`${todayKey}T00:00:00+03:00`) } },
      select: { id: true },
    });
    if (dupSession) return false;

    const day = await ensureAttendanceDay(tx, userId, todayKey);
    if (day.mode !== "ONSITE") return false;
    // يوم مقفول نهائيًا (القرار أ): لا بصم تلقائيًا أيضًا — دوامه يبدأ بكرة.
    if (day.lockedAt) return false;
    // الحماية (ب): القفل الذري — من خسره لا يبصم (بصمة أخرى سبقته بالملّي ثانية).
    const lock = await tx.attendanceDay.updateMany({
      where: { id: day.id, firstCheckInAt: null },
      data: { firstCheckInAt: now, wasLate: isLate, lastActivityAt: now },
    });
    if (lock.count === 0) return false;

    const event = await tx.attendanceEvent.create({
      data: {
        userId,
        locationId: args.locationId,
        type: AttendanceEventType.CHECK_IN,
        timestamp: now,
        lat: args.lat,
        lng: args.lng,
        accuracy: args.accuracy ?? 0,
        distanceMeters: args.distanceMeters,
        source: "AUTO_GEO",
        isMock: false,
        outOfZone: false,
        isLate,
      },
    });
    const session = await tx.attendanceSession.create({
      data: {
        userId, dayId: day.id, checkInEventId: event.id, startedAt: now, wasLate: isLate,
        lastAliveAt: now, lastZoneProofAt: now,
      },
    });

    // جدولة النداءات — نفس قواعد punch حرفيًا (السقف والحرسان)، بنداءات الموظف المخصصة.
    // مفتاح العشوائي الموحّد (مركز التحكم): verificationEnabled وحده يحكم.
    if (settings.verificationEnabled && !config.quietMode && !eff.isWeekend) {
      const dailyCap = Math.min(config.verificationPerDay, 2);
      const alreadyToday = await tx.attendanceVerification.count({
        where: { userId, kind: "RANDOM", scheduledAt: { gte: new Date(`${todayKey}T00:00:00+03:00`) } },
      });
      const times = planVerificationTimes(
        now,
        eff.targetMinutes,
        Math.max(0, dailyCap - alreadyToday),
        Math.random,
        settings.verificationStartGuardMinutes,
        settings.verificationEndGuardMinutes,
      );
      if (times.length > 0) {
        await tx.attendanceVerification.createMany({
          data: times.map((t) => ({ userId, sessionId: session.id, scheduledAt: t })),
        });
      }
    }

    // «بالطريق» تنحسم بوصوله آليًا.
    await tx.attendanceDecision.updateMany({
      where: { userId, date: dayDateOf(todayKey), kind: "ON_WAY", resolvedAt: null },
      data: { resolvedAt: now, outcome: "ARRIVED_AUTO" },
    });
    return true;
  });

  if (!punched) return { punched: false };

  // الإشعارات best-effort — فشلها لا يمس البصمة.
  try {
    await notify(
      prisma,
      [userId],
      "attendance.auto_punch",
      `بصمنا لك ✓ ${args.locationName ?? "موقعك"} · ${formatTime(now)}`,
      undefined,
      "/m",
    );
    // تنبيه التأخير («بصمة فقط»): مرة واحدة لكل موظف/يوم — نمط dedup تذكير البصم.
    if (isLate) {
      const already = await prisma.notification.findFirst({
        where: {
          type: "attendance.late",
          link: `/attendance/${userId}`,
          createdAt: { gte: new Date(`${todayKey}T00:00:00+03:00`) },
        },
        select: { id: true },
      });
      if (!already) {
        const who = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
        await notify(
          prisma,
          alertRecipients(settings.alertRouting, "attendance.late", await ownerIds(prisma)),
          "attendance.late",
          lateAlertText(who?.name ?? "موظف", Math.max(1, nowMinutes - eff.accountStartMinutes), minutesToHM(eff.accountStartMinutes)),
          undefined,
          `/attendance/${userId}`,
        );
      }
    }
    if (settings.notifyAutoPunchOwner) {
      const me = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
      await notify(
        prisma,
        alertRecipients(settings.alertRouting, "attendance.auto_punch", await ownerIds(prisma)),
        "attendance.checked_in",
        `${me?.name ?? "موظف"}: حضر تلقائيًا · ${args.locationName ?? "—"} · ${formatTime(now)}`,
        undefined,
        `/attendance/${userId}`,
      );
    }
  } catch (e) {
    console.error("[attendance] فشل إشعار البصم التلقائي", e);
  }

  return { punched: true, locationName: args.locationName, isLate };
}

/** عميل Prisma داخل معاملة — نفس المتاح لـensureAttendanceDay. */
export type Tx = Prisma.TransactionClient;
