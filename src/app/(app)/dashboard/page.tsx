import {
  Users,
  CalendarClock,
  Building2,
  TrendingUp,
  BadgeCheck,
  Flame,
} from "lucide-react";
import { requireUser, isManager } from "@/lib/auth-guards";

// لوحة التحكم (محميّة) — حاليًا بيانات تجريبية للتحقق البصري؛
// الربط الفعلي بـ Prisma والتحجيم حسب الدور يجي في المرحلة (٣).
export const dynamic = "force-dynamic";

const kpis = [
  { label: "إجمالي العملاء", value: "٦٩٠ك", hint: "+١٢٪ هالأسبوع", icon: Users, span: "md:col-span-2 md:row-span-2", accent: "gold" },
  { label: "غير موزّعين", value: "٢٣", hint: "وزّعهم الآن", icon: Flame, span: "", accent: "danger" },
  { label: "الحجوزات", value: "٤١", hint: "هالشهر", icon: Building2, span: "", accent: "info" },
  { label: "زيارات", value: "١٢٨", hint: "آخر ٧ أيام", icon: CalendarClock, span: "", accent: "muted" },
  { label: "صفقات مقفولة", value: "١٧", hint: "ر.س ٤.٢م", icon: BadgeCheck, span: "", accent: "success" },
  { label: "معدل التحويل", value: "٢٤٪", hint: "+٣ نقاط", icon: TrendingUp, span: "", accent: "gold" },
];

const accentText: Record<string, string> = {
  gold: "text-gold",
  danger: "text-destructive",
  success: "text-success",
  info: "text-info",
  muted: "text-muted-foreground",
};

export default async function DashboardPage() {
  const user = await requireUser();
  const manager = isManager(user.role);

  return (
    <div className="mx-auto max-w-7xl">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">
          هلا {user.name} 👋
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {manager
            ? "هذي نظرة عامة على كل النشاط."
            : "هذي نظرة على عملائك ومتابعاتك."}
        </p>
      </header>

      <section className="grid auto-rows-[140px] grid-cols-2 gap-6 md:grid-cols-4">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div
              key={kpi.label}
              className={`group glass flex flex-col justify-between rounded-2xl p-5 shadow-sm transition-colors hover:border-gold/40 ${kpi.span}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{kpi.label}</span>
                <Icon className={`size-5 ${accentText[kpi.accent]}`} />
              </div>
              <div>
                <div className={`text-3xl font-bold ${accentText[kpi.accent]}`}>
                  {kpi.value}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{kpi.hint}</div>
              </div>
            </div>
          );
        })}
      </section>

      <footer className="mt-10 text-xs text-muted-foreground">
        المرحلة (٢): المصادقة والصلاحيات تشتغل. الأرقام أعلاه تجريبية — تنربط بقاعدة البيانات في المرحلة (٣).
      </footer>
    </div>
  );
}
