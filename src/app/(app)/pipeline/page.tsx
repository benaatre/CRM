import { requireUser, isManager } from "@/lib/auth-guards";
import { getEmployees } from "@/lib/data/leads";
import { parseLeadFilters, buildLeadsQuery } from "@/lib/lead-filters";
import { KanbanBoard } from "@/components/leads/kanban-board";

export const dynamic = "force-dynamic";

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; stages?: string; emps?: string }>;
}) {
  const user = await requireUser();
  const manager = isManager(user.role);

  const sp = await searchParams;
  const { values } = parseLeadFilters(sp);
  const employees = manager ? await getEmployees() : [];

  // الكانبان يقرأ كل المراحل من نفس الـ API GET /api/leads.
  const query = buildLeadsQuery("all", values);

  return <KanbanBoard query={query} isManager={manager} employees={employees} filters={values} />;
}
