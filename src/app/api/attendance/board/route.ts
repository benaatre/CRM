import { NextResponse } from "next/server";
import { requireGovernanceApi } from "@/lib/attendance-guard";
import { getAttendanceBoard } from "@/lib/data/attendance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** اللوحة اللحظية — حالة كل عضو فريق اليوم (المالك فقط). */
export async function GET() {
  const guard = await requireGovernanceApi();
  if (!guard.ok) return guard.res;

  return NextResponse.json({ ok: true, rows: await getAttendanceBoard() });
}
