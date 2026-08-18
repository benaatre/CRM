"use client";

import { useState } from "react";
import { CalendarDays, Plus, X, Clock, Check, XCircle } from "lucide-react";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";

/**
 * «إجازاتي» — شاشة الموظف: زر طلب + نموذج (نوع/من/إلى/سبب مع عدّ الأيام) + قائمة
 * الطلبات بحالاتها. **ممنوع عرض أي رصيد/متبقٍ/مستخدَم** — الرصيد للمالك فقط (م٤).
 * الهوية: توكنز الديوان (/m)، أرقام عربية شرقية Zain، أيقونات SVG بلا إيموجي، RTL.
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

const STATUS_META: Record<string, { label: string; tone: (typeof MOBILE_STATUS)[keyof typeof MOBILE_STATUS]; Icon: typeof Clock }> = {
  PENDING: { label: "معلّق", tone: MOBILE_STATUS.warning, Icon: Clock },
  APPROVED: { label: "معتمد", tone: MOBILE_STATUS.success, Icon: Check },
  REJECTED: { label: "مرفوض", tone: MOBILE_STATUS.danger, Icon: XCircle },
};

export function MyLeaves({ initial, openNew = false }: { initial: LeaveRow[]; openNew?: boolean }) {
  const [rows, setRows] = useState<LeaveRow[]>(initial);
  const [open, setOpen] = useState(openNew);
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
      const d = (await res.json()) as { ok: boolean; requests?: LeaveRow[] };
      if (d.ok && d.requests) {
        setRows(
          d.requests.map((r: unknown) => {
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

  return (
    <div className="m-screen flex flex-col" style={{ gap: 13 }}>
      <div className="flex items-center justify-between" style={{ padding: "0 2px" }}>
        <h1 style={{ fontSize: 21, fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>إجازاتي</h1>
        {!open && (
          <button
            type="button"
            onClick={() => { reset(); setOpen(true); }}
            className="flex items-center gap-1.5"
            style={{ background: MOBILE_COLORS.gold, color: "var(--m-on-gold, #0A0A0B)", border: 0, borderRadius: 12, padding: "9px 14px", fontSize: 12.5, fontWeight: 700 }}
          >
            <Plus size={15} strokeWidth={2.4} aria-hidden />
            طلب إجازة
          </button>
        )}
      </div>

      {/* ===== النموذج ===== */}
      {open && (
        <div style={{ background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`, borderRadius: 16, padding: 15 }} className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span style={{ fontSize: 13.5, fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>طلب إجازة جديد</span>
            <button type="button" onClick={() => { setOpen(false); reset(); }} aria-label="إغلاق" style={{ background: "transparent", border: 0, color: MOBILE_COLORS.textMuted }}>
              <X size={18} strokeWidth={2} aria-hidden />
            </button>
          </div>

          {/* النوع */}
          <div>
            <p style={{ fontSize: 10.5, color: MOBILE_COLORS.textMuted, marginBottom: 7 }}>نوع الإجازة</p>
            <div className="flex gap-1.5">
              {TYPES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setType(t.key)}
                  style={{
                    flex: 1, minHeight: 38, borderRadius: 10, fontSize: 12, fontWeight: 600,
                    border: `1px solid ${type === t.key ? MOBILE_COLORS.goldBorder : MOBILE_COLORS.border}`,
                    background: type === t.key ? MOBILE_COLORS.goldBg : "transparent",
                    color: type === t.key ? MOBILE_COLORS.gold : MOBILE_COLORS.textMuted,
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* من / إلى */}
          <div className="flex gap-2">
            <label className="flex-1" style={{ fontSize: 10.5, color: MOBILE_COLORS.textMuted }}>
              من
              <input type="date" value={from} min={todayKey()} onChange={(e) => setFrom(e.target.value)} dir="ltr"
                style={{ marginTop: 5, height: 40, width: "100%", borderRadius: 10, border: `1px solid ${MOBILE_COLORS.border}`, background: "transparent", color: MOBILE_COLORS.textPrimary, padding: "0 10px", fontSize: 12.5 }} />
            </label>
            <label className="flex-1" style={{ fontSize: 10.5, color: MOBILE_COLORS.textMuted }}>
              إلى
              <input type="date" value={to} min={from || todayKey()} onChange={(e) => setTo(e.target.value)} dir="ltr"
                style={{ marginTop: 5, height: 40, width: "100%", borderRadius: 10, border: `1px solid ${MOBILE_COLORS.border}`, background: "transparent", color: MOBILE_COLORS.textPrimary, padding: "0 10px", fontSize: 12.5 }} />
            </label>
          </div>
          {days !== null && (
            <p style={{ fontSize: 11.5, color: MOBILE_COLORS.textSecondary }}>
              المدة: <span style={ZAIN}>{toArabicDigits(days)}</span> {days === 1 ? "يوم" : days === 2 ? "يومان" : "أيام"}
            </p>
          )}

          {/* السبب */}
          <label style={{ fontSize: 10.5, color: MOBILE_COLORS.textMuted }}>
            السبب
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="اكتب سبب الإجازة"
              style={{ marginTop: 5, width: "100%", borderRadius: 10, border: `1px solid ${MOBILE_COLORS.border}`, background: "transparent", color: MOBILE_COLORS.textPrimary, padding: "9px 10px", fontSize: 12.5, resize: "none" }} />
          </label>

          {error && <p style={{ fontSize: 11.5, color: MOBILE_STATUS.danger.base, lineHeight: 1.8 }}>{error}</p>}

          <button
            type="button"
            disabled={busy || !from || !to || !reason.trim()}
            onClick={() => void submit()}
            style={{ minHeight: 44, borderRadius: 12, border: 0, background: MOBILE_COLORS.gold, color: "var(--m-on-gold, #0A0A0B)", fontSize: 13.5, fontWeight: 800, opacity: busy || !from || !to || !reason.trim() ? 0.5 : 1 }}
          >
            {busy ? "جاري الإرسال…" : "إرسال الطلب"}
          </button>
        </div>
      )}

      {/* ===== قائمة الطلبات ===== */}
      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center" style={{ gap: 10, padding: "40px 0", color: MOBILE_COLORS.textMuted }}>
          <CalendarDays size={30} strokeWidth={1.5} aria-hidden />
          <span style={{ fontSize: 12.5 }}>ما قدّمت أي طلب إجازة بعد</span>
        </div>
      ) : (
        <div className="flex flex-col" style={{ gap: 9 }}>
          {rows.map((r) => {
            const s = STATUS_META[r.status] ?? STATUS_META.PENDING;
            const S = s.Icon;
            return (
              <div key={r.id} style={{ background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`, borderRadius: 14, padding: 13 }} className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>
                    إجازة {TYPE_LABEL[r.type] ?? ""}
                  </span>
                  <span className="flex flex-none items-center gap-1.5" style={{ background: s.tone.bg, color: s.tone.fg, border: `1px solid ${s.tone.border}`, borderRadius: 99, padding: "3px 10px", fontSize: 10.5, fontWeight: 700 }}>
                    <S size={12} strokeWidth={2.2} aria-hidden />
                    {s.label}
                  </span>
                </div>
                <div style={{ fontSize: 11.5, color: MOBILE_COLORS.textSecondary, lineHeight: 1.9 }}>
                  من {fmtDate(r.from)} إلى {fmtDate(r.to)}
                  <span style={{ color: MOBILE_COLORS.textMuted }}> · </span>
                  <span style={ZAIN}>{toArabicDigits(r.days)}</span> {r.days === 1 ? "يوم" : r.days === 2 ? "يومان" : "أيام"}
                </div>
                {r.reason && <div style={{ fontSize: 11, color: MOBILE_COLORS.textMuted, lineHeight: 1.8 }}>{r.reason}</div>}
                {r.status === "REJECTED" && r.decisionNote && (
                  <div style={{ fontSize: 11, color: MOBILE_STATUS.danger.fg, background: MOBILE_STATUS.danger.bg, border: `1px solid ${MOBILE_STATUS.danger.border}`, borderRadius: 9, padding: "7px 10px", lineHeight: 1.8 }}>
                    سبب الرفض: {r.decisionNote}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
