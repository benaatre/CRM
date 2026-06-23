import { requireUser, isManager } from "@/lib/auth-guards";
import { getLeadCounts, getEmployees } from "@/lib/data/leads";
import { parseLeadFilters, buildLeadsQuery } from "@/lib/lead-filters";
import { LeadsView } from "@/components/leads/leads-view";

export const dynamic = "force-dynamic";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; stages?: string; emps?: string }>;
}) {
  const user = await requireUser();
  const manager = isManager(user.role);

  const sp = await searchParams;
  const tab: "working" | "archived" | "unassigned" =
    sp.tab === "archived" ? "archived" : sp.tab === "unassigned" ? "unassigned" : "working";
  const { values } = parseLeadFilters(sp);

  const [counts, employees] = await Promise.all([
    getLeadCounts(),
    manager ? getEmployees() : Promise.resolve([]),
  ]);

  // الجدول يقرأ صفوفه من نفس الـ API GET /api/leads.
  // تبويب «غير موزّعين»: نفس الـ API مع emps=none (غير الموزّعين فقط، غير مؤرشف).
  const query = tab === "unassigned"
    ? buildLeadsQuery("working", { q: values.q, stages: values.stages, emps: ["none"] })
    : buildLeadsQuery(tab, values);

  return (
    <LeadsView
      query={query}
      counts={counts}
      tab={tab}
      isManager={manager}
      employees={employees}
      filters={values}
    />
  );
}
