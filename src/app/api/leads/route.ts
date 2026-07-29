import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getLeads } from "@/lib/data/leads";
import { parseLeadFilters } from "@/lib/lead-filters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/leads — مصدر بيانات العملاء الموحّد (الجدول والكانبان).
 * فلاتر: q، stages، emps (مع "none" لغير الموزّع في الكانبان). tab: working | archived | unassigned | all.
 * الصلاحيات على الخادم: الموظف يشوف عملاءه فقط (داخل getLeads).
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const url = new URL(req.url);
  const tabParam = url.searchParams.get("tab");
  const tab = tabParam === "archived" ? "archived"
    : tabParam === "hidden" ? "hidden"
      : tabParam === "unassigned" ? "unassigned"
        : tabParam === "all" ? "all"
          : "working";

  const { q, stages, assigneeIds, includeUnassigned, waiting, transferred, bankCheck, archiveReason, dateFrom, dateTo, sort } = parseLeadFilters({
    q: url.searchParams.get("q") ?? undefined,
    stages: url.searchParams.get("stages") ?? undefined,
    emps: url.searchParams.get("emps") ?? undefined,
    sort: url.searchParams.get("sort") ?? undefined,
    wait: url.searchParams.get("wait") ?? undefined,
    nr: url.searchParams.get("nr") ?? undefined, // توافق خلفي — يفتح «في الانتظار»
    tr: url.searchParams.get("tr") ?? undefined,
    bank: url.searchParams.get("bank") ?? undefined,
    ar: url.searchParams.get("ar") ?? undefined,
    range: url.searchParams.get("range") ?? undefined, // النطاق الزمني (زيارة/موعد لاحق)
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  });

  const leads = await getLeads({ tab, stages, assigneeIds, includeUnassigned, waiting, transferred, bankCheck, archiveReason, dateFrom, dateTo, q, sort });
  return NextResponse.json({ leads });
}
