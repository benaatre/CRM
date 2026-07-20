"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  purchaseMethodLabels, purchaseGoalLabels,
  firstContactStageLabels, firstContactStageColor,
} from "@/lib/labels";
import { formatDate, toArabicDigits } from "@/lib/format";
import type { LeadRow } from "@/lib/data/leads";
import { TransferStar } from "./transfer-star";
import {
  transferLeads, recoverLeads, bulkArchive, bulkDelete, unarchiveLeads,
} from "@/lib/actions/leads";
import type { UnarchiveMode } from "@/lib/actions/leads";
import { distributeUnassigned, distributeLeastLoaded, distributeCustom, getEmployeeLoads } from "@/lib/actions/team";
import { LeadsFilterBar } from "./leads-filter-bar";
import { NewLeadDialog } from "./new-lead-dialog";
import { FollowUpsDrawer } from "./followups-drawer";
import { ImportDialog } from "@/components/team/import-dialog";
import { useLeads } from "./use-leads";

import { DEFAULT_LEAD_SORT, type LeadSort } from "@/lib/lead-filters";

type Employee = { id: string; name: string };
type Tab = "working" | "archived" | "hidden" | "unassigned";
type Filters = { q: string; stages: string[]; emps: string[]; sort: LeadSort };
const PAGE_SIZE = 12;

