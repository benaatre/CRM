import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth-guards";
import { getDuplicateLeads } from "@/lib/data/duplicates";
import { getEmployees } from "@/lib/data/leads";
import { DuplicatesView } from "@/components/leads/duplicates-view";

export const dynamic = "force-dynamic";

export default async function DuplicatesPage() {
  await requireRole(Role.OWNER); // المالك فقط
  const [data, employees] = await Promise.all([getDuplicateLeads(), getEmployees()]);
  return <DuplicatesView data={data} employees={employees} />;
}
