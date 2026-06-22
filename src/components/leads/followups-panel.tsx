"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Phone, MessageCircle, MapPin, Building2, Plus, Loader2, CheckCircle2, CalendarClock } from "lucide-react";
import type { FollowUpType, FollowUpResult, LeadStage } from "@prisma/client";
import { followUpTypeLabels, followUpResultLabels } from "@/lib/labels";
import { formatDate, timeAgo } from "@/lib/format";

type Item = {
  id: string; type: FollowUpType; result: FollowUpResult;
  note: string | null; nextDate: string | null; createdAt: string; employeeName: string | null;
};

type Suggestion = { label: string; type: FollowUpType; result: FollowUpResult; needsDate?: boolean; icon: typeof Phone };

// اقتراحات ذكية حسب المرحلة الحالية
function suggestionsFor(stage: LeadStage): Suggestion[] {
  switch (stage) {
    case "INTERESTED":
      return [
        { label: "جدول موعد مكالمة", type: "CALL", result: "INTERESTED_SCHEDULED", needsDate: true, icon: Phone },
        { label: "إرسال واتساب", type: "WHATSAPP", result: "INTERESTED_SENT_INFO", icon: MessageCircle },
        { label: "زيارة المشروع", type: "VISIT_PROJECT", result: "INTERESTED_VISITED", needsDate: true, icon: MapPin },
        { label: "زيارة الشركة", type: "VISIT_OFFICE", result: "INTERESTED_VISITED", needsDate: true, icon: Building2 },
      ];
    case "NEW":
    case "ATTEMPTED":
    case "FOLLOW_UP_LATER":
      return [
        { label: "جدول محاولة لاحقة", type: "CALL", result: "NOT_ANSWERED_SCHEDULED", needsDate: true, icon: CalendarClock },
        { label: "إرسال واتساب", type: "WHATSAPP", result: "NOT_ANSWERED_WHATSAPP", icon: MessageCircle },
        { label: "ردّ وصار مهتم", type: "CALL", result: "INTERESTED_SCHEDULED", needsDate: true, icon: Phone },
      ];
    case "VIEWING":
    case "NEGOTIATION":
    case "RESERVED":
      return [
        { label: "مناسب — تم الحجز", type: "OTHER", result: "BOOKED", icon: CheckCircle2 },
        { label: "يبحث عن مشاريع أخرى", type: "CALL", result: "NEGOTIATING", icon: Phone },
        { label: "لم يناسبه نهائيًا", type: "CALL", result: "NOT_INTERESTED_FINAL", icon: Phone },
      ];
    case "CLOSED_LOST":
      return [
        { label: "السبب: الموقع", type: "CALL", result: "NOT_INTERESTED_LOCATION", icon: MapPin },
        { label: "السبب: المساحة", type: "CALL", result: "NOT_INTERESTED_SPACE", icon: MapPin },
        { label: "السبب: السعر", type: "CALL", result: "NOT_INTERESTED_PRICE", icon: MapPin },
        { label: "إعادة إحياء — مهتم", type: "CALL", result: "INTERESTED_SCHEDULED", needsDate: true, icon: Phone },
      ];
    default:
      return [
        { label: "اتصال", type: "CALL", result: "NOT_ANSWERED_SCHEDULED", needsDate: true, icon: Phone },
        { label: "واتساب", type: "WHATSAPP", result: "NOT_ANSWERED_WHATSAPP", icon: MessageCircle },
      ];
  }
}

export function FollowUpsPanel({ leadId, stage, onChanged }: { leadId: string; stage: LeadStage; onChanged?: () => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [sel, setSel] = useState<Suggestion | null>(null);
  const [note, setNote] = useState("");
  const [date, setDate] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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

  function submit() {
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
      setShowForm(false); setSel(null); setNote(""); setDate("");
      await load();
      onChanged?.();
    });
  }

  return (
    <div className="space-y-4">
      {!showForm ? (
        <button onClick={() => setShowForm(true)} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90">
          <Plus className="size-4" /> أضف متابعة
        </button>
      ) : (
        <div className="space-y-3 rounded-xl border border-gold/30 bg-gold/5 p-3">
          <div className="text-sm font-medium text-foreground">وش صار في المتابعة؟</div>
          <div className="grid grid-cols-2 gap-2">
            {suggestions.map((s) => {
              const Icon = s.icon;
              const active = sel?.label === s.label;
              return (
                <button key={s.label} type="button" onClick={() => setSel(s)} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs transition-colors ${active ? "border-gold bg-gold/15 text-gold" : "border-border text-muted-foreground hover:text-foreground"}`}>
                  <Icon className="size-3.5 shrink-0" /> {s.label}
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
            <button type="button" onClick={() => { setShowForm(false); setSel(null); }} className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground">إلغاء</button>
            <button type="button" onClick={submit} disabled={pending || !sel} className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">
              {pending && <Loader2 className="size-3.5 animate-spin" />} حفظ المتابعة
            </button>
          </div>
        </div>
      )}

      {/* Timeline */}
      <div>
        <div className="mb-3 text-sm font-medium text-foreground">سجل المتابعات ({items.length})</div>
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
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
