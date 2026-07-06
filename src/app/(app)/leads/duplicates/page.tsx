import { requireManager } from "@/lib/auth-guards";
import { getDuplicateLeads } from "@/lib/data/duplicates";
import { getEmployees } from "@/lib/data/leads";
import { DuplicatesView } from "@/components/leads/duplicates-view";

export const dynamic = "force-dynamic";

export default async function DuplicatesPage() {
  await requireManager();
  const [data, employees] = await Promise.all([getDuplicateLeads(), getEmployees()]);
  return <DuplicatesView data={data} employees={employees} />;
}
