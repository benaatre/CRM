import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { recordSessionBeat } from "@/lib/session-devices";
import { trackActivityWindow } from "@/lib/activity-window";
import { classifyZone, nearestLocation } from "@/lib/geofence";
import { dayDateOf, getActiveLocations, getAttendanceSettings, getAttendanceDay } from "@/lib/data/attendance";
import { ksaDayKey, ksaMinutesOfDay } from "@/lib/ksa-time";
import { effectiveDayOf, tryAutoPunch } from "@/lib/attendance-auto-punch";
import { createConditionalCall } from "@/lib/attendance-conditional";
import { effectiveConfigFor } from "@/lib/attendance-config";
import { notify, ownerIds } from "@/lib/notify";
import { formatTime } from "@/lib/format";

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

  // إعدادات الموظف الفعلية (ملف الموظف الحي) — الأوضاع الثلاثة تُنفَّذ هنا فعليًا.
  const config = await effectiveConfigFor(userId, { settings }, now);
  // «معفى مؤقتًا» = إيقاف كامل: لا رصد جغرافي ولا بصم تلقائي ولا نداءات — حياة رقمية فقط.
  if (config.mode === "EXEMPT") {
    return NextResponse.json({ ok: true, wantGeo: false, openSession: openSession !== null });
  }
  // «مراقبة فقط»: الرصد داخل نطاق الرصد المحدد حصرًا — خارجه لا يُسجَّل شيء.
  if (config.mode === "WATCH_ONLY" && (m < config.watchFromMinutes || m >= config.watchToMinutes)) {
    return NextResponse.json({ ok: true, wantGeo: false, openSession: openSession !== null });
  }

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
   * الحكم الخادمي المُدرك للدقة (ر٢): دقة أسوأ من الحد = لا حكم (inZone=null).
   * الدقة الجيدة → classifyZone: داخل/خارج بثقة، أو «غير معروف» على الحدود
   * (يُبقى الحكم السابق — لا نخرجه بقراءة حدّية). أفضل من حكم خاطئ يفتح نداءً.
   */
  const judgeable = acc !== null && acc <= settings.minAccuracyMeters;
  const zone = judgeable ? classifyZone(lat, lng, acc!, locations) : { state: "unknown" as const, id: null, distance: null };
  const match = zone.state === "in" && zone.id ? { id: zone.id, distance: zone.distance ?? 0 } : null;
  const inZone = zone.state === "in" ? true : zone.state === "out" ? false : null;

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
    if (prev?.inZone === true && config.enforced && config.outZoneCallEnabled) {
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

  // «مراقبة فقط» + تنبيه أول ظهور: أول نبضة داخل نطاق اليوم تُعلم المالك.
  if (config.mode === "WATCH_ONLY" && config.watchAlertFirstSeen && inZone === true) {
    const earlier = await prisma.attendancePulse.count({
      where: { userId, at: { gte: new Date(`${todayKey}T00:00:00+03:00`), lt: now }, inZone: true },
    });
    if (earlier === 0) {
      const locName = locations.find((l) => l.id === match?.id)?.name ?? "داخل النطاق";
      await notify(
        prisma,
        await ownerIds(prisma),
        "attendance.watch_first_seen",
        `أول ظهور ${session.user.name ?? "موظف"} اليوم — ${locName} · ${formatTime(now)}`,
        undefined,
        `/employees/${userId}`,
      ).catch(() => {});
    }
  }

  // ===== البصم التلقائي — بلا جلسة ونبضة داخل النطاق (يوم ONSITE و«ملزم» فقط) =====
  let autoPunched = false;
  if (inZone === true && !openSession && match && onsiteDay && config.enforced) {
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
