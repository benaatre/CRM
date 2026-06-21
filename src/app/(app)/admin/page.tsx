import { requireManager } from "@/lib/auth-guards";
import { getTeam } from "@/lib/data/team";
import { getEmployees } from "@/lib/data/leads";
import { getSettings } from "@/lib/data/settings";
import { TeamView } from "@/components/team/team-view";
import { SheetAutoSync } from "@/components/team/sheet-auto-sync";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  await requireManager();
  const [data, employees, settings] = await Promise.all([getTeam(), getEmployees(), getSettings()]);
  return (
    <div className="space-y-4">
      <div className="mx-auto flex max-w-6xl justify-end">
        <SheetAutoSync enabled={!!settings.googleSheetUrl} />
      </div>
      <TeamView data={data} employees={employees} />
    </div>
  );
}
