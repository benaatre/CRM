"use client";

// مكوّن «غير مهتم» المشترك — مصدر واحد لأسباب الانسحاب المنظّمة، يُستخدم في:
// النموذج (followups-form)، السحب في الكانبان، وقائمة مرحلة الدرج (توحيد كامل).
import { useState, useTransition } from "react";
import type { FollowUpType, FollowUpResult, FollowUpSection, LeadStage } from "@prisma/client";

// أسباب «غير مهتم» المعروضة (بترتيب العرض — الترتيب يحدّد السبب الرئيسي المنظّم).
export const NI_REASONS = [
  "الموقع ما ناسبه",
  "السعر",
  "المساحة",
  "زار المشروع وما ناسبه",
  "حسبة البنك ضعيفة",
  "مسوّق",
  "أخرى",
  "غير مهتم بالعقارات نهائيًا",
];

// سبب «غير مهتم» → نتيجة FollowUpResult منظّمة (لتحليلات الأسباب).
// بدون أي سبب محدّد = NOT_INTERESTED_FINAL.
export const NI_REASON_RESULT: Record<string, FollowUpResult> = {
  "الموقع ما ناسبه": "NOT_INTERESTED_LOCATION",
  السعر: "NOT_INTERESTED_PRICE",
  المساحة: "NOT_INTERESTED_SPACE",
  "زار المشروع وما ناسبه": "NOT_INTERESTED_VISITED",
  "حسبة البنك ضعيفة": "NOT_INTERESTED_BANK",
  "مسوّق": "NOT_INTERESTED_MARKETER",
  "أخرى": "NOT_INTERESTED_OTHER",
  "غير مهتم بالعقارات نهائيًا": "NOT_INTERESTED_FINAL",
};

// أسباب تتطلب نصًّا إلزاميًا: «أخرى» + «غير مهتم بالعقارات نهائيًا» (اكتب ما قاله العميل بالضبط).
const NI_TEXT_REQUIRED = new Set(["أخرى", "غير مهتم بالعقارات نهائيًا"]);

/** هل الاختيار الحالي يتطلب نصًّا إلزاميًا؟ (يعطّل الحفظ حتى يُكتب) */
export function niRequiresText(reasons: Set<string>): boolean {
  for (const r of reasons) if (NI_TEXT_REQUIRED.has(r)) return true;
  return false;
}

/** نص التلميح لخانة النص عند الأسباب الإلزامية. */
export const NI_TEXT_PLACEHOLDER = "اكتب ما قاله العميل بالضبط (إلزامي)…";

// السبب الرئيسي المنظّم = أول سبب محدّد مختار حسب ترتيب العرض؛ وإلا نهائي.
export function primaryNiResult(rs: Set<string>): FollowUpResult {
  for (const r of NI_REASONS) if (NI_REASON_RESULT[r] && rs.has(r)) return NI_REASON_RESULT[r];
  return "NOT_INTERESTED_FINAL";
}

// جسم المتابعة الناتج (مطابق لما كان النموذج يبنيه — نفس النتيجة ونفس تركيب الملاحظة).
export type NotInterestedBody = {
  type: FollowUpType;
  result: FollowUpResult;
  section: FollowUpSection;
  stage: LeadStage;
  note: string;
  nextDate?: string;
};

/**
 * يبني جسم المتابعة المنظّم من الأسباب + منطق retry:
 * - «نحاول لاحقًا» = انسحاب ناعم → FOLLOW_UP_SCHEDULED / FOLLOW_UP_LATER (لا سبب نهائي).
 * - «نهائي» → السبب الرئيسي المنظّم / CLOSED_LOST.
 * بقية الأسباب المختارة تبقى نصًّا في note (لا نعقّد الواجهة).
 */
export function buildNotInterestedBody(
  reasons: Set<string>,
  retry: "yes" | "no",
  date: string,
  note: string,
): NotInterestedBody {
  const rs = [...reasons];
  const composed = (base: string) => {
    const parts = [base];
    if (rs.length) parts.push(`الأسباب: ${rs.join("، ")}`);
    if (note.trim()) parts.push(note.trim());
    return parts.join(" — ");
  };
  return retry === "yes"
    ? { type: "CALL", result: "FOLLOW_UP_SCHEDULED", section: "NOT_INTERESTED", stage: "FOLLOW_UP_LATER", note: composed("غير مهتم — نحاول لاحقًا"), nextDate: date }
    : { type: "CALL", result: primaryNiResult(reasons), section: "NOT_INTERESTED", stage: "CLOSED_LOST", note: composed("غير مهتم") };
}

