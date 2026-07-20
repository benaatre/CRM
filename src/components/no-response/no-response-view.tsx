"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PhoneMissed, AlertTriangle, SlidersHorizontal, BellRing, UserMinus, Share2, X } from "lucide-react";
import { formatCount, toArabicDigits } from "@/lib/format";
import type { NoResponseSort, PendingPullSummary, PoolSourceGroup, CategoryStat, EmployeeLoad } from "@/lib/data/no-response";
import { CATEGORY_ORDER, CATEGORY_LABEL, DEFAULT_IMMUNITY_CAP, type NoResponseConfig, type EscalationCategory } from "@/lib/no-response-escalation";
import {
  warnAllEmployees, pullGroup, distributePoolGroup, distributeNoResponseBatch,
  type DistributeOpts, type PullGroupCategory,
} from "@/lib/actions/no-response";

type Employee = { id: string; name: string };
type Filters = { q: string; emp: string; rounds: number; sort: NoResponseSort };

// فئات «بانتظار السحب» حسب عدد المتابعات (بلا محصّن — لا يُسحب).
const PENDING_COLS: { cat: EscalationCategory; pull: PullGroupCategory; label: string }[] = [
  { cat: "none", pull: "pending_0", label: "بلا متابعة" },
  { cat: "one", pull: "pending_1", label: "متابعة أولى" },
  { cat: "two", pull: "pending_2", label: "متابعة ثانية" },
  { cat: "threePlus", pull: "pending_3plus", label: "متابعة ثالثة" },
];

type PullAsk = { employeeId: string; employeeName: string; category: PullGroupCategory; count: number };
type DistAsk = { count: number; sourceEmpIds: string[]; sourceEmployeeId: string | null; leadIds: string[]; who: string };

