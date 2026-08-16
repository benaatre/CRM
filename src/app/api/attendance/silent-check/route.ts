import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { matchLocation, nearestLocation } from "@/lib/geofence";
import { ksaDayKey } from "@/lib/ksa-time";
import { getActiveLocations, getAttendanceSettings, getAttendanceDay } from "@/lib/data/attendance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * الفحص الصامت عند فتح التطبيق (بديل التتبع) — وضع «في الموقع» فقط وأثناء
 * جلسة مفتوحة وبفاصل لا يقل عن silentCheckIntervalMinutes عن آخر فحص.
 *
 * صامت بالكامل: لا إشعار ولا أثر مرئي للموظف، والفشل/الرفض يُتجاهل. يُعرض
 * للمالك فقط، ومذكور صراحة في شاشة إفصاح الخصوصية.
 *
 * جسم بلا إحداثيات = سؤال «هل الفحص مستحق؟» (فلا يقرأ العميل الموقع عبثًا)؛
 * جسم بإحداثيات = تسجيل الفحص بعد إعادة التحقق من الاستحقاق.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ ok: true, due: false });
  if (session.user.role === Role.OWNER) return NextResponse.json({ ok: true, due: false });
  const userId = session.user.id;

  let raw: { lat?: unknown; lng?: unknown; accuracy?: unknown };
  try {
    raw = (await req.json()) as typeof raw;
  } catch {
    raw = {};
  }

  const now = new Date();
  const todayKey = ksaDayKey(now);

  const [day, openSession, settings] = await Promise.all([
    getAttendanceDay(userId, todayKey),
    prisma.attendanceSession.findFirst({ where: { userId, endedAt: null }, select: { id: true } }),
    getAttendanceSettings(),
  ]);

  // الاستحقاق: يوم موقعي + جلسة مفتوحة + فاصل كافٍ عن آخر فحص.
  const eligible = openSession !== null && (day === null || day.mode === "ONSITE");
  let due = eligible;
  if (eligible) {
    const last = await prisma.attendanceSilentCheck.findFirst({
      where: { userId, at: { gte: new Date(now.getTime() - settings.silentCheckIntervalMinutes * 60_000) } },
      select: { id: true },
    });
    due = last === null;
  }

  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ ok: true, due });
  }

  // إحداثيات واصلة لكن الاستحقاق سقط (سباق فتحين متقاربين) — تجاهل صامت.
  if (!due || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return NextResponse.json({ ok: true, due: false });
  }
  const accuracy = Number(raw.accuracy);
  const acc = Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= 100_000 ? accuracy : null;

  const locations = await getActiveLocations();
  const match = matchLocation(lat, lng, acc ?? 0, locations);
  const nearest = match ?? nearestLocation(lat, lng, locations);

  await prisma.attendanceSilentCheck.create({
    data: {
      userId,
      at: now,
      lat,
      lng,
      accuracy: acc,
      locationId: match?.id ?? null,
      distanceMeters: nearest?.distance ?? null,
      outOfZone: !match,
    },
  });

  // صامت حتى في الرد — العميل لا يعرض شيئًا أيًّا كانت النتيجة.
  return NextResponse.json({ ok: true, due: false });
}
