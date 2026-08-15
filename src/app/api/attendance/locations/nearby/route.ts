import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { auth } from "@/auth";
import { distanceMeters } from "@/lib/geofence";
import { getActiveLocations } from "@/lib/data/attendance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * المواقع النشطة مرتبة بالأقرب — لشيت «وين أنت الآن؟» في زر «تغيير موقعي».
 *
 * المسافات تُحسب هنا على الخادم من قراءة واحدة أرسلها العميل — القائمة عرض
 * فقط، والاختيار النهائي يعاد التحقق منه في `/api/attendance/punch` بحسبة
 * مستقلة. الحارس نفس نطاق البصم: الموظف والمدير، والمالك خارج النظام.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ ok: false }, { status: 401 });
  if (session.user.role === Role.OWNER) {
    return NextResponse.json(
      { ok: false, message: "المالك خارج نظام البصم" },
      { status: 403 },
    );
  }

  let raw: { lat?: unknown; lng?: unknown; accuracy?: unknown };
  try {
    raw = (await req.json()) as typeof raw;
  } catch {
    return NextResponse.json({ ok: false, message: "بيانات غير صالحة" }, { status: 400 });
  }
  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  const accuracy = Number(raw.accuracy);
  if (
    !Number.isFinite(lat) || lat < -90 || lat > 90 ||
    !Number.isFinite(lng) || lng < -180 || lng > 180 ||
    !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100_000
  ) {
    return NextResponse.json({ ok: false, message: "بيانات غير صالحة" }, { status: 400 });
  }

  const locations = (await getActiveLocations())
    .map((l) => {
      const d = distanceMeters(lat, lng, l.lat, l.lng);
      return {
        id: l.id,
        name: l.name,
        type: l.type,
        distanceMeters: Math.round(d),
        // نفس هامش الدقة المعتمد في المطابقة — فلا يتناقض الشيت مع نتيجة البصم.
        inRange: d <= l.radiusMeters + accuracy,
      };
    })
    .sort((a, b) => a.distanceMeters - b.distanceMeters);

  return NextResponse.json({ ok: true, locations });
}
