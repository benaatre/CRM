import { toArabicDigits } from "@/lib/format";
import type { EmployeePerformance } from "@/lib/data/analytics";

/** عرض تحليلات الموظف نفسه فقط (نطاقه) — لا يرى بيانات بقية الفريق. */
export function EmployeeSelfAnalytics({ data }: { data: EmployeePerformance }) {
  const cards = [
    { label: "عملائي", value: data.assigned, accent: "text-gold" },
    { label: "متابعاتي", value: data.followups, accent: "text-info" },
    { label: "زياراتي", value: data.visits, accent: "text-foreground" },
    { label: "حجوزاتي", value: data.bookings, accent: "text-warning" },
    { label: "صفقاتي المقفولة", value: data.closed, accent: "text-success" },
  ];
  const pct = Math.min(data.progress ?? 0, 100);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-foreground">أدائي</h1>
        <p className="mt-1 text-sm text-muted-foreground">مؤشرات أدائك الشخصية — {data.name}</p>
      </header>

      {/* مؤشرات الموظف */}
      <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className="glass rounded-2xl p-4 text-center">
            <div className={`text-3xl font-bold ${c.accent}`}>{toArabicDigits(c.value)}</div>
            <div className="mt-1 text-xs text-muted-foreground">{c.label}</div>
          </div>
        ))}
      </section>

      {/* معدل التحويل */}
      <section className="glass rounded-2xl p-5">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-foreground">معدل التحويل</span>
          <span className="text-2xl font-bold text-gold">{toArabicDigits(data.conversion)}٪</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">صفقات مقفولة من إجمالي عملائك.</p>
      </section>

      {/* مقارنة بالهدف الشهري */}
      <section className="glass rounded-2xl p-5">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-semibold text-foreground">الهدف الشهري</span>
          <span className="text-sm text-muted-foreground">
            {toArabicDigits(data.closed)} / {data.target > 0 ? toArabicDigits(data.target) : "غير محدّد"}
            {data.progress != null && <span className="mr-2 text-gold">({toArabicDigits(data.progress)}٪)</span>}
          </span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-gradient-to-l from-gold to-gold-dark" style={{ width: `${pct}%` }} />
        </div>
        {data.target === 0 && <p className="mt-2 text-xs text-muted-foreground/70">ما تم تحديد هدف شهري لك بعد — راجع مديرك.</p>}
      </section>
    </div>
  );
}
