import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireLeaveDeciderApi } from "@/lib/attendance-guard";
import { prisma } from "@/lib/prisma";
import { decideLeave, editLeaveRequest, LEAVE_LABEL } from "@/lib/data/leaves";
import { notify, ownerIds } from "@/lib/notify";
import { roleLabel } from "@/lib/labels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * قرار طلب الإجازة — LEAVE_DECIDERS (المالك/الموارد البشرية/المدير المالي، قرار 2026-08-20):
 * قرار HR/FINANCE نهائي، ويُشعر المالك فورًا بكل قرار لم يصدر منه، وكل قرار
 * في التدقيق باسم منفذه ودوره الحقيقي. منع القرار الذاتي داخل lib/data/leaves.
 * decision: "APPROVE" | "REJECT" | "EDIT" (تعديل المدى قبل البتّ).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireLeaveDeciderApi();
  if (!guard.ok) return guard.res;

  const { id } = await params;
  let body: {
    decision?: unknown;
    deductFromBalance?: unknown;
    note?: unknown;
    notifyEmployee?: unknown;
    edit?: { type?: unknown; fromKey?: unknown; toKey?: unknown };
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, message: "بيانات غير صالحة" }, { status: 400 });
  }

  // إشعار المالك بقرار غيره — best-effort بعد النجاح.
  const notifyOwnerIfDelegate = async (actionText: string) => {
    if (guard.role === Role.OWNER) return;
    const [actor, request] = await Promise.all([
      prisma.user.findUnique({ where: { id: guard.userId }, select: { name: true } }),
      prisma.leaveRequest.findUnique({ where: { id }, include: { user: { select: { name: true } } } }),
    ]);
    const range = request
      ? `${request.dateFrom.toISOString().slice(0, 10)} → ${request.dateTo.toISOString().slice(0, 10)}`
      : "";
    await notify(
      prisma,
      await ownerIds(prisma),
      "leave.delegate_decision",
      `${actor?.name ?? "—"} (${roleLabel(guard.role)}) ${actionText} إجازة ${request?.user?.name ?? "—"}`,
      request ? `${LEAVE_LABEL[request.type] ?? ""} · ${range}` : undefined,
      `/employees/${request?.userId ?? ""}`,
    ).catch(() => {});
  };

  // تعديل المدى/النوع قبل البتّ — decision:"EDIT".
  if (body.decision === "EDIT") {
    const r = await editLeaveRequest(guard.userId, guard.role, id, body.edit ?? {});
    if (r.ok) await notifyOwnerIfDelegate("عدّل مدى طلب");
    return NextResponse.json(r, r.ok ? undefined : { status: r.status ?? 400 });
  }

  const decision = body.decision === "APPROVE" || body.decision === "REJECT" ? body.decision : null;
  if (!decision) return NextResponse.json({ ok: false, message: "قرار غير معروف" }, { status: 400 });

  const r = await decideLeave(guard.userId, guard.role, id, {
    approve: decision === "APPROVE",
    deductFromBalance: body.deductFromBalance !== false,
    note: typeof body.note === "string" ? body.note : undefined,
    notifyEmployee: body.notifyEmployee !== false,
  });
  if (r.ok) await notifyOwnerIfDelegate(decision === "APPROVE" ? "اعتمد" : "رفض طلب");
  return NextResponse.json(r, r.ok ? undefined : { status: r.status ?? 400 });
}
