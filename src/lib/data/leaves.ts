import "server-only";

import { prisma } from "@/lib/prisma";
import { ksaDayKey } from "@/lib/ksa-time";
import { dayDateOf, getAttendanceSettings } from "@/lib/data/attendance";
import { recordAuditEvent } from "@/lib/audit-event";
import { createFullDayLeaveException } from "@/lib/attendance-leave-exception";

/**
 * منطق نظام الإجازة (م١) — طلب/عرض/قرار/رصيد. المصدر الوحيد المشترك بين المسارات.
 *
 * قواعد القرارات: الأنواع ANNUAL/SICK/EMERGENCY أيام كاملة فقط (٥) · لا سريان إلا
 * باعتماد المالك (٤) · الرصيد سنوي واحد افتراضي ٢١ للمالك فقط والمستخدَم مشتق (٣) ·
 * فحص تداخل إلزامي عند الطلب وعند الاعتماد.
 */

export const LEAVE_TYPES = new Set(["ANNUAL", "SICK", "EMERGENCY"]);
export const LEAVE_LABEL: Record<string, string> = { ANNUAL: "سنوية", SICK: "مرضية", EMERGENCY: "طارئة" };
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
/** الحد الأقصى لأيام الطلب الواحد — الأطول قرار إداري (القرار الفرعي/القيد ٣). */
const MAX_REQUEST_DAYS = 10;

type Ok<T = Record<string, unknown>> = { ok: true } & T;
type Err = { ok: false; message: string; status?: number };
type Result<T = Record<string, unknown>> = Ok<T> | Err;

/** أيام تقويمية شاملة الطرفين (القرار ٢: الخصم تقويمي). */
export function calendarDays(fromKey: string, toKey: string): number {
  return Math.round((dayDateOf(toKey).getTime() - dayDateOf(fromKey).getTime()) / 86_400_000) + 1;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10); // يطابق dayDateOf (UTC منتصف الليل)
/** تقاطع مدى (بمفاتيح نصية) مع مدى مخزَّن (Date @db.Date). */
function overlapsStored(fromKey: string, toKey: string, storedFrom: Date, storedTo: Date): boolean {
  return fromKey <= ymd(storedTo) && toKey >= ymd(storedFrom);
}

/** إنشاء طلب إجازة (الموظف) — مع القيود وفحص التداخل. */
export async function createLeaveRequest(
  userId: string,
  input: { type?: unknown; fromKey?: unknown; toKey?: unknown; reason?: unknown },
): Promise<Result<{ id: string }>> {
  const type = typeof input.type === "string" && LEAVE_TYPES.has(input.type) ? input.type : null;
  const fromKey = typeof input.fromKey === "string" && DAY_KEY.test(input.fromKey) ? input.fromKey : null;
  const toKey = typeof input.toKey === "string" && DAY_KEY.test(input.toKey) ? input.toKey : null;
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!type || !fromKey || !toKey) return { ok: false, message: "حدّد نوع الإجازة والمدة", status: 400 };
  if (!reason) return { ok: false, message: "اكتب سبب الإجازة", status: 400 };

  // القيود (القرار الفرعي ٣)
  if (toKey < fromKey) return { ok: false, message: "تاريخ النهاية قبل البداية", status: 400 };
  const todayKey = ksaDayKey(new Date());
  if (fromKey < todayKey) return { ok: false, message: "ما تقدر تطلب إجازة بتاريخ فات", status: 400 };
  if (calendarDays(fromKey, toKey) > MAX_REQUEST_DAYS) {
    return { ok: false, message: `الطلب أطول من ${MAX_REQUEST_DAYS} أيام — الأطول يحتاج مراجعة الإدارة`, status: 400 };
  }

  // فحص التداخل (١): ضد طلبات الموظف نفسه المعلّقة أو المعتمدة.
  const clashing = await prisma.leaveRequest.findMany({
    where: { userId, status: { in: ["PENDING", "APPROVED"] } },
    select: { dateFrom: true, dateTo: true, status: true },
  });
  const clash = clashing.find((r) => overlapsStored(fromKey, toKey, r.dateFrom, r.dateTo));
  if (clash) {
    const label = clash.status === "APPROVED" ? "معتمد" : "معلّق";
    return {
      ok: false,
      message: `عندك طلب إجازة ${label} يتقاطع مع هالمدة (من ${ymd(clash.dateFrom)} إلى ${ymd(clash.dateTo)}) — عدّل التواريخ`,
      status: 409,
    };
  }

  const created = await prisma.leaveRequest.create({
    data: { userId, type: type as never, dateFrom: dayDateOf(fromKey), dateTo: dayDateOf(toKey), reason },
  });
  await recordAuditEvent(prisma, {
    actorId: userId,
    actorRole: "EMPLOYEE",
    action: "LEAVE_REQUESTED",
    resourceType: "leave_request",
    resourceId: created.id,
    after: { type, fromKey, toKey, days: calendarDays(fromKey, toKey) },
  });
  return { ok: true, id: created.id };
}

/** طلبات الموظف نفسه — الأحدث أولًا (بلا أي عرض رصيد). */
export async function listMyLeaves(userId: string) {
  return prisma.leaveRequest.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
}

