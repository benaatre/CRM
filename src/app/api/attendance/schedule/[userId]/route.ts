import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireOwnerApi } from "@/lib/attendance-guard";
import { getScheduleFor } from "@/lib/data/attendance";
import { recordAuditEvent } from "@/lib/audit-event";

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
  let raw: { startMinutes?: unknown; shiftMinutes?: unknown; startWindowEndMinutes?: unknown };
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
  /*
   * نافذة البداية المرنة (الدوام الواقعي — قرار ٢): اختيارية؛ null = وقت واحد.
   * لازم تكون بعد البداية وبفارق منطقي (حتى ٦ ساعات — أوسع منها ضبط خاطئ).
   */
  let startWindowEndMinutes: number | null = null;
  if (raw.startWindowEndMinutes !== undefined && raw.startWindowEndMinutes !== null && raw.startWindowEndMinutes !== "") {
    startWindowEndMinutes = Math.round(Number(raw.startWindowEndMinutes));
    if (!Number.isFinite(startWindowEndMinutes) || startWindowEndMinutes <= startMinutes || startWindowEndMinutes > 1439) {
      return NextResponse.json({ ok: false, error: "نهاية نافذة البداية لازم تكون بعد بدايتها" }, { status: 400 });
    }
    if (startWindowEndMinutes - startMinutes > 360) {
      return NextResponse.json({ ok: false, error: "نافذة البداية تتجاوز ٦ ساعات — تأكد من الوقتين" }, { status: 400 });
    }
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user) return NextResponse.json({ ok: false, error: "الموظف غير موجود" }, { status: 404 });
  if (user.role === Role.OWNER) {
    return NextResponse.json({ ok: false, error: "المالك خارج نظام البصم" }, { status: 400 });
  }

  const before = await prisma.attendanceSchedule.findUnique({ where: { userId } });
  const schedule = await prisma.attendanceSchedule.upsert({
    where: { userId },
    update: { startMinutes, shiftMinutes, startWindowEndMinutes },
    create: { userId, startMinutes, shiftMinutes, startWindowEndMinutes },
  });
  // سجل التدقيق (الدفعة الرابعة) — تعديل الدوام إجراء مالك حسّاس.
  await recordAuditEvent(prisma, {
    actorId: guard.userId,
    actorRole: "OWNER",
    action: "SCHEDULE_UPDATE",
    resourceType: "attendance_schedule",
    resourceId: userId,
    before: before
      ? { startMinutes: before.startMinutes, shiftMinutes: before.shiftMinutes, startWindowEndMinutes: before.startWindowEndMinutes }
      : null,
    after: { startMinutes, shiftMinutes, startWindowEndMinutes },
    ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  });
  return NextResponse.json({ ok: true, schedule });
}
