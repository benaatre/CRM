import {
  Users,
  CalendarClock,
  Building2,
  TrendingUp,
  BadgeCheck,
  Flame,
} from "lucide-react";

// صفحة تحقّق المرحلة (١): تُثبت أن الثيم (أوبسيديان) + RTL + الخطوط + شبكة Bento تشتغل.
// الواجهات الحقيقية (لوحة التحكم، الكانبان، التحليلات) تجي في المراحل التالية.

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

export default function Home() {
  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      {/* رأس الصفحة */}
      <header className="mb-10 flex items-center justify-between gap-4">
        <div>
          <h1 className="font-logo text-3xl font-bold tracking-tight text-gold">
            مشاريع السلطان
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            نظام إدارة المبيعات العقاري — لوحة الإقلاع (المرحلة ١)
          </p>
        </div>
        <span className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
          ترخيص فال (REGA): ١٢٠٠٠٠٠٠٠٠
        </span>
      </header>

      {/* شريط الحالة */}
      <div className="mb-8 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        ✅ الأساس جاهز: Next.js 15 · TypeScript · Tailwind v4 · Prisma · ثيم أوبسيديان · اتجاه RTL · خط IBM Plex Sans Arabic + Reem Kufi للشعار.
      </div>

      {/* شبكة Bento تجريبية بأحجام مختلفة */}
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

      <footer className="mt-12 text-center text-xs text-muted-foreground">
        نموذج تحقّق بصري فقط — الواجهات الفعلية مربوطة بقاعدة البيانات تجي في المرحلة (٢) وما بعدها.
      </footer>
    </main>
  );
}
