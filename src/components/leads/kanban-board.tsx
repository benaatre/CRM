"use client";

import { useState } from "react";
import Link from "next/link";
import type { LeadStage, Priority } from "@prisma/client";
import { stageOrder, stageLabels, purchaseGoalLabels, purchaseMethodLabels, priorityLabels } from "@/lib/labels";
import { toArabicDigits, formatCurrency } from "@/lib/format";
import type { LeadFilterValues } from "@/lib/lead-filters";
import { LeadsFilterBar } from "./leads-filter-bar";
import { LeadDrawer } from "./lead-drawer";
import { useLeads } from "./use-leads";

type Employee = { id: string; name: string };

const priorityBorder: Record<Priority, string> = {
  HIGH: "border-r-destructive",
  MEDIUM: "border-r-warning",
  LOW: "border-r-muted-foreground",
};

export function KanbanBoard({
  query,
  isManager,
  employees,
  filters,
}: {
  query: string;
  isManager: boolean;
  employees: Employee[];
  filters: LeadFilterValues;
}) {
  const { leads: items, loading, reload, setLeads } = useLeads(query);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<LeadStage | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileStage, setMobileStage] = useState<LeadStage>("NEW");

  // تغيير مرحلة عميل (مشترك بين السحب على سطح المكتب وأزرار النقل على الجوال).
  async function changeStage(id: string, stage: LeadStage) {
    const lead = items.find((l) => l.id === id);
    if (!lead || lead.stage === stage) return;
    setLeads((cur) => cur.map((l) => (l.id === id ? { ...l, stage } : l))); // متفائل
    const res = await fetch(`/api/leads/${id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ stage }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data?.error ?? "تعذّر تغيير المرحلة");
    }
    reload(); // يقرأ الحقيقة من نفس الـ API (يؤكّد أو يتراجع)
  }

  function moveTo(stage: LeadStage) {
    const id = dragId;
    setDragId(null);
    setOverStage(null);
    if (id) changeStage(id, stage);
  }

  return (
    <div className="mx-auto max-w-[1600px]">
      <header className="mb-4">
        <h1 className="text-2xl font-bold text-foreground">مراحل العملاء</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          اسحب البطاقة لتغيير مرحلة العميل — {toArabicDigits(items.length)} عميل{loading ? " · جارٍ التحديث…" : ""}
        </p>
      </header>

      {/* نفس شريط فلاتر جدول العملاء (server-side) */}
      <div className="mb-4">
        <LeadsFilterBar basePath="/pipeline" isManager={isManager} employees={employees} filters={filters} />
      </div>

      {/* عرض الجوال: عمود واحد + اختيار المرحلة + أزرار نقل بدل السحب */}
      <div className="md:hidden">
        <select
          value={mobileStage}
          onChange={(e) => setMobileStage(e.target.value as LeadStage)}
          className="select-base mb-3 font-medium"
        >
          {stageOrder.map((s) => (
            <option key={s} value={s}>{stageLabels[s]} ({toArabicDigits(items.filter((l) => l.stage === s).length)})</option>
          ))}
        </select>
        <div className="space-y-3">
          {items.filter((l) => l.stage === mobileStage).length === 0 ? (
            <p className="rounded-xl border border-dashed border-border py-8 text-center text-sm text-muted-foreground">ما فيه عملاء في «{stageLabels[mobileStage]}».</p>
          ) : (
            items.filter((l) => l.stage === mobileStage).map((l) => (
              <article key={l.id} className={`rounded-xl border border-r-4 border-border bg-card p-4 ${priorityBorder[l.priority]}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-foreground">{l.name}</div>
                    <a href={`tel:${l.phone}`} className="text-xs text-gold" dir="ltr">{l.phone}</a>
                  </div>
                  <Link href={`/leads/${l.id}`} className="flex min-h-11 shrink-0 items-center rounded-lg border border-border px-3 text-xs text-muted-foreground hover:border-gold/40 hover:text-gold">فتح</Link>
                </div>
                <div className="mt-1.5 text-xs text-muted-foreground">
                  {l.purchaseGoal ? purchaseGoalLabels[l.purchaseGoal] : "—"} · {l.purchaseMethod ? purchaseMethodLabels[l.purchaseMethod] : "—"}
                  {isManager && l.assignedTo && <> · {l.assignedTo.name}</>}
                </div>
                <label className="mt-3 block space-y-1">
                  <span className="text-xs text-muted-foreground">نقل لمرحلة:</span>
                  <select value={l.stage} onChange={(e) => changeStage(l.id, e.target.value as LeadStage)} className="select-base min-h-12">
                    {stageOrder.map((s) => <option key={s} value={s}>{stageLabels[s]}</option>)}
                  </select>
                </label>
              </article>
            ))
          )}
        </div>
      </div>

      {/* عرض سطح المكتب: أعمدة بالسحب والإفلات */}
      <div className="hidden gap-4 overflow-x-auto pb-4 md:flex">
        {stageOrder.map((stage) => {
          const cards = items.filter((l) => l.stage === stage);
          return (
            <div
              key={stage}
              onDragOver={(e) => { e.preventDefault(); setOverStage(stage); }}
              onDragLeave={() => setOverStage((s) => (s === stage ? null : s))}
              onDrop={() => moveTo(stage)}
              className={`flex w-72 shrink-0 flex-col rounded-2xl border bg-card/40 transition-colors ${overStage === stage ? "border-gold/60 bg-gold/5" : "border-border"}`}
            >
              <div className="flex items-center justify-between border-b border-border p-3">
                <span className="text-sm font-semibold text-foreground">{stageLabels[stage]}</span>
                <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">{toArabicDigits(cards.length)}</span>
              </div>

              <div className="flex flex-1 flex-col gap-2 p-3">
                {cards.map((l) => (
                  <article
                    key={l.id}
                    draggable
                    onDragStart={() => setDragId(l.id)}
                    onDragEnd={() => setDragId(null)}
                    onClick={() => setSelectedId(l.id)}
                    title={`أولوية ${priorityLabels[l.priority]}`}
                    className={`cursor-pointer rounded-xl border border-r-4 border-border bg-card p-3 shadow-sm transition-all hover:border-gold/40 ${priorityBorder[l.priority]} ${dragId === l.id ? "opacity-40" : ""}`}
                  >
                    <div className="font-medium text-foreground">{l.name}</div>
                    <div className="mt-0.5 text-xs text-gold" dir="ltr">{l.phone}</div>
                    <div className="mt-1.5 text-xs text-muted-foreground">
                      {l.purchaseGoal ? purchaseGoalLabels[l.purchaseGoal] : "—"} · {l.purchaseMethod ? purchaseMethodLabels[l.purchaseMethod] : "—"}
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{toArabicDigits(l.followUpsCount)} متابعة</span>
                      {isManager && l.assignedTo && <span className="text-muted-foreground/70">{l.assignedTo.name}</span>}
                    </div>
                    {l.booking && (
                      <div className="mt-2 space-y-0.5 rounded-lg border border-border bg-secondary/40 px-2 py-1.5 text-xs">
                        <div className="flex justify-between"><span className="text-muted-foreground">محصّل</span><span className="text-success">{formatCurrency(l.booking.collected)}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">متبقي</span><span className="text-gold">{formatCurrency(l.booking.remaining)}</span></div>
                      </div>
                    )}
                    <Link
                      href={`/leads/${l.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-2 block rounded-lg border border-border py-1.5 text-center text-xs text-muted-foreground hover:border-gold/40 hover:text-gold"
                    >فتح الملف</Link>
                  </article>
                ))}
                {cards.length === 0 && (
                  <div className="rounded-xl border border-dashed border-border py-6 text-center text-xs text-muted-foreground">اسحب هنا</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <LeadDrawer
        leadId={selectedId}
        onClose={() => { setSelectedId(null); reload(); }}
        isManager={isManager}
        employees={employees}
      />
    </div>
  );
}
