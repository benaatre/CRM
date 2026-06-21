import Link from "next/link";
import { LayoutDashboard, Users2, Contact, KanbanSquare, LogOut } from "lucide-react";
import { requireUser } from "@/lib/auth-guards";
import { isManager } from "@/lib/auth-guards";
import { roleLabel } from "@/lib/labels";
import { signOutAction } from "@/lib/actions/auth";

// تخطيط المنطقة المحميّة — يتطلب دخولًا، ويعرض تنقّلًا حسب الدور.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const manager = isManager(user.role);

  const nav = [
    { href: "/dashboard", label: "لوحة التحكم", icon: LayoutDashboard, show: true },
    { href: "/leads", label: "كل العملاء", icon: Contact, show: true },
    { href: "/pipeline", label: "مراحل العملاء", icon: KanbanSquare, show: true },
    { href: "/admin", label: "الموظفين", icon: Users2, show: manager },
  ].filter((n) => n.show);

  return (
    <div className="flex min-h-dvh">
      {/* شريط جانبي (RTL — يظهر يمين) */}
      <aside className="hidden w-64 shrink-0 flex-col border-l border-border bg-card p-5 md:flex">
        <div className="mb-8">
          <span className="font-logo text-2xl font-bold text-gold">
            مشاريع السلطان
          </span>
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
      </aside>

      <div className="flex flex-1 flex-col">
        {/* هيدر */}
        <header className="flex items-center justify-between border-b border-border bg-card/50 px-6 py-4">
          <div className="md:hidden">
            <span className="font-logo text-lg font-bold text-gold">
              مشاريع السلطان
            </span>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-left">
              <div className="text-sm font-medium text-foreground">
                {user.name}
              </div>
              <div className="text-xs text-gold">{roleLabel(user.role)}</div>
            </div>
            <form action={signOutAction}>
              <button
                type="submit"
                className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
              >
                <LogOut className="size-4" />
                خروج
              </button>
            </form>
          </div>
        </header>

        <main className="flex-1 px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
