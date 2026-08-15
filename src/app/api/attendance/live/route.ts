import { NextResponse } from "next/server";
import { requireOwnerApi } from "@/lib/attendance-guard";
import { getLiveBoard } from "@/lib/data/attendance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * لوحة «البلاط الموحّد» — وضعان:
 * - بلا بارامترات: اليوم اللحظي (الشريط المباشر + بيانات العداد والمحطات).
 * - `?from=&to=` بمفاتيح أيام YYYY-MM-DD: ملخّص الفترة لكل موظف.
 * كل حساب على الخادم؛ العميل يحرّك العدادات فقط.
 */
export async function GET(req: Request) {
  const guard = await requireOwnerApi();
  if (!guard.ok) return guard.res;

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const range =
    from && to && DAY_KEY.test(from) && DAY_KEY.test(to) && from <= to
      ? { fromKey: from, toKey: to }
      : null;

  return NextResponse.json({ ok: true, ...(await getLiveBoard(range)) });
}
