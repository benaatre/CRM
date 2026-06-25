"use client";

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Phone, MessageCircle, LayoutGrid, BarChart2, Rows3, Check } from "lucide-react";
import { stageLabels, stageColor } from "@/lib/labels";
import { formatCurrency, formatNumberShort, timeAgo, toArabicDigits } from "@/lib/format";
import type { DashboardData } from "@/lib/data/dashboard";
import { DistributeDialog } from "@/components/leads/distribute-dialog";

type ViewMode = "compact" | "analytical" | "glass";

// أنماط البطاقات بالضبط من ملف التصميم (sultan-crm-standalone.html):
// V = 0 مكثّف | 1 تحليلي | 2 زجاجي
const KPI_SPANS = [
  [6, 3, 3, 4, 4, 4], // مكثّف
  [2, 2, 2, 2, 2, 2], // تحليلي
  [4, 4, 4, 4, 4, 4], // زجاجي
];

const glassStyle: CSSProperties = {
  background: "var(--glass)",
  backdropFilter: "blur(16px)",
  WebkitBackdropFilter: "blur(16px)",
  border: "1px solid rgba(203,164,94,.20)",
  boxShadow: "0 18px 48px rgba(0,0,0,.45)",
};

export function DashboardView({ data }: { data: DashboardData }) {
  const router = useRouter();
  const [view, setView] = useState<ViewMode>("glass");
  const [showDist, setShowDist] = useState(false);

  const V = view === "compact" ? 0 : view === "analytical" ? 1 : 2;
  const glass = V === 2;
  const spans = KPI_SPANS[V];
  const k = data.kpis;
  const maxCount = Math.max(k.totalClients, k.bookings, k.visits, k.closedWon, k.unassigned, 1);
  const pct = (n: number) => Math.round((n / maxCount) * 100);

  // الترتيب نفس التصميم: تحويل · إجمالي · غير موزّعين · حجوزات · زيارات · مقفولة
  const cards = [
    { label: "معدل التحويل", value: `${toArabicDigits(k.conversion)}٪`, unit: "", fill: Math.min(k.conversion, 100), up: true, chip: null as string | null, action: false },
    { label: "إجمالي العملاء", value: formatNumberShort(k.totalClients), unit: "عميل", fill: 100, up: true, chip: null, action: false },
    { label: "غير موزّعين", value: toArabicDigits(k.unassigned), unit: "ليد", fill: pct(k.unassigned), up: false, chip: k.unassigned > 0 ? toArabicDigits(k.unassigned) : null, action: data.manager && k.unassigned > 0 },
    { label: "عدد الحجوزات", value: formatNumberShort(k.bookings), unit: "حجز", fill: pct(k.bookings), up: true, chip: null, action: false },
    { label: "عدد الزيارات", value: formatNumberShort(k.visits), unit: "زيارة", fill: pct(k.visits), up: true, chip: null, action: false },
    { label: "صفقات مقفولة", value: formatNumberShort(k.closedWon), unit: "صفقة", fill: pct(k.closedWon), up: true, chip: null, action: false },
  ];

  return (
    <div className="space-y-7">
      {/* أنماط العرض */}
      <div className="flex justify-end">
        <div className="flex items-center gap-1 rounded-xl border border-border bg-card p-1">
          {([
            ["compact", "مكثّف", Rows3],
            ["analytical", "تحليلي", BarChart2],
            ["glass", "زجاجي", LayoutGrid],
          ] as const).map(([v, label, Icon]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                view === v ? "bg-secondary text-gold" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* مؤشرات Bento — شبكة ١٢ عمود (سطح المكتب)، عمود واحد على الجوال (kpi-grid في globals.css) */}
      <section className="kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(12,1fr)", gap: 20, alignItems: "stretch" }}>
        {cards.map((c, i) => {
          const span = spans[i];
          const accent = !glass && i === 0;
          const surface: CSSProperties = glass
            ? glassStyle
            : accent
              ? { background: "linear-gradient(155deg, rgba(203,164,94,.10), var(--card) 50%)", border: "1px solid rgba(203,164,94,.28)", boxShadow: "0 14px 34px rgba(0,0,0,.35)" }
              : { background: "var(--card)", border: "1px solid var(--border)" };
          const numSize = V === 1 ? 27 : accent || (glass && i === 0) ? 40 : 34;
          const goldNum = accent || glass;

          return (
            <div
              key={c.label}
              style={{
                gridColumn: `span ${span}`,
                ...surface,
                borderRadius: 18,
                padding: V === 1 ? 16 : 20,
                display: "flex",
                flexDirection: "column",
                minHeight: V === 1 ? 112 : 148,
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-[13px] text-muted-foreground">{c.label}</span>
                {c.chip && (
                  <span
                    style={{
                      fontSize: 11.5,
                      fontWeight: 700,
                      padding: "3px 9px",
                      borderRadius: 20,
                      color: c.up ? "#2FBF8F" : "#F0685F",
                      background: c.up ? "rgba(47,191,143,.12)" : "rgba(240,104,95,.12)",
                    }}
                  >
                    {c.chip}
                  </span>
                )}
              </div>

              <div style={{ flex: 1 }} />

              <div className="flex items-baseline gap-1.5">
                <span style={{ fontSize: numSize, fontWeight: 700, letterSpacing: "-1px", color: goldNum ? "#E2C078" : "var(--text)", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
                  {c.value}
                </span>
                {c.unit && <span className="text-xs text-muted-foreground">{c.unit}</span>}
              </div>

              {c.action && (
                <button
                  onClick={() => setShowDist(true)}
                  className="mt-3 w-fit rounded-lg bg-destructive/15 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/25"
                >
                  وزّع الآن
                </button>
              )}

              <div style={{ marginTop: 14, height: 6, background: "var(--inset)", borderRadius: 20, overflow: "hidden", display: V === 1 ? "none" : "block" }}>
                <div style={{ height: "100%", width: `${c.fill}%`, borderRadius: 20, background: goldNum ? "linear-gradient(90deg,#9C7C3C,#E2C078)" : "var(--border)" }} />
              </div>
            </div>
          );
        })}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ليدات تنتظر أول تواصل (NEW + مُسند) */}
        <Section title="ليدات تنتظر أول تواصل" hint="سرعة الرد ترفع التحويل ٩ أضعاف" bar="bg-destructive" count={data.waitingCount}>
          {data.waitingFirstContact.length === 0 ? (
            <Empty text="ما فيه ليدات جديدة تنتظر" />
          ) : (
            <div className="space-y-2">
              {data.waitingFirstContact.map((l) => (
                <div key={l.id} className="flex items-center justify-between gap-2 rounded-xl border border-border p-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-foreground">{l.name}</span>
                      <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive">{timeAgo(l.createdAt)}</span>
                    </div>
                    {data.manager && l.assignedToName && <div className="mt-0.5 text-xs text-muted-foreground/70">{l.assignedToName}</div>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <a href={`tel:${l.phone}`} className="flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90" title="اتصال">
                      <Phone className="size-3.5" /> اتصال
                    </a>
                    <a href={`https://wa.me/966${l.phone.replace(/^0/, "")}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 rounded-lg bg-success/15 px-2.5 py-1.5 text-xs font-medium text-success hover:bg-success/25" title="واتساب">
                      <MessageCircle className="size-3.5" /> واتساب
                    </a>
                    <Link href={`/leads/${l.id}`} className="rounded-lg border border-border px-2 py-1.5 text-xs text-muted-foreground hover:border-gold/40 hover:text-gold" title="فتح ملف العميل">←</Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* متابعات اليوم */}
        <Section title="متابعات اليوم" hint="المستحقّة اليوم أو فات موعدها" bar="bg-gold">
          {data.followupsToday.length === 0 ? (
            <Empty text="ما عندك متابعات مستحقّة" />
          ) : (
            <ul className="divide-y divide-border">
              {data.followupsToday.map((l) => (
                <li key={l.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <div className="font-medium text-foreground">{l.name}</div>
                    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs ${stageColor[l.stage]}`}>{stageLabels[l.stage]}</span>
                  </div>
                  <div className="text-left text-xs text-muted-foreground">
                    {timeAgo(l.nextFollowup)}
                    {data.manager && l.assignedToName && <div className="mt-1">{l.assignedToName}</div>}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Link href="/leads" className="mt-3 block text-center text-sm text-gold hover:underline">كل العملاء ←</Link>
        </Section>
      </div>

      {/* تم البيع */}
      {data.recentSales.length > 0 && (
        <Section title="تم البيع — آخر الصفقات المقفولة" bar="bg-success">
          <div className="grid gap-4 sm:grid-cols-2">
            {data.recentSales.map((s) => (
              <div key={s.id} className="rounded-2xl border border-success/30 bg-success/5 p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-bold text-foreground">{s.leadName}</div>
                    {s.phone && <div className="text-xs text-muted-foreground" dir="ltr">{s.phone}</div>}
                  </div>
                  <span className="flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-xs text-success"><Check className="size-3" /> باع</span>
                </div>
                <div className="mt-2 text-sm text-muted-foreground">{s.projectName ?? "—"} · وحدة <span dir="ltr">{s.unitNumber}</span></div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{s.sellerName ?? "—"}</span>
                  <span className="font-bold text-gold">{formatCurrency(s.finalPrice)}</span>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* قمع المبيعات */}
      <Section title="قمع المبيعات" hint="عدد العملاء في كل مرحلة">
        <div className="space-y-2">
          {(() => {
            const max = Math.max(...data.funnel.map((f) => f.count), 1);
            return data.funnel.map((f) => (
              <div key={f.stage} className="flex items-center gap-3">
                <span className="w-28 shrink-0 text-sm text-muted-foreground">{stageLabels[f.stage]}</span>
                <div className="h-7 flex-1 overflow-hidden rounded-lg bg-secondary">
                  <div className="flex h-full items-center justify-end rounded-lg bg-gradient-to-l from-gold to-gold-dark px-2 text-xs font-medium text-primary-foreground" style={{ width: `${Math.max((f.count / max) * 100, 6)}%` }}>
                    {f.count > 0 ? toArabicDigits(f.count) : ""}
                  </div>
                </div>
              </div>
            ));
          })()}
        </div>
      </Section>

      {/* أداء الموظفين */}
      {data.manager && data.team.length > 0 && (
        <Section title="أداء الموظفين" hint="ملخّص نشاط كل موظف نحو هدفه">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {data.team.map((t) => (
              <div key={t.id} className="rounded-xl border border-border p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="font-semibold text-foreground">{t.name}</span>
                  <span className="text-xs text-muted-foreground">نشاط {toArabicDigits(t.activityRate)}٪</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <S label="عملاء" v={t.total} />
                  <S label="محاولات" v={t.attempts} />
                  <S label="زيارات" v={t.visits} />
                  <S label="حجوزات" v={t.bookings} />
                  <S label="مقفول" v={t.closed} cls="text-success" />
                  <S label="الهدف" v={t.target} cls="text-gold" />
                </div>
                {t.progress !== null && (
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary">
                    <div className="h-full rounded-full bg-gold" style={{ width: `${Math.min(t.progress, 100)}%` }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {showDist && (
        <DistributeDialog
          availableUnassigned={k.unassigned}
          onClose={() => setShowDist(false)}
          onDone={() => router.refresh()}
        />
      )}
    </div>
  );
}

function Section({ title, hint, bar, count, children }: { title: string; hint?: string; bar?: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="glass rounded-2xl p-5">
      <div className="mb-4 flex items-center gap-2">
        {bar && <span className={`h-5 w-1 rounded-full ${bar}`} />}
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-foreground">{title}</h2>
            {count != null && count > 0 && (
              <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-bold text-destructive">{toArabicDigits(count)}</span>
            )}
          </div>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function S({ label, v, cls }: { label: string; v: number; cls?: string }) {
  return (
    <div className="rounded-lg bg-secondary/50 py-2">
      <div className={`text-base font-bold ${cls ?? "text-foreground"}`}>{toArabicDigits(v)}</div>
      <div className="text-muted-foreground">{label}</div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{text}</p>;
}
