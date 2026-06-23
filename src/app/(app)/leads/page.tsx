import { requireUser, isManager } from "@/lib/auth-guards";
import { getLeads, getLeadCounts, getEmployees } from "@/lib/data/leads";
import { parseLeadFilters } from "@/lib/lead-filters";
import { LeadsView } from "@/components/leads/leads-view";
import { AutoRefresh } from "@/components/auto-refresh";

export const dynamic = "force-dynamic";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; stages?: string; emps?: string }>;
}) {
  const user = await requireUser();
  const manager = isManager(user.role);

  const sp = await searchParams;
  const tab = sp.tab === "archived" ? "archived" : "working";
  const { q, stages, assigneeIds, includeUnassigned, values } = parseLeadFilters(sp);

  const [rows, counts, employees] = await Promise.all([
    getLeads({ archived: tab === "archived", stages, assigneeIds, includeUnassigned, q }),
    getLeadCounts(),
    manager ? getEmployees() : Promise.resolve([]),
  ]);

  return (
    <>
      <AutoRefresh seconds={30} />
      <LeadsView
        rows={rows}
        counts={counts}
        tab={tab}
        isManager={manager}
        employees={employees}
        filters={values}
      />
    </>
  );
}