export function NoResponseView({
  summary, pool, employeeLoads, filters, config,
}: {
  summary: PendingPullSummary;
  pool: PoolSourceGroup[];
  employeeLoads: EmployeeLoad[];
  filters: Filters;
  config: NoResponseConfig;
}) {
  const employees: Employee[] = employeeLoads.map((e) => ({ id: e.id, name: e.name }));
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [pullAsk, setPullAsk] = useState<PullAsk | null>(null);
  const [dist, setDist] = useState<DistAsk | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    setMsg(null);
    startTransition(async () => {
      const res = await fn();
      setMsg(res.ok ? (res.message ?? "تم") : (res.error ?? "صار خطأ"));
      router.refresh();
    });
  }

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

  // فلترة العرض حسب الموظف/البحث (تعمل على التجميع — بلا أسماء عملاء).
  const q = filters.q.trim();
  const matchEmp = (id: string, name: string) => (!filters.emp || id === filters.emp) && (!q || name.includes(q));

  const overdueEmps = summary.employees.filter((e) => e.totalOverdue > 0 && matchEmp(e.id, e.name));
  const pendingEmps = summary.employees.filter((e) => e.totalPending > 0 && matchEmp(e.id, e.name));
  const poolGroups = pool.filter((g) => matchEmp(g.employeeId, g.employee));
  const poolTotal = poolGroups.reduce((s, g) => s + g.count, 0);

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
        <StatCard label="يُسحبون الآن" value={summary.totalOverdue} tone="danger" />
        <StatCard label="في الحوض" value={summary.inQueue} tone="plain" />
        <StatCard label="بلغوا السقف" value={summary.capped} tone="plain" />
      </div>

      {/* حالة النظام */}
      <div className={`mb-4 flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm ${summary.live ? "border-success/40 bg-success/5 text-success" : "border-gold/40 bg-gold/5 text-gold"}`}>
        <span className={`inline-block size-2 rounded-full ${summary.live ? "bg-success" : "bg-gold"}`} />
        <span className="font-medium">حالة النظام: {summary.live ? "مفعّل — السحب التلقائي يعمل" : "معاينة (dry-run) — لا سحب تلقائي حتى التفعيل"}</span>
      </div>

      {/* لوحة الأرقام العلوية (per-category) — كما هي */}
      <NumbersPanel summary={summary} />

      {/* الإعدادات — كما هي */}
      <NoResponseSettings config={config} />

      {/* البحث والفلاتر — تعمل على التجميع */}
      <FilterBar filters={filters} employees={employees} onChange={pushFilters} />

      {msg && <p className="mb-4 rounded-lg bg-success/10 px-3 py-2 text-xs text-success">{msg}</p>}

      {/* ===== ١) يُسحب الآن — صف لكل موظف ===== */}
      <section className="mb-6">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-destructive">
          <AlertTriangle className="size-4" /> يُسحب الآن (تجاوزوا مهلتهم)
        </h2>
        <div className="overflow-x-auto rounded-2xl border border-destructive/30 bg-card">
          <table className="w-full min-w-[640px] text-right text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
            <thead className="bg-secondary/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">الموظف</th>
                <th className="px-3 py-3 text-center font-medium">متأخر جدًا (+٥ أيام)</th>
                <th className="px-3 py-3 text-center font-medium">متأخر (+٣ أيام)</th>
                <th className="px-3 py-3 text-center font-medium">الإجمالي</th>
                <th className="px-3 py-3 font-medium">إجراء</th>
              </tr>
            </thead>
            <tbody>
              {overdueEmps.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">ما فيه من يُسحب الآن.</td></tr>
              ) : overdueEmps.map((e) => (
                <tr key={e.id} className="border-t border-border">
                  <td className="px-4 py-3 font-medium text-foreground">{e.name}</td>
                  <NumPullCell value={e.overdueVery} tone="danger" onPull={() => setPullAsk({ employeeId: e.id, employeeName: e.name, category: "overdue_very", count: e.overdueVery })} pending={pending} />
                  <NumPullCell value={e.overdueLate} tone="danger" onPull={() => setPullAsk({ employeeId: e.id, employeeName: e.name, category: "overdue_late", count: e.overdueLate })} pending={pending} />
                  <td className="px-3 py-3 text-center font-bold text-destructive">{formatCount(e.totalOverdue)}</td>
                  <td className="px-3 py-3">
                    <PullBtn label="اسحب الكل" disabled={pending} onClick={() => setPullAsk({ employeeId: e.id, employeeName: e.name, category: "overdue_all", count: e.totalOverdue })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ===== ٢) بانتظار السحب — صف لكل موظف حسب عدد المتابعات ===== */}
      <section className="mb-6">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-bold text-gold">
          <AlertTriangle className="size-4" /> بانتظار السحب (لم يبلغوا الحد — سحبهم قرار يدوي)
        </h2>
        <div className="overflow-x-auto rounded-2xl border border-gold/30 bg-card">
          <table className="w-full min-w-[720px] text-right text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
            <thead className="bg-secondary/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">الموظف</th>
                {PENDING_COLS.map((c) => <th key={c.cat} className="px-3 py-3 text-center font-medium">{c.label}</th>)}
                <th className="px-3 py-3 text-center font-medium">الإجمالي</th>
                <th className="px-3 py-3 font-medium">إجراء</th>
              </tr>
            </thead>
            <tbody>
              {pendingEmps.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">ما فيه أحد بانتظار السحب.</td></tr>
              ) : pendingEmps.map((e) => (
                <tr key={e.id} className="border-t border-border">
                  <td className="px-4 py-3 font-medium text-foreground">{e.name}</td>
                  {PENDING_COLS.map((c) => (
                    <NumPullCell key={c.cat} value={e.byCategory[c.cat].pending} tone="gold"
                      onPull={() => setPullAsk({ employeeId: e.id, employeeName: e.name, category: c.pull, count: e.byCategory[c.cat].pending })} pending={pending} />
                  ))}
                  <td className="px-3 py-3 text-center font-bold text-gold">{formatCount(e.totalPending)}</td>
                  <td className="px-3 py-3">
                    <PullBtn label="اسحب الكل" disabled={pending} onClick={() => setPullAsk({ employeeId: e.id, employeeName: e.name, category: "pending_all", count: e.totalPending })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ===== ٣) الحوض — مقسّم بالموظف المسحوب منه ===== */}
      <section className="mb-6">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
            <Share2 className="size-4 text-gold" /> الحوض — بانتظار التوزيع
          </h2>
          <button
            onClick={() => setDist({ count: poolTotal, sourceEmpIds: poolGroups.map((g) => g.employeeId), sourceEmployeeId: null, leadIds: poolGroups.flatMap((g) => g.leadIds), who: "كل الحوض" })}
            disabled={pending || poolTotal === 0}
            className="rounded-lg border border-gold/50 bg-gold/10 px-3 py-1.5 text-xs font-medium text-gold hover:bg-gold/20 disabled:opacity-40"
          >وزّع الكل ({toArabicDigits(poolTotal)})</button>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full min-w-[720px] text-right text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
            <thead className="bg-secondary/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">الموظف المسحوب منه</th>
                <th className="px-3 py-3 text-center font-medium">العدد</th>
                {CATEGORY_ORDER.map((c) => <th key={c} className="px-3 py-3 text-center font-medium">{CATEGORY_LABEL[c]}</th>)}
                <th className="px-3 py-3 font-medium">إجراء</th>
              </tr>
            </thead>
            <tbody>
              {poolGroups.length === 0 ? (
                <tr><td colSpan={CATEGORY_ORDER.length + 3} className="px-4 py-8 text-center text-muted-foreground">الحوض فاضي.</td></tr>
              ) : poolGroups.map((g) => (
                <tr key={g.employeeId} className="border-t border-border">
                  <td className="px-4 py-3 font-medium text-foreground">{g.employee}</td>
                  <td className="px-3 py-3 text-center font-bold text-gold">{formatCount(g.count)}</td>
                  {CATEGORY_ORDER.map((c) => (
                    <td key={c} className="px-3 py-3 text-center text-muted-foreground">{g.byFollowup[c] > 0 ? toArabicDigits(g.byFollowup[c]) : "—"}</td>
                  ))}
                  <td className="px-3 py-3">
                    <button
                      onClick={() => setDist({ count: g.count, sourceEmpIds: [g.employeeId], sourceEmployeeId: g.employeeId, leadIds: g.leadIds, who: g.employee })}
                      disabled={pending}
                      className="flex items-center gap-1 rounded-lg border border-gold/50 bg-gold/10 px-3 py-1.5 text-xs font-medium text-gold hover:bg-gold/20 disabled:opacity-50"
                    ><Share2 className="size-3.5" /> وزّع</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* تأكيد السحب */}
      {pullAsk && (
        <ConfirmModal
          title="تأكيد السحب"
          body={`تسحب ${toArabicDigits(pullAsk.count)} عميل من ${pullAsk.employeeName}؟`}
          confirmLabel="اسحب"
          danger
          pending={pending}
          onCancel={() => setPullAsk(null)}
          onConfirm={() => { const a = pullAsk; setPullAsk(null); run(() => pullGroup(a.employeeId, a.category)); }}
        />
      )}

      {/* نافذة التوزيع */}
      {dist && (
        <DistributeDialog
          count={dist.count}
          who={dist.who}
          employeeLoads={employeeLoads}
          sourceEmpIds={dist.sourceEmpIds}
          onClose={() => setDist(null)}
          onConfirm={(opts) => {
            const d = dist;
            setDist(null);
            run(async () => d.sourceEmployeeId
              ? distributePoolGroup(d.sourceEmployeeId, opts)
              : distributeNoResponseBatch(d.leadIds, opts));
          }}
        />
      )}
    </div>
  );
}

// ===================== عناصر مساعدة =====================

function PullBtn({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="flex items-center gap-1 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/20 disabled:opacity-40">
      <UserMinus className="size-3.5" /> {label}
    </button>
  );
}

// خانة رقم + زر «اسحب» صغير للمجموعة (لا يظهر الزر لو الرقم صفر).
function NumPullCell({ value, tone, onPull, pending }: { value: number; tone: "danger" | "gold"; onPull: () => void; pending: boolean }) {
  const color = tone === "danger" ? "text-destructive" : "text-gold";
  return (
    <td className="px-3 py-3 text-center">
      {value === 0 ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <div className="flex items-center justify-center gap-1.5">
          <span className={`font-bold ${color}`}>{formatCount(value)}</span>
          <button onClick={onPull} disabled={pending} title="اسحب هذي المجموعة"
            className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:border-destructive hover:text-destructive disabled:opacity-40">اسحب</button>
        </div>
      )}
    </td>
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

// لوحة الأرقام العلوية (per-category) — كما هي: لكل موظف/فئة بانتظار/يُسحب.
function NumbersPanel({ summary }: { summary: PendingPullSummary }) {
  return (
    <section className="mb-6 rounded-2xl border border-border bg-card p-4">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-bold text-foreground">
        <AlertTriangle className="size-4 text-gold" /> الأرقام حسب الموظف والفئة
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        كل خانة: <span className="text-gold">بانتظار الإنذار</span> · <span className="text-destructive">يُسحب الآن</span> — «محصّن» = عدد المحصّنين (٥+ متابعات).
      </p>
      {summary.employees.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">كل شي تحت السيطرة.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-right text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">الموظف</th>
                {CATEGORY_ORDER.map((c) => <th key={c} className="px-3 py-2 text-center font-medium">{CATEGORY_LABEL[c]}</th>)}
              </tr>
            </thead>
            <tbody>
              {summary.employees.map((e) => (
                <tr key={e.id} className="border-t border-border">
                  <td className="px-3 py-2.5 font-medium text-foreground">{e.name}</td>
                  {CATEGORY_ORDER.map((c) => <CatCell key={c} cat={c} stat={e.byCategory[c]} />)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function CatCell({ cat, stat }: { cat: EscalationCategory; stat: CategoryStat }) {
  if (cat === "immune") {
    return <td className="px-3 py-2.5 text-center text-muted-foreground">{stat.total > 0 ? toArabicDigits(stat.total) : "—"}</td>;
  }
  const empty = stat.pending === 0 && stat.overdue === 0;
  return (
    <td className="px-3 py-2.5 text-center">
      {empty ? <span className="text-muted-foreground">—</span> : (
        <span className="inline-flex items-center justify-center gap-1" title={`بانتظار ${stat.pending} · يُسحب ${stat.overdue}`}>
          {stat.pending > 0 && <span className="rounded bg-gold/15 px-1.5 py-0.5 text-[11px] font-medium text-gold">{toArabicDigits(stat.pending)}</span>}
          {stat.overdue > 0 && <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-[11px] font-medium text-destructive">{toArabicDigits(stat.overdue)}</span>}
        </span>
      )}
    </td>
  );
}

function NoResponseSettings({ config }: { config: NoResponseConfig }) {
  return (
    <section className="mb-6 rounded-2xl border border-border bg-card p-4">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-bold text-foreground">
        <SlidersHorizontal className="size-4 text-gold" /> إعدادات «لم يتم الرد» (مستقلة عن التوزيع)
      </h2>
      <div className="mb-3 rounded-lg border border-gold/30 bg-gold/5 px-3 py-2 text-xs text-gold">
        القراءة حاليًا من متغيّرات البيئة (env): <span dir="ltr">NO_RESPONSE_PULL</span> · <span dir="ltr">NO_RESPONSE_DAYS</span> ·{" "}
        <span dir="ltr">NO_RESPONSE_IMMUNITY_CAP</span> · <span dir="ltr">NO_RESPONSE_ACTIVATION_DATE</span>. التعديل من الواجهة يحتاج حقل قاعدة (schema).
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-background/40 px-3 py-2.5">
          <div className="text-xs text-muted-foreground">حالة النظام</div>
          <div className={`mt-1 text-sm font-bold ${config.enabled ? "text-success" : "text-gold"}`}>{config.enabled ? "مفعّل (سحب حقيقي)" : "معاينة (dry-run)"}</div>
        </div>
        <div className="rounded-xl border border-border bg-background/40 px-3 py-2.5">
          <div className="text-xs text-muted-foreground">جدول المهل (يوم لكل عدد متابعات)</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {config.timeoutDays.map((d, i) => (
              <span key={i} className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-foreground">{toArabicDigits(i)}م: {toArabicDigits(d)} يوم</span>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-background/40 px-3 py-2.5">
          <div className="text-xs text-muted-foreground">سقف الحصانة (متابعات)</div>
          <div className="mt-1 text-sm font-bold text-foreground">{toArabicDigits(config.immunityCap)}{config.immunityCap === DEFAULT_IMMUNITY_CAP ? " (افتراضي)" : ""}</div>
        </div>
      </div>
    </section>
  );
}

function FilterBar({ filters, employees, onChange }: { filters: Filters; employees: Employee[]; onChange: (next: Partial<Filters>) => void }) {
  const [q, setQ] = useState(filters.q);
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <form onSubmit={(e) => { e.preventDefault(); onChange({ q: q.trim() }); }} className="flex flex-1 items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث باسم الموظف…" className="min-w-[12rem] flex-1 rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-gold" />
        <button type="submit" className="rounded-xl border border-border px-4 py-2.5 text-sm text-foreground hover:bg-secondary">بحث</button>
      </form>
      <select value={filters.emp} onChange={(e) => onChange({ emp: e.target.value })} className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-gold">
        <option value="">كل الموظفين</option>
        {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
      </select>
    </div>
  );
}

function ConfirmModal({ title, body, confirmLabel, danger, pending, onCancel, onConfirm }: {
  title: string; body: string; confirmLabel: string; danger?: boolean; pending: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-card p-5 shadow-2xl">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-foreground">{title}</h3>
            <button onClick={onCancel} className="rounded p-1 text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
          </div>
          <p className="text-sm text-foreground">{body}</p>
          <div className="flex justify-end gap-2">
            <button onClick={onCancel} disabled={pending} className="rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-secondary disabled:opacity-50">إلغاء</button>
            <button onClick={onConfirm} disabled={pending} className={`rounded-lg px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50 ${danger ? "bg-destructive" : "bg-primary"}`}>{confirmLabel}</button>
          </div>
        </div>
      </div>
    </>
  );
}

function DistributeDialog({ count, who, employeeLoads, sourceEmpIds, onClose, onConfirm }: {
  count: number; who: string; employeeLoads: EmployeeLoad[]; sourceEmpIds: string[]; onClose: () => void; onConfirm: (opts: DistributeOpts) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"even" | "single">("even");
  const [leadState, setLeadState] = useState<"asis" | "fresh">("asis");
  const sourceSet = new Set(sourceEmpIds);

  function toggle(id: string) {
    if (sourceSet.has(id)) return;
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
            <h2 className="font-bold text-foreground">توزيع {toArabicDigits(count)} عميل ({who})</h2>
            <p className="mt-1 text-xs text-muted-foreground">اختر الموظفين المستلمين وطريقة التوزيع وحالة العميل. الموظف المسحوب منه معطّل.</p>
          </div>

          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">الموظفون المستلمون</div>
            {employeeLoads.length === 0 ? (
              <p className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">ما فيه موظفون نشطون.</p>
            ) : (
              <div className="max-h-52 space-y-1 overflow-y-auto rounded-xl border border-border p-1.5">
                {employeeLoads.map((e) => {
                  const isSource = sourceSet.has(e.id);
                  return (
                    <label key={e.id} className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors ${isSource ? "cursor-not-allowed opacity-50" : picked.has(e.id) ? "cursor-pointer bg-gold/10" : "cursor-pointer hover:bg-secondary/40"}`}>
                      <input type="checkbox" checked={picked.has(e.id)} disabled={isSource} onChange={() => toggle(e.id)} className="accent-[var(--gold)]" />
                      <span className="flex-1 text-foreground">{e.name}</span>
                      {isSource ? (
                        <span className="text-[11px] text-muted-foreground">سُحب منه</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {toArabicDigits(e.count)}{e.maxClients != null ? ` / ${toArabicDigits(e.maxClients)}` : ""}
                          {e.remaining != null && <span className="mr-1 text-gold">(متبقّي {toArabicDigits(e.remaining)})</span>}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
          </div>

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
            {mode === "single" && ids.length > 1 && <p className="text-xs text-destructive">«كلهم لموظف واحد» — اختر موظفًا واحدًا فقط.</p>}
          </div>

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
            <button onClick={() => canConfirm && onConfirm({ employeeIds: ids, mode, leadState })} disabled={!canConfirm} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">وزّع</button>
          </div>
        </div>
      </div>
    </>
  );
}
