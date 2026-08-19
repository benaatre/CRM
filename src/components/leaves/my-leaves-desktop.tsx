"use client";

import { useState } from "react";
import { CalendarDays, Plus, X, Clock, Check, XCircle } from "lucide-react";
import { toArabicDigits } from "@/lib/format";

/**
 * «إجازاتي» — نسخة الديسكتوب لواجهة الموظف/المدير: زر طلب يفتح نموذجًا (نوع/من/إلى/سبب
 * مع عدّ الأيام) + جدول الطلبات بحالاتها. **ممنوع عرض أي رصيد** — الرصيد للمالك فقط (م٤).
 * نفس نداءات نسخة الجوال حرفيًا (POST/GET /api/leaves) — لا منطق خادم جديد.
 */

const ZAIN = { fontFamily: "var(--font-zain), var(--font-sans)", fontVariantNumeric: "tabular-nums" as const };
const AR_M = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

const TYPES = [
  { key: "ANNUAL", label: "سنوية" },
  { key: "SICK", label: "مرضية" },
  { key: "EMERGENCY", label: "طارئة" },
] as const;
const TYPE_LABEL: Record<string, string> = { ANNUAL: "سنوية", SICK: "مرضية", EMERGENCY: "طارئة" };

export type LeaveRow = {
  id: string;
  type: string;
  from: string; // YYYY-MM-DD
  to: string;
  days: number;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | string;
  decisionNote: string | null;
  createdAt: string;
};

const todayKey = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
function fmtDate(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return key;
  return `${toArabicDigits(d)} ${AR_M[m - 1]} ${toArabicDigits(y)}`;
}
function daysBetween(from: string, to: string): number | null {
  if (!from || !to) return null;
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return Math.round((b - a) / 86_400_000) + 1;
}
const dayWord = (n: number) => (n === 1 ? "يوم" : n === 2 ? "يومان" : "أيام");

const STATUS_META: Record<string, { label: string; cls: string; Icon: typeof Clock }> = {
  PENDING: { label: "معلّق", cls: "border-warning/40 bg-warning/10 text-warning", Icon: Clock },
  APPROVED: { label: "معتمد", cls: "border-success/40 bg-success/10 text-success", Icon: Check },
  REJECTED: { label: "مرفوض", cls: "border-destructive/40 bg-destructive/10 text-destructive", Icon: XCircle },
};

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

