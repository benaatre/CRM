import { NextResponse } from "next/server";
import {
  AttendanceEventType,
  AttendanceLocationType,
  AttendanceSource,
  Role,
} from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { distanceMeters, matchLocation, nearestLocation } from "@/lib/geofence";
import { ksaDayKey, ksaDayOfWeek, ksaMinutesOfDay } from "@/lib/ksa-time";
import { formatTime } from "@/lib/format";
import { getAttendanceSettings, getActiveLocations } from "@/lib/data/attendance";
import {
  activeWorkedMinutes,
  effectiveDay,
  isLateCheckIn,
  minutesToHM,
  parseWeekendDays,
  planVerificationTimes,
} from "@/lib/attendance-logic";
import {
  checkedInText,
  completedText,
  lateCheckInText,
  locationChangeOutOfZoneText,
  resumedCheckInText,
} from "@/lib/attendance-notify";
import { daySessionsOf, ensureAttendanceDay } from "@/lib/data/attendance";
import { NEW_RANDOM_CALLS_DISABLED } from "@/lib/attendance-conditional";
import { mergeConfig } from "@/lib/attendance-config";
import { notify, ownerIds } from "@/lib/notify";

export const runtime = "nodejs";

/**
 * البصمة — حضور/انصراف أو دخول/خروج زيارة مشروع.
 *
 * قاعدة قاطعة: **السيرفر لا يثق بالجوال**. الجوال يرسل إحداثيات ودقّة فقط؛
 * الخادم يعيد حساب المسافة (Haversine)، ويقرّر المطابقة، ويختم بوقته هو
 * (بتوقيت الرياض) لا بساعة الجهاز. ولا يُقرأ `userId` من الجسم أبدًا —
 * الموظف يبصم لنفسه فقط، وهويته من الجلسة حصرًا.
 *
 * الحارس auth() لا requireUser(): هذا route handler وrequireUser يستخدم
 * redirect() (سلوك صفحات) فيرجّع 3xx لطلب fetch بدل 401 واضح — نفس نمط
 * /api/heartbeat و/api/push/register في هذا الريبو.
 */

const INTENTS = new Set<string>(Object.values(AttendanceEventType));
const SOURCES = new Set<string>(Object.values(AttendanceSource));

type Body = {
  lat?: unknown;
  lng?: unknown;
  accuracy?: unknown;
  isMock?: unknown;
  source?: unknown;
  intent?: unknown;
  targetLocationId?: unknown;
};

type Parsed = {
  lat: number;
  lng: number;
  accuracy: number;
  isMock: boolean;
  source: AttendanceSource;
  intent: AttendanceEventType;
  /** «تغيير موقعي»: الموقع الذي اختاره الموظف من الشيت — ادّعاء يعاد حسابه هنا. */
  targetLocationId: string | null;
};

/** يقرأ ويتحقق من جسم الطلب — يرجّع null لو غير صالح. */
async function parseBody(req: Request): Promise<Parsed | null> {
  let raw: Body;
  try {
    raw = (await req.json()) as Body;
  } catch {
    return null;
  }

  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  const accuracy = Number(raw.accuracy);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return null;
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return null;
  // دقّة غير رقمية أو سالبة = قراءة فاسدة؛ نسقّفها فوق حتى لا يمرّ رقم خيالي.
  if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100_000) return null;

  const intent = typeof raw.intent === "string" ? raw.intent : "";
  if (!INTENTS.has(intent)) return null;

  const source = typeof raw.source === "string" && SOURCES.has(raw.source) ? raw.source : "WEB";

  return {
    lat,
    lng,
    accuracy,
    isMock: raw.isMock === true,
    source: source as AttendanceSource,
    intent: intent as AttendanceEventType,
    targetLocationId:
      typeof raw.targetLocationId === "string" && raw.targetLocationId.length > 0 && raw.targetLocationId.length <= 64
        ? raw.targetLocationId
        : null,
  };
}

