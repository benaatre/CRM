import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwnerApi } from "@/lib/attendance-guard";
import { getAllLocations } from "@/lib/data/attendance";
import { parseLocation, type LocationInput } from "@/lib/attendance-location-input";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** قائمة المواقع (النشطة والمعطّلة) — للوحة المالك. */
export async function GET() {
  const guard = await requireOwnerApi();
  if (!guard.ok) return guard.res;

  return NextResponse.json({ ok: true, locations: await getAllLocations() });
}

/** إضافة موقع جديد (مقر أو مشروع). */
export async function POST(req: Request) {
  const guard = await requireOwnerApi();
  if (!guard.ok) return guard.res;

  let raw: Record<string, unknown>;
  try {
    raw = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "بيانات غير صالحة" }, { status: 400 });
  }

  const parsed = parseLocation(raw);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

  const location = await prisma.attendanceLocation.create({ data: parsed.data as LocationInput });
  return NextResponse.json({ ok: true, location });
}
