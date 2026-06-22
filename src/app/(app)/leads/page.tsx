import { requireUser, isManager } from "@/lib/auth-guards";
import { getLeads, getEmployees } from "@/lib/data/leads";
import { LeadsView } from "@/components/leads/leads-view";
import { AutoRefresh } from "@/components/auto-refresh";

export const dynamic = "force-dynamic";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await requireUser();
  const manager = isManager(user.role);
  const [working, archived, employees] = await Promise.all([
    getLeads(false),
    getLeads(true),
    manager ? getEmployees() : Promise.resolve([]),
  ]);
  const { q } = await searchParams;

  return (
    <>
      <AutoRefresh seconds={30} />
      <LeadsView working={working} archived={archived} isManager={manager} employees={employees} initialQ={q ?? ""} />
    </>
  );
}
