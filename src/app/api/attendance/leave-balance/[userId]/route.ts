import { NextResponse } from "next/server";
import { requireOwnerApi } from "@/lib/attendance-guard";
import { getLeaveBalance, setLeaveEntitlement } from "@/lib/data/leaves";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * رصيد إجازة الموظف — للمالك فقط (القرار ٣). يُستهلك في ملف الموظف (م٤).
 * GET   — رصيد مشتق (entitled + used + remaining).
 * PATCH — تعديل entitledDays.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const guard = await requireOwnerApi();
  if (!guard.ok) return guard.res;

  const { userId } = await params;
  return NextResponse.json({ ok: true, balance: await getLeaveBalance(userId) });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const guard = await requireOwnerApi();
  if (!guard.ok) return guard.res;

  const { userId } = await params;
  let body: { entitledDays?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, message: "بيانات غير صالحة" }, { status: 400 });
  }

  const r = await setLeaveEntitlement(userId, body.entitledDays);
  return NextResponse.json(r, r.ok ? undefined : { status: r.status ?? 400 });
}
