import { requireManager } from "@/lib/auth-guards";
import { getTeam } from "@/lib/data/team";
import { getEmployees } from "@/lib/data/leads";
import { TeamView } from "@/components/team/team-view";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  await requireManager();
  const [data, employees] = await Promise.all([getTeam(), getEmployees()]);
  return <TeamView data={data} employees={employees} />;
}
