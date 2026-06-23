import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getLeads } from "@/lib/data/leads";
import { parseLeadFilters } from "@/lib/lead-filters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/leads — مصدر بيانات العملاء الموحّد (الجدول والكانبان).
 * فلاتر: q، stages، emps (مع "none" لغير الموزّع). tab: working | archived | all.
 * الصلاحيات على الخادم: الموظف يشوف عملاءه فقط (داخل getLeads).
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const url = new URL(req.url);
  const tab = url.searchParams.get("tab");
  const archived: boolean | "all" = tab === "archived" ? true : tab === "all" ? "all" : false;

  const { q, stages, assigneeIds, includeUnassigned } = parseLeadFilters({
    q: url.searchParams.get("q") ?? undefined,
    stages: url.searchParams.get("stages") ?? undefined,
    emps: url.searchParams.get("emps") ?? undefined,
  });

  const leads = await getLeads({ archived, stages, assigneeIds, includeUnassigned, q });
  return NextResponse.json({ leads });
}