/**
 * كتلة اختيار الأسباب (شرائح + مفتاح «نحاول لاحقًا» + تاريخ المحاولة) — مُتحكَّم بها.
 * مستخرجة كما هي من النموذج ليُعاد استخدامها inline (النموذج) و داخل المودال.
 */
export function NotInterestedReasons({
  reasons, onToggle, retry, onRetry, date, onDate,
}: {
  reasons: Set<string>;
  onToggle: (r: string) => void;
  retry: "yes" | "no";
  onRetry: (v: "yes" | "no") => void;
  date: string;
  onDate: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <span className="text-xs text-muted-foreground">السبب (اختياري — أكثر من واحد):</span>
      <div className="grid grid-cols-2 gap-2">
        {NI_REASONS.map((r) => (
          <button key={r} type="button" onClick={() => onToggle(r)} className={`rounded-lg border px-2.5 py-1.5 text-xs ${reasons.has(r) ? "border-destructive bg-destructive/10 text-destructive" : "border-border text-muted-foreground"}`}>{r}</button>
        ))}
      </div>
      <span className="text-xs text-muted-foreground">نحاول معه بعد فترة؟</span>
      <div className="flex gap-2">
        <button type="button" onClick={() => onRetry("yes")} className={`flex-1 rounded-lg border px-2.5 py-1.5 text-xs ${retry === "yes" ? "border-gold bg-gold/15 text-gold" : "border-border text-muted-foreground"}`}>نعم</button>
        <button type="button" onClick={() => onRetry("no")} className={`flex-1 rounded-lg border px-2.5 py-1.5 text-xs ${retry === "no" ? "border-gold bg-gold/15 text-gold" : "border-border text-muted-foreground"}`}>لا</button>
      </div>
      {retry === "yes" && (
        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">تاريخ المحاولة القادمة</span>
          <input type="datetime-local" value={date} onChange={(e) => onDate(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-gold" />
        </label>
      )}
    </div>
  );
}

/**
 * مودال «غير مهتم» المشترك — للكانبان (السحب) وقائمة مرحلة الدرج (٢-ب/٢-ج لاحقًا).
 * يبني النتيجة المنظّمة عبر buildNotInterestedBody ويرسلها لـ POST /followups.
 * ثيم أوبسيديان + ذهبي، RTL، لهجة سعودية.
 */
export function NotInterestedDialog({
  leadId, leadName, onClose, onDone,
}: {
  leadId: string;
  leadName?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reasons, setReasons] = useState<Set<string>>(new Set());
  const [retry, setRetry] = useState<"yes" | "no">("no");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggle = (r: string) => setReasons((s) => { const n = new Set(s); if (n.has(r)) n.delete(r); else n.add(r); return n; });
  const needsText = niRequiresText(reasons);
  const disabled = pending || (retry === "yes" && !date) || (needsText && !note.trim());

  function confirm() {
    setError(null);
    const body = buildNotInterestedBody(reasons, retry, date, note);
    startTransition(async () => {
      const res = await fetch(`/api/leads/${leadId}/followups`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error ?? "صار خطأ"); return; }
      onDone();
    });
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-card p-5 shadow-2xl">
          <h2 className="font-bold text-foreground">تسجيل «غير مهتم»{leadName ? ` — ${leadName}` : ""}</h2>
          <NotInterestedReasons reasons={reasons} onToggle={toggle} retry={retry} onRetry={setRetry} date={date} onDate={setDate} />
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={needsText ? NI_TEXT_PLACEHOLDER : "ملاحظة (اختياري)…"} className={`w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-gold ${needsText && !note.trim() ? "border-destructive/60" : "border-border"}`} />
          {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground">إلغاء</button>
            <button type="button" onClick={confirm} disabled={disabled} className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{pending ? "جارٍ…" : "تأكيد"}</button>
          </div>
        </div>
      </div>
    </>
  );
}
