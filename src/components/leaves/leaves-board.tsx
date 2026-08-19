"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, X, Clock, XCircle, FilterX } from "lucide-react";
import { toArabicDigits } from "@/lib/format";

/**
 * «طلبات الإجازة» — لوحة المالك على /leaves (ديسكتوب). جدول عريض لكل طلبات الفريق
 * مع الرصيد المشتق، وشريط فلاتر (الحالة/الموظف/المدى الزمني — فلترة محلية)، والقرار
 * بنفس نداءات الجوال حرفيًا (PATCH /api/leaves/[id]) — لا منطق قرار جديد بالواجهة.
 * تحديث تلقائي كل ٣٠ ثانية (نمط خط المبيعات).
 */

const ZAIN = { fontFamily: "var(--font-zain), var(--font-sans)", fontVariantNumeric: "tabular-nums" as const };
const AR_M = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const TYPE_LABEL: Record<string, string> = { ANNUAL: "سنوية", SICK: "مرضية", EMERGENCY: "طارئة" };

export type Balance = { entitledDays: number; usedDays: number; remainingDays: number };
export type OwnerLeaveRow = {
  id: string;
  userId: string;
  userName: string;
  type: string;
  from: string; // YYYY-MM-DD
  to: string;
  days: number;
  reason: string;
  status: string;
  decisionNote: string | null;
  createdAt: string;
};

function fmtDate(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return key;
  return `${toArabicDigits(d)} ${AR_M[m - 1]} ${toArabicDigits(y)}`;
}
function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000) + 1;
}
const dayWord = (n: number) => (n === 1 ? "يوم" : n === 2 ? "يومان" : "أيام");

