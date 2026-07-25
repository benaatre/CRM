"use client";

// التسجيل بضغطة واحدة — أزرار سريعة في صف العميل:
// 🔴 لم يرد (فوري) · 🟢 مهتم (مصغّر الخطوة الإلزامية) · 📅 موعد (منتقي تاريخ) · ❌ غير مناسب (المودال الموحّد).
// كلها عبر POST /followups القياسي — صفر منطق جديد للحالات، الواجهة اختصار فقط.
import { useState, useTransition } from "react";
import type { FollowUpResult, FollowUpSection, FollowUpType, LeadStage } from "@prisma/client";
import { NotInterestedDialog, NotInterestedReasons, buildNotInterestedBody, niRequiresText, NI_TEXT_PLACEHOLDER } from "./not-interested-dialog";

export type QuickLead = { id: string; name: string; stage: LeadStage };

type SaveBody = {
  type: FollowUpType;
  result: FollowUpResult;
  section: FollowUpSection;
  stage: LeadStage;
  note?: string;
  nextDate?: string;
};

/** مراحل ما قبل ثبوت الاهتمام — «لم يرد» فيها بوابة نظام السحب. */
const PRE_INTEREST: LeadStage[] = ["NEW", "ATTEMPTED"];

/**
 * جسم «لم يرد» حسب المرحلة — نفس منطق النموذج بالضبط:
 * جديد/محاولة → NOT_ANSWERED_SCHEDULED (يحرّك ATTEMPTED ويدخل نظام السحب)،
 * المظلة المهتمة → NO_ANSWER_INTERESTED (بلا تغيير مرحلة ولا سحب).
 */
export function noAnswerBody(stage: LeadStage, type: FollowUpType = "CALL"): SaveBody {
  return PRE_INTEREST.includes(stage)
    ? { type, result: "NOT_ANSWERED_SCHEDULED", section: "NO_ANSWER", stage: "ATTEMPTED", note: "لم يرد" }
    : { type, result: "NO_ANSWER_INTERESTED", section: "INTERESTED", stage, note: "لم يستجب" };
}

