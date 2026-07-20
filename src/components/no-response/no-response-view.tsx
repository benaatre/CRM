"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PhoneMissed, AlertTriangle, Share2, BellRing } from "lucide-react";
import { formatDate, formatCount, toArabicDigits } from "@/lib/format";
import { stageLabels, channelLabels } from "@/lib/labels";
import type { NoResponseRow, NoResponseSort, PendingPullSummary, EmployeeLoad } from "@/lib/data/no-response";
import {
  distributeNoResponseBatch, autoDistributeNoResponse, warnEmployee, warnAllEmployees,
  type DistributeOpts,
} from "@/lib/actions/no-response";

type Employee = { id: string; name: string };
type Filters = { q: string; emp: string; rounds: number; sort: NoResponseSort };
const PAGE_SIZE = 12;

export function NoResponseView({
  summary, rows, employeeLoads, filters,
}: {
  summary: PendingPullSummary;
  rows: NoResponseRow[];
  employeeLoads: EmployeeLoad[];
  filters: Filters;
}) {
  const employees: Employee[] = employeeLoads.map((e) => ({ id: e.id, name: e.name }));
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [dist, setDist] = useState<{ ids: string[] } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { setPage(1); setSel(new Set()); }, [rows]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const curPage = Math.min(page, pages);
  const pageRows = rows.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);
  // القابلون للتوزيع فقط (غير المستنفدين) — أساس «تحديد الكل».
  const selectable = rows.filter((r) => !r.exhausted);
  const allSelected = selectable.length > 0 && selectable.every((r) => sel.has(r.id));
  const someSelected = sel.size > 0 && !allSelected;

  function toggleSel(id: string) {
    setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function toggleSelectAll() {
    setSel(allSelected ? new Set() : new Set(selectable.map((r) => r.id)));
  }
  function clearSel() { setSel(new Set()); }

  function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    setMsg(null);
    startTransition(async () => {
      const res = await fn();
      setMsg(res.ok ? (res.message ?? "تم") : (res.error ?? "صار خطأ"));
      router.refresh();
    });
  }

  // تحديث الرابط بالفلاتر (server-side) مع الحفاظ على البقية.
  function pushFilters(next: Partial<Filters>) {
    const f = { ...filters, ...next };
    const p = new URLSearchParams();
    if (f.q) p.set("q", f.q);
    if (f.emp) p.set("emp", f.emp);
    if (f.rounds) p.set("rounds", String(f.rounds));
    if (f.sort !== "recent") p.set("sort", f.sort);
    const s = p.toString();
    startTransition(() => router.push(s ? `/no-response?${s}` : "/no-response"));
  }

  return (
    <div className="mx-auto max-w-7xl">
      <header className="mb-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <PhoneMissed className="size-6 text-gold" />
          <h1 className="text-2xl font-bold text-foreground">لم يتم الرد</h1>
        </div>
        <button
          onClick={() => run(() => warnAllEmployees())}
          disabled={pending || summary.employees.length === 0}
          className="flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          <BellRing className="size-4" /> إرسال إنذارات للجميع
        </button>
      </header>

      {/* بطاقات الإجمالي */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="بانتظار السحب" value={summary.totalPending} tone="gold" />
        <StatCard label="يُسحبون الآن (+٧٢س)" value={summary.totalOverdue} tone="danger" />
        <StatCard label="في الحوض" value={summary.inQueue} tone="plain" />
        <StatCard label="بلغوا السقف" value={summary.capped} tone="plain" />
      </div>

      {/* حالة النظام */}
      <div className={`mb-4 flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm ${summary.live ? "border-success/40 bg-success/5 text-success" : "border-gold/40 bg-gold/5 text-gold"}`}>
        <span className={`inline-block size-2 rounded-full ${summary.live ? "bg-success" : "bg-gold"}`} />
        <span className="font-medium">حالة النظام: {summary.live ? "مفعّل — السحب التلقائي يعمل" : "معاينة (dry-run) — لا سحب فعلي حتى التفعيل"}</span>
      </div>

      {/* لوحة «بانتظار السحب» لكل موظف */}
      <section className="mb-6 rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-foreground">
          <AlertTriangle className="size-4 text-gold" /> بانتظار السحب حسب الموظف
        </h2>
        {summary.employees.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">ما فيه موظفون عندهم عملاء متأخرون — كل شي تحت السيطرة.</p>
        ) : (
          <div className="space-y-2">
            {summary.employees.map((e) => {
              const total = e.pending + e.overdue;
              const overduePct = total > 0 ? (e.overdue / total) * 100 : 0;
              const pendingPct = total > 0 ? (e.pending / total) * 100 : 0;
              return (
                <div key={e.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background/40 px-3 py-2.5">
                  <span className="min-w-[7rem] font-medium text-foreground">{e.name}</span>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="rounded-full bg-gold/15 px-2 py-0.5 text-gold">بانتظار: {toArabicDigits(e.pending)}</span>
                    <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-destructive">يُسحب: {toArabicDigits(e.overdue)}</span>
                  </div>
                  {/* شريط تقدّم: أحمر (يُسحب) + ذهبي (بانتظار) */}
                  <div className="h-2 min-w-[8rem] flex-1 overflow-hidden rounded-full bg-secondary">
                    <div className="flex h-full">
                      <div className="h-full bg-destructive" style={{ width: `${overduePct}%` }} />
                      <div className="h-full bg-gold" style={{ width: `${pendingPct}%` }} />
                    </div>
                  </div>
                  <button
                    onClick={() => run(() => warnEmployee(e.id))}
                    disabled={pending}
                    className="rounded-lg border border-gold/50 bg-gold/10 px-3 py-1.5 text-xs font-medium text-gold hover:bg-gold/20 disabled:opacity-50"
                  >أرسل إنذار</button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* البحث والفلاتر */}
      <FilterBar filters={filters} employees={employees} onChange={pushFilters} />

      {/* شريط أدوات التحديد + التوزيع */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-gold/30 bg-gold/5 px-4 py-2.5 text-sm">
        <span className="font-medium text-foreground">محدّد: {toArabicDigits(sel.size)} من {toArabicDigits(selectable.length)}</span>
        <button
          onClick={toggleSelectAll}
          disabled={selectable.length === 0}
          className={`rounded-lg border px-3 py-1.5 text-xs transition-colors disabled:opacity-40 ${allSelected ? "border-gold bg-gold/15 text-gold" : "border-border text-foreground hover:bg-secondary"}`}
        >{allSelected ? "إلغاء تحديد الكل" : "تحديد الكل"}</button>
        <div className="flex-1" />
        <button
          onClick={() => run(() => autoDistributeNoResponse())}
          disabled={pending || summary.inQueue === 0}
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground hover:bg-secondary disabled:opacity-50"
        >وزّع تلقائيًا</button>
        {sel.size > 0 && (
          <>
            <button
              onClick={() => setDist({ ids: [...sel] })}
              disabled={pending}
              className="rounded-lg border border-gold/50 bg-gold/10 px-3 py-1.5 text-xs font-medium text-gold hover:bg-gold/20 disabled:opacity-50"
            >توزيع المحدّدين</button>
            <button onClick={clearSel} className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">إلغاء التحديد</button>
          </>
        )}
      </div>

      {msg && <p className="mb-3 rounded-lg bg-success/10 px-3 py-2 text-xs text-success">{msg}</p>}

      {/* الجدول */}
      <div className="hidden overflow-x-auto rounded-2xl border border-border bg-card md:block">
        <table className="w-full min-w-[1100px] text-right text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
          <thead className="bg-secondary/40 text-muted-foreground">
            <tr>
              <th className="px-3 py-3"><input type="checkbox" checked={allSelected} ref={(el) => { if (el) el.indeterminate = someSelected; }} onChange={toggleSelectAll} aria-label="تحديد الكل" title="تحديد / إلغاء تحديد الكل" /></th>
              <th className="px-3 py-3 font-medium">#</th>
              <th className="px-4 py-3 font-medium">الاسم</th>
              <th className="px-4 py-3 font-medium">الجوال</th>
              <th className="px-4 py-3 font-medium">آخر موظف</th>
              <th className="px-4 py-3 font-medium">تاريخ السحب</th>
              <th className="px-4 py-3 font-medium">آخر تواصل</th>
              <th className="px-4 py-3 font-medium">عدد الدورات</th>
              <th className="px-4 py-3 font-medium">المرحلة</th>
              <th className="px-4 py-3 font-medium">القناة</th>
              <th className="px-3 py-3 font-medium">خيارات</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr><td colSpan={11} className="px-4 py-10 text-center text-muted-foreground">ما فيه عملاء في الحوض.</td></tr>
            ) : (
              pageRows.map((r, i) => (
                <tr key={r.id} className={`border-t border-border transition-colors hover:bg-secondary/40 ${r.exhausted ? "bg-destructive/[0.05]" : ""}`}>
                  <td className="px-3 py-3">
                    <input type="checkbox" checked={sel.has(r.id)} disabled={r.exhausted} onChange={() => toggleSel(r.id)} aria-label={`تحديد ${r.name}`} />
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">{toArabicDigits((curPage - 1) * PAGE_SIZE + i + 1)}</td>
                  <td className="px-4 py-3 font-medium text-foreground">
                    <Link href={`/leads/${r.id}`} className="hover:text-gold">{r.name}</Link>
                    {r.exhausted && <span className="mr-2 rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-medium text-destructive">مستنفد</span>}
                  </td>
                  <td className="px-4 py-3 text-gold" dir="ltr">{r.phone}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.lastEmployee ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.pullDate ? formatDate(r.pullDate) : "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.lastContact ? formatDate(r.lastContact) : "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{toArabicDigits(r.reassignCount)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{stageLabels[r.stage]}</td>
                  <td className="px-4 py-3 text-muted-foreground">{channelLabels[r.channel]}</td>
                  <td className="px-3 py-3">
                    {r.exhausted ? (
                      <span className="text-xs text-muted-foreground">يحتاج تدخّلك</span>
                    ) : (
                      <button
                        onClick={() => setDist({ ids: [r.id] })}
                        className="flex items-center gap-1 rounded-lg border border-gold/50 bg-gold/10 px-3 py-1.5 text-xs font-medium text-gold hover:bg-gold/20"
                      ><Share2 className="size-3.5" /> توزيع</button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* بطاقات الجوال */}
      <div className="space-y-3 md:hidden">
        {pageRows.length === 0 ? (
          <p className="rounded-2xl border border-border bg-card px-4 py-10 text-center text-muted-foreground">ما فيه عملاء في الحوض.</p>
        ) : (
          pageRows.map((r) => (
            <div key={r.id} className={`rounded-2xl border p-4 ${r.exhausted ? "border-destructive/40 bg-destructive/[0.05]" : "border-border bg-card"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={sel.has(r.id)} disabled={r.exhausted} onChange={() => toggleSel(r.id)} aria-label={`تحديد ${r.name}`} />
                    <Link href={`/leads/${r.id}`} className="font-medium text-foreground hover:text-gold">{r.name}</Link>
                    {r.exhausted && <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-medium text-destructive">مستنفد</span>}
                  </div>
                  <a href={`tel:${r.phone}`} className="mt-1 block text-sm text-gold" dir="ltr">{r.phone}</a>
                </div>
                {!r.exhausted && (
                  <button onClick={() => setDist({ ids: [r.id] })} className="flex min-h-11 shrink-0 items-center gap-1 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground hover:opacity-90">
                    <Share2 className="size-3.5" /> توزيع
                  </button>
                )}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>آخر موظف: {r.lastEmployee ?? "—"}</span>
                <span>· دورات: {toArabicDigits(r.reassignCount)}</span>
                <span>· {stageLabels[r.stage]}</span>
                {r.pullDate && <span>· سُحب: {formatDate(r.pullDate)}</span>}
              </div>
            </div>
          ))
        )}
      </div>

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

      {dist && (
        <DistributeDialog
          count={dist.ids.length}
          employeeLoads={employeeLoads}
          onClose={() => setDist(null)}
          onConfirm={(opts) => {
            const ids = dist.ids;
            setDist(null);
            run(async () => { const r = await distributeNoResponseBatch(ids, opts); clearSel(); return r; });
          }}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: "gold" | "danger" | "plain" }) {
  const cls = tone === "gold" ? "text-gold" : tone === "danger" ? "text-destructive" : "text-foreground";
  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${cls}`}>{formatCount(value)}</div>
    </div>
  );
}

function FilterBar({
  filters, employees, onChange,
}: {
  filters: Filters;
  employees: Employee[];
  onChange: (next: Partial<Filters>) => void;
}) {
  const [q, setQ] = useState(filters.q);
  useEffect(() => { setQ(filters.q); }, [filters.q]);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <form
        onSubmit={(e) => { e.preventDefault(); onChange({ q: q.trim() }); }}
        className="flex flex-1 items-center gap-2"
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="بحث بالاسم أو الجوال…"
          className="min-w-[12rem] flex-1 rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-gold"
        />
        <button type="submit" className="rounded-xl border border-border px-4 py-2.5 text-sm text-foreground hover:bg-secondary">بحث</button>
      </form>

      <select
        value={filters.emp}
        onChange={(e) => onChange({ emp: e.target.value })}
        className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-gold"
      >
        <option value="">كل الموظفين السابقين</option>
        {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
      </select>

      <select
        value={filters.rounds || ""}
        onChange={(e) => onChange({ rounds: Number(e.target.value) || 0 })}
        className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-gold"
      >
        <option value="">كل الدورات</option>
        <option value="1">دورة واحدة</option>
        <option value="2">دورتان</option>
        <option value="3">٣ فأكثر</option>
      </select>

      <select
        value={filters.sort}
        onChange={(e) => onChange({ sort: e.target.value as NoResponseSort })}
        className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-gold"
      >
        <option value="recent">الأحدث سحبًا</option>
        <option value="oldest">الأقدم سحبًا</option>
        <option value="rounds">عدد الدورات</option>
      </select>
    </div>
  );
}

function DistributeDialog({
  count, employeeLoads, onClose, onConfirm,
}: {
  count: number;
  employeeLoads: EmployeeLoad[];
  onClose: () => void;
  onConfirm: (opts: DistributeOpts) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"even" | "single">("even");
  const [leadState, setLeadState] = useState<"asis" | "fresh">("asis");

  function toggle(id: string) {
    setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  const ids = [...picked];
  const canConfirm = ids.length > 0 && (mode === "even" || ids.length === 1);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="max-h-[90dvh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-2xl">
          <div>
            <h2 className="font-bold text-foreground">توزيع {toArabicDigits(count)} عميل</h2>
            <p className="mt-1 text-xs text-muted-foreground">اختر الموظفين المشاركين وطريقة التوزيع وحالة العميل.</p>
          </div>

          {/* أ) اختيار الموظفين المشاركين */}
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">الموظفون المشاركون</div>
            {employeeLoads.length === 0 ? (
              <p className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">ما فيه موظفون نشطون.</p>
            ) : (
              <div className="max-h-52 space-y-1 overflow-y-auto rounded-xl border border-border p-1.5">
                {employeeLoads.map((e) => (
                  <label key={e.id} className={`flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors ${picked.has(e.id) ? "bg-gold/10" : "hover:bg-secondary/40"}`}>
                    <input type="checkbox" checked={picked.has(e.id)} onChange={() => toggle(e.id)} className="accent-[var(--gold)]" />
                    <span className="flex-1 text-foreground">{e.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {toArabicDigits(e.count)}{e.maxClients != null ? ` / ${toArabicDigits(e.maxClients)}` : ""}
                      {e.remaining != null && <span className="mr-1 text-gold">(متبقّي {toArabicDigits(e.remaining)})</span>}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* ب) طريقة التوزيع */}
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">طريقة التوزيع</div>
            <div className="grid grid-cols-2 gap-2">
              {([["even", "بالتساوي على المحدّدين"], ["single", "كلهم لموظف واحد"]] as const).map(([v, label]) => (
                <label key={v} className={`cursor-pointer rounded-xl border p-2.5 text-center text-xs transition-colors ${mode === v ? "border-gold bg-gold/10 text-gold" : "border-border text-foreground hover:bg-secondary/40"}`}>
                  <input type="radio" name="dist-mode" className="sr-only" checked={mode === v} onChange={() => setMode(v)} />
                  {label}
                </label>
              ))}
            </div>
            {mode === "single" && ids.length > 1 && (
              <p className="text-xs text-destructive">«كلهم لموظف واحد» — اختر موظفًا واحدًا فقط.</p>
            )}
          </div>

          {/* ج) حالة العميل */}
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">حالة العميل</div>
            <div className="space-y-1.5">
              {([
                ["asis", "ببياناته كما هي", "المرحلة والمتابعات تبقى كما هي (الأأمن)."],
                ["fresh", "كعميل جديد", "يرجّع المرحلة «جديد» ويصفّر موعد المتابعة — المتابعات محفوظة كسجل."],
              ] as const).map(([v, label, desc]) => (
                <label key={v} className={`block cursor-pointer rounded-xl border p-2.5 transition-colors ${leadState === v ? "border-gold bg-gold/10" : "border-border hover:bg-secondary/40"}`}>
                  <div className="flex items-center gap-2">
                    <input type="radio" name="lead-state" checked={leadState === v} onChange={() => setLeadState(v)} className="accent-[var(--gold)]" />
                    <span className="text-sm font-medium text-foreground">{label}</span>
                  </div>
                  <p className="mt-0.5 pr-6 text-xs text-muted-foreground">{desc}</p>
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground">إلغاء</button>
            <button
              onClick={() => canConfirm && onConfirm({ employeeIds: ids, mode, leadState })}
              disabled={!canConfirm}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >وزّع</button>
          </div>
        </div>
      </div>
    </>
  );
}