const STATUS_META: Record<string, { label: string; cls: string; Icon: typeof Clock }> = {
  PENDING: { label: "معلّق", cls: "border-warning/40 bg-warning/10 text-warning", Icon: Clock },
  APPROVED: { label: "معتمد", cls: "border-success/40 bg-success/10 text-success", Icon: Check },
  REJECTED: { label: "مرفوض", cls: "border-destructive/40 bg-destructive/10 text-destructive", Icon: XCircle },
};
const STATUS_FILTERS = [
  ["all", "الكل"],
  ["PENDING", "معلّق"],
  ["APPROVED", "معتمد"],
  ["REJECTED", "مرفوض"],
] as const;

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_META[status] ?? STATUS_META.PENDING;
  const S = s.Icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${s.cls}`}>
      <S className="size-3.5" strokeWidth={2.2} aria-hidden />
      {s.label}
    </span>
  );
}

export function LeavesBoard({ initial, balances }: { initial: OwnerLeaveRow[]; balances: Record<string, Balance> }) {
  const [rows, setRows] = useState<OwnerLeaveRow[]>(initial);
  const [bal, setBal] = useState<Record<string, Balance>>(balances);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [deduct, setDeduct] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  // فلاتر محلية — لا تغيّر نداءات الخادم.
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number][0]>("all");
  const [employeeFilter, setEmployeeFilter] = useState<string>("all");
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");

  const isDeduct = (id: string) => deduct[id] !== false; // الافتراضي مفعّل

  const refresh = async () => {
    try {
      const res = await fetch("/api/leaves", { cache: "no-store" });
      const d = (await res.json()) as { ok: boolean; requests?: unknown[] };
      if (!d.ok || !d.requests) return;
      const newRows: OwnerLeaveRow[] = d.requests.map((r) => {
        const x = r as { id: string; userId: string; user?: { name?: string }; type: string; dateFrom: string; dateTo: string; reason: string; status: string; decisionNote: string | null; createdAt: string };
        const from = x.dateFrom.slice(0, 10), to = x.dateTo.slice(0, 10);
        return { id: x.id, userId: x.userId, userName: x.user?.name ?? "—", type: x.type, from, to, days: daysBetween(from, to), reason: x.reason, status: x.status, decisionNote: x.decisionNote, createdAt: x.createdAt };
      });
      setRows(newRows);
      const ids = [...new Set(newRows.map((r) => r.userId))];
      const entries = await Promise.all(
        ids.map(async (id) => {
          const b = await fetch(`/api/attendance/leave-balance/${id}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
          return [id, b?.balance as Balance | undefined] as const;
        }),
      );
      setBal(Object.fromEntries(entries.filter((e) => e[1]) as [string, Balance][]));
    } catch {
      /* نُبقي الحالي */
    }
  };

  // تحديث تلقائي كل ٣٠ ثانية — طلبات الفريق مشتركة.
  useEffect(() => {
    const t = setInterval(() => void refresh(), 30000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const decide = async (id: string, approve: boolean) => {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/leaves/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(approve ? { decision: "APPROVE", deductFromBalance: isDeduct(id) } : { decision: "REJECT", note: note.trim() || undefined }),
      });
      const d = (await res.json()) as { ok: boolean; message?: string };
      if (d.ok) {
        setRejectId(null);
        setNote("");
        await refresh();
      } else {
        setError(d.message ?? "تعذّر تنفيذ القرار");
      }
    } catch {
      setError("تعذّر الاتصال — حاول مرة ثانية");
    }
    setBusyId(null);
  };

  const employees = useMemo(
    () => [...new Map(rows.map((r) => [r.userId, r.userName])).entries()].sort((a, b) => a[1].localeCompare(b[1], "ar")),
    [rows],
  );

  const filtered = useMemo(() => {
    let list = rows;
    if (statusFilter !== "all") list = list.filter((r) => r.status === statusFilter);
    if (employeeFilter !== "all") list = list.filter((r) => r.userId === employeeFilter);
    // المدى الزمني: يكفي تقاطع مدة الطلب مع المدى (مقارنة مفاتيح نصية).
    if (rangeFrom) list = list.filter((r) => r.to >= rangeFrom);
    if (rangeTo) list = list.filter((r) => r.from <= rangeTo);
    return list;
  }, [rows, statusFilter, employeeFilter, rangeFrom, rangeTo]);

  const pendingCount = rows.filter((r) => r.status === "PENDING").length;
  const hasFilter = statusFilter !== "all" || employeeFilter !== "all" || !!rangeFrom || !!rangeTo;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">طلبات الإجازة</h1>
          <p className="mt-1 text-sm text-muted-foreground">السريان باعتمادك فقط · الرصيد مشتق من المعتمد الخاصم · يتحدّث تلقائيًا</p>
        </div>
        {pendingCount > 0 && (
          <span className="rounded-full border border-warning/40 bg-warning/10 px-3.5 py-1.5 text-sm font-bold text-warning">
            <span style={ZAIN}>{toArabicDigits(pendingCount)}</span> بانتظارك
          </span>
        )}
      </header>

      {/* ===== شريط الفلاتر ===== */}
      <section className="flex flex-wrap items-end gap-3">
        <div className="flex gap-1 rounded-xl border border-border bg-card p-1">
          {STATUS_FILTERS.map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setStatusFilter(v)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${statusFilter === v ? "bg-secondary text-gold" : "text-muted-foreground hover:text-foreground"}`}
            >
              {label}
            </button>
          ))}
        </div>

        <label className="text-xs text-muted-foreground">
          الموظف
          <select
            value={employeeFilter}
            onChange={(e) => setEmployeeFilter(e.target.value)}
            className="mt-1.5 block h-9 rounded-xl border border-border bg-card px-3 text-xs text-foreground outline-none focus:border-ring"
          >
            <option value="all">الكل</option>
            {employees.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        </label>

        <label className="text-xs text-muted-foreground">
          من
          <input
            type="date" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} dir="ltr"
            className="mt-1.5 block h-9 w-36 rounded-xl border border-border bg-card px-3 text-xs text-foreground outline-none focus:border-ring"
          />
        </label>
        <label className="text-xs text-muted-foreground">
          إلى
          <input
            type="date" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} dir="ltr"
            className="mt-1.5 block h-9 w-36 rounded-xl border border-border bg-card px-3 text-xs text-foreground outline-none focus:border-ring"
          />
        </label>

        {hasFilter && (
          <button
            type="button"
            onClick={() => { setStatusFilter("all"); setEmployeeFilter("all"); setRangeFrom(""); setRangeTo(""); }}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <FilterX className="size-3.5" aria-hidden />
            مسح الفلاتر
          </button>
        )}
      </section>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* ===== الجدول ===== */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
          <CalendarDays className="size-8" strokeWidth={1.5} aria-hidden />
          <span className="text-sm">{rows.length === 0 ? "ما فيه طلبات إجازة" : "ما فيه طلبات تطابق الفلاتر"}</span>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="crm-table min-w-[1080px] text-sm">
            <thead className="bg-secondary/40 text-muted-foreground">
              <tr>
                <th>الموظف</th>
                <th>النوع</th>
                <th>المدة</th>
                <th>الأيام</th>
                <th>السبب</th>
                <th>رصيده</th>
                <th>الحالة</th>
                <th>الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const b = bal[r.userId];
                const pending = r.status === "PENDING";
                const busy = busyId === r.id;
                return (
                  <tr key={r.id}>
                    <td className="font-semibold text-foreground">{r.userName}</td>
                    <td className="text-muted-foreground">{TYPE_LABEL[r.type] ?? "—"}</td>
                    <td className="whitespace-nowrap text-muted-foreground">
                      {fmtDate(r.from)} <span className="text-border">←</span> {fmtDate(r.to)}
                    </td>
                    <td>
                      <span style={ZAIN}>{toArabicDigits(r.days)}</span>
                      <span className="text-muted-foreground"> {dayWord(r.days)}</span>
                    </td>
                    <td className="max-w-56 text-muted-foreground">
                      <div className="truncate" title={r.reason}>{r.reason}</div>
                      {r.status === "REJECTED" && r.decisionNote && (
                        <div className="mt-1 text-xs text-destructive">ملاحظة الرفض: {r.decisionNote}</div>
                      )}
                    </td>
                    <td className="whitespace-nowrap text-xs text-gold">
                      {b ? (
                        <>
                          مستخدَم <span style={ZAIN}>{toArabicDigits(b.usedDays)}</span> · متبقٍ{" "}
                          <span style={ZAIN}>{toArabicDigits(b.remainingDays)}</span> من <span style={ZAIN}>{toArabicDigits(b.entitledDays)}</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td><StatusBadge status={r.status} /></td>
                    <td>
                      {!pending ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : rejectId === r.id ? (
                        <div className="flex min-w-64 flex-col gap-2 py-1">
                          <textarea
                            value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="ملاحظة الرفض (اختيارية)"
                            className="w-full resize-none rounded-lg border border-border bg-transparent p-2 text-xs text-foreground outline-none focus:border-ring"
                          />
                          <div className="flex gap-2">
                            <button
                              type="button" disabled={busy} onClick={() => void decide(r.id, false)}
                              className="flex-1 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-bold text-destructive transition-opacity hover:opacity-80 disabled:opacity-50"
                            >
                              {busy ? "..." : "تأكيد الرفض"}
                            </button>
                            <button
                              type="button" onClick={() => { setRejectId(null); setNote(""); }}
                              className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                            >
                              إلغاء
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2 py-1">
                          <label className="flex items-center gap-2 text-xs text-muted-foreground">
                            <input
                              type="checkbox" checked={isDeduct(r.id)}
                              onChange={(e) => setDeduct((m) => ({ ...m, [r.id]: e.target.checked }))}
                              className="size-3.5 accent-[var(--gold)]"
                            />
                            خصم من رصيده
                          </label>
                          <div className="flex gap-2">
                            <button
                              type="button" disabled={busy} onClick={() => void decide(r.id, true)}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-success px-3.5 py-1.5 text-xs font-extrabold text-background transition-opacity hover:opacity-90 disabled:opacity-50"
                            >
                              <Check className="size-3.5" strokeWidth={2.6} aria-hidden />
                              {busy ? "جاري…" : "اعتماد"}
                            </button>
                            <button
                              type="button" disabled={busy} onClick={() => { setRejectId(r.id); setNote(""); }}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-1.5 text-xs font-bold text-destructive transition-opacity hover:opacity-80"
                            >
                              <X className="size-3.5" strokeWidth={2.6} aria-hidden />
                              رفض
                            </button>
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
