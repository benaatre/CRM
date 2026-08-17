import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { recordSessionBeat } from "@/lib/session-devices";
import { trackActivityWindow } from "@/lib/activity-window";
import { matchLocation, nearestLocation } from "@/lib/geofence";
import { dayDateOf, getActiveLocations, getAttendanceSettings, getAttendanceDay } from "@/lib/data/attendance";
import { ksaDayKey, ksaMinutesOfDay } from "@/lib/ksa-time";
import { effectiveDayOf, tryAutoPunch } from "@/lib/attendance-auto-punch";
import { createConditionalCall } from "@/lib/attendance-conditional";

export const runtime = "nodejs";

/**
 * النبضة — «آخر ظهور» + الجهاز + نافذة «عن بُعد»، ومن الثقة المتجددة v3:
 *
 * - أي نبضة أثناء جلسة دوام مفتوحة تحدّث `lastAliveAt` (إثبات حياة).
 * - النبضة **الجغرافية** (بإحداثيات) تُصنَّف على الخادم — لا ثقة بادعاء العميل:
 *   داخل دائرة → صف AttendancePulse بـinZone=true + تحديث `lastZoneProofAt`؛
 *   خارجها → inZone=false؛ دقة أسوأ من الحد → inZone=null (حياة بلا حكم موقع).
 * - **البصم التلقائي (الدوام الواقعي — قرار ٣)**: بلا جلسة وداخل نافذة بدايته
 *   (أو «بالطريق» معلنة)، نبضتان متتاليتان داخل النطاق تبصمان له فورًا —
 *   الحمايتان (التتالي + القفل الذري) في tryAutoPunch.
 * - `wantGeo` بالرد يطلب قراءة صامتة — فقط بإذن قائم (لا prompt من النبضة).
 * - `openSession` بالرد: العميل يرفع الإيقاع لدقيقة أثناء الدوام (قرار ١٠).
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ ok: false }, { status: 401 });
  const userId = session.user.id;
  const now = new Date();

  await prisma.user.update({ where: { id: userId }, data: { lastSeenAt: now } });
  // سجل الجهاز (جوال/كمبيوتر + المتصفح) — فشله لا يُفشِل النبضة.
  await recordSessionBeat(userId, req.headers.get("user-agent")).catch(() => {});
  /*
   * قياس نشاط «عن بُعد» (الدفعة الرابعة): النبضة هي **مصدر الحقيقة** — تمدّد
   * فترة الفتح الجارية أو تفتح جديدة بعد انقطاع. فشلها لا يُفشِل النبضة.
   */
  await trackActivityWindow(userId, now).catch(() => {});

  // OWNER لا يبصم ولا يُنادى — نبضته حضور رقمي فقط.
  if (session.user.role === Role.OWNER) {
    return NextResponse.json({ ok: true, wantGeo: false, openSession: false });
  }

  const openSession = await prisma.attendanceSession.findFirst({
    where: { userId, endedAt: null },
    select: { id: true },
  });

  // إثبات حياة — كل نبضة أثناء الجلسة، جغرافية كانت أم لا.
  if (openSession) {
    await prisma.attendanceSession
      .update({ where: { id: openSession.id }, data: { lastAliveAt: now } })
      .catch(() => {});
  }

  /*
   * الاستحقاق الجغرافي:
   * - جلسة مفتوحة بيوم «في الموقع» — مراقبة الدوام.
   * - بلا جلسة داخل نافذة الشركة كلها — للبصم التلقائي (المبكر حق، وما بعد
   *   نافذته الشخصية يُبصم بدل ما تُعرض عليه شاشة الحسم).
   * - يوم إجازة/استئذان **ذاتي** (من شاشة الحسم) — نبضات كشف الرجوع: دخوله
   *   النطاق يفتح بانر «تلغي استئذانك وتبصم؟».
   */
  const todayKey = ksaDayKey(now);
  const day = await getAttendanceDay(userId, todayKey);
  const onsiteDay = day === null || day.mode === "ONSITE";
  const settings = await getAttendanceSettings();
  const m = ksaMinutesOfDay(now);
  const inCompanyWindow = m >= settings.workStartMinutes && m < settings.workEndMinutes;

  let geoEligible = false;
  let latePunchContext = false;
  if (openSession) {
    geoEligible = onsiteDay;
  } else if (inCompanyWindow) {
    const eff = await effectiveDayOf(userId, now);
    if (!eff.isWeekend && !eff.onLeave) {
      if (onsiteDay) {
        geoEligible = true;
        latePunchContext = m > eff.windowEndMinutes;
      } else if (day?.mode === "LEAVE") {
        // إجازة/استئذان ذاتيان فقط (قرار من شاشة الحسم) — لكشف الرجوع.
        const selfDeclared = await prisma.attendanceDecision.findFirst({
          where: { userId, date: dayDateOf(todayKey), kind: { in: ["LEAVE", "EXCUSED"] }, outcome: { not: "REVOKED" } },
          select: { id: true },
        });
        geoEligible = selfDeclared !== null;
      }
    }
  }

  let raw: { lat?: unknown; lng?: unknown; accuracy?: unknown };
  try {
    raw = (await req.json()) as typeof raw;
  } catch {
    raw = {};
  }
  const lat = Number(raw.lat);
  const lng = Number(raw.lng);

  // نبضة بلا إحداثيات — نطلبها للقادمة إن كان مستحقًا.
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ ok: true, wantGeo: geoEligible, openSession: openSession !== null });
  }
  if (!geoEligible || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return NextResponse.json({ ok: true, wantGeo: false, openSession: openSession !== null });
  }

  const accuracy = Number(raw.accuracy);
  const acc = Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= 100_000 ? accuracy : null;

  const locations = await getActiveLocations();
  /*
   * الحكم الخادمي: دقة أسوأ من الحد = لا حكم (inZone=null) — أفضل من حكم
   * «خارج النطاق» خاطئ يفتح نداءً ظالمًا. الدقة الجيدة تُطابَق كالبصمة.
   */
  const judgeable = acc !== null && acc <= settings.minAccuracyMeters;
  const match = judgeable ? matchLocation(lat, lng, acc, locations) : null;
  const inZone = judgeable ? match !== null : null;

  await prisma.attendancePulse.create({
    data: {
      userId,
      sessionId: openSession?.id ?? null,
      at: now,
      lat,
      lng,
      accuracy: acc,
      locationId: match?.id ?? null,
      inZone,
    },
  });

  if (inZone === true && openSession) {
    await prisma.attendanceSession
      .update({ where: { id: openSession.id }, data: { lastZoneProofAt: now } })
      .catch(() => {});
  }

  /*
   * ===== خروج النطاق يُكتشف بالدقيقة (الدوام الواقعي — قرار ١٠) =====
   * نبضة خارج النطاق والنبضة السابقة داخله = خرج توًّا → نداء «طلعت من
   * {الموقع} — وين رايح؟» فورًا. رد النداء القائم يغطي الخيارات: بالموقع
   * (راجع) / ذاهب لمشروع / استئذان / انصراف («خلصت زيارتي»).
   */
  if (inZone === false && openSession) {
    // النبضة الحالية سُجّلت بـat=now فيستثنيها lt — هذي أحدث نبضة قبلها بحكم.
    const prev = await prisma.attendancePulse
      .findFirst({
        where: { userId, at: { lt: now, gte: new Date(now.getTime() - 5 * 60_000) }, inZone: { not: null } },
        orderBy: { at: "desc" },
        include: { location: { select: { name: true } } },
      })
      .catch(() => null);
    if (prev?.inZone === true) {
      await createConditionalCall({
        userId,
        sessionId: openSession.id,
        reason: "OUT_ZONE",
        now,
        windowMinutes: settings.conditionalWindowMinutes,
        cooldownMinutes: settings.conditionalCooldownMinutes,
        maxPerDay: settings.maxConditionalPerDay,
        title: `طلعت من ${prev.location?.name ?? "موقع العمل"} — وين رايح؟`,
        body: "أكّد وضعك: بالموقع / ذاهب لمشروع / استئذان — أو سجّل انصرافك",
      }).catch(() => {});
    }
  }

  // ===== البصم التلقائي — بلا جلسة ونبضة داخل النطاق (يوم ONSITE فقط) =====
  let autoPunched = false;
  if (inZone === true && !openSession && match && onsiteDay) {
    const nearest = nearestLocation(lat, lng, locations);
    const outcome = await tryAutoPunch({
      userId,
      now,
      lat,
      lng,
      accuracy: acc,
      locationId: match.id,
      locationName: locations.find((l) => l.id === match.id)?.name ?? null,
      distanceMeters: nearest?.distance ?? match.distance,
      // ما بعد نافذته الشخصية: نبضة واحدة تكفي — أولوية البصم على شاشة الحسم.
      singlePulse: latePunchContext,
    }).catch(() => ({ punched: false as const }));
    autoPunched = outcome.punched;
  }

  // أرسل إحداثيات توًّا — لا نطلب غيرها بنفس النبضة.
  return NextResponse.json({ ok: true, wantGeo: false, openSession: openSession !== null || autoPunched });
}
