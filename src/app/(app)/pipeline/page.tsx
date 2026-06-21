import { requireUser, isManager } from "@/lib/auth-guards";
import { getPipeline, getEmployees } from "@/lib/data/leads";
import { KanbanBoard } from "@/components/leads/kanban-board";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const user = await requireUser();
  const manager = isManager(user.role);
  const [leads, employees] = await Promise.all([
    getPipeline(),
    manager ? getEmployees() : Promise.resolve([]),
  ]);

  return <KanbanBoard leads={leads} isManager={manager} employees={employees} />;
}
