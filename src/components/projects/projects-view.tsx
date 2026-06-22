"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Building2, CheckCircle2, Clock, BadgeCheck, Wallet, Coins, Search, Plus } from "lucide-react";
import type { ProjectStatus } from "@prisma/client";
import { projectStatusLabels, projectStatusColor } from "@/lib/labels";
import { formatCurrency, formatNumberShort, formatDate, toArabicDigits } from "@/lib/format";
import type { ProjectCard, ProjectsOverview } from "@/lib/data/projects";
import { ProjectForm } from "./project-form";

const priceBands: { label: string; lo: number; hi: number }[] = [
  { label: "الكل", lo: 0, hi: Infinity },
  { label: "٦٠٠–٧٠٠ألف", lo: 600000, hi: 700000 },
  { label: "٧٠٠–٨٠٠ألف", lo: 700000, hi: 800000 },
  { label: "٨٠٠ألف–مليون", lo: 800000, hi: 1000000 },
  { label: "مليون–٢مليون", lo: 1000000, hi: 2000000 },
];

const statusFilters: { label: string; value: ProjectStatus | "" }[] = [
  { label: "الكل", value: "" },
  { label: "متاح", value: "AVAILABLE" },
  { label: "تحت الإنشاء", value: "UNDER_CONSTRUCTION" },
  { label: "تشطيبات", value: "FINISHING" },
  { label: "مكتمل", value: "COMPLETED" },
];

export function ProjectsView({ data }: { data: ProjectsOverview }) {
  const [q, setQ] = useState("");
  const [band, setBand] = useState(0);
  const [status, setStatus] = useState<ProjectStatus | "">("");
  const [showAdd, setShowAdd] = useState(false);

  const cards = useMemo(() => {
    const { lo, hi } = priceBands[band];
    return data.cards.filter((c) => {
      if (q && !(c.name.includes(q) || (c.district ?? "").includes(q))) return false;
      if (status && c.status !== status) return false;
      const cMin = c.priceMin ?? c.priceMax ?? 0;
      const cMax = c.priceMax ?? c.priceMin ?? Infinity;
      return cMax >= lo && cMin <= hi;
    });
  }, [data.cards, q, band, status]);

  const kpis = [
    { label: "المشاريع", value: data.kpis.projects, icon: Building2, accent: "text-gold" },
    { label: "متاحة", value: data.kpis.available, icon: CheckCircle2, accent: "text-success" },
    { label: "محجوزة", value: data.kpis.reserved, icon: Clock, accent: "text-warning" },
    { label: "مباعة", value: data.kpis.sold, icon: BadgeCheck, accent: "text-muted-foreground" },
    { label: "قيمة المبيعات", value: formatCurrency(data.kpis.salesValue), icon: Wallet, accent: "text-gold", money: true },
    { label: "إجمالي العرابين", value: formatCurrency(data.kpis.deposits), icon: Coins, accent: "text-info", money: true },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">المشاريع والوحدات</h1>
          <p className="mt-1 text-sm text-muted-foreground">المخزون العقاري وحالة الوحدات</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90">
          <Plus className="size-4" /> إضافة مشروع
        </button>
      </header>
      <ProjectForm open={showAdd} onClose={() => setShowAdd(false)} />

      <section className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="glass rounded-2xl p-4">
              <Icon className={`size-5 ${k.accent}`} />
              <div className={`mt-2 font-bold ${k.accent} ${k.money ? "text-lg" : "text-2xl"}`}>
                {k.money ? k.value : formatNumberShort(k.value as number)}
              </div>
              <div className="text-xs text-muted-foreground">{k.label}</div>
            </div>
          );
        })}
      </section>

      {/* بحث */}
      <div className="relative">
        <Search className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث: اسم مشروع أو حي…" className="w-full rounded-xl border border-border bg-card py-2.5 pr-9 pl-3 text-sm outline-none focus:border-gold" />
      </div>

      {/* فلتر الأسعار */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">السعر:</span>
        {priceBands.map((b, i) => (
          <button key={b.label} onClick={() => setBand(i)} className={`rounded-xl border px-3 py-1.5 text-sm transition-colors ${band === i ? "border-gold/50 bg-gold/10 text-gold" : "border-border bg-card text-muted-foreground hover:text-foreground"}`}>{b.label}</button>
        ))}
      </div>

      {/* فلتر الحالة */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">الحالة:</span>
        {statusFilters.map((s) => (
          <button key={s.label} onClick={() => setStatus(s.value)} className={`rounded-xl border px-3 py-1.5 text-sm transition-colors ${status === s.value ? "border-gold/50 bg-gold/10 text-gold" : "border-border bg-card text-muted-foreground hover:text-foreground"}`}>{s.label}</button>
        ))}
        <span className="text-xs text-muted-foreground">({toArabicDigits(cards.length)} مشروع)</span>
      </div>

      <section className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => <ProjectCardView key={c.id} c={c} />)}
        {cards.length === 0 && <p className="col-span-full py-10 text-center text-muted-foreground">ما فيه مشاريع مطابقة.</p>}
      </section>
    </div>
  );
}

function ProjectCardView({ c }: { c: ProjectCard }) {
  const soldPct = c.units.total > 0 ? Math.round((c.units.sold / c.units.total) * 100) : 0;
  return (
    <Link href={`/projects/${c.id}`} className="glass group block rounded-2xl p-5 transition-colors hover:border-gold/40">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-bold text-foreground">{c.name}</h3>
          {c.district && <p className="text-xs text-muted-foreground">{c.district}</p>}
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-xs ${projectStatusColor[c.status]}`}>{projectStatusLabels[c.status]}</span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-lg bg-success/10 py-2 text-success"><div className="text-base font-bold">{toArabicDigits(c.units.available)}</div>متاحة</div>
        <div className="rounded-lg bg-warning/10 py-2 text-warning"><div className="text-base font-bold">{toArabicDigits(c.units.reserved)}</div>محجوزة</div>
        <div className="rounded-lg bg-secondary py-2 text-muted-foreground"><div className="text-base font-bold">{toArabicDigits(c.units.sold)}</div>مباعة</div>
      </div>

      {/* شريط تقدّم البيع */}
      <div className="mt-4">
        <div className="mb-1 flex justify-between text-xs text-muted-foreground">
          <span>نسبة البيع</span>
          <span className="text-gold">{toArabicDigits(soldPct)}٪</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-gradient-to-l from-gold to-gold-dark" style={{ width: `${soldPct}%` }} />
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm">
        <span className="text-gold">{c.priceMin ? formatCurrency(c.priceMin) : "—"}{c.priceMax ? ` – ${formatCurrency(c.priceMax)}` : ""}</span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">التسليم: {c.deliveryDate ? formatDate(c.deliveryDate) : "—"}</div>
      {c.falLicense && <div className="mt-2 text-[0.65rem] text-muted-foreground/70">ترخيص فال: {c.falLicense}</div>}
    </Link>
  );
}
