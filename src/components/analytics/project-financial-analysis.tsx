"use client";

import { useState, useTransition } from "react";
import {
  projectStatusLabels, paymentMethodLabels, bankLabels,
  floorLabels,
} from "@/lib/labels";
import { formatCurrencyFull, toArabicDigits } from "@/lib/format";
import { fetchProjectFinance, fetchAllProjectsFinance } from "@/lib/actions/analytics";
import type { ProjectFinance, ProjectFinanceRow, AllProjectsFinanceRow } from "@/lib/data/analytics";

const ALL = "__ALL__";

export function ProjectFinancialAnalysis({ projects }: { projects: { id: string; name: string }[] }) {
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState("");
  const [data, setData] = useState<ProjectFinance | null>(null);
  const [allData, setAllData] = useState<AllProjectsFinanceRow[] | null>(null);

  function onSelect(id: string) {
    setSelected(id);
    setData(null);
    setAllData(null);
    if (!id) return;
    startTransition(async () => {
      if (id === ALL) setAllData(await fetchAllProjectsFinance());
      else setData(await fetchProjectFinance(id));
    });
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold text-foreground">تحليل المشاريع المالي</h2>
        <select value={selected} onChange={(e) => onSelect(e.target.value)} className="select-base sm:w-auto">
          <option value="">اختر مشروعًا…</option>
          <option value={ALL}>كل المشاريع (مقارنة)</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {pending && <p className="glass rounded-2xl p-8 text-center text-sm text-muted-foreground">جارٍ التحميل…</p>}

      {!pending && allData && <AllProjectsComparison rows={allData} />}
      {!pending && data && <SingleProject d={data} />}
      {!pending && !data && !allData && selected === "" && (
        <p className="glass rounded-2xl p-8 text-center text-muted-foreground">اختر مشروعًا لعرض تحليله المالي، أو «كل المشاريع» للمقارنة.</p>
      )}
    </section>
  );
}

