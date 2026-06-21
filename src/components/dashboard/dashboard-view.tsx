"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Users,
  Flame,
  Building2,
  CalendarClock,
  BadgeCheck,
  TrendingUp,
  Phone,
  LayoutGrid,
  BarChart2,
  Rows3,
  Check,
} from "lucide-react";
import { stageLabels, stageColor, channelLabel } from "@/lib/labels";
import { formatCurrency, formatNumberShort, timeAgo, toArabicDigits } from "@/lib/format";
import type { DashboardData } from "@/lib/data/dashboard";
import { distributeUnassigned } from "@/lib/actions/team";

type ViewMode = "glass" | "analytical" | "compact";

export function DashboardView({ data }: { data: DashboardData }) {
  const router = useRouter();
  const [view, setView] = useState<ViewMode>("glass");
  const [pending, startTransition] = useTransition();

  function distribute() {
    startTransition(async () => {
      await distributeUnassigned();
      router.refresh();
    });
  }

  const cardBase =
    view === "compact"
      ? "rounded-xl p-4"
      : view === "analytical"
        ? "rounded-2xl border border-border bg-card p-5"
        : "glass rounded-2xl p-5";
  const valueSize = view === "compact" ? "text-2xl" : "text-3xl";
  const bigSize = view === "compact" ? "text-3xl" : "text-5xl";

  return (
    <div className="space-y-7">
      {/* أنماط العرض */}
      <div className="flex justify-end">
        <div className="flex items-center gap-1 rounded-xl border border-border bg-card p-1">
          {([
            ["glass", "زجاجي", LayoutGrid],
            ["analytical", "تحليلي", BarChart2],
            ["compact", "مكثّف", Rows3],
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

      {/* الصف الأول: غير موزّعين | إجمالي العملاء (كبير) | معدل التحويل (كبير) */}
      <section className="grid grid-cols-1 gap-5 md:grid-cols-4">
        <Card className={`${cardBase} relative overflow-hidden md:col-span-1`}>
          <Badge tone="danger">{toArabicDigits(data.kpis.unassigned)}</Badge>
          <Head icon={Flame} accent="text-destructive" label="غير موزّعين" />
          <div className={`mt-2 font-bold text-destructive ${valueSize}`}>
            {toArabicDigits(data.kpis.unassigned)}
          </div>
          {data.manager && data.kpis.unassigned > 0 && (
            <button
              onClick={distribute}
              disabled={pending}
              className="mt-3 w-full rounded-lg bg-destructive/15 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/25 disabled:opacity-50"
            >
              {pending ? "جارٍ التوزيع…" : "وزّعهم الآن"}
            </button>
          )}
          <GoldBar />
        </Card>

        <Card className={`${cardBase} relative overflow-hidden md:col-span-2`}>
          {data.kpis.newInPeriod > 0 && <Badge tone="success">+{toArabicDigits(data.kpis.newInPeriod)}</Badge>}
          <Head icon={Users} accent="text-gold" label="إجمالي العملاء" />
          <div className={`mt-2 font-bold text-gold ${bigSize}`}>
            {formatNumberShort(data.kpis.totalClients)}
          </div>
          <GoldBar />
        </Card>

        <Card className={`${cardBase} relative overflow-hidden md:col-span-1`}>
          <Head icon={TrendingUp} accent="text-gold" label="معدل التحويل" />
          <div className={`mt-2 font-bold text-gold ${bigSize}`}>
            {toArabicDigits(data.kpis.conversion)}٪
          </div>
          <GoldBar />
        </Card>
      </section>

      {/* الصف الثاني: صفقات مقفولة | الزيارات | الحجوزات */}
      <section className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <KpiSmall cardBase={cardBase} valueSize={valueSize} icon={BadgeCheck} accent="text-success" label="صفقات مقفولة" value={data.kpis.closedWon} />
        <KpiSmall cardBase={cardBase} valueSize={valueSize} icon={CalendarClock} accent="text-info" label="عدد الزيارات" value={data.kpis.visits} />
        <KpiSmall cardBase={cardBase} valueSize={valueSize} icon={Building2} accent="text-gold" label="عدد الحجوزات" value={data.kpis.bookings} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ليدات تنتظر أول تواصل */}
        <Section title="ليدات تنتظر أول تواصل" hint="سرعة الرد ترفع التحويل ٩ أضعاف" bar="bg-destructive">
          {data.waitingFirstContact.length === 0 ? (
            <Empty text="ما فيه ليدات جديدة تنتظر 👌" />
          ) : (
            <div className="space-y-2">
              {data.waitingFirstContact.map((l) => (
                <div key={l.id} className="flex items-center justify-between rounded-xl border border-border p-3">
                  <div>
                    <div className="font-medium text-foreground">{l.name}</div>
                    <div className="text-xs text-muted-foreground">
                      <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-destructive">{timeAgo(l.createdAt)}</span>
                    </div>
                  </div>
                  <a
                    href={`tel:${l.phone}`}
                    className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                  >
                    <Phone className="size-3.5" /> اتصال
                  </a>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* متابعات اليوم */}
        <Section title="متابعات اليوم" hint="المستحقّة اليوم أو فات موعدها" bar="bg-gold">
          {data.followupsToday.length === 0 ? (
            <Empty text="ما عندك متابعات مستحقّة 🎉" />
          ) : (
            <ul className="divide-y divide-border">
              {data.followupsToday.map((l) => (
                <li key={l.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <div className="font-medium text-foreground">{l.name}</div>
                    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs ${stageColor[l.stage]}`}>
                      {stageLabels[l.stage]}
                    </span>
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

      {/* تم البيع — آخر الصفقات المقفولة */}
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
                  <span className="flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-xs text-success">
                    <Check className="size-3" /> باع
                  </span>
                </div>
                <div className="mt-2 text-sm text-muted-foreground">
                  {s.projectName ?? "—"} · وحدة <span dir="ltr">{s.unitNumber}</span>
                </div>
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
                  <div
                    className="flex h-full items-center justify-end rounded-lg bg-gradient-to-l from-gold to-gold-dark px-2 text-xs font-medium text-primary-foreground"
                    style={{ width: `${Math.max((f.count / max) * 100, 6)}%` }}
                  >
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
    </div>
  );
}

function Card({ className, children }: { className: string; children: React.ReactNode }) {
  return <div className={className}>{children}</div>;
}
function Head({ icon: Icon, accent, label }: { icon: typeof Users; accent: string; label: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <Icon className={`size-5 ${accent}`} />
    </div>
  );
}
function Badge({ tone, children }: { tone: "success" | "danger"; children: React.ReactNode }) {
  const c = tone === "success" ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive";
  return <span className={`absolute left-3 top-3 rounded-full px-2 py-0.5 text-[0.65rem] font-bold ${c}`}>{children}</span>;
}
function GoldBar() {
  return <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-l from-gold via-gold-light to-gold-dark" />;
}
function KpiSmall({ cardBase, valueSize, icon: Icon, accent, label, value }: { cardBase: string; valueSize: string; icon: typeof Users; accent: string; label: string; value: number }) {
  return (
    <div className={`${cardBase} relative overflow-hidden`}>
      <Head icon={Icon} accent={accent} label={label} />
      <div className={`mt-2 font-bold ${accent} ${valueSize}`}>{formatNumberShort(value)}</div>
      <GoldBar />
    </div>
  );
}
function Section({ title, hint, bar, children }: { title: string; hint?: string; bar?: string; children: React.ReactNode }) {
  return (
    <section className="glass rounded-2xl p-5">
      <div className="mb-4 flex items-center gap-2">
        {bar && <span className={`h-5 w-1 rounded-full ${bar}`} />}
        <div>
          <h2 className="font-semibold text-foreground">{title}</h2>
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
