import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireOwnerApi } from "@/lib/attendance-guard";
import { getScheduleFor } from "@/lib/data/attendance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** دوام الموظف المحدد — المالك فقط يقرأ ويعدّل. */
export async function GET(_req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const guard = await requireOwnerApi();
  if (!guard.ok) return guard.res;

  const { userId } = await params;
  return NextResponse.json({ ok: true, schedule: await getScheduleFor(userId) });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const guard = await requireOwnerApi();
  if (!guard.ok) return guard.res;

  const { userId } = await params;
  let raw: { startMinutes?: unknown; shiftMinutes?: unknown };
  try {
    raw = (await req.json()) as typeof raw;
  } catch {
    return NextResponse.json({ ok: false, error: "بيانات غير صالحة" }, { status: 400 });
  }

  const startMinutes = Math.round(Number(raw.startMinutes));
  const shiftMinutes = Math.round(Number(raw.shiftMinutes));
  if (!Number.isFinite(startMinutes) || startMinutes < 0 || startMinutes > 1439) {
    return NextResponse.json({ ok: false, error: "بداية الدوام غير صحيحة" }, { status: 400 });
  }
  // من ساعة إلى ١٦ ساعة — خارجها ضبط خاطئ يفسد العدادات كلها.
  if (!Number.isFinite(shiftMinutes) || shiftMinutes < 60 || shiftMinutes > 960) {
    return NextResponse.json({ ok: false, error: "عدد الساعات غير صحيح (من ساعة إلى ١٦)" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user) return NextResponse.json({ ok: false, error: "الموظف غير موجود" }, { status: 404 });
  if (user.role === Role.OWNER) {
    return NextResponse.json({ ok: false, error: "المالك خارج نظام البصم" }, { status: 400 });
  }

  const schedule = await prisma.attendanceSchedule.upsert({
    where: { userId },
    update: { startMinutes, shiftMinutes },
    create: { userId, startMinutes, shiftMinutes },
  });
  return NextResponse.json({ ok: true, schedule });
}
