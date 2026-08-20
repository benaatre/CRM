import { NextResponse } from "next/server";
import { requireGovernanceApi } from "@/lib/attendance-guard";
import { getEmployeeFile } from "@/lib/data/attendance";
import { currentMonthKSA } from "@/lib/attendance-logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ملف الموظف لشهر: الإحصاءات + سجل الأيام + الاستثناءات + نداءات التحقق. */
export async function GET(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const guard = await requireGovernanceApi();
  if (!guard.ok) return guard.res;

  const { userId } = await params;
  const month = new URL(req.url).searchParams.get("month") ?? currentMonthKSA();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ ok: false, error: "شهر غير صالح" }, { status: 400 });
  }

  const file = await getEmployeeFile(userId, month);
  if (!file) return NextResponse.json({ ok: false, error: "الموظف غير موجود" }, { status: 404 });
  return NextResponse.json({ ok: true, file });
}
