"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FirstContactStage } from "@prisma/client";
import {
  purchaseMethodLabels, purchaseGoalLabels,
  firstContactStageLabels, firstContactStageColor,
} from "@/lib/labels";
import { formatDate, toArabicDigits } from "@/lib/format";
import type { LeadRow } from "@/lib/data/leads";
import {
  setFirstContactStage, transferLeads, recoverLeads, bulkArchive,
} from "@/lib/actions/leads";
import { LeadsFilterBar } from "./leads-filter-bar";
import { NewLeadDialog } from "./new-lead-dialog";
import { FollowUpsDrawer } from "./followups-drawer";
import { useLeads } from "./use-leads";

type Employee = { id: string; name: string };
type Tab = "working" | "archived";
type Filters = { q: string; stages: string[]; emps: string[] };
const PAGE_SIZE = 12;

export function LeadsView({
  query, counts, tab, isManager, employees, filters,
}: {
  query: string;
  counts: { working: number; archived: number };
  tab: Tab;
  isManager: boolean;
  employees: Employee[];
  filters: Filters;
}) {
  const router = useRouter();
  const { leads: rows, loading, reload } = useLeads(query);
  const [pending, startTransition] = useTransition();
  const [page, setPage] = useState(1);
  const [showNew, setShowNew] = useState(false);
  const [fuLead, setFuLead] = useState<LeadRow | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [transfer, setTransfer] = useState<{ ids: string[] } | null>(null);

  // إعادة الترقيم/التحديد عند تغيّر النتائج.
  useEffect(() => { setPage(1); setSel(new Set()); }, [rows]);

  // تبديل التبويب مع الحفاظ على بقية الفلاتر.
  function goTab(v: Tab) {
    const p = new URLSearchParams();
    if (v === "archived") p.set("tab", "archived");
    if (filters.q) p.set("q", filters.q);
    if (filters.stages.length) p.set("stages", filters.stages.join(","));
    if (filters.emps.length) p.set("emps", filters.emps.join(","));
    const s = p.toString();
    startTransition(() => router.push(s ? `/leads?${s}` : "/leads"));
  }

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const curPage = Math.min(page, pages);
  const pageRows = rows.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);
  const allOnPage = pageRows.length > 0 && pageRows.every((r) => sel.has(r.id));

  function toggleSel(id: string) {
    setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    setSel((s) => {
      const n = new Set(s);
      if (allOnPage) pageRows.forEach((r) => n.delete(r.id));
      else pageRows.forEach((r) => n.add(r.id));
      return n;
    });
  }
  function clearSel() { setSel(new Set()); }

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok && res.error) alert(res.error);
      reload();          // يعيد قراءة الصفوف من نفس الـ API
      router.refresh();  // يحدّث أعداد التبويبات
    });
  }

  function setStage(id: string, s: FirstContactStage) {
    run(() => setFirstContactStage(id, s));
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
        {([["working", "جاري العمل", counts.working], ["archived", "تم الحجز / الشراء", counts.archived]] as const).map(([v, label, count]) => (
          <button key={v} onClick={() => goTab(v)} className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${tab === v ? "bg-secondary text-gold" : "text-muted-foreground hover:text-foreground"}`}>
            {label} <span className="text-xs">({toArabicDigits(count)})</span>
          </button>
        ))}
      </div>

      {/* شريط الفلاتر المشترك (نفسه في الكانبان) */}
      <div className="mb-4">
        <LeadsFilterBar
          basePath="/leads"
          isManager={isManager}
          employees={employees}
          filters={filters}
          preserve={{ tab: tab === "archived" ? "archived" : "" }}
        />
      </div>

      {/* شريط التحديد المتعدد */}
      {sel.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-gold/30 bg-gold/5 px-4 py-2.5 text-sm">
          <span className="font-medium text-foreground">محدّد: {toArabicDigits(sel.size)}</span>
          <div className="flex-1" />
          {isManager && (
            <button onClick={() => setTransfer({ ids: [...sel] })} disabled={pending} className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground hover:bg-secondary disabled:opacity-50">تحويل</button>
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
            {pageRows.length === 0 ? (
              <tr><td colSpan={12} className="px-4 py-10 text-center text-muted-foreground">{loading ? "جارٍ التحميل…" : "ما فيه عملاء."}</td></tr>
            ) : (
              pageRows.map((l, i) => (
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
                    {isManager ? (
                      <button onClick={() => setMenuFor(menuFor === l.id ? null : l.id)} className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground">خيارات</button>
                    ) : <span className="text-xs text-muted-foreground/50">—</span>}
                    {menuFor === l.id && (
                      <div className="absolute left-2 top-full z-20 mt-1 w-44 overflow-hidden rounded-lg border border-border bg-card shadow-xl">
                        <button onClick={() => { setMenuFor(null); setTransfer({ ids: [l.id] }); }} className="block w-full px-3 py-2 text-right text-xs text-foreground hover:bg-secondary">تحويل / استرداد</button>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <Link href={`/leads/${l.id}`} className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-gold/40 hover:text-gold" title="فتح الملف">فتح</Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {menuFor && <div className="fixed inset-0 z-10" onClick={() => setMenuFor(null)} />}

      {/* ترقيم */}
      {rows.length > 0 && (
        <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
          <span>عرض {toArabicDigits((curPage - 1) * PAGE_SIZE + 1)}–{toArabicDigits(Math.min(curPage * PAGE_SIZE, rows.length))} من {toArabicDigits(rows.length)}</span>
          <div className="flex items-center gap-1">
            <button disabled={curPage === 1} onClick={() => setPage(curPage - 1)} className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-40">السابق</button>
            <span className="px-2">{toArabicDigits(curPage)} / {toArabicDigits(pages)}</span>
            <button disabled={curPage === pages} onClick={() => setPage(curPage + 1)} className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-40">التالي</button>
          </div>
        </div>
      )}

      {transfer && (
        <TransferDialog
          count={transfer.ids.length}
          employees={employees}
          onClose={() => setTransfer(null)}
          onConfirm={(mode, toUserId) => {
            const ids = transfer.ids;
            setTransfer(null);
            run(async () => {
              const res = mode === "recover"
                ? await recoverLeads(ids)
                : await transferLeads(ids, toUserId!, mode);
              clearSel();
              return res;
            });
          }}
        />
      )}

      <NewLeadDialog open={showNew} onClose={() => setShowNew(false)} isManager={isManager} employees={employees} />
      <FollowUpsDrawer leadId={fuLead?.id ?? null} leadName={fuLead?.name ?? ""} stage={fuLead?.stage ?? "NEW"} onClose={() => setFuLead(null)} onChanged={() => { reload(); router.refresh(); }} />
    </div>
  );
}

type TransferMode = "full" | "fresh" | "recover";

function TransferDialog({
  count, employees, onClose, onConfirm,
}: {
  count: number;
  employees: Employee[];
  onClose: () => void;
  onConfirm: (mode: TransferMode, toUserId: string | null) => void;
}) {
  const [mode, setMode] = useState<TransferMode>("full");
  const [to, setTo] = useState("");
  const needsEmployee = mode === "full" || mode === "fresh";
  const canConfirm = !needsEmployee || !!to;

  const options: { value: TransferMode; label: string; desc: string }[] = [
    { value: "full", label: "نقل مع كل السجل والمتابعات", desc: "العميل ينتقل للموظف الجديد ببياناته وتاريخ متابعاته كامل." },
    { value: "fresh", label: "نقل كعميل جديد", desc: "البيانات الأساسية فقط — سجل المتابعات يبدأ من صفر." },
    { value: "recover", label: "استرداد للنظام كعميل جديد", desc: "يُسحب من الموظف الحالي — يرجع بدون موظف — المرحلة ترجع «جديد»." },
  ];

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-card p-5 shadow-2xl">
          <h2 className="font-bold text-foreground">تحويل {toArabicDigits(count)} عميل</h2>

          <div className="space-y-2">
            {options.map((o) => (
              <label key={o.value} className={`block cursor-pointer rounded-xl border p-3 transition-colors ${mode === o.value ? "border-gold bg-gold/10" : "border-border hover:bg-secondary/40"}`}>
                <div className="flex items-center gap-2">
                  <input type="radio" name="transfer-mode" checked={mode === o.value} onChange={() => setMode(o.value)} />
                  <span className="text-sm font-medium text-foreground">{o.label}</span>
                </div>
                <p className="mt-1 pr-6 text-xs text-muted-foreground">{o.desc}</p>
              </label>
            ))}
          </div>

          {needsEmployee && (
            <select value={to} onChange={(e) => setTo(e.target.value)} className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-gold">
              <option value="">اختر الموظف…</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          )}

          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground">إلغاء</button>
            <button onClick={() => canConfirm && onConfirm(mode, needsEmployee ? to : null)} disabled={!canConfirm} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">تنفيذ</button>
          </div>
        </div>
      </div>
    </>
  );
}