/** كل الطلبات للمالك (اختياريًا بحالة) مع اسم الموظف. */
export async function listLeaves(opts: { status?: string | null } = {}) {
  const status = opts.status && ["PENDING", "APPROVED", "REJECTED"].includes(opts.status) ? opts.status : undefined;
  return prisma.leaveRequest.findMany({
    where: status ? { status: status as never } : undefined,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: { user: { select: { name: true } } },
  });
}

/** رصيد الإجازة (للمالك فقط) — entitled مخزَّن، used مشتق من المعتمد الخاصم. */
export async function getLeaveBalance(userId: string): Promise<{ entitledDays: number; usedDays: number; remainingDays: number }> {
  const [bal, approved] = await Promise.all([
    prisma.leaveBalance.findUnique({ where: { userId }, select: { entitledDays: true } }),
    prisma.leaveRequest.findMany({
      where: { userId, status: "APPROVED", deductFromBalance: true },
      select: { dateFrom: true, dateTo: true },
    }),
  ]);
  const entitledDays = bal?.entitledDays ?? 21;
  const usedDays = approved.reduce((s, r) => s + calendarDays(ymd(r.dateFrom), ymd(r.dateTo)), 0);
  return { entitledDays, usedDays, remainingDays: entitledDays - usedDays };
}

/** تعديل رصيد الموظف (المالك فقط، من ملف الموظف). */
export async function setLeaveEntitlement(userId: string, entitledDays: unknown): Promise<Result> {
  const n = Number(entitledDays);
  if (!Number.isInteger(n) || n < 0 || n > 365) return { ok: false, message: "رصيد غير صالح", status: 400 };
  await prisma.leaveBalance.upsert({ where: { userId }, update: { entitledDays: n }, create: { userId, entitledDays: n } });
  return { ok: true };
}

/** قرار المالك على طلب — اعتماد (يُنشئ الاستثناء) أو رفض. OWNER حصريًا (يُفرض بالمسار). */
export async function decideLeave(
  ownerId: string,
  ownerRole: string,
  id: string,
  input: { approve: boolean; deductFromBalance?: boolean; note?: string },
): Promise<Result<{ exceptionCreated: boolean; exceptionId?: string }>> {
  const req = await prisma.leaveRequest.findUnique({ where: { id } });
  if (!req) return { ok: false, message: "الطلب غير موجود", status: 404 };
  if (req.status !== "PENDING") return { ok: false, message: "الطلب مو معلّق — تم البتّ فيه", status: 409 };

  const now = new Date();
  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim() : null;

  // رفض — حالة فقط، بلا استثناء.
  if (!input.approve) {
    await prisma.leaveRequest.update({
      where: { id },
      data: { status: "REJECTED", decidedById: ownerId, decidedAt: now, decisionNote: note },
    });
    await recordAuditEvent(prisma, {
      actorId: ownerId,
      actorRole: ownerRole,
      action: "LEAVE_DECIDED",
      resourceType: "leave_request",
      resourceId: id,
      after: { decision: "REJECTED" },
      reason: note,
    });
    return { ok: true, exceptionCreated: false };
  }

  // اعتماد — فحص التداخل (٢): ضد استثناءات الإجازة القائمة قبل الإنشاء.
  const fromKey = ymd(req.dateFrom);
  const toKey = ymd(req.dateTo);
  const existing = await prisma.attendanceException.findMany({
    where: { userId: req.userId, type: "FULL_DAY_LEAVE" },
    select: { dateFrom: true, dateTo: true },
  });
  const clash = existing.find((e) => overlapsStored(fromKey, toKey, e.dateFrom, e.dateTo));
  if (clash) {
    return {
      ok: false,
      message: `ما نقدر نعتمد — فيه استثناء إجازة قائم يتقاطع (من ${ymd(clash.dateFrom)} إلى ${ymd(clash.dateTo)})`,
      status: 409,
    };
  }

  const deduct = input.deductFromBalance !== false; // toggle الخصم (القرار ٣)، الافتراضي true
  const settings = await getAttendanceSettings();

  const result = await prisma.$transaction(async (tx) => {
    const exc = await createFullDayLeaveException(tx, {
      userId: req.userId,
      leaveType: req.type,
      fromKey,
      toKey,
      reason: `إجازة ${LEAVE_LABEL[req.type] ?? ""} — معتمدة`,
      createdById: ownerId,
      authorizerLabel: "اعتماد الإدارة",
      selfDeclared: false,
      actorRole: ownerRole,
      pauseIntake: settings.leavePausesLeadIntake,
      now,
    });
    await tx.leaveRequest.update({
      where: { id },
      data: {
        status: "APPROVED",
        decidedById: ownerId,
        decidedAt: now,
        decisionNote: note,
        deductFromBalance: deduct,
        exceptionId: exc.id,
      },
    });
    await recordAuditEvent(tx, {
      actorId: ownerId,
      actorRole: ownerRole,
      action: "LEAVE_DECIDED",
      resourceType: "leave_request",
      resourceId: id,
      after: { decision: "APPROVED", exceptionId: exc.id, deductFromBalance: deduct, days: calendarDays(fromKey, toKey) },
      reason: note,
    });
    return exc.id;
  });

  return { ok: true, exceptionCreated: true, exceptionId: result };
}
