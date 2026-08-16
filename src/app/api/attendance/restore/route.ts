import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwnerApi } from "@/lib/attendance-guard";
import { ksaDayKey } from "@/lib/ksa-time";
import { activeWorkedMinutes } from "@/lib/attendance-logic";
import { dayDateOf } from "@/lib/data/attendance";
import { recordAuditEvent } from "@/lib/audit-event";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * «استعادة الوقت المفقود» — المالك فقط، بسبب نصي إلزامي، وكل عملية تُدوَّن
 * في سجل التدقيق (TIME_RESTORE) بقبل/بعد:
 *
 *   op=UNCONFIRMED  يخصم دقائق من `unconfirmedMinutes` ليوم — تتحول «مؤكَّدة يدويًا».
 *   op=CANCEL_PAUSE يلغي توقف NO_RESPONSE بأثر رجعي: حذف التوقف وإعادة حساب
 *                   دقائق الجلسة بالدالة المشتركة (لو كانت مغلقة).
 */
export async function POST(req: Request) {
  const guard = await requireOwnerApi();
  if (!guard.ok) return guard.res;

  let raw: {
    op?: unknown;
    userId?: unknown;
    dayKey?: unknown;
    minutes?: unknown;
    pauseId?: unknown;
    reason?: unknown;
  };
  try {
    raw = (await req.json()) as typeof raw;
  } catch {
    return NextResponse.json({ ok: false, error: "بيانات غير صالحة" }, { status: 400 });
  }

  const reason = typeof raw.reason === "string" ? raw.reason.trim().slice(0, 500) : "";
  if (!reason) {
    return NextResponse.json({ ok: false, error: "اكتب سبب الاستعادة" }, { status: 400 });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  /* ═══════════ خصم من غير المؤكَّد ═══════════ */
  if (raw.op === "UNCONFIRMED") {
    const userId = typeof raw.userId === "string" ? raw.userId : "";
    const dayKey = typeof raw.dayKey === "string" && DAY_KEY.test(raw.dayKey) ? raw.dayKey : null;
    const minutes = Math.round(Number(raw.minutes));
    if (!userId || !dayKey || !Number.isFinite(minutes) || minutes <= 0 || minutes > 1440) {
      return NextResponse.json({ ok: false, error: "حدّد اليوم والدقائق" }, { status: 400 });
    }
    const day = await prisma.attendanceDay.findUnique({
      where: { userId_date: { userId, date: dayDateOf(dayKey) } },
    });
    if (!day || day.unconfirmedMinutes <= 0) {
      return NextResponse.json({ ok: false, error: "ما فيه وقت غير مؤكَّد بهذا اليوم" });
    }
    const restore = Math.min(minutes, day.unconfirmedMinutes);
    await prisma.$transaction(async (tx) => {
      await tx.attendanceDay.update({
        where: { id: day.id },
        data: { unconfirmedMinutes: day.unconfirmedMinutes - restore },
      });
      await recordAuditEvent(tx, {
        actorId: guard.userId,
        actorRole: "OWNER",
        action: "TIME_RESTORE",
        resourceType: "attendance_day",
        resourceId: day.userId,
        before: { dayKey, unconfirmedMinutes: day.unconfirmedMinutes },
        after: { dayKey, unconfirmedMinutes: day.unconfirmedMinutes - restore, restoredMinutes: restore },
        reason,
        ipAddress: ip,
      });
    });
    return NextResponse.json({ ok: true, restoredMinutes: restore });
  }

  /* ═══════════ إلغاء توقف NO_RESPONSE بأثر رجعي ═══════════ */
  if (raw.op === "CANCEL_PAUSE") {
    const pauseId = typeof raw.pauseId === "string" ? raw.pauseId : "";
    const pause = pauseId ? await prisma.attendancePause.findUnique({ where: { id: pauseId } }) : null;
    if (!pause || pause.kind !== "NO_RESPONSE") {
      return NextResponse.json({ ok: false, error: "التوقف غير موجود أو ليس إيقاف عدم رد" });
    }
    const session = await prisma.attendanceSession.findUnique({ where: { id: pause.sessionId } });
    if (!session) return NextResponse.json({ ok: false, error: "الجلسة غير موجودة" });

    await prisma.$transaction(async (tx) => {
      await tx.attendancePause.delete({ where: { id: pause.id } });
      // جلسة مغلقة: يعاد حساب دقائقها بالدالة المشتركة بلا هذا التوقف.
      if (session.endedAt) {
        const remaining = await tx.attendancePause.findMany({ where: { sessionId: session.id } });
        await tx.attendanceSession.update({
          where: { id: session.id },
          data: {
            workedMinutes: activeWorkedMinutes(
              session.startedAt,
              session.endedAt,
              remaining.map((p) => ({ startedAt: p.startedAt, endedAt: p.endedAt ?? session.endedAt })),
              session.endedAt,
            ),
          },
        });
      }
      await recordAuditEvent(tx, {
        actorId: guard.userId,
        actorRole: "OWNER",
        action: "TIME_RESTORE",
        resourceType: "attendance_day",
        resourceId: pause.userId,
        before: {
          cancelledPauseId: pause.id,
          kind: pause.kind,
          startedAt: pause.startedAt.toISOString(),
          endedAt: pause.endedAt?.toISOString() ?? null,
          dayKey: ksaDayKey(pause.startedAt),
        },
        after: { pauseCancelled: true },
        reason,
        ipAddress: ip,
      });
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: "عملية غير معروفة" }, { status: 400 });
}
