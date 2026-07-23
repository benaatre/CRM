import { requireManager } from "@/lib/auth-guards";
import { getSettings } from "@/lib/data/settings";
import { getActiveSessions } from "@/lib/session-devices";
import { SettingsForm } from "@/components/settings/settings-form";
import { SessionsPanel } from "@/components/settings/sessions-panel";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireManager();
  const settings = await getSettings();
  const isOwner = user.role === "OWNER";
  // قسم «الجلسات» للمالك فقط — البيانات لا تُجلب أصلًا لغيره (فرض على الخادم).
  const sessions = isOwner ? await getActiveSessions() : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-foreground">الإعدادات</h1>
        <p className="mt-1 text-sm text-muted-foreground">بيانات الشركة وترخيص فال — تظهر في الواجهة والإعلانات</p>
      </header>
      <SettingsForm settings={settings} isOwner={isOwner} />
      {sessions && <SessionsPanel sessions={sessions} />}
    </div>
  );
}
