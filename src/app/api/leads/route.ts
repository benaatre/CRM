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

  const { q, stages, assigneeIds, includeUnassigned, unresponsive, archiveReason, sort } = parseLeadFilters({
    q: url.searchParams.get("q") ?? undefined,
    stages: url.searchParams.get("stages") ?? undefined,
    emps: url.searchParams.get("emps") ?? undefined,
    sort: url.searchParams.get("sort") ?? undefined,
    nr: url.searchParams.get("nr") ?? undefined,
    ar: url.searchParams.get("ar") ?? undefined,
  });

  const leads = await getLeads({ tab, stages, assigneeIds, includeUnassigned, unresponsive, archiveReason, q, sort });
  return NextResponse.json({ leads });
}
