"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { LeadStage } from "@prisma/client";
import type { Priority } from "@prisma/client";
import { stageOrder, stageLabels, channelLabel, priorityLabels } from "@/lib/labels";
import { formatCurrency, toArabicDigits } from "@/lib/format";
import type { LeadRow } from "@/lib/data/leads";
import type { LeadFilterValues } from "@/lib/lead-filters";
import { updateLeadStage } from "@/lib/actions/leads";
import { LeadsFilterBar } from "./leads-filter-bar";
import { LeadDrawer } from "./lead-drawer";

type Employee = { id: string; name: string };

const priorityBorder: Record<Priority, string> = {
  HIGH: "border-r-destructive",
  MEDIUM: "border-r-warning",
  LOW: "border-r-muted-foreground",
};

export function KanbanBoard({
  leads,
  isManager,
  employees,
  filters,
}: {
  leads: LeadRow[];
  isManager: boolean;
  employees: Employee[];
  filters: LeadFilterValues;
}) {
  const router = useRouter();
  const [items, setItems] = useState<LeadRow[]>(leads);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<LeadStage | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => setItems(leads), [leads]);

  async function moveTo(stage: LeadStage) {
    const id = dragId;
    setDragId(null);
    setOverStage(null);
    if (!id) return;
    const lead = items.find((l) => l.id === id);
    if (!lead || lead.stage === stage) return;

    const prev = items;
    setItems((cur) => cur.map((l) => (l.id === id ? { ...l, stage } : l))); // متفائل
    const res = await updateLeadStage(id, stage);
    if (!res.ok) {
      setItems(prev); // تراجع عند الفشل
    } else {
      router.refresh();
    }
  }

  return (
    <div className="mx-auto max-w-[1600px]">
      <header className="mb-4">
        <h1 className="text-2xl font-bold text-foreground">مراحل العملاء</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          اسحب البطاقة لتغيير مرحلة العميل — {toArabicDigits(items.length)} عميل
        </p>
      </header>

      {/* نفس شريط فلاتر جدول العملاء (server-side) */}
      <div className="mb-4">
        <LeadsFilterBar basePath="/pipeline" isManager={isManager} employees={employees} filters={filters} />
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4">
        {stageOrder.map((stage) => {
          const cards = items.filter((l) => l.stage === stage);
          const total = cards.reduce((s, l) => s + (l.budget ?? 0), 0);
          return (
            <div
              key={stage}
              onDragOver={(e) => {
                e.preventDefault();
                setOverStage(stage);
              }}
              onDragLeave={() => setOverStage((s) => (s === stage ? null : s))}
              onDrop={() => moveTo(stage)}
              className={`flex w-72 shrink-0 flex-col rounded-2xl border bg-card/40 transition-colors ${
                overStage === stage ? "border-gold/60 bg-gold/5" : "border-border"
              }`}
            >
              <div className="flex items-center justify-between border-b border-border p-3">
                <span className="text-sm font-semibold text-foreground">{stageLabels[stage]}</span>
                <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                  {cards.length}
                </span>
              </div>
              <div className="px-3 pb-1 pt-2 text-xs text-gold">{formatCurrency(total)}</div>

              <div className="flex flex-1 flex-col gap-2 p-3 pt-1">
                {cards.map((l) => (
                  <article
                    key={l.id}
                    draggable
                    onDragStart={() => setDragId(l.id)}
                    onDragEnd={() => setDragId(null)}
                    onClick={() => setSelectedId(l.id)}
                    title={`أولوية ${priorityLabels[l.priority]}`}
                    className={`cursor-pointer rounded-xl border border-r-4 border-border bg-card p-3 shadow-sm transition-all hover:border-gold/40 ${
                      priorityBorder[l.priority]
                    } ${dragId === l.id ? "opacity-40" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium text-foreground">{l.name}</span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {channelLabel(l.channel)}
                      {l.projectName ? ` · ${l.projectName}` : ""}
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <span className="text-gold">{formatCurrency(l.budget)}</span>
                      <span className="text-muted-foreground">محاولات: {l.attempts}</span>
                    </div>
                    {isManager && l.assignedTo && (
                      <div className="mt-1.5 text-xs text-muted-foreground/70">{l.assignedTo.name}</div>
                    )}
                  </article>
                ))}
                {cards.length === 0 && (
                  <div className="rounded-xl border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
                    اسحب هنا
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <LeadDrawer
        leadId={selectedId}
        onClose={() => setSelectedId(null)}
        isManager={isManager}
        employees={employees}
      />
    </div>
  );
}