export function LeadsView({
  query, counts, notContacted, tab, isManager, employees, filters,
}: {
  query: string;
  counts: { working: number; archived: number; hidden: number; unassigned: number };
  notContacted: number;
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
  const [showImport, setShowImport] = useState(false);
  const [fuLead, setFuLead] = useState<LeadRow | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [transfer, setTransfer] = useState<{ ids: string[] } | null>(null);
  const [unarchive, setUnarchive] = useState<{ ids: string[] } | null>(null);

  // إعادة الترقيم/التحديد عند تغيّر النتائج.
  useEffect(() => { setPage(1); setSel(new Set()); }, [rows]);

  // تبديل التبويب مع الحفاظ على بقية الفلاتر.
  function goTab(v: Tab) {
    const p = new URLSearchParams();
    if (v === "archived") p.set("tab", "archived");
    else if (v === "hidden") p.set("tab", "hidden");
    else if (v === "unassigned") p.set("tab", "unassigned");
    if (filters.q) p.set("q", filters.q);
    if (filters.stages.length) p.set("stages", filters.stages.join(","));
    if (filters.emps.length) p.set("emps", filters.emps.join(","));
    if (filters.sort !== DEFAULT_LEAD_SORT) p.set("sort", filters.sort); // يحفظ الترتيب عبر التبويبات
    const s = p.toString();
    startTransition(() => router.push(s ? `/leads?${s}` : "/leads"));
  }

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const curPage = Math.min(page, pages);
  const pageRows = rows.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);
  // «تحديد الكل» على مستوى التبويب الحالي كامل (كل العملاء المطابقين، مو الصفحة فقط).
  const allSelected = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const someSelected = sel.size > 0 && !allSelected;

  function toggleSel(id: string) {
    setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function toggleSelectAll() {
    setSel(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
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


  return (
    <div className="mx-auto max-w-7xl">
      <header className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-foreground">العملاء</h1>
        <button onClick={() => setShowNew(true)} className="min-h-11 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90">
          عميل جديد
        </button>
      </header>

      {/* التبويبات */}
      <div className="mb-4 flex gap-1 rounded-xl border border-border bg-card p-1">
        {(([
          ...(isManager ? [["unassigned", "عملاء غير موزّعين", counts.unassigned] as const] : []),
          ["working", "جاري العمل", counts.working] as const,
          ["archived", "تم الحجز / الشراء", counts.archived] as const,
          ["hidden", "مؤرشف", counts.hidden] as const,
        ])).map(([v, label, count]) => (
          <button key={v} onClick={() => goTab(v)} className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${tab === v ? "bg-secondary text-gold" : "text-muted-foreground hover:text-foreground"}`}>
            {label} <span className="text-xs">({toArabicDigits(count)})</span>
          </button>
        ))}
      </div>

      {/* تبويب «غير موزّعين»: طرق الإضافة + التوزيع. باقي التبويبات: شريط الفلاتر. */}
      {tab === "unassigned" && isManager ? (
        <UnassignedTools
          availableUnassigned={counts.unassigned}
          onImport={() => setShowImport(true)}
          onNew={() => setShowNew(true)}
          onChanged={() => { reload(); router.refresh(); }}
        />
      ) : (
        <div className="mb-4">
          <LeadsFilterBar
            basePath="/leads"
            isManager={isManager}
            employees={employees}
            filters={filters}
            preserve={{ tab: tab === "archived" || tab === "hidden" ? tab : "" }}
            hideUnassignedEmp={tab === "working"}
            notContacted={tab === "working" ? notContacted : undefined}
          />
        </div>
      )}

      {/* شريط أدوات التحديد — ظاهر دائمًا (مع عدّاد واضح + زر «تحديد الكل») */}
      {rows.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-gold/30 bg-gold/5 px-4 py-2.5 text-sm">
          <span className="font-medium text-foreground">محدّد: {toArabicDigits(sel.size)} من {toArabicDigits(rows.length)}</span>
          <button
            onClick={toggleSelectAll}
            className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${allSelected ? "border-gold bg-gold/15 text-gold" : "border-border text-foreground hover:bg-secondary"}`}
          >{allSelected ? "إلغاء تحديد الكل" : "تحديد الكل"}</button>
          <div className="flex-1" />
          {sel.size > 0 && (
            <>
              {isManager && (
                <button onClick={() => setTransfer({ ids: [...sel] })} disabled={pending} className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground hover:bg-secondary disabled:opacity-50">تحويل</button>
              )}
              {tab === "hidden" ? (
                <button onClick={() => setUnarchive({ ids: [...sel] })} disabled={pending} className="rounded-lg border border-gold/50 bg-gold/10 px-3 py-1.5 text-xs font-medium text-gold hover:bg-gold/20 disabled:opacity-50">إرجاع من الأرشيف</button>
              ) : (
                <button onClick={() => run(async () => { const r = await bulkArchive([...sel]); clearSel(); return r; })} disabled={pending} className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground hover:bg-secondary disabled:opacity-50">أرشفة</button>
              )}
              {isManager && (
                <button
                  onClick={() => { if (confirm(`متأكد تبي تحذف ${toArabicDigits(sel.size)} عميل نهائيًا؟ ما يمكن التراجع.`)) run(async () => { const r = await bulkDelete([...sel]); clearSel(); return r; }); }}
                  disabled={pending}
                  className="rounded-lg border border-destructive/40 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
                >حذف</button>
              )}
              <button onClick={clearSel} className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">إلغاء التحديد</button>
            </>
          )}
        </div>
      )}

      {/* بطاقات الجوال (بدل الجدول) */}
      <div className="space-y-3 md:hidden">
        {pageRows.length === 0 ? (
          <p className="rounded-2xl border border-border bg-card px-4 py-10 text-center text-muted-foreground">{loading ? "جارٍ التحميل…" : "ما فيه عملاء."}</p>
        ) : (
          pageRows.map((l) => (
            <div key={l.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={sel.has(l.id)} onChange={() => toggleSel(l.id)} aria-label={`تحديد ${l.name}`} />
                    <span className="font-medium text-foreground">{l.name}</span>
                    <TransferStar show={l.isTransferred} />
                  </div>
                  <a href={`tel:${l.phone}`} className="mt-1 block text-sm text-gold" dir="ltr">{l.phone}</a>
                </div>
                <Link href={`/leads/${l.id}`} className="flex min-h-11 shrink-0 items-center rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground hover:opacity-90">فتح</Link>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                {l.firstContactStage ? (
                  <span className={`rounded-full border px-2 py-0.5 ${firstContactStageColor[l.firstContactStage]}`}>{firstContactStageLabels[l.firstContactStage]}</span>
                ) : (
                  <span className="rounded-full border border-border px-2 py-0.5 text-muted-foreground">بلا مرحلة</span>
                )}
                <span className="text-muted-foreground">الموظف: {l.assignedTo?.name ?? "غير موزّع"}</span>
                {l.followUpsCount > 0 && (
                  <button onClick={() => setFuLead(l)} className="rounded-full border border-border px-2 py-0.5 text-gold">{toArabicDigits(l.followUpsCount)} متابعة</button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* الجدول (سطح المكتب) */}
      <div className="hidden overflow-x-auto rounded-2xl border border-border bg-card md:block">
        <table className="w-full min-w-[1100px] text-right text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
          <thead className="bg-secondary/40 text-muted-foreground">
            <tr>
              <th className="px-3 py-3"><input type="checkbox" checked={allSelected} ref={(el) => { if (el) el.indeterminate = someSelected; }} onChange={toggleSelectAll} aria-label="تحديد الكل" title="تحديد / إلغاء تحديد الكل" /></th>
              <th className="px-3 py-3 font-medium">#</th>
              <th className="px-4 py-3 font-medium">الاسم</th>
              <th className="px-4 py-3 font-medium">الجوال</th>
              <th className="px-4 py-3 font-medium">تاريخ الإضافة</th>
              <th className="px-4 py-3 font-medium">الموظف</th>
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
              <tr><td colSpan={13} className="px-4 py-10 text-center text-muted-foreground">{loading ? "جارٍ التحميل…" : "ما فيه عملاء."}</td></tr>
            ) : (
              pageRows.map((l, i) => (
                <tr key={l.id} className="border-t border-border transition-colors hover:bg-secondary/40">
                  <td className="px-3 py-3"><input type="checkbox" checked={sel.has(l.id)} onChange={() => toggleSel(l.id)} aria-label={`تحديد ${l.name}`} /></td>
                  <td className="px-3 py-3 text-muted-foreground">{toArabicDigits((curPage - 1) * PAGE_SIZE + i + 1)}</td>
                  <td className="px-4 py-3 font-medium text-foreground"><span className="inline-flex items-center gap-1.5">{l.name}<TransferStar show={l.isTransferred} /></span></td>
                  <td className="px-4 py-3 text-gold" dir="ltr">{l.phone}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(l.createdAt)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{l.assignedTo?.name ?? "غير موزّع"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{l.purchaseMethod ? purchaseMethodLabels[l.purchaseMethod] : "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{l.purchaseGoal ? purchaseGoalLabels[l.purchaseGoal] : "—"}</td>
                  <td className="px-4 py-3">
                    {l.firstContactStage ? (
                      <span className={`inline-block rounded-full border px-2 py-0.5 text-xs ${firstContactStageColor[l.firstContactStage]}`}>{firstContactStageLabels[l.firstContactStage]}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {l.followUpsCount > 0 ? (
                      <button onClick={() => setFuLead(l)} className="rounded-lg border border-border px-2.5 py-1 text-xs text-gold hover:bg-gold/10">
                        {toArabicDigits(l.followUpsCount)}
                      </button>
                    ) : (
                      <span className="text-muted-foreground">—</span>
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

      {unarchive && (
        <UnarchiveDialog
          count={unarchive.ids.length}
          onClose={() => setUnarchive(null)}
          onConfirm={(mode) => {
            const ids = unarchive.ids;
            setUnarchive(null);
            run(async () => { const r = await unarchiveLeads(ids, mode); clearSel(); return r; });
          }}
        />
      )}

      <NewLeadDialog open={showNew} onClose={() => setShowNew(false)} isManager={isManager} employees={employees} />
      {showImport && <ImportDialog employees={employees} onClose={() => { setShowImport(false); reload(); router.refresh(); }} />}
      <FollowUpsDrawer leadId={fuLead?.id ?? null} leadName={fuLead?.name ?? ""} stage={fuLead?.stage ?? "NEW"} firstContactStage={fuLead?.firstContactStage} onClose={() => setFuLead(null)} onChanged={() => { reload(); router.refresh(); }} />
    </div>
  );
}

// أدوات تبويب «غير موزّعين»: طرق الإضافة + التوزيع.
function UnassignedTools({
  availableUnassigned, onImport, onNew, onChanged,
}: {
  availableUnassigned: number;
  onImport: () => void;
  onNew: () => void;
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [custom, setCustom] = useState(false);
  const [loads, setLoads] = useState<{ id: string; name: string; count: number; maxClients: number | null; remaining: number | null }[] | null>(null);
  const [alloc, setAlloc] = useState<Record<string, string>>({});

  function dist(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    setMsg(null);
    startTransition(async () => {
      const res = await fn();
      setMsg(res.ok ? (res.message ?? "تم التوزيع") : res.error ?? "صار خطأ");
      onChanged();
      if (res.ok && custom) { setAlloc({}); setLoads(await getEmployeeLoads()); }
    });
  }

  function openCustom() {
    const next = !custom;
    setCustom(next);
    if (next && loads === null) {
      startTransition(async () => { setLoads(await getEmployeeLoads()); });
    }
  }

  const totalWanted = Object.values(alloc).reduce((s, v) => s + (Number(v) || 0), 0);
  const over = totalWanted > availableUnassigned;
  const overCap = (loads ?? []).some((e) => e.remaining != null && (Number(alloc[e.id]) || 0) > e.remaining);

  return (
    <div className="mb-4 space-y-3 rounded-2xl border border-border bg-card p-4">
      {/* طرق الإضافة */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">طرق الإضافة:</span>
        <button onClick={onNew} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90">عميل جديد</button>
        <button onClick={onImport} className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground hover:bg-secondary">استيراد (Excel / لصق / رابط Sheets)</button>
      </div>

      {/* التوزيع */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <span className="text-sm font-medium text-foreground">التوزيع:</span>
        <button onClick={() => dist(() => distributeUnassigned())} disabled={pending} className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground hover:bg-secondary disabled:opacity-50">بالتساوي</button>
        <button onClick={() => dist(() => distributeLeastLoaded())} disabled={pending} className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground hover:bg-secondary disabled:opacity-50">الأقل عملاءً</button>
        <button onClick={openCustom} className={`rounded-lg border px-3 py-1.5 text-xs ${custom ? "border-gold bg-gold/15 text-gold" : "border-border text-foreground hover:bg-secondary"}`}>مخصص</button>
        <span className="text-xs text-muted-foreground">— أو يدويًا: حدّد عملاء بالأسفل ثم «تحويل».</span>
      </div>

      {/* جدول التوزيع المخصّص */}
      {custom && (
        <div className="space-y-2 rounded-xl border border-gold/30 bg-gold/5 p-3">
          {loads === null ? (
            <p className="py-2 text-center text-xs text-muted-foreground">جارٍ التحميل…</p>
          ) : loads.length === 0 ? (
            <p className="py-2 text-center text-xs text-muted-foreground">ما فيه موظفون مفعّلون.</p>
          ) : (
            <>
              <table className="w-full text-right text-sm">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">الموظف</th>
                    <th className="px-2 py-1.5 font-medium">عملاؤه الآن</th>
                    <th className="px-2 py-1.5 font-medium">المتبقّي له</th>
                    <th className="px-2 py-1.5 font-medium">عدد العملاء</th>
                  </tr>
                </thead>
                <tbody>
                  {loads.map((e) => {
                    const rowOver = e.remaining != null && (Number(alloc[e.id]) || 0) > e.remaining;
                    return (
                      <tr key={e.id} className="border-t border-border">
                        <td className="px-2 py-2 text-foreground">{e.name}</td>
                        <td className="px-2 py-2 text-muted-foreground">{toArabicDigits(e.count)}</td>
                        <td className="px-2 py-2 text-muted-foreground">{e.remaining == null ? "بلا حد" : toArabicDigits(e.remaining)}</td>
                        <td className="px-2 py-2">
                          <input
                            value={alloc[e.id] ?? ""}
                            onChange={(ev) => setAlloc((a) => ({ ...a, [e.id]: ev.target.value.replace(/\D/g, "") }))}
                            inputMode="numeric" dir="ltr" placeholder="٠"
                            className={`w-16 rounded border bg-background px-2 py-1 text-center text-foreground outline-none focus:border-gold ${rowOver ? "border-destructive" : "border-border"}`}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="flex items-center justify-between">
                <span className={`text-xs ${over ? "text-destructive" : "text-muted-foreground"}`}>
                  المجموع: {toArabicDigits(totalWanted)} من {toArabicDigits(availableUnassigned)} متاح
                </span>
                <button
                  onClick={() => dist(() => distributeCustom(loads.map((e) => ({ userId: e.id, count: Number(alloc[e.id]) || 0 }))))}
                  disabled={pending || over || overCap || totalWanted === 0}
                  className="rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                >وزّع الآن</button>
              </div>
              {over && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">المجموع أكبر من عدد العملاء المتاح ({toArabicDigits(availableUnassigned)}).</p>}
              {overCap && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">في موظف تجاوز سعته المتبقية — صحّح الأعداد المظللة بالأحمر.</p>}
            </>
          )}
        </div>
      )}

      {msg && <p className="rounded-lg bg-success/10 px-3 py-2 text-xs text-success">{msg}</p>}
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

// حوار الإرجاع من الأرشيف — ٣ أنماط. المتابعات محفوظة في كلها.
function UnarchiveDialog({
  count, onClose, onConfirm,
}: {
  count: number;
  onClose: () => void;
  onConfirm: (mode: UnarchiveMode) => void;
}) {
  const [mode, setMode] = useState<UnarchiveMode>("asis");

  const options: { value: UnarchiveMode; label: string; desc: string }[] = [
    { value: "asis", label: "رجّعه زي ما كان", desc: "يشيل الأرشفة بس — المرحلة والمتابعات تبقى كما هي. يرجع لتبويبه الطبيعي (جاري العمل لو مُسند، غير موزّع لو بلا موظف)." },
    { value: "freshUnassigned", label: "رجّعه جديد غير موزّع", desc: "يشيل الأرشفة + يرجّع المرحلة «جديد» + يشيله من الموظف. يروح حوض «غير موزّعين». المتابعات محفوظة." },
    { value: "freshKeepEmployee", label: "رجّعه جديد مع نفس الموظف", desc: "يشيل الأرشفة + يرجّع المرحلة «جديد» + يبقى مع نفس الموظف الحالي. المتابعات محفوظة." },
  ];

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-card p-5 shadow-2xl">
          <h2 className="font-bold text-foreground">إرجاع {toArabicDigits(count)} عميل من الأرشيف</h2>

          <div className="space-y-2">
            {options.map((o) => (
              <label key={o.value} className={`block cursor-pointer rounded-xl border p-3 transition-colors ${mode === o.value ? "border-gold bg-gold/10" : "border-border hover:bg-secondary/40"}`}>
                <div className="flex items-center gap-2">
                  <input type="radio" name="unarchive-mode" checked={mode === o.value} onChange={() => setMode(o.value)} />
                  <span className="text-sm font-medium text-foreground">{o.label}</span>
                </div>
                <p className="mt-1 pr-6 text-xs text-muted-foreground">{o.desc}</p>
              </label>
            ))}
          </div>

          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground">إلغاء</button>
            <button onClick={() => onConfirm(mode)} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">تنفيذ</button>
          </div>
        </div>
      </div>
    </>
  );
}
