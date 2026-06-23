import { requireUser, isManager } from "@/lib/auth-guards";
import { getLeads, getEmployees } from "@/lib/data/leads";
import { parseLeadFilters } from "@/lib/lead-filters";
import { KanbanBoard } from "@/components/leads/kanban-board";
import { AutoRefresh } from "@/components/auto-refresh";

export const dynamic = "force-dynamic";

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; stages?: string; emps?: string }>;
}) {
  const user = await requireUser();
  const manager = isManager(user.role);

  const sp = await searchParams;
  const { q, stages, assigneeIds, includeUnassigned, values } = parseLeadFilters(sp);

  const [leads, employees] = await Promise.all([
    // نفس مصدر بيانات جدول العملاء — مع كل المراحل (مؤرشف + جاري العمل).
    getLeads({ archived: "all", stages, assigneeIds, includeUnassigned, q }),
    manager ? getEmployees() : Promise.resolve([]),
  ]);

  return (
    <>
      <AutoRefresh seconds={30} />
      <KanbanBoard leads={leads} isManager={manager} employees={employees} filters={values} />
    </>
  );
}
