"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";
import { BottomSheet } from "@/components/mobile/bottom-sheet";

/**
 * ورقة «تعديل المتابعة» — واجهة على PATCH /api/leads/[id]/followups القائم حرفيًا:
 * الملاحظة والموعد فقط (النتيجة ما تتعدّل — قاعدة الخادم)، ضمن نافذة ٦٠ دقيقة
 * من الإنشاء لصاحبها. العدّاد «متاح X دقيقة» ينقص بالدقيقة (مع cleanup) ويقفل
 * الورقة عند انتهاء النافذة — والخادم يبقى خط الدفاع.
 */

const MIN = 60_000;
const EDIT_WINDOW_MIN = 60;

function toParts(d: Date | null): { date: string; time: string } {
  if (!d) return { date: "", time: "" };
  const p = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    time: `${p(d.getHours())}:${p(d.getMinutes())}`,
  };
}

/** الدقائق المتبقية من نافذة التعديل — سالبها يعني انتهت. */
export function editMinutesLeft(createdAt: Date, nowMs: number): number {
  return EDIT_WINDOW_MIN - Math.floor((nowMs - createdAt.getTime()) / MIN);
}

export function EditFollowupSheet({
  open, onClose, leadId, followupId, initialNote, initialDate, createdAt,
}: {
  open: boolean;
  onClose: () => void;
  leadId: string;
  followupId: string;
  initialNote: string | null;
  initialDate: Date | null;
  createdAt: Date;
}) {
  const router = useRouter();
  const [note, setNote] = useState(initialNote ?? "");
  const [dateOnly, setDateOnly] = useState(() => toParts(initialDate).date);
  const [timeOnly, setTimeOnly] = useState(() => toParts(initialDate).time);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // عدّاد الدقيقة — يقفل الورقة بانتهاء النافذة (الخادم يرفض بعدها بأي حال).
  useEffect(() => {
    if (!open) return;
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), MIN);
    return () => clearInterval(t);
  }, [open]);

  // إعادة تعبئة القيم عند فتح الورقة على متابعة مختلفة.
  useEffect(() => {
    if (open) {
      setNote(initialNote ?? "");
      const p = toParts(initialDate);
      setDateOnly(p.date);
      setTimeOnly(p.time);
      setError(null);
    }
  }, [open, followupId, initialNote, initialDate]);

  const left = editMinutesLeft(createdAt, nowMs);

  async function save() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/followups`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          followupId,
          note,
          // غياب المفتاح = «لا تلمسه» (قاعدة PATCH) — نرسل null لمسح الموعد صراحةً.
          nextDate: dateOnly ? `${dateOnly}T${timeOnly || "10:00"}` : null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error ?? "صار خطأ"); return; }
      onClose();
      router.refresh();
    } catch {
      setError("ما وصلنا للخادم — تحقق من الإنترنت وحاول مرة ثانية");
    } finally {
      setPending(false);
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="تعديل المتابعة"
      subtitle={
        left > 0
          ? `متاح ${toArabicDigits(left)} ${left === 1 ? "دقيقة" : left === 2 ? "دقيقتين" : left <= 10 ? "دقائق" : "دقيقة"} — الملاحظة والموعد فقط`
          : "انتهت مهلة التعديل (ساعة من التسجيل)"
      }
      footer={
        <button
          type="button"
          onClick={save}
          disabled={pending || left <= 0}
          className="m-press m-sweep w-full"
          style={{
            boxSizing: "border-box", height: 50, borderRadius: 13, border: "none",
            background: MOBILE_COLORS.gold, color: MOBILE_COLORS.bg,
            fontSize: 15, fontWeight: 700, opacity: pending || left <= 0 ? 0.55 : 1,
          }}
        >
          {pending ? "جارٍ الحفظ…" : left <= 0 ? "انتهت المهلة" : "حفظ التعديل"}
        </button>
      }
    >
      <div className="flex flex-col" style={{ gap: 12, marginTop: 14 }}>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="الملاحظة…"
          style={{
            boxSizing: "border-box", background: MOBILE_COLORS.bg,
            border: `1px solid ${MOBILE_COLORS.border}`, borderRadius: 14,
            padding: "12px 13px", minHeight: 84, fontSize: 13,
            color: MOBILE_COLORS.textPrimary, resize: "vertical", outline: "none",
          }}
        />
        <div className="flex" style={{ gap: 8 }}>
          <label
            className="flex flex-col justify-center"
            style={{
              boxSizing: "border-box", flex: 1, minHeight: 52, gap: 3,
              background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`,
              borderRadius: 12, padding: "7px 12px",
            }}
          >
            <span style={{ fontSize: "11.5px", color: MOBILE_COLORS.textSecondary }}>📅 التاريخ</span>
            <input type="date" value={dateOnly} onChange={(e) => setDateOnly(e.target.value)}
              style={{ background: "transparent", border: "none", outline: "none", width: "100%", fontSize: 13, color: MOBILE_COLORS.textPrimary }} />
          </label>
          <label
            className="flex flex-col justify-center"
            style={{
              boxSizing: "border-box", flex: 1, minHeight: 52, gap: 3,
              background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`,
              borderRadius: 12, padding: "7px 12px",
            }}
          >
            <span style={{ fontSize: "11.5px", color: MOBILE_COLORS.textSecondary }}>🕐 الوقت</span>
            <input type="time" value={timeOnly} onChange={(e) => setTimeOnly(e.target.value)}
              style={{ background: "transparent", border: "none", outline: "none", width: "100%", fontSize: 13, color: MOBILE_COLORS.textPrimary }} />
          </label>
        </div>
        <div style={{ fontSize: 11, color: MOBILE_COLORS.textMuted }}>
          امسح التاريخ لإلغاء الموعد — النتيجة ما تتعدّل: سجّل متابعة جديدة لتغييرها.
        </div>
        {error && (
          <p style={{
            boxSizing: "border-box", borderRadius: 10, padding: "9px 12px", fontSize: "12.5px", textAlign: "center",
            background: MOBILE_STATUS.danger.bg, color: MOBILE_STATUS.danger.fg,
            border: `1px solid ${MOBILE_STATUS.danger.border}`,
          }}>{error}</p>
        )}
      </div>
    </BottomSheet>
  );
}

export default EditFollowupSheet;
