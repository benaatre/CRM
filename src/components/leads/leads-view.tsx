"use client";

import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import type { Channel, LeadStage } from "@prisma/client";
import {
  stageOrder,
  stageLabels,
  stageColor,
  channelLabels,
  channelLabel,
  priorityColor,
  priorityLabels,
} from "@/lib/labels";
import { formatDate, timeAgo, isFollowupDue } from "@/lib/format";
import type { LeadRow } from "@/lib/data/leads";
import { LeadDrawer } from "./lead-drawer";
import { NewLeadDialog } from "./new-lead-dialog";

type Employee = { id: string; name: string };

export function LeadsView({
  leads,
  isManager,
  employees,
}: {
  leads: LeadRow[];
  isManager: boolean;
  employees: Employee[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [q, setQ] = useState("");
  const [stage, setStage] = useState<LeadStage | "">("");
  const [channel, setChannel] = useState<Channel | "">("");
  const [emp, setEmp] = useState<string>("");
  const [notContacted, setNotContacted] = useState(false);

  const filtered = useMemo(() => {
    return leads.filter((l) => {
      if (q && !(l.name.includes(q) || l.phone.includes(q))) return false;
      if (stage && l.stage !== stage) return false;
      if (channel && l.channel !== channel) return false;
      if (emp && l.assignedTo?.id !== emp) return false;
      if (notContacted && l.attempts > 0) return false;
      return true;
    });
  }, [leads, q, stage, channel, emp, notContacted]);

  return (
    <div className="mx-auto max-w-7xl">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">كل العملاء</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {filtered.length} من {leads.length} عميل
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          <Plus className="size-4" />
          عميل جديد
        </button>
      </header>

      {/* الفلاتر */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ابحث بالاسم أو الجوال…"
            className="w-full rounded-xl border border-border bg-card py-2.5 pr-9 pl-3 text-sm outline-none focus:border-gold"
          />
        </div>
        <select value={stage} onChange={(e) => setStage(e.target.value as LeadStage | "")} className="w-auto rounded-xl border border-border bg-card px-3 py-2.5 text-sm">
          <option value="">كل المراحل</option>
          {stageOrder.map((s) => (
            <option key={s} value={s}>{stageLabels[s]}</option>
          ))}
        </select>
        <select value={channel} onChange={(e) => setChannel(e.target.value as Channel | "")} className="w-auto rounded-xl border border-border bg-card px-3 py-2.5 text-sm">
          <option value="">كل القنوات</option>
          {(Object.keys(channelLabels) as Channel[]).map((c) => (
            <option key={c} value={c}>{channelLabels[c]}</option>
          ))}
        </select>
        {isManager && (
          <select value={emp} onChange={(e) => setEmp(e.target.value)} className="w-auto rounded-xl border border-border bg-card px-3 py-2.5 text-sm">
            <option value="">كل الموظفين</option>
            {employees.map((e2) => (
              <option key={e2.id} value={e2.id}>{e2.name}</option>
            ))}
          </select>
        )}
        <button
          onClick={() => setNotContacted((v) => !v)}
          className={`rounded-xl border px-3 py-2.5 text-sm transition-colors ${
            notContacted ? "border-warning/50 bg-warning/10 text-warning" : "border-border bg-card text-muted-foreground hover:text-foreground"
          }`}
        >
          لم يتم التواصل
        </button>
      </div>

      {/* الجدول */}
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full text-right text-sm">
          <thead className="bg-secondary/40 text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">العميل</th>
              <th className="px-4 py-3 font-medium">الجوال</th>
              <th className="px-4 py-3 font-medium">القناة</th>
              <th className="px-4 py-3 font-medium">المرحلة</th>
              <th className="px-4 py-3 font-medium">محاولات</th>
              <th className="px-4 py-3 font-medium">أُضيف</th>
              <th className="px-4 py-3 font-medium">المتابعة</th>
              {isManager && <th className="px-4 py-3 font-medium">الموظف</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={isManager ? 8 : 7} className="px-4 py-10 text-center text-muted-foreground">
                  ما فيه عملاء مطابقين.
                </td>
              </tr>
            ) : (
              filtered.map((l) => (
                <tr
                  key={l.id}
                  onClick={() => setSelectedId(l.id)}
                  className="cursor-pointer border-t border-border transition-colors hover:bg-secondary/40"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`size-2 rounded-full ${priorityColor[l.priority].replace("text-", "bg-")}`} title={priorityLabels[l.priority]} />
                      <span className="font-medium text-foreground">{l.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground" dir="ltr">{l.phone}</td>
                  <td className="px-4 py-3 text-muted-foreground">{channelLabel(l.channel)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs ${stageColor[l.stage]}`}>
                      {stageLabels[l.stage]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{l.attempts}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(l.createdAt)}</td>
                  <td className="px-4 py-3">
                    {l.nextFollowup ? (
                      <span className={isFollowupDue(l.nextFollowup) ? "text-destructive" : "text-muted-foreground"}>
                        {timeAgo(l.nextFollowup)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  {isManager && (
                    <td className="px-4 py-3 text-muted-foreground">{l.assignedTo?.name ?? "—"}</td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <LeadDrawer
        leadId={selectedId}
        onClose={() => setSelectedId(null)}
        isManager={isManager}
        employees={employees}
      />
      <NewLeadDialog
        open={showNew}
        onClose={() => setShowNew(false)}
        isManager={isManager}
        employees={employees}
      />
    </div>
  );
}
