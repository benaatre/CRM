import { requireManager } from "@/lib/auth-guards";
import { getAnalytics } from "@/lib/data/analytics";
import { stageLabels, channelLabels } from "@/lib/labels";
import { formatCurrency, toArabicDigits } from "@/lib/format";
import { AiAssistant } from "@/components/analytics/ai-assistant";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  await requireManager();
  const a = await getAnalytics();

  const metricCards = [
    { label: "متوسط زمن أول رد", value: a.metrics.avgFirstResponseHours != null ? `${toArabicDigits(a.metrics.avgFirstResponseHours)} ساعة` : "—" },
    { label: "رد خلال ساعة", value: `${toArabicDigits(a.metrics.within1hRate)}٪` },
    { label: "نسبة الرد", value: `${toArabicDigits(a.metrics.responseRate)}٪` },
    { label: "متوسط المحاولات", value: toArabicDigits(a.metrics.avgAttempts) },
    { label: "متوسط دورة البيع", value: a.metrics.avgSalesCycleDays != null ? `${toArabicDigits(a.metrics.avgSalesCycleDays)} يوم` : "—" },
  ];

  const maxChannel = Math.max(...a.channels.map((c) => c.count), 1);
  const maxClosed = Math.max(...a.team.map((t) => t.closed), 1);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-foreground">التحليلات والذكاء</h1>
        <p className="mt-1 text-sm text-muted-foreground">مؤشرات الأداء والتحصيل والمبيعات</p>
      </header>

      <AiAssistant />

      {/* المؤشرات الاحترافية */}
      <section className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {metricCards.map((m) => (
          <div key={m.label} className="glass rounded-2xl p-4">
            <div className="text-xl font-bold text-gold">{m.value}</div>
            <div className="mt-1 text-xs text-muted-foreground">{m.label}</div>
          </div>
        ))}
      </section>

      {/* تحليلات المبيعات والتحصيل */}
      <section className="glass rounded-2xl p-5">
        <h2 className="mb-4 font-semibold text-foreground">تحليلات المبيعات والتحصيل</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <Fin label="السعر الأساسي" value={a.finance.basePrice} />
          <Fin label="بعد الخصم" value={a.finance.afterDiscount} accent="text-gold" />
          <Fin label="إجمالي الخصومات" value={a.finance.discounts} accent="text-warning" />
          <Fin label="محصّل فعليًا" value={a.finance.collected} accent="text-success" />
          <Fin label="لسة ما دخلت" value={a.finance.notCollected} accent="text-destructive" />
          <Fin label="قيمة المحجوزات" value={a.finance.reservedValue} accent="text-info" />
        </div>
        {a.finance.financeFailedCount > 0 && (
          <div className="mt-4 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
            ⚠️ تنبيه تمويل فاشل: {toArabicDigits(a.finance.financeFailedCount)} حجز بقيمة {formatCurrency(a.finance.financeFailedValue)} — تحتاج متابعة.
          </div>
        )}

        {a.finance.perProject.length > 0 && (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="py-2 font-medium">المشروع</th>
                  <th className="py-2 font-medium">الأساسي</th>
                  <th className="py-2 font-medium">بعد الخصم</th>
                  <th className="py-2 font-medium">محصّل</th>
                  <th className="py-2 font-medium">متبقّي</th>
                  <th className="py-2 font-medium">محجوز</th>
                </tr>
              </thead>
              <tbody>
                {a.finance.perProject.map((p) => (
                  <tr key={p.projectId} className="border-t border-border">
                    <td className="py-2 font-medium text-foreground">{p.projectName}</td>
                    <td className="py-2 text-muted-foreground">{formatCurrency(p.basePrice)}</td>
                    <td className="py-2 text-gold">{formatCurrency(p.afterDiscount)}</td>
                    <td className="py-2 text-success">{formatCurrency(p.collected)}</td>
                    <td className="py-2 text-destructive">{formatCurrency(p.notCollected)}</td>
                    <td className="py-2 text-info">{formatCurrency(p.reservedValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* القمع + نسب التحويل */}
        <section className="glass rounded-2xl p-5">
          <h2 className="mb-4 font-semibold text-foreground">القمع ونِسب التحويل</h2>
          <div className="space-y-2">
            {a.funnel.map((f) => {
              const max = Math.max(...a.funnel.map((x) => x.count), 1);
              return (
                <div key={f.stage} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-sm text-muted-foreground">{stageLabels[f.stage]}</span>
                  <div className="h-6 flex-1 overflow-hidden rounded-lg bg-secondary">
                    <div
                      className="flex h-full items-center justify-end rounded-lg bg-gradient-to-l from-gold to-gold-dark px-2 text-xs text-primary-foreground"
                      style={{ width: `${Math.max((f.count / max) * 100, 6)}%` }}
                    >
                      {f.count > 0 ? toArabicDigits(f.count) : ""}
                    </div>
                  </div>
                  <span className="w-12 shrink-0 text-left text-xs text-success">
                    {f.convFromPrev != null ? `${toArabicDigits(f.convFromPrev)}٪` : ""}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        {/* القنوات التسويقية */}
        <section className="glass rounded-2xl p-5">
          <h2 className="mb-4 font-semibold text-foreground">القنوات التسويقية</h2>
          <div className="space-y-3">
            {a.channels.map((c) => (
              <div key={c.channel} className="flex items-center gap-3">
                <span className="w-20 shrink-0 text-sm text-muted-foreground">{channelLabels[c.channel]}</span>
                <div className="h-5 flex-1 overflow-hidden rounded-lg bg-secondary">
                  <div className="h-full rounded-lg bg-info/70" style={{ width: `${(c.count / maxChannel) * 100}%` }} />
                </div>
                <span className="w-8 shrink-0 text-left text-sm text-foreground">{toArabicDigits(c.count)}</span>
              </div>
            ))}
            {a.channels.length === 0 && <p className="text-sm text-muted-foreground">ما فيه بيانات.</p>}
          </div>
        </section>
      </div>

      {/* أداء الموظفين (أعمدة) */}
      <section className="glass rounded-2xl p-5">
        <h2 className="mb-4 font-semibold text-foreground">أداء الموظفين (صفقات مقفولة)</h2>
        <div className="flex items-end gap-4 overflow-x-auto pb-2" style={{ minHeight: "160px" }}>
          {a.team.map((t) => (
            <div key={t.name} className="flex w-20 shrink-0 flex-col items-center justify-end gap-2">
              <span className="text-xs font-bold text-gold">{toArabicDigits(t.closed)}</span>
              <div
                className="w-10 rounded-t-lg bg-gradient-to-t from-gold-dark to-gold"
                style={{ height: `${Math.max((t.closed / maxClosed) * 120, 6)}px` }}
              />
              <span className="text-center text-xs text-muted-foreground">{t.name.split(" ")[0]}</span>
            </div>
          ))}
          {a.team.length === 0 && <p className="text-sm text-muted-foreground">ما فيه موظفين.</p>}
        </div>
      </section>
    </div>
  );
}

function Fin({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="rounded-xl border border-border p-3">
      <div className={`text-base font-bold ${accent ?? "text-foreground"}`}>{formatCurrency(value)}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
