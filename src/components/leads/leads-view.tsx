"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FirstContactStage } from "@prisma/client";
import {
  purchaseMethodLabels, purchaseGoalLabels,
  firstContactStageLabels, firstContactStageColor,
  stageLabels, stageOrder,
} from "@/lib/labels";
import { formatDate, toArabicDigits } from "@/lib/format";
import type { LeadRow } from "@/lib/data/leads";
import {
  setFirstContactStage, resetLeadToNew, reassignLead, bulkReassign, bulkArchive,
} from "@/lib/actions/leads";
import { NewLeadDialog } from "./new-lead-dialog";
import { FollowUpsDrawer } from "./followups-drawer";

type Employee = { id: string; name: string };
const PAGE_SIZE = 12;

export function LeadsView({
  working, archived, isManager, employees, initialQ = "",
}: {
  working: LeadRow[];
  archived: LeadRow[];
  isManager: boolean;
  employees: Employee[];
  initialQ?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState<"working" | "archived">("working");
  const [q, setQ] = useState(initialQ);
  const [emp, setEmp] = useState("");
  const [stageF, setStageF] = useState<string>("");
  const [page, setPage] = useState(1);
  const [showNew, setShowNew] = useState(false);
  const [fuLead, setFuLead] = useState<LeadRow | null>(null);

  const [sel, setSel] = useState<Set<string>>(new Set());
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [transfer, setTransfer] = useState<{ ids: string[] } | null>(null);

  const source = tab === "working" ? working : archived;

  const filtered = useMemo(() => {
    return source.filter((l) => {
      if (q && !(l.name.includes(q) || l.phone.includes(q))) return false;
      if (emp && l.assignedTo?.id !== emp) return false;
      if (stageF && l.stage !== stageF) return false;
      return true;
    });
  }, [source, q, emp, stageF]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const curPage = Math.min(page, pages);
  const rows = filtered.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);

  const allOnPage = rows.length > 0 && rows.every((r) => sel.has(r.id));

  function toggleSel(id: string) {
    setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    setSel((s) => {
      const n = new Set(s);
      if (allOnPage) rows.forEach((r) => n.delete(r.id));
      else rows.forEach((r) => n.add(r.id));
      return n;
    });
  }
  function clearSel() { setSel(new Set()); }

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok && res.error) alert(res.error);
      router.refresh();
    });
  }

  function setStage(id: string, s: FirstContactStage) {
    run(() => setFirstContactStage(id, s));
  }

  function doTransfer(toUserId: string) {
    const ids = transfer?.ids ?? [];
    setTransfer(null);
    run(async () => {
      const res = ids.length === 1 ? await reassignLead(ids[0], toUserId) : await bulkReassign(ids, toUserId);
      clearSel();
      return res;
    });
  }

  return (
    <div className="mx-auto max-w-7xl">
      <header className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-foreground">العملاء</h1>
        <button onClick={() => setShowNew(true)} className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90">
          عميل جديد
        </button>
      </header>

      {/* التبويبان الرئيسيان */}
      <div className="mb-4 flex gap-1 rounded-xl border border-border bg-card p-1">
        {([["working", "جاري العمل", working.length], ["archived", "تم الحجز / الشراء", archived.length]] as const).map(([v, label, count]) => (
          <button key={v} onClick={() => { setTab(v); setPage(1); clearSel(); }} className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${tab === v ? "bg-secondary text-gold" : "text-muted-foreground hover:text-foreground"}`}>
            {label} <span className="text-xs">({toArabicDigits(count)})</span>
          </button>
        ))}
      </div>

      {/* أدوات */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="ابحث بالاسم أو الجوال…" className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm outline-none focus:border-gold" />
        </div>
        <select value={stageF} onChange={(e) => { setStageF(e.target.value); setPage(1); }} className="rounded-xl border border-border bg-card px-3 py-2.5 text-sm">
          <option value="">كل المراحل</option>
          {stageOrder.map((s) => <option key={s} value={s}>{stageLabels[s]}</option>)}
        </select>
        {isManager && (
          <select value={emp} onChange={(e) => { setEmp(e.target.value); setPage(1); }} className="rounded-xl border border-border bg-card px-3 py-2.5 text-sm">
            <option value="">كل الموظفين</option>
            {employees.map((e2) => <option key={e2.id} value={e2.id}>{e2.name}</option>)}
          </select>
        )}
      </div>

      {/* شريط التحديد المتعدد */}
      {sel.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-gold/30 bg-gold/5 px-4 py-2.5 text-sm">
          <span className="font-medium text-foreground">محدّد: {toArabicDigits(sel.size)}</span>
          <div className="flex-1" />
          {isManager && (
            <button onClick={() => setTransfer({ ids: [...sel] })} disabled={pending} className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground hover:bg-secondary disabled:opacity-50">نقل لموظف</button>
          )}
          <button onClick={() => run(async () => { const r = await bulkArchive([...sel]); clearSel(); return r; })} disabled={pending} className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground hover:bg-secondary disabled:opacity-50">أرشفة</button>
          <button onClick={clearSel} className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">إلغاء التحديد</button>
        </div>
      )}

      {/* الجدول */}
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full text-right text-sm">
          <thead className="bg-secondary/40 text-muted-foreground">
            <tr>
              <th className="px-3 py-3"><input type="checkbox" checked={allOnPage} onChange={toggleAll} aria-label="تحديد الكل" /></th>
              <th className="px-3 py-3 font-medium">#</th>
              <th className="px-4 py-3 font-medium">الاسم</th>
              <th className="px-4 py-3 font-medium">الجوال</th>
              <th className="px-4 py-3 font-medium">تاريخ الإضافة</th>
              <th className="px-4 py-3 font-medium">طريقة الشراء</th>
              <th className="px-4 py-3 font-medium">هدف الشراء</th>
              <th className="px-4 py-3 font-medium">المرحلة الأولى</th>
              <th className="px-4 py-3 font-medium">المتابعات</th>
              <th className="px-4 py-3 font-medium">أول تواصل</th>
              <th className="px-3 py-3 font-medium">خيارات</th>
              <th className="px-3 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={12} className="px-4 py-10 text-center text-muted-foreground">ما فيه عملاء.</td></tr>
            ) : (
              rows.map((l, i) => (
                <tr key={l.id} className="border-t border-border transition-colors hover:bg-secondary/40">
                  <td className="px-3 py-3"><input type="checkbox" checked={sel.has(l.id)} onChange={() => toggleSel(l.id)} aria-label={`تحديد ${l.name}`} /></td>
                  <td className="px-3 py-3 text-muted-foreground">{toArabicDigits((curPage - 1) * PAGE_SIZE + i + 1)}</td>
                  <td className="px-4 py-3 font-medium text-foreground">{l.name}</td>
                  <td className="px-4 py-3 text-gold" dir="ltr">{l.phone}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(l.createdAt)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{l.purchaseMethod ? purchaseMethodLabels[l.purchaseMethod] : "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{l.purchaseGoal ? purchaseGoalLabels[l.purchaseGoal] : "—"}</td>
                  <td className="px-4 py-3">
                    {l.firstContactStage ? (
                      <span className={`inline-block rounded-full border px-2 py-0.5 text-xs ${firstContactStageColor[l.firstContactStage]}`}>{firstContactStageLabels[l.firstContactStage]}</span>
                    ) : (
                      <select defaultValue="" disabled={pending} onChange={(e) => e.target.value && setStage(l.id, e.target.value as FirstContactStage)} className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-muted-foreground">
                        <option value="" disabled>حدّد…</option>
                        {(Object.keys(firstContactStageLabels) as FirstContactStage[]).map((s) => <option key={s} value={s}>{firstContactStageLabels[s]}</option>)}
                      </select>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {l.isArchived ? (
                      <span className="rounded-full bg-success/15 px-2 py-0.5 text-xs text-success">تم الحجز</span>
                    ) : (
                      <button onClick={() => setFuLead(l)} className="rounded-lg border border-border px-2.5 py-1 text-xs text-gold hover:bg-gold/10">
                        {toArabicDigits(l.attempts)} محاولة
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{l.firstContactDate ? formatDate(l.firstContactDate) : "—"}</td>
                  <td className="relative px-3 py-3">
                    <button onClick={() => setMenuFor(menuFor === l.id ? null : l.id)} className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground">خيارات</button>
                    {menuFor === l.id && (
                      <div className="absolute left-2 top-full z-20 mt-1 w-40 overflow-hidden rounded-lg border border-border bg-card shadow-xl">
                        {isManager && (
                          <button onClick={() => { setMenuFor(null); setTransfer({ ids: [l.id] }); }} className="block w-full px-3 py-2 text-right text-xs text-foreground hover:bg-secondary">تحويل لموظف آخر</button>
                        )}
                        <button onClick={() => { setMenuFor(null); run(() => resetLeadToNew(l.id)); }} className="block w-full px-3 py-2 text-right text-xs text-foreground hover:bg-secondary">إرجاع لمرحلة «جديد»</button>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <Link href={`/leads/${l.id}`} className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-gold/40 hover:text-gold" title="فتح الملف">
                      فتح
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* خلفية لإغلاق قائمة الخيارات */}
      {menuFor && <div className="fixed inset-0 z-10" onClick={() => setMenuFor(null)} />}

      {/* ترقيم */}
      {filtered.length > 0 && (
        <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
          <span>عرض {toArabicDigits((curPage - 1) * PAGE_SIZE + 1)}–{toArabicDigits(Math.min(curPage * PAGE_SIZE, filtered.length))} من {toArabicDigits(filtered.length)}</span>
          <div className="flex items-center gap-1">
            <button disabled={curPage === 1} onClick={() => setPage(curPage - 1)} className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-40">السابق</button>
            <span className="px-2">{toArabicDigits(curPage)} / {toArabicDigits(pages)}</span>
            <button disabled={curPage === pages} onClick={() => setPage(curPage + 1)} className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-40">التالي</button>
          </div>
        </div>
      )}

      {/* نافذة التحويل لموظف */}
      {transfer && (
        <TransferDialog
          count={transfer.ids.length}
          employees={employees}
          onClose={() => setTransfer(null)}
          onConfirm={doTransfer}
        />
      )}

      <NewLeadDialog open={showNew} onClose={() => setShowNew(false)} isManager={isManager} employees={employees} />
      <FollowUpsDrawer leadId={fuLead?.id ?? null} leadName={fuLead?.name ?? ""} stage={fuLead?.stage ?? "NEW"} onClose={() => setFuLead(null)} onChanged={() => router.refresh()} />
    </div>
  );
}

function TransferDialog({
  count, employees, onClose, onConfirm,
}: {
  count: number;
  employees: Employee[];
  onClose: () => void;
  onConfirm: (toUserId: string) => void;
}) {
  const [to, setTo] = useState("");
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-card p-5 shadow-2xl">
          <h2 className="font-bold text-foreground">تحويل {toArabicDigits(count)} عميل لموظف</h2>
          <select value={to} onChange={(e) => setTo(e.target.value)} className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-gold">
            <option value="">اختر الموظف…</option>
            {employees.map((e2) => <option key={e2.id} value={e2.id}>{e2.name}</option>)}
          </select>
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground">إلغاء</button>
            <button onClick={() => to && onConfirm(to)} disabled={!to} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">تحويل</button>
          </div>
        </div>
      </div>
    </>
  );
}
