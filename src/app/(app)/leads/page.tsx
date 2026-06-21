import { requireUser, isManager } from "@/lib/auth-guards";
import { getLeads, getEmployees } from "@/lib/data/leads";
import { LeadsView } from "@/components/leads/leads-view";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const user = await requireUser();
  const manager = isManager(user.role);
  const [leads, employees] = await Promise.all([
    getLeads(),
    manager ? getEmployees() : Promise.resolve([]),
  ]);

  return <LeadsView leads={leads} isManager={manager} employees={employees} />;
}
