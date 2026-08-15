import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { matchLocation, nearestLocation } from "@/lib/geofence";
import { getActiveLocations, getAttendanceSettings } from "@/lib/data/attendance";
import { verifyOutOfZoneText } from "@/lib/attendance-notify";
import { notify, ownerIds } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ردّ الموظف على نداء التحقق — قراءة موقع واحدة، والحكم كله على الخادم:
 * Haversine ضد المواقع النشطة، داخل → CONFIRMED، خارج → OUT_OF_ZONE + إشعار
 * المالك بالمسافة عن أقرب موقع. لا ثقة بأي «داخل النطاق» قادم من الجوال.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ ok: false }, { status: 401 });
  if (session.user.role === Role.OWNER) {
    return NextResponse.json(
      { ok: false, reason: "owner_excluded", message: "المالك خارج نظام البصم" },
      { status: 403 },
    );
  }
  const userId = session.user.id;

  let raw: { lat?: unknown; lng?: unknown; accuracy?: unknown; isMock?: unknown };
  try {
    raw = (await req.json()) as typeof raw;
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid", message: "بيانات غير صالحة" }, { status: 400 });
  }
  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  const accuracy = Number(raw.accuracy);
  if (
    !Number.isFinite(lat) || lat < -90 || lat > 90 ||
    !Number.isFinite(lng) || lng < -180 || lng > 180 ||
    !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100_000
  ) {
    return NextResponse.json({ ok: false, reason: "invalid", message: "بيانات غير صالحة" }, { status: 400 });
  }

  const now = new Date();
  const pending = await prisma.attendanceVerification.findFirst({
    where: { userId, status: "SENT", deadlineAt: { gt: now } },
    orderBy: { sentAt: "desc" },
  });
  if (!pending) {
    return NextResponse.json({
      ok: false,
      reason: "no_pending",
      message: "ما عندك نداء تحقق نشط الحين",
    });
  }

  // فحص الدقة كما في punch — قراءة ضعيفة تُرفض قبل أي تسجيل، والنداء يبقى نشطًا.
  const settings = await getAttendanceSettings();
  if (accuracy > settings.minAccuracyMeters) {
    return NextResponse.json({
      ok: false,
      reason: "weak_accuracy",
      message: "الإشارة ضعيفة، حاول مرة ثانية بمكان مفتوح",
    });
  }

  const locations = await getActiveLocations();
  const match = matchLocation(lat, lng, accuracy, locations);

  if (match) {
    await prisma.attendanceVerification.update({
      where: { id: pending.id },
      data: {
        status: "CONFIRMED",
        respondedAt: now,
        lat,
        lng,
        accuracy,
        locationId: match.id,
        distanceMeters: match.distance,
      },
    });
    const name = locations.find((l) => l.id === match.id)?.name ?? null;
    return NextResponse.json({
      ok: true,
      status: "CONFIRMED",
      message: `تم — أكّدنا موقعك${name ? ` في ${name}` : ""}`,
    });
  }

  // خارج النطاق: يُسجَّل الرد كما هو ويُنبَّه المالك — لا رفض صامت.
  const nearest = nearestLocation(lat, lng, locations);
  await prisma.attendanceVerification.update({
    where: { id: pending.id },
    data: {
      status: "OUT_OF_ZONE",
      respondedAt: now,
      lat,
      lng,
      accuracy,
      locationId: null,
      distanceMeters: nearest?.distance ?? null,
    },
  });
  try {
    const me = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    await notify(
      prisma,
      await ownerIds(prisma),
      "attendance.verify_out_of_zone",
      verifyOutOfZoneText(
        me?.name ?? "موظف",
        nearest?.distance ?? null,
        nearest ? (locations.find((l) => l.id === nearest.id)?.name ?? null) : null,
      ),
      undefined,
      `/attendance/${userId}`,
    );
  } catch (e) {
    console.error("[attendance] فشل إشعار المالك برد خارج النطاق", e);
  }

  return NextResponse.json({
    ok: true,
    status: "OUT_OF_ZONE",
    message: "سجّلنا ردك، لكن موقعك خارج النطاق — بلّغنا المالك",
  });
}