export async function postFollowup(leadId: string, body: SaveBody): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/leads/${leadId}/followups`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return res.ok ? { ok: true } : { ok: false, error: data?.error ?? "صار خطأ" };
}

/** المراحل التي تظهر لها الأزرار السريعة (المفتوحة للعمل). */
const QUICK_STAGES: LeadStage[] = ["NEW", "ATTEMPTED", "INTERESTED", "FOLLOW_UP_LATER", "VISIT_SCHEDULED", "VIEWING", "NEGOTIATION"];

export function QuickActions({ lead, onDone }: { lead: QuickLead; onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<"interested" | "appointment" | "notInterested" | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  if (!QUICK_STAGES.includes(lead.stage)) return null;

  function fire(body: SaveBody, doneLabel: string) {
    startTransition(async () => {
      const r = await postFollowup(lead.id, body);
      if (!r.ok) { setFlash(r.error ?? "صار خطأ"); setTimeout(() => setFlash(null), 2500); return; }
      setFlash(doneLabel);
      setTimeout(() => setFlash(null), 1500);
      onDone();
    });
  }

  const btn = "flex size-8 items-center justify-center rounded-lg border border-border text-sm transition-colors hover:border-gold/50 hover:bg-secondary disabled:opacity-40";

  return (
    <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <button type="button" disabled={pending} title="لم يرد — تسجيل فوري" aria-label="لم يرد"
        onClick={() => fire(noAnswerBody(lead.stage), "سُجّلت ✓")} className={btn}>🔴</button>
      <button type="button" disabled={pending} title="مهتم — مع الخطوة التالية" aria-label="مهتم"
        onClick={() => setDialog("interested")} className={btn}>🟢</button>
      <button type="button" disabled={pending} title="موعد لاحق" aria-label="موعد"
        onClick={() => setDialog("appointment")} className={btn}>📅</button>
      <button type="button" disabled={pending} title="غير مناسب" aria-label="غير مناسب"
        onClick={() => setDialog("notInterested")} className={btn}>❌</button>
      {flash && <span className="text-[10px] text-gold">{flash}</span>}

      {dialog === "interested" && (
        <QuickInterestedDialog
          leadName={lead.name}
          onClose={() => setDialog(null)}
          onSave={(body) => { setDialog(null); fire(body, "سُجّل مهتم ✓"); }}
        />
      )}
      {dialog === "appointment" && (
        <QuickAppointmentDialog
          leadName={lead.name}
          onClose={() => setDialog(null)}
          onSave={(date) => {
            setDialog(null);
            fire({ type: "CALL", result: "INTERESTED_SCHEDULED", section: "INTERESTED", stage: "FOLLOW_UP_LATER", note: "موعد لاحق", nextDate: date }, "سُجّل الموعد ✓");
          }}
        />
      )}
      {dialog === "notInterested" && (
        <NotInterestedDialog
          leadId={lead.id}
          leadName={lead.name}
          onClose={() => setDialog(null)}
          onDone={() => { setDialog(null); onDone(); }}
        />
      )}
    </span>
  );
}

/** مصغّر الخطوة الإلزامية لنتيجة «مهتم» — موعد زيارة / موعد اتصال / غير مناسب (لا حفظ بدونها). */
function QuickInterestedDialog({ leadName, onClose, onSave }: {
  leadName: string;
  onClose: () => void;
  onSave: (body: SaveBody) => void;
}) {
  const [step, setStep] = useState<"visit" | "call" | "notsuitable" | null>(null);
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [reasons, setReasons] = useState<Set<string>>(new Set());
  const [retry, setRetry] = useState<"yes" | "no">("no");

  const needsText = step === "notsuitable" && niRequiresText(reasons);
  const disabled = !step
    || ((step === "visit" || step === "call") && !date)
    || (step === "notsuitable" && ((retry === "yes" && !date) || (needsText && !note.trim())));

  function save() {
    if (step === "visit")
      return onSave({ type: "CALL", result: "INTERESTED_VISIT_SCHEDULED", section: "INTERESTED", stage: "VISIT_SCHEDULED", note: note.trim() ? `مهتم — موعد زيارة — ${note.trim()}` : "مهتم — موعد زيارة", nextDate: date });
    if (step === "call")
      return onSave({ type: "CALL", result: "INTERESTED_SCHEDULED", section: "INTERESTED", stage: "FOLLOW_UP_LATER", note: note.trim() ? `مهتم — موعد اتصال — ${note.trim()}` : "مهتم — موعد اتصال", nextDate: date });
    if (step === "notsuitable")
      return onSave(buildNotInterestedBody(reasons, retry, date, note) as SaveBody);
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-3 rounded-2xl border border-border bg-card p-5 shadow-2xl" dir="rtl">
          <h2 className="font-bold text-foreground">مهتم — {leadName}</h2>
          <p className="text-xs text-muted-foreground">وش الخطوة الجاية معه؟ (إلزامي — ما ينحفظ بدونها)</p>
          <div className="flex gap-2">
            {([["visit", "موعد زيارة"], ["call", "موعد اتصال"], ["notsuitable", "غير مناسب"]] as const).map(([k, label]) => (
              <button key={k} type="button" onClick={() => { setStep(k); setDate(""); setReasons(new Set()); setRetry("no"); }}
                className={`flex-1 rounded-lg border px-2.5 py-2 text-xs ${step === k ? "border-gold bg-gold/15 text-gold" : "border-border text-muted-foreground"}`}>{label}</button>
            ))}
          </div>
          {(step === "visit" || step === "call") && (
            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">{step === "visit" ? "تاريخ ووقت الزيارة" : "تاريخ ووقت الاتصال"}</span>
              <input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-gold" />
            </label>
          )}
          {step === "notsuitable" && (
            <NotInterestedReasons reasons={reasons} onToggle={(r) => setReasons((s) => { const n = new Set(s); if (n.has(r)) n.delete(r); else n.add(r); return n; })} retry={retry} onRetry={setRetry} date={date} onDate={setDate} />
          )}
          {step && (
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={needsText ? NI_TEXT_PLACEHOLDER : "ملاحظة (اختياري)…"} className={`w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-gold ${needsText && !note.trim() ? "border-destructive/60" : "border-border"}`} />
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground">إلغاء</button>
            <button type="button" onClick={save} disabled={disabled} className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">حفظ</button>
          </div>
        </div>
      </div>
    </>
  );
}

/** منتقي موعد مصغّر — «موعد لاحق» بتاريخ ووقت. */
function QuickAppointmentDialog({ leadName, onClose, onSave }: {
  leadName: string;
  onClose: () => void;
  onSave: (date: string) => void;
}) {
  const [date, setDate] = useState("");
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-3 rounded-2xl border border-border bg-card p-5 shadow-2xl" dir="rtl">
          <h2 className="font-bold text-foreground">موعد لاحق — {leadName}</h2>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">تاريخ ووقت المتابعة القادمة</span>
            <input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-gold" />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground">إلغاء</button>
            <button type="button" onClick={() => date && onSave(date)} disabled={!date} className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">حفظ</button>
          </div>
        </div>
      </div>
    </>
  );
}