export function MyLeavesDesktop({ initial, openNew = false, canRequest = true }: { initial: LeaveRow[]; openNew?: boolean; canRequest?: boolean }) {
  const [rows, setRows] = useState<LeaveRow[]>(initial);
  const [open, setOpen] = useState(openNew && canRequest);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<(typeof TYPES)[number]["key"]>("ANNUAL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");

  const days = daysBetween(from, to);

  const reset = () => { setType("ANNUAL"); setFrom(""); setTo(""); setReason(""); setError(null); };

  const refresh = async () => {
    try {
      const res = await fetch("/api/leaves", { cache: "no-store" });
      const d = (await res.json()) as { ok: boolean; requests?: unknown[] };
      if (d.ok && d.requests) {
        setRows(
          d.requests.map((r) => {
            const x = r as { id: string; type: string; dateFrom: string; dateTo: string; reason: string; status: string; decisionNote: string | null; createdAt: string };
            const f = x.dateFrom.slice(0, 10), t = x.dateTo.slice(0, 10);
            return { id: x.id, type: x.type, from: f, to: t, days: daysBetween(f, t) ?? 1, reason: x.reason, status: x.status, decisionNote: x.decisionNote, createdAt: x.createdAt };
          }),
        );
      }
    } catch { /* نُبقي القائمة الحالية */ }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/leaves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, fromKey: from, toKey: to, reason: reason.trim() }),
      });
      const d = (await res.json()) as { ok: boolean; message?: string };
      if (d.ok) {
        await refresh();
        setOpen(false);
        reset();
      } else {
        setError(d.message ?? "ما قدرنا نرسل الطلب");
      }
    } catch {
      setError("تعذّر الاتصال — حاول مرة ثانية");
    }
    setBusy(false);
  };

  const canSubmit = !busy && !!from && !!to && !!reason.trim();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">إجازاتي</h1>
          <p className="mt-1 text-sm text-muted-foreground">طلباتك وحالتها · السريان باعتماد الإدارة</p>
        </div>
        {canRequest && !open && (
          <button
            type="button"
            onClick={() => { reset(); setOpen(true); }}
            className="inline-flex items-center gap-2 rounded-xl bg-gold px-4 py-2.5 text-sm font-bold text-background transition-opacity hover:opacity-90"
          >
            <Plus className="size-4" strokeWidth={2.4} aria-hidden />
            طلب إجازة
          </button>
        )}
        {!canRequest && (
          <span className="text-xs text-muted-foreground">المالك خارج نظام الإجازات — إدارة طلبات الفريق من ملف الموظف</span>
        )}
      </header>

      {/* ===== نموذج الطلب ===== */}
      {open && (
        <section className="glass space-y-4 rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-foreground">طلب إجازة جديد</h2>
            <button type="button" onClick={() => { setOpen(false); reset(); }} aria-label="إغلاق" className="text-muted-foreground transition-colors hover:text-foreground">
              <X className="size-5" strokeWidth={2} aria-hidden />
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-[1fr_auto_auto]">
            {/* النوع */}
            <div>
              <p className="mb-2 text-xs text-muted-foreground">نوع الإجازة</p>
              <div className="flex gap-1 rounded-xl border border-border bg-card p-1">
                {TYPES.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setType(t.key)}
                    className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${type === t.key ? "bg-secondary text-gold" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* من / إلى */}
            <label className="text-xs text-muted-foreground">
              من
              <input
                type="date" value={from} min={todayKey()} onChange={(e) => setFrom(e.target.value)} dir="ltr"
                className="mt-2 block h-10 w-40 rounded-xl border border-border bg-transparent px-3 text-sm text-foreground outline-none focus:border-ring"
              />
            </label>
            <label className="text-xs text-muted-foreground">
              إلى
              <input
                type="date" value={to} min={from || todayKey()} onChange={(e) => setTo(e.target.value)} dir="ltr"
                className="mt-2 block h-10 w-40 rounded-xl border border-border bg-transparent px-3 text-sm text-foreground outline-none focus:border-ring"
              />
            </label>
          </div>

          {days !== null && (
            <p className="text-sm text-muted-foreground">
              المدة: <span className="text-foreground" style={ZAIN}>{toArabicDigits(days)}</span> {dayWord(days)}
            </p>
          )}

          <label className="block text-xs text-muted-foreground">
            السبب
            <textarea
              value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="اكتب سبب الإجازة"
              className="mt-2 w-full resize-none rounded-xl border border-border bg-transparent p-3 text-sm text-foreground outline-none focus:border-ring"
            />
          </label>

          {error && <p className="text-sm leading-7 text-destructive">{error}</p>}

          <div className="flex justify-end">
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => void submit()}
              className="rounded-xl bg-gold px-6 py-2.5 text-sm font-extrabold text-background transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "جاري الإرسال…" : "إرسال الطلب"}
            </button>
          </div>
        </section>
      )}

      {/* ===== جدول الطلبات ===== */}
      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
          <CalendarDays className="size-8" strokeWidth={1.5} aria-hidden />
          <span className="text-sm">ما قدّمت أي طلب إجازة بعد</span>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="crm-table min-w-[760px] text-sm">
            <thead className="bg-secondary/40 text-muted-foreground">
              <tr>
                <th>النوع</th>
                <th>من</th>
                <th>إلى</th>
                <th>الأيام</th>
                <th>السبب</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-semibold text-foreground">إجازة {TYPE_LABEL[r.type] ?? ""}</td>
                  <td className="whitespace-nowrap text-muted-foreground">{fmtDate(r.from)}</td>
                  <td className="whitespace-nowrap text-muted-foreground">{fmtDate(r.to)}</td>
                  <td>
                    <span style={ZAIN}>{toArabicDigits(r.days)}</span>
                    <span className="text-muted-foreground"> {dayWord(r.days)}</span>
                  </td>
                  <td className="max-w-72 text-muted-foreground">
                    <div className="truncate" title={r.reason}>{r.reason}</div>
                    {r.status === "REJECTED" && r.decisionNote && (
                      <div className="mt-1 text-xs text-destructive">سبب الرفض: {r.decisionNote}</div>
                    )}
                  </td>
                  <td><StatusBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
