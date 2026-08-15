import { NextResponse } from "next/server";
import { requireOwnerApi } from "@/lib/attendance-guard";
import { getLiveBoard } from "@/lib/data/attendance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** لوحة «مداوم الآن» — بيانات العداد والتقدم والوسوم، والعميل يحرّك العداد. */
export async function GET() {
  const guard = await requireOwnerApi();
  if (!guard.ok) return guard.res;

  return NextResponse.json({ ok: true, rows: await getLiveBoard() });
}
