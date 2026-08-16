import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwnerApi } from "@/lib/attendance-guard";
import { ksaDayKey } from "@/lib/ksa-time";
import { dayDateOf } from "@/lib/data/attendance";
import { recordAuditEvent } from "@/lib/audit-event";
import { notify } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * حذف استثناء — المالك فقط. الحذف فعلي: الاستثناء منحة قابلة للسحب لا سجل بصم.
 *
 * إلغاء إجازة ذاتية (الدفعة الرابعة) يفكّ آثارها أيضًا: إرجاع استقبال الليدات
 * إن كان موقوفًا بسببها، وإرجاع وضع اليوم من LEAVE، وإشعار الموظف — وكل ذلك
 * يُدوَّن في سجل التدقيق (LEAVE_CANCEL).
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireOwnerApi();
  if (!guard.ok) return guard.res;

  const { id } = await params;
  const exception = await prisma.attendanceException.findUnique({ where: { id } });
  if (!exception) return NextResponse.json({ ok: false, error: "الاستثناء غير موجود" }, { status: 404 });

  const now = new Date();
  const todayKey = ksaDayKey(now);
  const isSelfLeave = exception.type === "FULL_DAY_LEAVE" && exception.selfDeclared;

  await prisma.$transaction(async (tx) => {
    await tx.attendanceException.delete({ where: { id } });

    if (isSelfLeave) {
      // فك إيقاف الاستقبال المربوط بالإجازة (VACATION من الموظف نفسه فقط).
      const user = await tx.user.findUnique({
        where: { id: exception.userId },
        select: { availabilityPaused: true, pauseReason: true, pausedBy: true },
      });
      if (user?.availabilityPaused && user.pauseReason === "VACATION" && user.pausedBy === exception.userId) {
        await tx.user.update({
          where: { id: exception.userId },
          data: { availabilityPaused: false, pauseReason: null, pauseUntil: null, pausedBy: null, pausedAt: null },
        });
      }
      // اليوم الجاري كان LEAVE بسببها؟ يرجع ONSITE.
      const fromKey = exception.dateFrom.toISOString().slice(0, 10);
      const toKey = exception.dateTo.toISOString().slice(0, 10);
      if (fromKey <= todayKey && todayKey <= toKey) {
        await tx.attendanceDay.updateMany({
          where: { userId: exception.userId, date: dayDateOf(todayKey), mode: "LEAVE" },
          data: { mode: "ONSITE" },
        });
      }
    }

    await recordAuditEvent(tx, {
      actorId: guard.userId,
      actorRole: "OWNER",
      action: isSelfLeave ? "LEAVE_CANCEL" : "EXCEPTION_GRANT",
      resourceType: "attendance_exception",
      resourceId: id,
      before: {
        userId: exception.userId,
        type: exception.type,
        leaveType: exception.leaveType,
        fromKey: exception.dateFrom.toISOString().slice(0, 10),
        toKey: exception.dateTo.toISOString().slice(0, 10),
        selfDeclared: exception.selfDeclared,
      },
      after: null,
      reason: isSelfLeave ? "إلغاء إجازة ذاتية" : "سحب استثناء",
    });
  });

  if (isSelfLeave) {
    try {
      await notify(
        prisma,
        [exception.userId],
        "attendance.leave_cancelled",
        "ألغت الإدارة إجازتك المسجّلة — تواصل معهم لو عندك استفسار",
        undefined,
        "/m",
      );
    } catch (e) {
      console.error("[attendance] فشل إشعار إلغاء الإجازة", e);
    }
  }

  return NextResponse.json({ ok: true });
}
