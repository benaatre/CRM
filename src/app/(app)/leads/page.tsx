import { requireUser, isManager } from "@/lib/auth-guards";
import { getLeadCounts, getEmployees, getNotContactedCount } from "@/lib/data/leads";
import { parseLeadFilters, buildLeadsQuery } from "@/lib/lead-filters";
import { LeadsView } from "@/components/leads/leads-view";

export const dynamic = "force-dynamic";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; stages?: string; emps?: string; sort?: string }>;
}) {
  const user = await requireUser();
  const manager = isManager(user.role);

  const sp = await searchParams;
  const tab: "working" | "archived" | "hidden" | "unassigned" =
    sp.tab === "archived" ? "archived" : sp.tab === "hidden" ? "hidden" : sp.tab === "unassigned" ? "unassigned" : "working";
  const { values, assigneeIds } = parseLeadFilters(sp);

  const [counts, employees, notContacted] = await Promise.all([
    getLeadCounts(),
    manager ? getEmployees() : Promise.resolve([]),
    getNotContactedCount(assigneeIds),
  ]);

  // الجدول يقرأ صفوفه من نفس الـ API GET /api/leads — كل تبويب بقيوده على الخادم.
  const query = buildLeadsQuery(tab, values);

  return (
    <LeadsView
      query={query}
      counts={counts}
      notContacted={notContacted}
      tab={tab}
      isManager={manager}
      employees={employees}
      filters={values}
    />
  );
}
