import { NextResponse } from "next/server";
import { requireGovernanceApi } from "@/lib/attendance-guard";
import { getEmployeeDayTimeline } from "@/lib/data/attendance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * سجل اليوم للموظف (الكرت المنسدل بلوحة «مداوم الآن») — المالك فقط، جلب كسول
 * عند فتح السهم فقط فلا تثقل اللوحة. حالة الرادار + الأجهزة + الخط الزمني.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const guard = await requireGovernanceApi();
  if (!guard.ok) return guard.res;
  const { userId } = await params;
  return NextResponse.json({ ok: true, ...(await getEmployeeDayTimeline(userId)) });
}
