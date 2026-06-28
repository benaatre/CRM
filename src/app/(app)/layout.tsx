import Link from "next/link";
import {
  LayoutDashboard,
  Users2,
  Contact,
  KanbanSquare,
  Building2,
  Handshake,
  BarChart3,
  ScrollText,
  MessagesSquare,
  Settings as SettingsIcon,
} from "lucide-react";
import { requireUser, isManager } from "@/lib/auth-guards";
import { roleLabel } from "@/lib/labels";
import { getSettings } from "@/lib/data/settings";
import { getEmployees } from "@/lib/data/leads";
import { Topbar } from "@/components/layout/topbar";
import { Brand } from "@/components/layout/brand";
import { Heartbeat } from "@/components/layout/heartbeat";
import { FloatingAssistant } from "@/components/layout/floating-assistant";

// تخطيط المنطقة المحميّة — يتطلب دخولًا، ويعرض تنقّلًا حسب الدور.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const manager = isManager(user.role);
  const [settings, employees] = await Promise.all([
    getSettings(),
    manager ? getEmployees() : Promise.resolve([]),
  ]);

  const nav = [
    { href: "/dashboard", label: "لوحة التحكم", icon: LayoutDashboard, show: true },
    { href: "/leads", label: "كل العملاء", icon: Contact, show: true },
    { href: "/pipeline", label: "مراحل العملاء", icon: KanbanSquare, show: true },
    { href: "/projects", label: "المشاريع", icon: Building2, show: true },
    { href: "/bookings", label: "خط المبيعات", icon: Handshake, show: true },
    { href: "/chat", label: "الشات الداخلي", icon: MessagesSquare, show: true },
    { href: "/analytics", label: "التحليلات", icon: BarChart3, show: true },
    { href: "/admin", label: "الفريق", icon: Users2, show: manager },
    { href: "/audit", label: "سجل التدقيق", icon: ScrollText, show: manager },
    { href: "/settings", label: "الإعدادات", icon: SettingsIcon, show: manager },
  ].filter((n) => n.show);

  return (
    <div className="flex min-h-dvh">
      <Heartbeat />
      {/* شريط جانبي (RTL — يظهر يمين) */}
      <aside className="hidden w-64 shrink-0 flex-col border-l border-border bg-card p-5 md:flex">
        <div className="mb-8">
          <Brand companyName={settings.companyName} logoUrl={settings.logoUrl} textClassName="text-2xl" imgClassName="h-10 w-auto" />
          <p className="mt-0.5 text-xs text-muted-foreground">إدارة المبيعات العقارية</p>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        {/* رقم ترخيص فال (REGA) — دائمًا أسفل القائمة */}
        {settings.falLicense && (
          <div className="mt-4 rounded-xl border border-border bg-background/50 px-3 py-2 text-center">
            <div className="text-[0.65rem] text-muted-foreground">ترخيص فال (REGA)</div>
            <div className="text-xs font-medium text-gold" dir="ltr">{settings.falLicense}</div>
          </div>
        )}
      </aside>

      <div className="flex flex-1 flex-col">
        <Topbar
          userName={user.name ?? "مستخدم"}
          roleLabel={roleLabel(user.role)}
          companyName={settings.companyName}
          logoUrl={settings.logoUrl}
          falLicense={settings.falLicense ?? null}
          isManager={manager}
          employees={employees}
        />
        <main className="flex-1 px-4 py-6 md:px-6 md:py-8">{children}</main>
      </div>
      <FloatingAssistant />
    </div>
  );
}
