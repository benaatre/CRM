import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwnerApi } from "@/lib/attendance-guard";
import { ksaDayKey } from "@/lib/ksa-time";
import { activeWorkedMinutes } from "@/lib/attendance-logic";
import { ensureAttendanceDay } from "@/lib/data/attendance";
import { recordAuditEvent } from "@/lib/audit-event";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * قفل اليوم يدويًا (ملف الموظف الحي — القرار أ): يوم انقفل انقفل — أي بصمة
 * بنفس اليوم تُرفض «يومك مقفول — دوامك يبدأ بكرة»، واليوم التالي طبيعي.
 * الجلسة المفتوحة (إن وُجدت) تُقفل الآن بنفس مكانيكا session-repair (توقف جارٍ
 * يُقفل عند بدئه)، ثم يُختم اليوم lockedAt. تدقيق DAY_LOCK بسبب إلزامي.
 */
export async function POST(req: Request) {
  const guard = await requireOwnerApi();
  if (!guard.ok) return guard.res;

  let raw: { userId?: unknown; reason?: unknown };
  try {
    raw = (await req.json()) as typeof raw;
  } catch {
    return NextResponse.json({ ok: false, error: "بيانات غير صالحة" }, { status: 400 });
  }
  const userId = typeof raw.userId === "string" ? raw.userId : "";
  const reason = typeof raw.reason === "string" ? raw.reason.trim().slice(0, 500) : "";
  if (!userId) return NextResponse.json({ ok: false, error: "حدّد الموظف" }, { status: 400 });
  if (!reason) return NextResponse.json({ ok: false, error: "اكتب سبب القفل" }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user || user.role === "OWNER") return NextResponse.json({ ok: false, error: "الموظف غير موجود" }, { status: 404 });

  const now = new Date();
  const todayKey = ksaDayKey(now);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  const result = await prisma.$transaction(async (tx) => {
    const day = await ensureAttendanceDay(tx, userId, todayKey);
    if (day.lockedAt) return { alreadyLocked: true as const, closedSessionId: null as string | null, workedMinutes: null as number | null };

    // إقفال الجلسة المفتوحة (إن وُجدت) — نفس قاعدة التوقف الجاري في session-repair.
    const open = await tx.attendanceSession.findFirst({ where: { userId, endedAt: null, voided: false } });
    let closedSessionId: string | null = null;
    let workedMinutes: number | null = null;
    if (open) {
      const pauses = await tx.attendancePause.findMany({ where: { sessionId: open.id } });
      const openPause = pauses.find((p) => p.endedAt === null) ?? null;
      const closeMoment = openPause ? new Date(Math.min(now.getTime(), openPause.startedAt.getTime())) : now;
      if (openPause) {
        await tx.attendancePause.update({ where: { id: openPause.id }, data: { endedAt: openPause.startedAt } });
      }
      workedMinutes = activeWorkedMinutes(
        open.startedAt,
        closeMoment,
        pauses.filter((p) => p.endedAt !== null).map((p) => ({ startedAt: p.startedAt, endedAt: p.endedAt })),
        closeMoment,
      );
      await tx.attendanceSession.update({
        where: { id: open.id },
        data: { endedAt: closeMoment, workedMinutes, closedBy: "OWNER" },
      });
      closedSessionId = open.id;
    }
    await tx.attendanceVerification.deleteMany({ where: { userId, status: "PENDING" } });
    await tx.attendanceDay.update({ where: { id: day.id }, data: { lockedAt: now, lockedById: guard.userId } });

    await recordAuditEvent(tx, {
      actorId: guard.userId,
      actorRole: "OWNER",
      action: "DAY_LOCK",
      resourceType: "attendance_day",
      resourceId: userId,
      after: { dayKey: todayKey, lockedAt: now.toISOString(), closedSessionId, workedMinutes },
      reason,
      ipAddress: ip,
    });
    return { alreadyLocked: false as const, closedSessionId, workedMinutes };
  });

  if (result.alreadyLocked) return NextResponse.json({ ok: false, error: "اليوم مقفول أصلًا" }, { status: 409 });
  return NextResponse.json({ ok: true, dayKey: todayKey, closedSessionId: result.closedSessionId, workedMinutes: result.workedMinutes });
}
