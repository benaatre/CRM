import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { recordSessionBeat } from "@/lib/session-devices";
import { trackActivityWindow } from "@/lib/activity-window";
import { matchLocation, nearestLocation } from "@/lib/geofence";
import { getActiveLocations, getAttendanceSettings, getAttendanceDay } from "@/lib/data/attendance";
import { ksaDayKey, ksaMinutesOfDay } from "@/lib/ksa-time";
import { activeOnWayDecision, effectiveDayOf, tryAutoPunch } from "@/lib/attendance-auto-punch";

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
   * - أو بلا جلسة داخل نافذة البداية / «بالطريق» نشطة — للبصم التلقائي.
   */
  const day = await getAttendanceDay(userId, ksaDayKey(now));
  const onsiteDay = day === null || day.mode === "ONSITE";
  const settings = await getAttendanceSettings();

  let geoEligible = false;
  if (onsiteDay) {
    if (openSession) {
      geoEligible = true;
    } else {
      const eff = await effectiveDayOf(userId, now);
      const m = ksaMinutesOfDay(now);
      const inStartWindow = !eff.isWeekend && !eff.onLeave && m >= eff.startMinutes && m <= eff.windowEndMinutes;
      geoEligible =
        inStartWindow || (await activeOnWayDecision(userId, now, settings.arrivalMarginMinutes)) !== null;
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

  // ===== البصم التلقائي — بلا جلسة ونبضة داخل النطاق =====
  let autoPunched = false;
  if (inZone === true && !openSession && match) {
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
    }).catch(() => ({ punched: false as const }));
    autoPunched = outcome.punched;
  }

  // أرسل إحداثيات توًّا — لا نطلب غيرها بنفس النبضة.
  return NextResponse.json({ ok: true, wantGeo: false, openSession: openSession !== null || autoPunched });
}
