"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import type { FollowUpType, FollowUpResult, LeadStage } from "@prisma/client";
import { followUpResultLabels } from "@/lib/labels";
import { formatDate, timeAgo } from "@/lib/format";

type Item = {
  id: string; type: FollowUpType; result: FollowUpResult;
  note: string | null; nextDate: string | null; createdAt: string; employeeName: string | null;
};

// خيار «وش صار في المتابعة؟» — book=true يفتح نموذج الحجز بدل حفظ متابعة.
type Suggestion = { label: string; type?: FollowUpType; result?: FollowUpResult; needsDate?: boolean; book?: boolean };

// أسباب «غير مهتم» (اختيار متعدد — اختياري، تُحفظ في الملاحظة).
const NOT_INTERESTED_REASONS = ["سعر غير مناسب", "المساحات", "الموقع", "غير مهتم نهائيًا"];

// الخيارات الذكية حسب المرحلة الحالية. «غير مهتم» (CLOSED_LOST) له فورم خاص.
function suggestionsFor(stage: LeadStage): Suggestion[] {
  switch (stage) {
    case "NEW":
    case "ATTEMPTED":
    case "FOLLOW_UP_LATER":
      return [
        { label: "تم التواصل — مهتم", type: "CALL", result: "INTERESTED_SENT_INFO" },
        { label: "تم التواصل — غير مهتم", type: "CALL", result: "NOT_INTERESTED_FINAL" },
        { label: "لم يرد — جدّل محاولة أخرى", type: "CALL", result: "NOT_ANSWERED_SCHEDULED", needsDate: true },
        { label: "لم يرد — أُرسلت رسالة واتساب", type: "WHATSAPP", result: "NOT_ANSWERED_WHATSAPP" },
      ];
    case "INTERESTED":
      return [
        { label: "جُدّلت زيارة للمشروع", type: "VISIT_PROJECT", result: "INTERESTED_SCHEDULED", needsDate: true },
        { label: "أُرسلت تفاصيل المشاريع واتساب", type: "WHATSAPP", result: "INTERESTED_SENT_INFO" },
        { label: "زار المشروع — انتقل للتفاوض", type: "VISIT_PROJECT", result: "NEGOTIATING" },
        { label: "زار المشروع — سيستخير", type: "VISIT_PROJECT", result: "FOLLOW_UP_SCHEDULED", needsDate: true },
        { label: "زار المشروع — لم يناسبه — جرّب مشاريع أخرى", type: "VISIT_PROJECT", result: "NEGOTIATING" },
      ];
    case "VIEWING":
      return [
        { label: "انتقل للتفاوض", type: "CALL", result: "NEGOTIATING" },
        { label: "سيستخير — جدّل متابعة", type: "CALL", result: "FOLLOW_UP_SCHEDULED", needsDate: true },
        { label: "لم يناسبه — جرّب مشاريع أخرى", type: "CALL", result: "NEGOTIATING" },
        { label: "لم يناسبه نهائيًا", type: "CALL", result: "NOT_INTERESTED_FINAL" },
      ];
    case "NEGOTIATION":
    case "RESERVED":
      return [
        { label: "تم الحجز", book: true },
        { label: "سيستخير — جدّل متابعة", type: "CALL", result: "FOLLOW_UP_SCHEDULED", needsDate: true },
        { label: "لم يناسبه — جرّب مشاريع أخرى", type: "CALL", result: "NEGOTIATING" },
        { label: "لم يناسبه نهائيًا", type: "CALL", result: "NOT_INTERESTED_FINAL" },
      ];
    default:
      return [
        { label: "تم التواصل — مهتم", type: "CALL", result: "INTERESTED_SENT_INFO" },
        { label: "لم يرد — جدّل محاولة أخرى", type: "CALL", result: "NOT_ANSWERED_SCHEDULED", needsDate: true },
        { label: "لم يرد — أُرسلت رسالة واتساب", type: "WHATSAPP", result: "NOT_ANSWERED_WHATSAPP" },
      ];
  }
}

