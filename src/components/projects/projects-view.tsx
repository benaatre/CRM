"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Building2, CheckCircle2, Clock, BadgeCheck, Wallet, Coins } from "lucide-react";
import { projectStatusLabels, projectStatusColor } from "@/lib/labels";
import { formatCurrency, formatNumberShort, formatDate } from "@/lib/format";
import type { ProjectCard, ProjectsOverview } from "@/lib/data/projects";

export function ProjectsView({ data }: { data: ProjectsOverview }) {
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");

  const cards = useMemo(() => {
    const lo = min ? Number(min) : 0;
    const hi = max ? Number(max) : Infinity;
    return data.cards.filter((c) => {
      const cMin = c.priceMin ?? c.priceMax ?? 0;
      const cMax = c.priceMax ?? c.priceMin ?? Infinity;
      return cMax >= lo && cMin <= hi;
    });
  }, [data.cards, min, max]);

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
      <header>
        <h1 className="text-2xl font-bold text-foreground">المشاريع والوحدات</h1>
        <p className="mt-1 text-sm text-muted-foreground">المخزون العقاري وحالة الوحدات</p>
      </header>

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

      {/* فلتر الأسعار */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-4">
        <span className="text-sm text-muted-foreground">فلتر السعر (ر.س):</span>
        <input value={min} onChange={(e) => setMin(e.target.value.replace(/\D/g, ""))} inputMode="numeric" dir="ltr" placeholder="من" className="w-28 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-gold" />
        <input value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, ""))} inputMode="numeric" dir="ltr" placeholder="إلى" className="w-28 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-gold" />
        {(min || max) && (
          <button onClick={() => { setMin(""); setMax(""); }} className="text-sm text-gold hover:underline">
            مسح
          </button>
        )}
        <span className="text-xs text-muted-foreground">({cards.length} مشروع)</span>
      </div>

      <section className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <ProjectCardView key={c.id} c={c} />
        ))}
        {cards.length === 0 && (
          <p className="col-span-full py-10 text-center text-muted-foreground">ما فيه مشاريع في هذا النطاق.</p>
        )}
      </section>
    </div>
  );
}

function ProjectCardView({ c }: { c: ProjectCard }) {
  return (
    <Link
      href={`/projects/${c.id}`}
      className="glass group block rounded-2xl p-5 transition-colors hover:border-gold/40"
    >
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-bold text-foreground">{c.name}</h3>
          {c.district && <p className="text-xs text-muted-foreground">{c.district}</p>}
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-xs ${projectStatusColor[c.status]}`}>
          {projectStatusLabels[c.status]}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-lg bg-success/10 py-2 text-success">
          <div className="text-base font-bold">{formatNumberShort(c.units.available)}</div>
          متاحة
        </div>
        <div className="rounded-lg bg-warning/10 py-2 text-warning">
          <div className="text-base font-bold">{formatNumberShort(c.units.reserved)}</div>
          محجوزة
        </div>
        <div className="rounded-lg bg-secondary py-2 text-muted-foreground">
          <div className="text-base font-bold">{formatNumberShort(c.units.sold)}</div>
          مباعة
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm">
        <span className="text-gold">
          {c.priceMin ? formatCurrency(c.priceMin) : "—"}
          {c.priceMax ? ` – ${formatCurrency(c.priceMax)}` : ""}
        </span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        التسليم: {c.deliveryDate ? formatDate(c.deliveryDate) : "—"}
      </div>
      {c.falLicense && (
        <div className="mt-2 text-[0.65rem] text-muted-foreground/70">ترخيص فال: {c.falLicense}</div>
      )}
    </Link>
  );
}
