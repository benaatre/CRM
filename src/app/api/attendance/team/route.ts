import { NextResponse } from "next/server";
import { requireOwnerApi } from "@/lib/attendance-guard";
import { getTeamSummary } from "@/lib/data/attendance";
import { currentMonthKSA } from "@/lib/attendance-logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ملخص الفريق الشهري (صفوف EMPLOYEE+ADMIN): أيام/ساعات/تأخير/غياب + بداية دوامه. */
export async function GET(req: Request) {
  const guard = await requireOwnerApi();
  if (!guard.ok) return guard.res;

  const month = new URL(req.url).searchParams.get("month") ?? currentMonthKSA();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ ok: false, error: "شهر غير صالح" }, { status: 400 });
  }

  return NextResponse.json({ ok: true, month, rows: await getTeamSummary(month) });
}
