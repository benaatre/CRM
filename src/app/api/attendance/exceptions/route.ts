import { NextResponse } from "next/server";
import { AttendanceExceptionType, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireOwnerApi } from "@/lib/attendance-guard";
import { recordAuditEvent } from "@/lib/audit-event";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * استثناءات الدوام (إجازة/استئذان/دوام معدّل) — يمنحها المالك فقط، وتُحتسب
 * في التأخير والغياب والهدف عبر `effectiveDay`.
 */

const TYPES = new Set<string>(Object.values(AttendanceExceptionType));
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const guard = await requireOwnerApi();
  if (!guard.ok) return guard.res;

  const userId = new URL(req.url).searchParams.get("userId");
  const exceptions = await prisma.attendanceException.findMany({
    where: userId ? { userId } : {},
    orderBy: { dateFrom: "desc" },
    take: 200,
    include: { user: { select: { name: true } } },
  });
  return NextResponse.json({ ok: true, exceptions });
}

export async function POST(req: Request) {
  const guard = await requireOwnerApi();
  if (!guard.ok) return guard.res;

  let raw: {
    userId?: unknown;
    type?: unknown;
    dateFrom?: unknown;
    dateTo?: unknown;
    excuseUntilMinutes?: unknown;
    modifiedShiftMinutes?: unknown;
    reason?: unknown;
  };
  try {
    raw = (await req.json()) as typeof raw;
  } catch {
    return NextResponse.json({ ok: false, error: "بيانات غير صالحة" }, { status: 400 });
  }

  const userId = typeof raw.userId === "string" ? raw.userId : "";
  const type = typeof raw.type === "string" && TYPES.has(raw.type) ? (raw.type as AttendanceExceptionType) : null;
  const dateFrom = typeof raw.dateFrom === "string" && DAY_RE.test(raw.dateFrom) ? raw.dateFrom : null;
  const dateTo = typeof raw.dateTo === "string" && DAY_RE.test(raw.dateTo) ? raw.dateTo : null;
  const reason = typeof raw.reason === "string" ? raw.reason.trim() : "";

  if (!userId || !type) {
    return NextResponse.json({ ok: false, error: "بيانات غير صالحة" }, { status: 400 });
  }
  if (!dateFrom || !dateTo || dateTo < dateFrom) {
    return NextResponse.json({ ok: false, error: "التواريخ غير صحيحة" }, { status: 400 });
  }
  if (!reason) {
    return NextResponse.json({ ok: false, error: "اكتب سبب الاستثناء" }, { status: 400 });
  }

  // الحقول الشرطية حسب النوع — يُخزَّن حقل نوعه فقط والباقي null.
  let excuseUntilMinutes: number | null = null;
  let modifiedShiftMinutes: number | null = null;
  if (type === AttendanceExceptionType.HOURS_EXCUSE) {
    const v = Math.round(Number(raw.excuseUntilMinutes));
    if (!Number.isFinite(v) || v < 0 || v > 1439) {
      return NextResponse.json({ ok: false, error: "حدّد «معذور حتى» وقتًا صحيحًا" }, { status: 400 });
    }
    excuseUntilMinutes = v;
  } else if (type === AttendanceExceptionType.MODIFIED_SHIFT) {
    const v = Math.round(Number(raw.modifiedShiftMinutes));
    if (!Number.isFinite(v) || v < 60 || v > 960) {
      return NextResponse.json({ ok: false, error: "عدد ساعات الدوام المعدّل غير صحيح" }, { status: 400 });
    }
    modifiedShiftMinutes = v;
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user) return NextResponse.json({ ok: false, error: "الموظف غير موجود" }, { status: 404 });
  if (user.role === Role.OWNER) {
    return NextResponse.json({ ok: false, error: "المالك خارج نظام البصم" }, { status: 400 });
  }

  const exception = await prisma.attendanceException.create({
    data: {
      userId,
      type,
      dateFrom: new Date(`${dateFrom}T00:00:00Z`),
      dateTo: new Date(`${dateTo}T00:00:00Z`),
      excuseUntilMinutes,
      modifiedShiftMinutes,
      reason,
      createdById: guard.userId,
    },
  });
  // سجل التدقيق (الدفعة الرابعة) — منح استثناء إجراء مالك حسّاس.
  await recordAuditEvent(prisma, {
    actorId: guard.userId,
    actorRole: "OWNER",
    action: "EXCEPTION_GRANT",
    resourceType: "attendance_exception",
    resourceId: exception.id,
    after: { userId, type, fromKey: dateFrom, toKey: dateTo, excuseUntilMinutes, modifiedShiftMinutes },
    reason,
    ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  });
  return NextResponse.json({ ok: true, exception });
}
