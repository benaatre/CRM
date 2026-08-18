"use client";

import { useState } from "react";
import { CalendarDays, Check, X, Clock, XCircle } from "lucide-react";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";

/**
 * «طلبات الإجازة» — واجهة المالك على نفس مسار /m/leaves. يعرض طلبات الفريق
 * (المعلّق أولًا) مع اسم الموظف ورصيده (مشتق، للمالك فقط)، ويعتمد/يرفض عبر نفس
 * decideLeave (PATCH) — لا منطق قرار جديد بالواجهة. الهوية: توكنز الديوان.
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
  from: string;
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

const STATUS_META: Record<string, { label: string; tone: (typeof MOBILE_STATUS)[keyof typeof MOBILE_STATUS]; Icon: typeof Clock }> = {
  PENDING: { label: "معلّق", tone: MOBILE_STATUS.warning, Icon: Clock },
  APPROVED: { label: "معتمد", tone: MOBILE_STATUS.success, Icon: Check },
  REJECTED: { label: "مرفوض", tone: MOBILE_STATUS.danger, Icon: XCircle },
};

export function OwnerLeaves({ initial, balances }: { initial: OwnerLeaveRow[]; balances: Record<string, Balance> }) {
  const [rows, setRows] = useState<OwnerLeaveRow[]>(initial);
  const [bal, setBal] = useState<Record<string, Balance>>(balances);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [deduct, setDeduct] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

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

  const pendingCount = rows.filter((r) => r.status === "PENDING").length;

  return (
    <div className="m-screen flex flex-col" style={{ gap: 13 }}>
      <div className="flex items-center justify-between" style={{ padding: "0 2px" }}>
        <h1 style={{ fontSize: 21, fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>طلبات الإجازة</h1>
        {pendingCount > 0 && (
          <span style={{ ...ZAIN, background: MOBILE_STATUS.warning.bg, color: MOBILE_STATUS.warning.fg, border: `1px solid ${MOBILE_STATUS.warning.border}`, borderRadius: 99, padding: "4px 11px", fontSize: 11, fontWeight: 700 }}>
            {toArabicDigits(pendingCount)} بانتظارك
          </span>
        )}
      </div>

      {error && <p style={{ fontSize: 11.5, color: MOBILE_STATUS.danger.base, padding: "0 2px" }}>{error}</p>}

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center" style={{ gap: 10, padding: "40px 0", color: MOBILE_COLORS.textMuted }}>
          <CalendarDays size={30} strokeWidth={1.5} aria-hidden />
          <span style={{ fontSize: 12.5 }}>ما فيه طلبات إجازة</span>
        </div>
      ) : (
        <div className="flex flex-col" style={{ gap: 9 }}>
          {rows.map((r) => {
            const s = STATUS_META[r.status] ?? STATUS_META.PENDING;
            const S = s.Icon;
            const b = bal[r.userId];
            const pending = r.status === "PENDING";
            const busy = busyId === r.id;
            return (
              <div key={r.id} style={{ background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`, borderRadius: 14, padding: 13 }} className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>{r.userName}</span>
                  <span className="flex flex-none items-center gap-1.5" style={{ background: s.tone.bg, color: s.tone.fg, border: `1px solid ${s.tone.border}`, borderRadius: 99, padding: "3px 10px", fontSize: 10.5, fontWeight: 700 }}>
                    <S size={12} strokeWidth={2.2} aria-hidden />
                    {s.label}
                  </span>
                </div>
                <div style={{ fontSize: 11.5, color: MOBILE_COLORS.textSecondary, lineHeight: 1.9 }}>
                  إجازة {TYPE_LABEL[r.type] ?? ""} · من {fmtDate(r.from)} إلى {fmtDate(r.to)}
                  <span style={{ color: MOBILE_COLORS.textMuted }}> · </span>
                  <span style={ZAIN}>{toArabicDigits(r.days)}</span> {r.days === 1 ? "يوم" : r.days === 2 ? "يومان" : "أيام"}
                </div>
                {r.reason && <div style={{ fontSize: 11, color: MOBILE_COLORS.textMuted, lineHeight: 1.8 }}>{r.reason}</div>}

                {/* رصيده — للمالك فقط */}
                {b && (
                  <div style={{ fontSize: 10.5, color: MOBILE_COLORS.gold, lineHeight: 1.7 }}>
                    رصيده: مستخدَم <span style={ZAIN}>{toArabicDigits(b.usedDays)}</span> · متبقٍ <span style={ZAIN}>{toArabicDigits(b.remainingDays)}</span> من <span style={ZAIN}>{toArabicDigits(b.entitledDays)}</span>
                  </div>
                )}

                {r.status === "REJECTED" && r.decisionNote && (
                  <div style={{ fontSize: 11, color: MOBILE_STATUS.danger.fg, background: MOBILE_STATUS.danger.bg, border: `1px solid ${MOBILE_STATUS.danger.border}`, borderRadius: 9, padding: "7px 10px", lineHeight: 1.8 }}>
                    ملاحظة الرفض: {r.decisionNote}
                  </div>
                )}

                {/* إجراءات — للمعلّق فقط */}
                {pending && (
                  <div className="flex flex-col gap-2" style={{ marginTop: 2 }}>
                    <label className="flex items-center gap-2" style={{ fontSize: 11, color: MOBILE_COLORS.textSecondary }}>
                      <input type="checkbox" checked={isDeduct(r.id)} onChange={(e) => setDeduct((m) => ({ ...m, [r.id]: e.target.checked }))} className="size-4 accent-[var(--m-gold)]" />
                      خصم من رصيده
                    </label>

                    {rejectId === r.id ? (
                      <>
                        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="ملاحظة الرفض (اختيارية)"
                          style={{ width: "100%", borderRadius: 10, border: `1px solid ${MOBILE_COLORS.border}`, background: "transparent", color: MOBILE_COLORS.textPrimary, padding: "8px 10px", fontSize: 12, resize: "none" }} />
                        <div className="flex gap-2">
                          <button type="button" disabled={busy} onClick={() => void decide(r.id, false)}
                            style={{ flex: 1, minHeight: 40, borderRadius: 11, border: `1px solid ${MOBILE_STATUS.danger.border}`, background: MOBILE_STATUS.danger.bg, color: MOBILE_STATUS.danger.fg, fontSize: 12.5, fontWeight: 700, opacity: busy ? 0.5 : 1 }}>
                            {busy ? "..." : "تأكيد الرفض"}
                          </button>
                          <button type="button" onClick={() => { setRejectId(null); setNote(""); }}
                            style={{ minHeight: 40, borderRadius: 11, border: `1px solid ${MOBILE_COLORS.border}`, background: "transparent", color: MOBILE_COLORS.textMuted, fontSize: 12.5, fontWeight: 600, padding: "0 14px" }}>
                            إلغاء
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="flex gap-2">
                        <button type="button" disabled={busy} onClick={() => void decide(r.id, true)}
                          className="flex items-center justify-center gap-1.5"
                          style={{ flex: 1, minHeight: 40, borderRadius: 11, border: 0, background: MOBILE_STATUS.success.base, color: "#0A0A0B", fontSize: 12.5, fontWeight: 800, opacity: busy ? 0.5 : 1 }}>
                          <Check size={14} strokeWidth={2.6} aria-hidden />
                          {busy ? "جاري…" : "اعتماد"}
                        </button>
                        <button type="button" disabled={busy} onClick={() => { setRejectId(r.id); setNote(""); }}
                          className="flex items-center justify-center gap-1.5"
                          style={{ minHeight: 40, borderRadius: 11, border: `1px solid ${MOBILE_STATUS.danger.border}`, background: MOBILE_STATUS.danger.bg, color: MOBILE_STATUS.danger.fg, fontSize: 12.5, fontWeight: 700, padding: "0 16px" }}>
                          <X size={14} strokeWidth={2.6} aria-hidden />
                          رفض
                        </button>
                      </div>
                    )}
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
