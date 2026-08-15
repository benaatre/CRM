import { NextResponse } from "next/server";
import {
  AttendanceEventType,
  AttendanceLocationType,
  AttendanceSource,
  Role,
} from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { matchLocation, nearestLocation } from "@/lib/geofence";
import { ksaDayKey, ksaDayOfWeek, ksaMinutesOfDay } from "@/lib/ksa-time";
import { formatTime } from "@/lib/format";
import { getAttendanceSettings, getActiveLocations } from "@/lib/data/attendance";
import {
  effectiveDay,
  isLateCheckIn,
  parseWeekendDays,
  planVerificationTimes,
} from "@/lib/attendance-logic";
import { checkedInText, completedText, lateCheckInText } from "@/lib/attendance-notify";
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
};

type Parsed = {
  lat: number;
  lng: number;
  accuracy: number;
  isMock: boolean;
  source: AttendanceSource;
  intent: AttendanceEventType;
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

  // ===== ٥) المواقع المرشّحة — الحضور الرسمي من المقر فقط لو المشاريع مقفلة =====
  const active = await getActiveLocations();
  const candidates =
    isOfficial && !settings.allowProjectAttendance
      ? active.filter((l) => l.type === AttendanceLocationType.HQ)
      : active;

  // ===== ٦) المطابقة بالسيرفر =====
  const match = matchLocation(body.lat, body.lng, body.accuracy, candidates);
  const now = new Date();

  // ===== ٧) خارج كل الدوائر: تُسجَّل للمراجعة ثم تُرفض بوضوح =====
  if (!match) {
    const nearest = nearestLocation(body.lat, body.lng, candidates);
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
  const eff = effectiveDay(
    schedule,
    todayExceptions,
    todayKey,
    ksaDayOfWeek(now),
    parseWeekendDays(settings.weekendDays),
  );

  const nowMinutes = ksaMinutesOfDay(now);
  const isLate =
    body.intent === AttendanceEventType.CHECK_IN &&
    isLateCheckIn(nowMinutes, eff, settings.lateThresholdMinutes);

  const location = candidates.find((l) => l.id === match.id) ?? null;

  // للانصراف: تُحسب قبل المعاملة لتُستعمل في إشعار الاكتمال بعدها.
  const workedMinutes = openSession
    ? Math.max(0, Math.round((now.getTime() - openSession.startedAt.getTime()) / 60_000))
    : 0;

  // ===== ٩) التسجيل + الجلسة — معاملة واحدة فلا تبقى بصمة بلا جلستها =====
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
        data: { userId, checkInEventId: created.id, startedAt: now, wasLate: isLate },
      });

      /*
       * جدولة نداءات التحقق: N أوقات عشوائية داخل ما تبقى من دوامه (ليست في
       * أول ٣٠ دقيقة ولا آخرها). الكرون يلتقط ما حان وقته ويرسل الإشعار.
       */
      if (settings.verificationEnabled) {
        const times = planVerificationTimes(now, eff.targetMinutes, settings.verificationPerDay);
        if (times.length > 0) {
          await tx.attendanceVerification.createMany({
            data: times.map((t) => ({ userId, sessionId: session.id, scheduledAt: t })),
          });
        }
      }
    } else if (body.intent === AttendanceEventType.CHECK_OUT && openSession) {
      await tx.attendanceSession.update({
        where: { id: openSession.id },
        data: { checkOutEventId: created.id, endedAt: now, workedMinutes },
      });
      // انصرف — نداءات اليوم التي لم تُرسل بعد صارت بلا معنى.
      await tx.attendanceVerification.deleteMany({ where: { userId, status: "PENDING" } });
    }
    // زيارة المشروع (PROJECT_IN/OUT): حدث فقط بلا جلسة.

    return created;
  });

  /*
   * ===== ١٠) إشعارات المالك — بعد نجاح المعاملة (best-effort لا يفشل البصمة) =====
   * الحضور والتأخير يُدمجان في إشعار واحد؛ الاكتمال عند انصرافٍ أنجز الهدف.
   * «حضر بدري» و«مشى متأخر» وسوم عرض فقط — لا إشعار لها.
   */
  try {
    if (body.intent === AttendanceEventType.CHECK_IN) {
      const me = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
      const name = me?.name ?? "موظف";
      const text = isLate
        ? lateCheckInText(name, Math.max(1, nowMinutes - eff.accountStartMinutes), location?.name ?? null)
        : checkedInText(name, formatTime(now), location?.name ?? null);
      await notify(prisma, await ownerIds(prisma), "attendance.checked_in", text, undefined, `/attendance/${userId}`);
    } else if (body.intent === AttendanceEventType.CHECK_OUT && workedMinutes >= eff.targetMinutes) {
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
  });
}