export function FollowUpsPanel({
  leadId, stage, onChanged, onBook, readOnly = false,
}: {
  leadId: string;
  stage: LeadStage;
  onChanged?: () => void;
  onBook?: () => void;
  readOnly?: boolean;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [sel, setSel] = useState<Suggestion | null>(null);
  const [note, setNote] = useState("");
  const [date, setDate] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // فورم «غير مهتم» (يظهر تلقائيًا لمّا تكون المرحلة = غير مهتم)
  const [reasons, setReasons] = useState<Set<string>>(new Set());
  const [niRetry, setNiRetry] = useState<"yes" | "no">("no");
  const [niRetryDate, setNiRetryDate] = useState("");

  const isNotInterested = stage === "CLOSED_LOST";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/leads/${leadId}/followups`);
      const data = await res.json();
      if (res.ok) setItems(data.items ?? []);
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => { load(); }, [load]);

  const suggestions = suggestionsFor(stage);

  function resetForm() {
    setShowForm(false); setSel(null); setNote(""); setDate("");
    setReasons(new Set()); setNiRetry("no"); setNiRetryDate(""); setError(null);
  }

  function post(body: Record<string, unknown>) {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/leads/${leadId}/followups`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setError(data?.error ?? "صار خطأ"); return; }
      resetForm();
      await load();
      onChanged?.();
    });
  }

  function composeNote(label: string, extra: string) {
    return [label, extra.trim()].filter(Boolean).join(" — ");
  }

  function submitQuick() {
    if (!sel || !sel.result || !sel.type) return;
    post({
      type: sel.type, result: sel.result,
      note: composeNote(sel.label, note),
      nextDate: sel.needsDate && date ? date : undefined,
    });
  }

  function submitNotInterested() {
    const parts: string[] = [];
    if (reasons.size) parts.push(`الأسباب: ${[...reasons].join("، ")}`);
    if (note.trim()) parts.push(note.trim());
    const finalNote = parts.join(" — ") || undefined;
    // وعد بمعاودة → موعد لاحق؛ غير ذلك → غير مهتم نهائيًا.
    const result: FollowUpResult = niRetry === "yes" ? "FOLLOW_UP_SCHEDULED" : "NOT_INTERESTED_FINAL";
    const nextDate = niRetry === "yes" && niRetryDate ? niRetryDate : undefined;
    post({ type: "CALL", result, note: finalNote, nextDate });
  }

  function toggleReason(r: string) {
    setReasons((s) => { const n = new Set(s); n.has(r) ? n.delete(r) : n.add(r); return n; });
  }

  return (
    <div className="space-y-4">
      {readOnly ? (
        <div className="rounded-xl border border-success/30 bg-success/5 px-4 py-3 text-center text-sm text-success">تم الحجز — توقّفت المتابعات</div>
      ) : !showForm ? (
        <button onClick={() => setShowForm(true)} className="w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90">
          أضف متابعة
        </button>
      ) : isNotInterested ? (
        // ===== فورم «غير مهتم» =====
        <div className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
          <div className="text-sm font-medium text-foreground">السبب (اختياري — تقدر تختار أكثر من واحد)</div>
          <div className="grid grid-cols-2 gap-2">
            {NOT_INTERESTED_REASONS.map((r) => {
              const active = reasons.has(r);
              return (
                <button key={r} type="button" onClick={() => toggleReason(r)} className={`rounded-lg border px-2.5 py-2 text-xs transition-colors ${active ? "border-destructive bg-destructive/10 text-destructive" : "border-border text-muted-foreground hover:text-foreground"}`}>
                  {r}
                </button>
              );
            })}
          </div>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="ملاحظة (اختياري)…" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-gold" />
          <div className="space-y-2">
            <span className="text-xs text-muted-foreground">نحاول معه بعد فترة؟</span>
            <div className="flex gap-2">
              <button type="button" onClick={() => setNiRetry("yes")} className={`flex-1 rounded-lg border px-2.5 py-1.5 text-xs ${niRetry === "yes" ? "border-gold bg-gold/15 text-gold" : "border-border text-muted-foreground"}`}>نعم</button>
              <button type="button" onClick={() => setNiRetry("no")} className={`flex-1 rounded-lg border px-2.5 py-1.5 text-xs ${niRetry === "no" ? "border-gold bg-gold/15 text-gold" : "border-border text-muted-foreground"}`}>لا</button>
            </div>
            {niRetry === "yes" && (
              <input type="datetime-local" value={niRetryDate} onChange={(e) => setNiRetryDate(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-gold" />
            )}
          </div>
          {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={resetForm} className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground">إلغاء</button>
            <button type="button" onClick={submitNotInterested} disabled={pending} className="rounded-lg bg-destructive px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
              {pending ? "جارٍ…" : "حفظ"}
            </button>
          </div>
        </div>
      ) : (
        // ===== خيارات ذكية حسب المرحلة =====
        <div className="space-y-3 rounded-xl border border-gold/30 bg-gold/5 p-3">
          <div className="text-sm font-medium text-foreground">وش صار في المتابعة؟</div>
          <div className="grid grid-cols-1 gap-2">
            {suggestions.map((s) => {
              if (s.book) {
                if (!onBook) return null;
                return (
                  <button key={s.label} type="button" onClick={() => { onBook(); resetForm(); }} className="rounded-lg border border-success/40 bg-success/10 px-2.5 py-2 text-right text-xs font-medium text-success hover:bg-success/20">
                    {s.label}
                  </button>
                );
              }
              const active = sel?.label === s.label;
              return (
                <button key={s.label} type="button" onClick={() => setSel(s)} className={`rounded-lg border px-2.5 py-2 text-right text-xs transition-colors ${active ? "border-gold bg-gold/15 text-gold" : "border-border text-muted-foreground hover:text-foreground"}`}>
                  {s.label}
                </button>
              );
            })}
          </div>
          {sel?.needsDate && (
            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">التاريخ القادم</span>
              <input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-gold" />
            </label>
          )}
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="ملاحظة (اختياري)…" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-gold" />
          {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={resetForm} className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground">إلغاء</button>
            <button type="button" onClick={submitQuick} disabled={pending || !sel || !!sel.book} className="rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">
              {pending ? "جارٍ…" : "حفظ المتابعة"}
            </button>
          </div>
        </div>
      )}

      {/* Timeline تصاعدي */}
      <div>
        <div className="mb-3 text-sm font-medium text-foreground">سجل المتابعات ({items.length})</div>
        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">جارٍ التحميل…</p>
        ) : items.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">ما فيه متابعات بعد.</p>
        ) : (
          <ol className="space-y-4 border-r border-border pr-4">
            {items.map((f) => (
              <li key={f.id} className="relative">
                <span className={`absolute -right-[1.30rem] top-1.5 size-2 rounded-full ${f.result === "BOOKED" ? "bg-success" : f.result.startsWith("NOT_INTERESTED") ? "bg-destructive" : "bg-gold"}`} />
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">{f.note || followUpResultLabels[f.result]}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(f.createdAt)}</span>
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">{formatDate(f.createdAt)}</div>
                {f.nextDate && <p className="mt-0.5 text-xs text-info">الخطوة القادمة: {formatDate(f.nextDate)}</p>}
                {f.employeeName && <p className="mt-0.5 text-xs text-muted-foreground/70">{f.employeeName}</p>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
