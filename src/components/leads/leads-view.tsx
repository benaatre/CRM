"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, ArrowUpDown, Trash2, X, ChevronLeft, ChevronRight } from "lucide-react";
import type { Channel, LeadStage } from "@prisma/client";
import {
  stageLabels,
  stageColor,
  channelLabels,
  channelLabel,
  priorityColor,
  priorityLabels,
} from "@/lib/labels";
import { formatDate, timeAgo, isFollowupDue, toArabicDigits } from "@/lib/format";
import type { LeadRow } from "@/lib/data/leads";
import { bulkReassign, bulkDelete } from "@/lib/actions/leads";
import { LeadDrawer } from "./lead-drawer";
import { NewLeadDialog } from "./new-lead-dialog";

type Employee = { id: string; name: string };
type SortKey = "name" | "createdAt" | "nextFollowup" | "attempts";

const quickStages: { label: string; stage: LeadStage | ""; notContacted?: boolean }[] = [
  { label: "كل المراحل", stage: "" },
  { label: "لم يتم التواصل", stage: "", notContacted: true },
  { label: "جديد", stage: "NEW" },
  { label: "مهتم", stage: "INTERESTED" },
  { label: "تفاوض", stage: "NEGOTIATION" },
  { label: "محجوز", stage: "RESERVED" },
  { label: "مقفول", stage: "CLOSED_WON" },
];

const PAGE_SIZE = 10;

