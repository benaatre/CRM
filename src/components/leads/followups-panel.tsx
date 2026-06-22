"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import type { FollowUpType, FollowUpResult, LeadStage } from "@prisma/client";
import { followUpTypeLabels, followUpResultLabels } from "@/lib/labels";
import { formatDate, timeAgo } from "@/lib/format";

type Item = {
  id: string; type: FollowUpType; result: FollowUpResult;
  note: string | null; nextDate: string | null; createdAt: string; employeeName: string | null;
};

type Suggestion = { label: string; type: FollowUpType; result: FollowUpResult; needsDate?: boolean };

// أسباب «غير مهتم / لم يناسبه» (إجباري اختيار واحد).
const NOT_INTERESTED_REASONS: { label: string; result: FollowUpResult }[] = [
  { label: "سعر غير مناسب", result: "NOT_INTERESTED_PRICE" },
  { label: "المساحات", result: "NOT_INTERESTED_SPACE" },
  { label: "الموقع", result: "NOT_INTERESTED_LOCATION" },
  { label: "غير مهتم نهائيًا", result: "NOT_INTERESTED_FINAL" },
];

// اقتراحات ذكية حسب المرحلة الحالية (بدون «غير مهتم» — له فورم خاص).
function suggestionsFor(stage: LeadStage): Suggestion[] {
  switch (stage) {
    case "INTERESTED":
      return [
        { label: "جدول موعد مكالمة", type: "CALL", result: "INTERESTED_SCHEDULED", needsDate: true },
        { label: "إرسال واتساب", type: "WHATSAPP", result: "INTERESTED_SENT_INFO" },
        { label: "زيارة المشروع", type: "VISIT_PROJECT", result: "INTERESTED_VISITED", needsDate: true },
        { label: "زيارة الشركة", type: "VISIT_OFFICE", result: "INTERESTED_VISITED", needsDate: true },
      ];
    case "NEW":
    case "ATTEMPTED":
    case "FOLLOW_UP_LATER":
      return [
        { label: "جدول محاولة لاحقة", type: "CALL", result: "NOT_ANSWERED_SCHEDULED", needsDate: true },
        { label: "إرسال واتساب", type: "WHATSAPP", result: "NOT_ANSWERED_WHATSAPP" },
        { label: "ردّ وصار مهتم", type: "CALL", result: "INTERESTED_SCHEDULED", needsDate: true },
      ];
    case "VIEWING":
    case "NEGOTIATION":
    case "RESERVED":
      return [
        { label: "مناسب — تم الحجز", type: "OTHER", result: "BOOKED" },
        { label: "يبحث عن مشاريع أخرى", type: "CALL", result: "NEGOTIATING" },
      ];
    case "CLOSED_LOST":
      return [
        { label: "إعادة إحياء — مهتم", type: "CALL", result: "INTERESTED_SCHEDULED", needsDate: true },
      ];
    default:
      return [
        { label: "اتصال", type: "CALL", result: "NOT_ANSWERED_SCHEDULED", needsDate: true },
        { label: "واتساب", type: "WHATSAPP", result: "NOT_ANSWERED_WHATSAPP" },
      ];
  }
}

