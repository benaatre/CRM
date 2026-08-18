import { NextResponse } from "next/server";
import { requireOwnerApi } from "@/lib/attendance-guard";
import { decideLeave } from "@/lib/data/leaves";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * قرار المالك على طلب إجازة — OWNER حصريًا (القرار ٦).
 * decision: "APPROVE" (يُنشئ AttendanceException + خصم اختياري) | "REJECT" (حالة فقط).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireOwnerApi();
  if (!guard.ok) return guard.res;

  const { id } = await params;
  let body: { decision?: unknown; deductFromBalance?: unknown; note?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, message: "بيانات غير صالحة" }, { status: 400 });
  }

  const decision = body.decision === "APPROVE" || body.decision === "REJECT" ? body.decision : null;
  if (!decision) return NextResponse.json({ ok: false, message: "قرار غير معروف" }, { status: 400 });

  const r = await decideLeave(guard.userId, "OWNER", id, {
    approve: decision === "APPROVE",
    deductFromBalance: body.deductFromBalance !== false,
    note: typeof body.note === "string" ? body.note : undefined,
  });
  return NextResponse.json(r, r.ok ? undefined : { status: r.status ?? 400 });
}