export function LeadsView({
  leads,
  isManager,
  employees,
  initialQ = "",
}: {
  leads: LeadRow[];
  isManager: boolean;
  employees: Employee[];
  initialQ?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [q, setQ] = useState(initialQ);
  const [quick, setQuick] = useState(0);
  const [channel, setChannel] = useState<Channel | "">("");
  const [emp, setEmp] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "createdAt", dir: -1 });
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<Set<string>>(new Set());

  const active = quickStages[quick];

  const filtered = useMemo(() => {
    const out = leads.filter((l) => {
      if (q && !(l.name.includes(q) || l.phone.includes(q))) return false;
      if (active.stage && l.stage !== active.stage) return false;
      if (active.notContacted && l.attempts > 0) return false;
      if (channel && l.channel !== channel) return false;
      if (emp && l.assignedTo?.id !== emp) return false;
      return true;
    });
    out.sort((a, b) => {
      let av: number | string = "", bv: number | string = "";
      if (sort.key === "name") { av = a.name; bv = b.name; }
      else if (sort.key === "attempts") { av = a.attempts; bv = b.attempts; }
      else if (sort.key === "createdAt") { av = a.createdAt.getTime(); bv = b.createdAt.getTime(); }
      else { av = a.nextFollowup?.getTime() ?? 0; bv = b.nextFollowup?.getTime() ?? 0; }
      return av < bv ? -sort.dir : av > bv ? sort.dir : 0;
    });
    return out;
  }, [leads, q, active, channel, emp, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const curPage = Math.min(page, pages);
  const pageRows = filtered.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  }
  function toggleSel(id: string) {
    setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleSelAll() {
    setSel((s) => (pageRows.every((r) => s.has(r.id)) ? new Set() : new Set(pageRows.map((r) => r.id))));
  }
  function clearSel() { setSel(new Set()); }

  function doReassign(toUserId: string) {
    if (!toUserId) return;
    startTransition(async () => { await bulkReassign([...sel], toUserId); clearSel(); router.refresh(); });
  }
  function doDelete() {
    if (!confirm(`متأكد تبي تحذف ${sel.size} عميل؟`)) return;
    startTransition(async () => { await bulkDelete([...sel]); clearSel(); router.refresh(); });
  }

  return (
    <div className="mx-auto max-w-7xl">
      <header className="mb-5 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">كل العملاء</h1>
          <p className="mt-1 text-sm text-muted-foreground">{toArabicDigits(filtered.length)} من {toArabicDigits(leads.length)} عميل</p>
        </div>
        <button onClick={() => setShowNew(true)} className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90">
          <Plus className="size-4" /> عميل جديد
        </button>
      </header>

      {/* أزرار المراحل */}
      <div className="mb-3 flex flex-wrap gap-2">
        {quickStages.map((s, i) => (
          <button
            key={s.label}
            onClick={() => { setQuick(i); setPage(1); }}
            className={`rounded-xl border px-3 py-1.5 text-sm transition-colors ${
              quick === i ? "border-gold/50 bg-gold/10 text-gold" : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* شريط الأدوات */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="ابحث بالاسم أو الجوال…" className="w-full rounded-xl border border-border bg-card py-2.5 pr-9 pl-3 text-sm outline-none focus:border-gold" />
        </div>
        <select value={channel} onChange={(e) => { setChannel(e.target.value as Channel | ""); setPage(1); }} className="rounded-xl border border-border bg-card px-3 py-2.5 text-sm">
          <option value="">كل القنوات</option>
          {(Object.keys(channelLabels) as Channel[]).map((c) => <option key={c} value={c}>{channelLabels[c]}</option>)}
        </select>
        {isManager && (
          <select value={emp} onChange={(e) => { setEmp(e.target.value); setPage(1); }} className="rounded-xl border border-border bg-card px-3 py-2.5 text-sm">
            <option value="">كل الموظفين</option>
            {employees.map((e2) => <option key={e2.id} value={e2.id}>{e2.name}</option>)}
          </select>
        )}
      </div>

      {/* شريط التحديد الجماعي */}
      {sel.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-gold/40 bg-gold/10 px-4 py-2.5 text-sm">
          <span className="font-medium text-gold">تم تحديد {toArabicDigits(sel.size)}</span>
          {isManager && (
            <select onChange={(e) => doReassign(e.target.value)} defaultValue="" disabled={pending} className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm">
              <option value="" disabled>نقل إلى…</option>
              {employees.map((e2) => <option key={e2.id} value={e2.id}>{e2.name}</option>)}
            </select>
          )}
          <button onClick={doDelete} disabled={pending} className="flex items-center gap-1.5 rounded-lg border border-destructive/40 px-3 py-1.5 text-destructive hover:bg-destructive/10">
            <Trash2 className="size-4" /> حذف
          </button>
          <button onClick={clearSel} className="flex items-center gap-1 text-muted-foreground hover:text-foreground">
            <X className="size-4" /> إلغاء
          </button>
        </div>
      )}

      {/* الجدول */}
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full text-right text-sm">
          <thead className="bg-secondary/40 text-muted-foreground">
            <tr>
              <th className="px-4 py-3"><input type="checkbox" checked={pageRows.length > 0 && pageRows.every((r) => sel.has(r.id))} onChange={toggleSelAll} /></th>
              <th className="px-3 py-3 font-medium">#</th>
              <Th label="العميل" onClick={() => toggleSort("name")} />
              <th className="px-4 py-3 font-medium">الجوال</th>
              <th className="px-4 py-3 font-medium">القناة</th>
              <th className="px-4 py-3 font-medium">المرحلة</th>
              <Th label="المتابعة" onClick={() => toggleSort("nextFollowup")} />
              {isManager && <th className="px-4 py-3 font-medium">الموظف</th>}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr><td colSpan={isManager ? 8 : 7} className="px-4 py-10 text-center text-muted-foreground">ما فيه عملاء مطابقين.</td></tr>
            ) : (
              pageRows.map((l, i) => (
                <tr key={l.id} className="border-t border-border transition-colors hover:bg-secondary/40">
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={sel.has(l.id)} onChange={() => toggleSel(l.id)} />
                  </td>
                  <td className="cursor-pointer px-3 py-3 text-muted-foreground" onClick={() => setSelectedId(l.id)}>{toArabicDigits((curPage - 1) * PAGE_SIZE + i + 1)}</td>
                  <td className="cursor-pointer px-4 py-3" onClick={() => setSelectedId(l.id)}>
                    <div className="flex items-center gap-2">
                      <span className={`size-2 rounded-full ${priorityColor[l.priority].replace("text-", "bg-")}`} title={priorityLabels[l.priority]} />
                      <span className="font-medium text-foreground">{l.name}</span>
                    </div>
                  </td>
                  <td className="cursor-pointer px-4 py-3 text-gold" dir="ltr" onClick={() => setSelectedId(l.id)}>{l.phone}</td>
                  <td className="cursor-pointer px-4 py-3 text-muted-foreground" onClick={() => setSelectedId(l.id)}>{channelLabel(l.channel)}</td>
                  <td className="cursor-pointer px-4 py-3" onClick={() => setSelectedId(l.id)}>
                    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs ${stageColor[l.stage]}`}>{stageLabels[l.stage]}</span>
                  </td>
                  <td className="cursor-pointer px-4 py-3" onClick={() => setSelectedId(l.id)}>
                    {l.nextFollowup ? <span className={isFollowupDue(l.nextFollowup) ? "text-destructive" : "text-muted-foreground"}>{timeAgo(l.nextFollowup)}</span> : <span className="text-muted-foreground">—</span>}
                  </td>
                  {isManager && <td className="cursor-pointer px-4 py-3 text-muted-foreground" onClick={() => setSelectedId(l.id)}>{l.assignedTo?.name ?? "—"}</td>}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ترقيم الصفحات */}
      {filtered.length > 0 && (
        <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
          <span>عرض {toArabicDigits((curPage - 1) * PAGE_SIZE + 1)}–{toArabicDigits(Math.min(curPage * PAGE_SIZE, filtered.length))} من {toArabicDigits(filtered.length)}</span>
          <div className="flex items-center gap-1">
            <button disabled={curPage === 1} onClick={() => setPage(curPage - 1)} className="rounded-lg border border-border p-1.5 disabled:opacity-40"><ChevronRight className="size-4" /></button>
            <span className="px-2">{toArabicDigits(curPage)} / {toArabicDigits(pages)}</span>
            <button disabled={curPage === pages} onClick={() => setPage(curPage + 1)} className="rounded-lg border border-border p-1.5 disabled:opacity-40"><ChevronLeft className="size-4" /></button>
          </div>
        </div>
      )}

      <LeadDrawer leadId={selectedId} onClose={() => setSelectedId(null)} isManager={isManager} employees={employees} />
      <NewLeadDialog open={showNew} onClose={() => setShowNew(false)} isManager={isManager} employees={employees} />
    </div>
  );
}

function Th({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <th className="px-4 py-3 font-medium">
      <button onClick={onClick} className="flex items-center gap-1 hover:text-foreground">
        {label} <ArrowUpDown className="size-3" />
      </button>
    </th>
  );
}