// ===================== مشروع واحد =====================
function SingleProject({ d }: { d: ProjectFinance }) {
  return (
    <div className="space-y-6">
      {/* قسم أ — نظرة المشروع الكاملة */}
      <Block title="نظرة المشروع الكاملة" badge={projectStatusLabels[d.constructionStatus]}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <BigCard label="أصل المبلغ عند الطرح" value={formatCurrencyFull(d.listValue)} accent="text-foreground" sub={`${toArabicDigits(d.unitsTotal)} وحدة`} />
          <BigCard label="إجمالي الخصم المخطط" value={formatCurrencyFull(d.plannedDiscount)} accent="text-warning" sub={`${toArabicDigits(d.plannedDiscountPct)}٪ من الأصل`} />
          <BigCard label="صافي القيمة بعد الخصم" value={formatCurrencyFull(d.netAfterDiscount)} accent="text-gold" />
          <BigCard label="حالة البناء" value={projectStatusLabels[d.constructionStatus]} accent="text-info" textValue />
        </div>
      </Block>

      {/* قسم ب — الإنجاز */}
      <Block title="الإنجاز">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
          <div className="flex-1">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">نسبة الإنجاز (مباع + محجوز)</span>
              <span className="text-xl font-bold text-gold">{toArabicDigits(d.completionPct)}٪</span>
            </div>
            <div className="flex h-5 overflow-hidden rounded-full bg-secondary" title="مباع / محجوز / متاح">
              <Bar n={d.soldCount} total={d.unitsTotal} cls="bg-info" />
              <Bar n={d.reservedCount} total={d.unitsTotal} cls="bg-warning" />
              <Bar n={d.availableCount} total={d.unitsTotal} cls="bg-success/60" />
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2 text-center text-xs lg:w-80">
            <CountCell label="الكل" v={d.unitsTotal} cls="text-foreground" />
            <CountCell label="مباع" v={d.soldCount} cls="text-info" dot="bg-info" />
            <CountCell label="محجوز" v={d.reservedCount} cls="text-warning" dot="bg-warning" />
            <CountCell label="متاح" v={d.availableCount} cls="text-success" dot="bg-success/60" />
          </div>
        </div>
      </Block>

      {/* قسم ج — المبيعات الفعلية */}
      <Block title="المبيعات الفعلية">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <BigCard label="إجمالي المبيعات الفعلية" value={formatCurrencyFull(d.totalSales)} accent="text-success" sub={`${toArabicDigits(d.count)} وحدة مباعة/محجوزة`} />
          <BigCard label="إجمالي الخصم الممنوح" value={formatCurrencyFull(d.totalDiscount)} accent="text-warning" sub={`${toArabicDigits(d.actualDiscountPct)}٪ من قيمة طرحها`} />
          <BigCard label="متوسط الخصم لكل شقة" value={formatCurrencyFull(d.avgDiscount)} accent="text-warning" />
          <BigCard label="إجمالي المحصّل" value={formatCurrencyFull(d.totalCollected)} accent="text-gold" />
          <div className="rounded-2xl border border-border bg-card p-4 sm:col-span-2">
            <div className="mb-1 text-sm font-bold text-destructive">{formatCurrencyFull(d.totalRemaining)}</div>
            <div className="mb-2 text-xs text-muted-foreground">إجمالي المتبقّي — تفسيره:</div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <RemainCell label="تمويل بنكي" v={d.remainingBankFinance} />
              <RemainCell label="أقساط" v={d.remainingInstallments} />
              <RemainCell label="أخرى" v={d.remainingOther} />
            </div>
          </div>
        </div>
      </Block>

      {/* قسم د — جدول تفصيلي */}
      <Block title="تفاصيل الوحدات المباعة/المحجوزة">
        {d.rows.length === 0 ? (
          <p className="py-6 text-center text-muted-foreground">ما فيه وحدات مباعة أو محجوزة في هذا المشروع.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[1040px] text-right text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
              <thead className="bg-secondary/40 text-muted-foreground">
                <tr>
                  {["رقم الوحدة", "الدور", "اسم العميل", "جوال العميل", "الهوية/الإقامة", "السعر الأصلي", "باع بكم", "الخصم", "نسبة الخصم", "طريقة الدفع", "الموظف البائع", "الحالة"].map((h) => (
                    <th key={h} className="px-3 py-2.5 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r, i) => (
                  <tr key={i} className={`border-t border-border ${i % 2 ? "bg-secondary/20" : ""} hover:bg-secondary/40`}>
                    <td className="px-3 py-2.5 font-medium text-foreground" dir="ltr">{r.unitNumber}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{r.floorLevel ? floorLabels[r.floorLevel] : (r.floor ?? "—")}</td>
                    <td className="px-3 py-2.5 text-foreground">{r.leadName ?? "—"}</td>
                    <td className="px-3 py-2.5 text-muted-foreground" dir="ltr">{r.leadPhone ?? "—"}</td>
                    <td className="px-3 py-2.5 text-muted-foreground" dir="ltr">{r.nationalId ? `${r.nationality === "RESIDENT" ? "إقامة" : "هوية"} ${r.nationalId}` : "—"}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{formatCurrencyFull(r.originalPrice)}</td>
                    <td className="px-3 py-2.5 font-medium text-gold">{formatCurrencyFull(r.soldPrice)}</td>
                    <td className="px-3 py-2.5 text-warning">{r.discount > 0 ? formatCurrencyFull(r.discount) : "—"}</td>
                    <td className="px-3 py-2.5 text-warning">{r.discount > 0 ? `${toArabicDigits(r.discountPct)}٪` : "—"}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{paymentMethodLabels[r.paymentMethod]}{r.bankName ? ` · ${bankLabels[r.bankName]}` : ""}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{r.sellerName ?? "—"}</td>
                    <td className="px-3 py-2.5"><StatusChip stage={r.stage} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Block>
    </div>
  );
}

function StatusChip({ stage }: { stage: ProjectFinanceRow["stage"] }) {
  const cfg = stage === "DELIVERED"
    ? { t: "تم البيع والاستلام", c: "bg-success/15 text-success" }
    : stage === "SOLD"
      ? { t: "تم البيع", c: "bg-info/15 text-info" }
      : { t: "محجوز", c: "bg-warning/15 text-warning" };
  return <span className={`rounded-full px-2 py-0.5 text-xs ${cfg.c}`}>{cfg.t}</span>;
}

// ===================== مقارنة كل المشاريع (قسم هـ) =====================
function AllProjectsComparison({ rows }: { rows: AllProjectsFinanceRow[] }) {
  return (
    <Block title="مقارنة كل المشاريع">
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[920px] text-right text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
          <thead className="bg-secondary/40 text-muted-foreground">
            <tr>
              {["المشروع", "قيمة الطرح", "عدد الوحدات", "المباع", "نسبة الإنجاز", "إجمالي المبيعات", "إجمالي الخصم", "نسبة الخصم", "المحصّل", "المتبقّي"].map((h) => (
                <th key={h} className="px-3 py-2.5 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.projectId} className={`border-t border-border ${i % 2 ? "bg-secondary/20" : ""} hover:bg-secondary/40`}>
                <td className="px-3 py-2.5 font-medium text-foreground">{r.projectName}</td>
                <td className="px-3 py-2.5 text-muted-foreground">{formatCurrencyFull(r.listValue)}</td>
                <td className="px-3 py-2.5 text-muted-foreground">{toArabicDigits(r.unitsTotal)}</td>
                <td className="px-3 py-2.5 text-info">{toArabicDigits(r.sold)}</td>
                <td className="px-3 py-2.5 text-gold">{toArabicDigits(r.completionPct)}٪</td>
                <td className="px-3 py-2.5 text-success">{formatCurrencyFull(r.totalSales)}</td>
                <td className="px-3 py-2.5 text-warning">{formatCurrencyFull(r.totalDiscount)}</td>
                <td className="px-3 py-2.5 text-warning">{toArabicDigits(r.discountPct)}٪</td>
                <td className="px-3 py-2.5 text-foreground">{formatCurrencyFull(r.collected)}</td>
                <td className="px-3 py-2.5 text-destructive">{formatCurrencyFull(r.remaining)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">ما فيه مشاريع.</td></tr>}
          </tbody>
        </table>
      </div>
    </Block>
  );
}

// ===================== عناصر مساعدة =====================
function Block({ title, badge, children }: { title: string; badge?: string; children: React.ReactNode }) {
  return (
    <div className="glass rounded-2xl p-5">
      <div className="mb-4 flex items-center gap-2">
        <span className="h-5 w-1 rounded-full bg-gold" />
        <h3 className="font-semibold text-foreground">{title}</h3>
        {badge && <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">{badge}</span>}
      </div>
      {children}
    </div>
  );
}

function BigCard({ label, value, accent, sub, textValue }: { label: string; value: string; accent?: string; sub?: string; textValue?: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className={`${textValue ? "text-lg" : "text-xl"} font-bold ${accent ?? "text-foreground"}`}>{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
      {sub && <div className="text-[0.65rem] text-muted-foreground/70">{sub}</div>}
    </div>
  );
}

function Bar({ n, total, cls }: { n: number; total: number; cls: string }) {
  const w = total > 0 ? (n / total) * 100 : 0;
  if (w <= 0) return null;
  return <div className={cls} style={{ width: `${w}%` }} title={`${n}`} />;
}

function CountCell({ label, v, cls, dot }: { label: string; v: number; cls: string; dot?: string }) {
  return (
    <div className="rounded-lg bg-secondary/50 py-2">
      <div className={`text-lg font-bold ${cls}`}>{toArabicDigits(v)}</div>
      <div className="flex items-center justify-center gap-1 text-muted-foreground">
        {dot && <span className={`size-2 rounded-full ${dot}`} />}{label}
      </div>
    </div>
  );
}

function RemainCell({ label, v }: { label: string; v: number }) {
  return (
    <div className="rounded-lg bg-secondary/50 py-2">
      <div className="text-xs font-bold text-foreground">{v > 0 ? formatCurrencyFull(v) : "—"}</div>
      <div className="text-[0.65rem] text-muted-foreground">{label}</div>
    </div>
  );
}