/** رفض بسبب معروف — نص عربي جاهز للعرض + مفتاح للواجهة. */
function refuse(reason: string, message: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, reason, message, ...extra });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ ok: false }, { status: 401 });

  /*
   * قرار المالك (٢٠٢٦-٠٨-١٣): الموظف والمدير يبصمان — كلٌّ لنفسه — والمالك
   * خارج البصم تمامًا (مراقب لا مرصود). الفرض هنا على الخادم لا بإخفاء الزر:
   * نفس نطاق `getAttendanceBoard` حرفيًا، فلا تظهر باللوحة بصمة لمن ليس فيها.
   */
  if (session.user.role === Role.OWNER) {
    return NextResponse.json(
      { ok: false, reason: "owner_excluded", message: "المالك خارج نظام البصم" },
      { status: 403 },
    );
  }

  const userId = session.user.id;

  const body = await parseBody(req);
  if (!body) {
    return NextResponse.json(
      { ok: false, reason: "invalid", message: "بيانات غير صالحة" },
      { status: 400 },
    );
  }

  const settings = await getAttendanceSettings();
  const isOfficial =
    body.intent === AttendanceEventType.CHECK_IN || body.intent === AttendanceEventType.CHECK_OUT;

  // ===== ٣) دقّة القراءة — أسوأ من الحد نطلب إعادة المحاولة قبل تسجيل أي شيء =====
  if (body.accuracy > settings.minAccuracyMeters) {
    return refuse("weak_accuracy", "الإشارة ضعيفة، حاول مرة ثانية بمكان مفتوح");
  }

  // ===== ٤) فاصل التكرار — نفس النية خلال cooldownSeconds =====
  const cooldownFrom = new Date(Date.now() - settings.cooldownSeconds * 1000);
  const recent = await prisma.attendanceEvent.findFirst({
    where: { userId, type: body.intent, timestamp: { gte: cooldownFrom } },
    orderBy: { timestamp: "desc" },
    select: { id: true },
  });
  if (recent) {
    return refuse("cooldown", "سجّلت قبل شوي — انتظر لحظة وحاول مرة ثانية");
  }

  /*
   * حالة الجلسة قبل الموقع: «حاضر أصلًا» أو «ما سجّلت حضور» تعارض حالة لا مكان،
   * وتسجيل بصمة لها يلوّث السجل بلا فائدة. أما الخروج عن النطاق (تحت) فيُسجَّل
   * دائمًا — ذاك سلوك يستحق المراجعة لا خطأ في الواجهة.
   */
  const openSession = await prisma.attendanceSession.findFirst({
    where: { userId, endedAt: null },
    orderBy: { startedAt: "desc" },
  });
  if (body.intent === AttendanceEventType.CHECK_IN && openSession) {
    return refuse("already_checked_in", "أنت مسجّل حضور من قبل — سجّل انصرافك أول");
  }
  if (body.intent === AttendanceEventType.CHECK_OUT && !openSession) {
    return refuse("not_checked_in", "ما عندك حضور مفتوح — سجّل حضورك أول");
  }
  // «تغيير موقعي» محطة داخل جلسة — بلا جلسة مفتوحة لا معنى له.
  if (body.intent === AttendanceEventType.LOCATION_CHANGE && !openSession) {
    return refuse("not_checked_in", "ما عندك حضور مفتوح — سجّل حضورك أول");
  }

  // ===== ٥) المواقع المرشّحة — الحضور الرسمي من المقر فقط لو المشاريع مقفلة =====
  const active = await getActiveLocations();
  const candidates =
    isOfficial && !settings.allowProjectAttendance
      ? active.filter((l) => l.type === AttendanceLocationType.HQ)
      : active;

  // ===== ٦) المطابقة بالسيرفر =====
  const isLocationChange = body.intent === AttendanceEventType.LOCATION_CHANGE;
  /*
   * «تغيير موقعي» باختيار صريح من الشيت: الادّعاء هو الموقع المختار، والخادم
   * يعيد حساب المسافة إليه هو — لا لأقرب دائرة صدفةً. بلا اختيار (أو لبقية
   * الأنواع): المطابقة العادية ضد كل المرشّحين.
   */
  const chosenTarget =
    isLocationChange && body.targetLocationId
      ? (candidates.find((l) => l.id === body.targetLocationId) ?? null)
      : null;
  if (isLocationChange && body.targetLocationId && !chosenTarget) {
    return refuse("invalid", "الموقع المختار غير معروف أو معطّل");
  }
  const match = chosenTarget
    ? (() => {
        const d = distanceMeters(body.lat, body.lng, chosenTarget.lat, chosenTarget.lng);
        return d <= chosenTarget.radiusMeters + body.accuracy ? { id: chosenTarget.id, distance: d } : null;
      })()
    : matchLocation(body.lat, body.lng, body.accuracy, candidates);
  const now = new Date();

  // ===== ٧) خارج كل الدوائر =====
  if (!match) {
    const nearest = chosenTarget
      ? { id: chosenTarget.id, distance: distanceMeters(body.lat, body.lng, chosenTarget.lat, chosenTarget.lng) }
      : nearestLocation(body.lat, body.lng, candidates);

    await prisma.attendanceEvent.create({
      data: {
        userId,
        locationId: null,
        type: body.intent,
        timestamp: now,
        lat: body.lat,
        lng: body.lng,
        accuracy: body.accuracy,
        distanceMeters: nearest?.distance ?? 0,
        source: body.source,
        isMock: body.isMock,
        outOfZone: true,
        isLate: false,
      },
    });

    /*
     * قرار المالك: «تغيير موقعي» خارج النطاق **يُسجَّل ولا يوقف الدوام** —
     * محطة «خارج النطاق» حمراء + إشعار للمالك. بقية الأنواع تُرفض كما كانت.
     */
    if (isLocationChange) {
      // إثبات حياة فقط (v3) — بصمة خارج النطاق لا تجدد إثبات الموقع.
      await prisma.attendanceSession
        .updateMany({ where: { userId, endedAt: null }, data: { lastAliveAt: now } })
        .catch(() => {});
      try {
        const me = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
        const targetName = chosenTarget?.name ?? candidates.find((l) => l.id === nearest?.id)?.name ?? null;
        await notify(
          prisma,
          await ownerIds(prisma),
          "attendance.out_of_zone",
          locationChangeOutOfZoneText(me?.name ?? "موظف", nearest?.distance ?? null, targetName),
          undefined,
          `/attendance/${userId}`,
        );
      } catch (e) {
        console.error("[attendance] فشل إشعار خارج النطاق", e);
      }
      return NextResponse.json({
        ok: true,
        type: body.intent,
        locationName: null,
        timeKSA: formatTime(now),
        isLate: false,
        outOfZone: true,
      });
    }

    return refuse("out_of_zone", "أنت خارج الموقع — اقترب من الشركة أو المشروع عشان تسجّل", {
      distance: nearest ? Math.round(nearest.distance) : null,
    });
  }

  /*
   * ===== ٨) التأخير — بالدوام المحدد لا بالإعداد العام (المرحلة ٢) =====
   * الدوام الفعّال لليوم: `AttendanceSchedule` (أو الافتراضي) + استثناءات اليوم —
   * HOURS_EXCUSE يؤخّر بداية محاسبة التأخير، وMODIFIED_SHIFT يبدّل الهدف.
   */
  const todayKey = ksaDayKey(now);
  const [schedule, todayExceptions] = await Promise.all([
    prisma.attendanceSchedule.findUnique({ where: { userId } }),
    prisma.attendanceException.findMany({
      where: {
        userId,
        dateFrom: { lte: new Date(`${todayKey}T00:00:00Z`) },
        dateTo: { gte: new Date(`${todayKey}T00:00:00Z`) },
      },
    }),
  ]);
  // إعدادات الموظف الفعلية (ملف الموظف الحي) — العطلة والنداءات والإلزام لكل موظف.
  const config = mergeConfig(settings, schedule, now);
  const eff = effectiveDay(
    schedule,
    todayExceptions,
    todayKey,
    ksaDayOfWeek(now),
    config.weekendSet,
  );

  /*
   * ===== اليوم المنطقي (الدفعة الرابعة) — الحساب يومي لا جلسي =====
   * حضور ثانٍ فما فوق بنفس اليوم = **استئناف**: لا يعاد حساب التأخير (يُحسب
   * مرة واحدة من أول حضور)، والإشعار «كمّل دوامه». ويوم REMOTE/LEAVE لا بصم فيه.
   */
  const day =
    body.intent === AttendanceEventType.CHECK_IN
      ? await ensureAttendanceDay(prisma, userId, todayKey)
      : null;
  if (body.intent === AttendanceEventType.CHECK_IN) {
    if (day!.mode === "REMOTE") {
      return refuse("remote_day", "يومك مسجّل «عن بُعد» — ما فيه بصم موقع اليوم");
    }
    if (day!.mode === "LEAVE" || eff.onLeave) {
      return refuse("on_leave", "أنت بإجازة اليوم — ما تحتاج تبصم");
    }
    // القفل النهائي (يوم انقفل انقفل — القرار أ): أي بصمة بنفس اليوم تُرفض.
    if (day!.lockedAt) {
      return refuse("day_locked", "يومك مقفول — دوامك يبدأ بكرة");
    }
  }
  const isResume = body.intent === AttendanceEventType.CHECK_IN && day!.firstCheckInAt !== null;

  // أساس اليوم المغلق قبل هذي البصمة — لجدولة النداءات داخل المتبقي من الهدف.
  const dayBaseMinutes =
    body.intent === AttendanceEventType.CHECK_IN
      ? (await daySessionsOf(userId, todayKey)).reduce((s, x) => s + (x.workedMinutes ?? 0), 0)
      : 0;

  const nowMinutes = ksaMinutesOfDay(now);

  if (body.intent === AttendanceEventType.CHECK_IN) {
    // السياج الكلي (الدوام الواقعي — قرار ١): لا حضور خارج نافذة الشركة.
    if (nowMinutes < settings.workStartMinutes || nowMinutes >= settings.workEndMinutes) {
      return refuse(
        "company_closed",
        `الشركة مقفلة الحين — الدوام من ${minutesToHM(settings.workStartMinutes)} إلى ${minutesToHM(settings.workEndMinutes)}`,
      );
    }
    // الهدف مكتمل (قرار ٧): لا وقت إضافي يُحسب — «أكمل دوامه ✓».
    if (dayBaseMinutes >= eff.targetMinutes) {
      return refuse("target_done", "أكملت دوامك اليوم ✓ — ما فيه وقت إضافي يُحسب بعد الهدف");
    }
  }
  // «مراقبة فقط»/«معفى»: البصم يُسجَّل لكن بلا احتساب تأخير (لا إلزام).
  const isLate =
    body.intent === AttendanceEventType.CHECK_IN &&
    !isResume &&
    config.enforced &&
    isLateCheckIn(nowMinutes, eff, settings.lateThresholdMinutes);

  const location = candidates.find((l) => l.id === match.id) ?? null;

  // ===== تهدئة الانصراف: لا انصراف خلال ٦٠ ثانية من الحضور (ضغطة عرضية) =====
  if (
    body.intent === AttendanceEventType.CHECK_OUT &&
    openSession &&
    now.getTime() - openSession.startedAt.getTime() < 60_000
  ) {
    return refuse("too_soon", "سجّلت حضورك قبل لحظات — استنى دقيقة وحاول");
  }

  /*
   * للانصراف: الدقائق **صافية من التوقف** عبر الدالة المشتركة (الدفعة الثالثة).
   * توقف نشط لحظة الانصراف يُقفل أولًا عند لحظة الانصراف نفسها — فمدته كلها
   * مخصومة. تُحسب قبل المعاملة لتُستعمل في إشعار الاكتمال بعدها.
   */
  const sessionPauses =
    openSession && body.intent === AttendanceEventType.CHECK_OUT
      ? await prisma.attendancePause.findMany({ where: { sessionId: openSession.id } })
      : [];
  const workedMinutes = openSession
    ? activeWorkedMinutes(
        openSession.startedAt,
        now,
        sessionPauses.map((p) => ({ startedAt: p.startedAt, endedAt: p.endedAt ?? now })),
        now,
      )
    : 0;

  // ===== ٩) التسجيل + الجلسة — معاملة واحدة فلا تبقى بصمة بلا جلستها =====
  // معرّف جلسة الحضور المنشأة — لربط صف النبض الراداري بها بعد المعاملة.
  let checkInSessionId: string | null = null;
  const event = await prisma.$transaction(async (tx) => {
    const created = await tx.attendanceEvent.create({
      data: {
        userId,
        locationId: match.id,
        type: body.intent,
        timestamp: now,
        lat: body.lat,
        lng: body.lng,
        accuracy: body.accuracy,
        distanceMeters: match.distance,
        source: body.source,
        isMock: body.isMock,
        outOfZone: false,
        isLate,
      },
    });

    if (body.intent === AttendanceEventType.CHECK_IN) {
      const session = await tx.attendanceSession.create({
        // البصمة داخل النطاق بحكم الوصول هنا — إثباتا الحياة والموقع (v3) يبدآن معها.
        data: {
          userId, dayId: day!.id, checkInEventId: created.id, startedAt: now, wasLate: isLate,
          lastAliveAt: now, lastZoneProofAt: now,
        },
      });
      checkInSessionId = session.id;

      // أول حضور فقط يثبّت بداية اليوم وتأخيره — الاستئناف لا يمسّهما.
      if (!isResume) {
        await tx.attendanceDay.update({
          where: { id: day!.id },
          data: { firstCheckInAt: now, wasLate: isLate, lastActivityAt: now },
        });
      } else {
        await tx.attendanceDay.update({ where: { id: day!.id }, data: { lastActivityAt: now } });
      }

      /*
       * جدولة نداءات التحقق (التحقق الذكي — الدفعة الرابعة): حد أقصى نداءان
       * يوميًا مهما كان الإعداد، بحرسي بداية/نهاية من الإعدادات، ولا جدولة في
       * يوم إجازة أسبوعية. عند الاستئناف تُجدول داخل **المتبقي من هدف اليوم**
       * وبما لا يتجاوز السقف اليومي مع نداءات اليوم السابقة.
       */
      // فلسفة النبض الحاكم (الدفعة أ): لا جدولة نداءات عشوائية جديدة — البنية
      // باقية والمعلقة تنتهي طبيعيًا؛ الثابت موثق في attendance-conditional.
      if (!NEW_RANDOM_CALLS_DISABLED && settings.verificationEnabled && config.enforced && !eff.isWeekend) {
        const dailyCap = Math.min(config.verificationPerDay, 2);
        const alreadyToday = await tx.attendanceVerification.count({
          where: {
            userId,
            kind: "RANDOM",
            scheduledAt: { gte: new Date(`${todayKey}T00:00:00+03:00`) },
          },
        });
        const remainingTarget = Math.max(0, eff.targetMinutes - dayBaseMinutes);
        const quota = Math.max(0, dailyCap - alreadyToday);
        const times = planVerificationTimes(
          now,
          remainingTarget,
          quota,
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
    } else if (body.intent === AttendanceEventType.CHECK_OUT && openSession) {
      // الانصراف أثناء توقف يقفل التوقف أولًا — عند لحظة الانصراف.
      await tx.attendancePause.updateMany({
        where: { sessionId: openSession.id, endedAt: null },
        data: { endedAt: now },
      });
      await tx.attendanceSession.update({
        where: { id: openSession.id },
        // الانصراف داخل النطاق — يختم الإثباتين ويوسم المُغلِق (v3).
        data: {
          checkOutEventId: created.id, endedAt: now, workedMinutes,
          lastAliveAt: now, lastZoneProofAt: now, closedBy: "USER",
        },
      });
      // انصرف — نداءات اليوم التي لم تُرسل بعد صارت بلا معنى.
      await tx.attendanceVerification.deleteMany({ where: { userId, status: "PENDING" } });
      // «قفل اليوم نهائيًا» المفعّل لهذا الموظف: الانصراف يقفل اليوم (بصمة جديدة تُرفض).
      if (config.dayLockEnabled) {
        const dayRow = await ensureAttendanceDay(tx, userId, todayKey);
        if (!dayRow.lockedAt) {
          await tx.attendanceDay.update({ where: { id: dayRow.id }, data: { lockedAt: now } });
        }
      }
    } else if (body.intent === AttendanceEventType.LOCATION_CHANGE && openSession) {
      // تغيير موقع داخل النطاق = إثبات حياة وموقع (v3) — الجلسة نفسها لا تُمس عداهما.
      await tx.attendanceSession.update({
        where: { id: openSession.id },
        data: { lastAliveAt: now, lastZoneProofAt: now },
      });
    }
    // زيارة المشروع التاريخية (PROJECT_IN/OUT): حدث فقط بلا لمس للجلسة —
    // المحطات تُشتق من تسلسل الأحداث.

    return created;
  });

  /*
   * ===== إغلاق النبض: البصمة اليدوية إثبات راداري كامل =====
   * حضور ناجح داخل النطاق (الوصول هنا يضمنه) بدقة مقبولة أصلًا (حارس ٣) —
   * صف AttendancePulse من نفس الإحداثيات والحكم، فيظهر في «المواقع الحية»
   * فورًا بلا انتظار دورتي heartbeat (lastZoneProofAt خُتم بإنشاء الجلسة).
   * فشله لا يمس البصمة — النبض القادم يعوّضه.
   */
  if (body.intent === AttendanceEventType.CHECK_IN) {
    await prisma.attendancePulse
      .create({
        data: {
          userId,
          sessionId: checkInSessionId,
          at: now,
          lat: body.lat,
          lng: body.lng,
          accuracy: body.accuracy,
          locationId: match.id,
          inZone: true,
        },
      })
      .catch(() => {});
  }

  /*
   * ===== ١٠) إشعارات المالك — بعد نجاح المعاملة (best-effort لا يفشل البصمة) =====
   * الحضور والتأخير يُدمجان في إشعار واحد؛ الاكتمال عند انصرافٍ أنجز الهدف.
   * «حضر بدري» و«مشى متأخر» وسوم عرض فقط — لا إشعار لها.
   */
  /*
   * مجموع اليوم بعد البصمة (الدفعة الرابعة) — للإشعارات وللواجهة معًا:
   * «أكمل دوامه» يقارن **مجموع اليوم** بالهدف لا الجلسة الأخيرة، ويُرسل عند
   * عبور الهدف فقط (لا يتكرر مع كل انصراف لاحق).
   */
  const dayTotalMinutes = (await daySessionsOf(userId, todayKey)).reduce(
    (sum, s) => sum + (s.workedMinutes ?? 0),
    0,
  );

  try {
    if (body.intent === AttendanceEventType.CHECK_IN) {
      const me = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
      const name = me?.name ?? "موظف";
      const text = isResume
        ? resumedCheckInText(name, formatTime(now), location?.name ?? null)
        : isLate
          ? lateCheckInText(name, Math.max(1, nowMinutes - eff.accountStartMinutes), location?.name ?? null)
          : checkedInText(name, formatTime(now), location?.name ?? null);
      await notify(prisma, await ownerIds(prisma), "attendance.checked_in", text, undefined, `/attendance/${userId}`);
    } else if (
      body.intent === AttendanceEventType.CHECK_OUT &&
      dayTotalMinutes >= eff.targetMinutes &&
      dayTotalMinutes - workedMinutes < eff.targetMinutes
    ) {
      const me = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
      await notify(
        prisma,
        await ownerIds(prisma),
        "attendance.completed",
        completedText(me?.name ?? "موظف", eff.targetMinutes, location?.name ?? null),
        undefined,
        `/attendance/${userId}`,
      );
    }
  } catch (e) {
    console.error("[attendance] فشل إشعار المالك بعد البصمة", e);
  }

  return NextResponse.json({
    ok: true,
    type: event.type,
    locationName: location?.name ?? null,
    timeKSA: formatTime(now),
    isLate,
    outOfZone: false,
    resumed: isResume,
    dayWorkedMinutes: dayTotalMinutes,
    // نافذة التراجع عن الانصراف — ٩٠ ثانية.
    undoUntilIso:
      body.intent === AttendanceEventType.CHECK_OUT ? new Date(now.getTime() + 90_000).toISOString() : null,
  });
}
