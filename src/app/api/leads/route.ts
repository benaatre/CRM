import { NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guards";
import { getLeads } from "@/lib/data/leads";
import { listStaleLeadRows, attachStaleMeta } from "@/lib/stale-leads";
import { parseLeadFilters } from "@/lib/lead-filters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/leads — مصدر بيانات العملاء الموحّد (الجدول والكانبان).
 * فلاتر: q، stages، emps (مع "none" لغير الموزّع في الكانبان). tab: working | archived | unassigned | all.
 * الصلاحيات على الخادم: الموظف يشوف عملاءه فقط (داخل getLeads).
 */
export async function GET(req: Request) {
  const session = await requireUserApi();
  if (session instanceof Response) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  // FINANCE بلا عملاء نهائيًا (قرار 2026-08-20).
  if (session.user.role === "FINANCE") return NextResponse.json({ ok: false, error: "المدير المالي بلا صلاحية عملاء" }, { status: 403 });

  const url = new URL(req.url);
  const tabParam = url.searchParams.get("tab");
  const tab = tabParam === "archived" ? "archived"
    : tabParam === "hidden" ? "hidden"
      : tabParam === "unassigned" ? "unassigned"
        : tabParam === "all" ? "all"
          : "working";

  const { q, stages, assigneeIds, includeUnassigned, waiting, transferred, bankCheck, stale, archiveReason, dateFrom, dateTo, sort } = parseLeadFilters({
    q: url.searchParams.get("q") ?? undefined,
    stages: url.searchParams.get("stages") ?? undefined,
    emps: url.searchParams.get("emps") ?? undefined,
    sort: url.searchParams.get("sort") ?? undefined,
    wait: url.searchParams.get("wait") ?? undefined,
    nr: url.searchParams.get("nr") ?? undefined, // توافق خلفي — يفتح «في الانتظار»
    tr: url.searchParams.get("tr") ?? undefined,
    bank: url.searchParams.get("bank") ?? undefined,
    stale: url.searchParams.get("stale") ?? undefined,
    ar: url.searchParams.get("ar") ?? undefined,
    range: url.searchParams.get("range") ?? undefined, // النطاق الزمني (زيارة/موعد لاحق)
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  });

  // فلتر «العملاء الراكدين»: مسار مستقل (المرحلة ٢) — استعلاماته الثلاثة لا
  // تُنفَّذ إلا هنا بوجود stale=1. total = القائمة الكاملة (٩٠٠)، والصفوف أول
  // ٥٠٠ بالترتيب المعتمد وشارة staleMeta ملصقة.
  if (stale) {
    const { rows, total } = await listStaleLeadRows();
    return NextResponse.json({ leads: rows, staleTotal: total });
  }

  const leads = await getLeads({ tab, stages, assigneeIds, includeUnassigned, waiting, transferred, bankCheck, archiveReason, dateFrom, dateTo, q, sort });
  // شارة «راكد N يوم» في كل الفلاتر: تجميعة واحدة خفيفة مقيّدة بمعرّفات الصفوف
  // المعروضة وحدها. الركود مفهوم «جاري العمل»/الكانبان — فلا نُتعب المؤرشف/المحجوز.
  if (tab === "working" || tab === "all") await attachStaleMeta(leads);
  return NextResponse.json({ leads });
}
