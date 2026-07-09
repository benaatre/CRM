import { requireManager } from "@/lib/auth-guards";
import { getSettings } from "@/lib/data/settings";
import { SettingsForm } from "@/components/settings/settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireManager();
  const settings = await getSettings();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-foreground">الإعدادات</h1>
        <p className="mt-1 text-sm text-muted-foreground">بيانات الشركة وترخيص فال — تظهر في الواجهة والإعلانات</p>
      </header>
      <SettingsForm settings={settings} isOwner={user.role === "OWNER"} />
    </div>
  );
}