export function FollowUpsPanel({ leadId, stage, onChanged, readOnly = false }: { leadId: string; stage: LeadStage; onChanged?: () => void; readOnly?: boolean }) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [mode, setMode] = useState<"quick" | "notInterested">("quick");
  const [sel, setSel] = useState<Suggestion | null>(null);
  const [note, setNote] = useState("");
  const [date, setDate] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // حقول فورم «غير مهتم»
  const [niReason, setNiReason] = useState<FollowUpResult | "">("");
  const [niLocation, setNiLocation] = useState("");
  const [niRetry, setNiRetry] = useState<"yes" | "no">("no");
  const [niRetryDate, setNiRetryDate] = useState("");

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
    setShowForm(false); setMode("quick"); setSel(null); setNote(""); setDate("");
    setNiReason(""); setNiLocation(""); setNiRetry("no"); setNiRetryDate(""); setError(null);
  }

  function submitQuick() {
    if (!sel) return;
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/leads/${leadId}/followups`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: sel.type, result: sel.result, note: note || undefined, nextDate: sel.needsDate && date ? date : undefined }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data?.error ?? "صار خطأ"); return; }
      resetForm();
      await load();
      onChanged?.();
    });
  }

  function submitNotInterested() {
    if (!niReason) { setError("اختر سبب عدم الاهتمام"); return; }
    setError(null);
    const parts: string[] = [];
    if (niLocation.trim()) parts.push(`الحي/الموقع المرغوب: ${niLocation.trim()}`);
    if (note.trim()) parts.push(note.trim());
    const finalNote = parts.join(" — ") || undefined;
    const nextDate = niRetry === "yes" && niRetryDate ? niRetryDate : undefined;
    startTransition(async () => {
      const res = await fetch(`/api/leads/${leadId}/followups`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "CALL", result: niReason, note: finalNote, nextDate }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data?.error ?? "صار خطأ"); return; }
      resetForm();
      await load();
      onChanged?.();
    });
  }

  return (
    <div className="space-y-4">
      {readOnly ? (
        <div className="rounded-xl border border-success/30 bg-success/5 px-4 py-3 text-center text-sm text-success">تم الحجز — توقّفت المتابعات</div>
      ) : !showForm ? (
        <button onClick={() => setShowForm(true)} className="w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90">
          أضف متابعة
        </button>
      ) : (
        <div className="space-y-3 rounded-xl border border-gold/30 bg-gold/5 p-3">
          {/* تبديل بين متابعة عادية و«غير مهتم» */}
          <div className="flex gap-2">
            <button type="button" onClick={() => { setMode("quick"); setSel(null); setError(null); }} className={`flex-1 rounded-lg border px-2.5 py-1.5 text-xs ${mode === "quick" ? "border-gold bg-gold/15 text-gold" : "border-border text-muted-foreground hover:text-foreground"}`}>متابعة</button>
            <button type="button" onClick={() => { setMode("notInterested"); setSel(null); setError(null); }} className={`flex-1 rounded-lg border px-2.5 py-1.5 text-xs ${mode === "notInterested" ? "border-destructive bg-destructive/10 text-destructive" : "border-border text-muted-foreground hover:text-foreground"}`}>غير مهتم / لم يناسبه</button>
          </div>

          {mode === "quick" ? (
            <>
              <div className="text-sm font-medium text-foreground">وش صار في المتابعة؟</div>
              <div className="grid grid-cols-2 gap-2">
                {suggestions.map((s) => {
                  const active = sel?.label === s.label;
                  return (
                    <button key={s.label} type="button" onClick={() => setSel(s)} className={`rounded-lg border px-2.5 py-2 text-xs transition-colors ${active ? "border-gold bg-gold/15 text-gold" : "border-border text-muted-foreground hover:text-foreground"}`}>
                      {s.label}
                    </button>
                  );
                })}
              </div>
              {sel?.needsDate && (
                <label className="block space-y-1">
                  <span className="text-xs text-muted-foreground">الموعد القادم</span>
                  <input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-gold" />
                </label>
              )}
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="ملاحظة (اختياري)…" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-gold" />
              {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={resetForm} className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground">إلغاء</button>
                <button type="button" onClick={submitQuick} disabled={pending || !sel} className="rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">
                  {pending ? "جارٍ…" : "حفظ المتابعة"}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="text-sm font-medium text-foreground">السبب (إجباري)</div>
              <div className="grid grid-cols-2 gap-2">
                {NOT_INTERESTED_REASONS.map((r) => {
                  const active = niReason === r.result;
                  return (
                    <button key={r.result} type="button" onClick={() => setNiReason(r.result)} className={`rounded-lg border px-2.5 py-2 text-xs transition-colors ${active ? "border-destructive bg-destructive/10 text-destructive" : "border-border text-muted-foreground hover:text-foreground"}`}>
                      {r.label}
                    </button>
                  );
                })}
              </div>
              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">الحي أو الموقع اللي يريده (اختياري)</span>
                <input value={niLocation} onChange={(e) => setNiLocation(e.target.value)} placeholder="مثال: حي الياسمين…" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-gold" />
              </label>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="ملاحظات (اختياري)…" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-gold" />
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
                <button type="button" onClick={submitNotInterested} disabled={pending || !niReason} className="rounded-lg bg-destructive px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                  {pending ? "جارٍ…" : "حفظ"}
                </button>
              </div>
            </>
          )}
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
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">{followUpTypeLabels[f.type]}</span>
                  <span className="text-xs text-muted-foreground">{timeAgo(f.createdAt)}</span>
                </div>
                <div className="text-xs text-gold">{followUpResultLabels[f.result]}</div>
                {f.note && <p className="mt-0.5 text-sm text-muted-foreground">{f.note}</p>}
                {f.nextDate && <p className="mt-0.5 text-xs text-info">الموعد القادم: {formatDate(f.nextDate)}</p>}
                {f.employeeName && <p className="mt-0.5 text-xs text-muted-foreground/70">{f.employeeName}</p>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
