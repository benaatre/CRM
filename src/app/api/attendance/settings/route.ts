import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwnerApi } from "@/lib/attendance-guard";
import { getAttendanceSettings } from "@/lib/data/attendance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** حدود كل إعداد — الرقم خارجها يعني ضبطًا خاطئًا يعطّل النظام كله بصمت. */
const RANGES: Record<string, [number, number]> = {
  workStartMinutes: [0, 1439],
  workEndMinutes: [0, 1439],
  lateThresholdMinutes: [0, 240],
  minAccuracyMeters: [10, 1000],
  cooldownSeconds: [0, 3600],
};

export async function GET() {
  const guard = await requireOwnerApi();
  if (!guard.ok) return guard.res;

  return NextResponse.json({ ok: true, settings: await getAttendanceSettings() });
}

export async function PATCH(req: Request) {
  const guard = await requireOwnerApi();
  if (!guard.ok) return guard.res;

  let raw: Record<string, unknown>;
  try {
    raw = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "بيانات غير صالحة" }, { status: 400 });
  }

  const data: Record<string, number | boolean> = {};
  for (const [key, [min, max]] of Object.entries(RANGES)) {
    if (raw[key] === undefined) continue;
    const v = Math.round(Number(raw[key]));
    if (!Number.isFinite(v) || v < min || v > max) {
      return NextResponse.json({ ok: false, error: "قيمة خارج الحدود المسموحة" }, { status: 400 });
    }
    data[key] = v;
  }
  if (typeof raw.allowProjectAttendance === "boolean") {
    data.allowProjectAttendance = raw.allowProjectAttendance;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ ok: false, error: "ما فيه شي للتعديل" }, { status: 400 });
  }

  // نهاية دوام قبل بدايته تجعل «متأخر» بلا معنى — نفحصها على القيم بعد الدمج.
  const current = await getAttendanceSettings();
  const start = (data.workStartMinutes as number) ?? current.workStartMinutes;
  const end = (data.workEndMinutes as number) ?? current.workEndMinutes;
  if (end <= start) {
    return NextResponse.json(
      { ok: false, error: "نهاية الدوام لازم تكون بعد بدايته" },
      { status: 400 },
    );
  }

  const settings = await prisma.attendanceSettings.update({ where: { id: "singleton" }, data });
  return NextResponse.json({ ok: true, settings });
}
