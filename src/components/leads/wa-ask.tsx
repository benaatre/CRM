"use client";

// سؤال الواتساب: بعد فتح المحادثة من زر الواتساب، عند العودة للتبويب (visibilitychange)
// يظهر شريط خفيف «رد العميل؟» — نعم: يفتح نموذج المتابعة بنتيجة مبدئية «مهتم» ·
// لا: يسجّل «لم يرد» المناسب لمرحلته فورًا · تجاهل: يختفي بعد ١٥ ثانية.
// مرة واحدة لكل فتح محادثة (العلَم يُستهلك عند أول عودة).
import { useEffect, useRef, useState } from "react";
import type { FollowUpResult, FollowUpSection, FollowUpType, LeadStage } from "@prisma/client";

type SaveBody = {
  type: FollowUpType;
  result: FollowUpResult;
  section: FollowUpSection;
  stage: LeadStage;
  note?: string;
};

/** مراحل ما قبل ثبوت الاهتمام — «لم يرد» فيها بوابة نظام السحب. */
const PRE_INTEREST: LeadStage[] = ["NEW", "ATTEMPTED"];

/**
 * جسم «لم يرد» حسب المرحلة — نفس منطق النموذج بالضبط:
 * جديد/محاولة → NOT_ANSWERED_SCHEDULED (يحرّك ATTEMPTED ويدخل نظام السحب)،
 * المظلة المهتمة → NO_ANSWER_INTERESTED (بلا تغيير مرحلة ولا سحب).
 */
function noAnswerBody(stage: LeadStage, type: FollowUpType = "CALL"): SaveBody {
  return PRE_INTEREST.includes(stage)
    ? { type, result: "NOT_ANSWERED_SCHEDULED", section: "NO_ANSWER", stage: "ATTEMPTED", note: "لم يرد" }
    : { type, result: "NO_ANSWER_INTERESTED", section: "INTERESTED", stage, note: "لم يستجب" };
}

async function postFollowup(leadId: string, body: SaveBody): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/leads/${leadId}/followups`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return res.ok ? { ok: true } : { ok: false, error: data?.error ?? "صار خطأ" };
}

export function WaAskLink({
  href, leadId, stage, onYes, onLogged, className, children,
}: {
  href: string;
  leadId: string;
  stage: LeadStage;
  /** «نعم رد» — يفتح نموذج المتابعة بنتيجة مبدئية «مهتم». */
  onYes: () => void;
  /** بعد تسجيل «لم يرد» بنجاح (لإعادة التحميل). */
  onLogged: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  const pendingRef = useRef(false);
  const [ask, setAsk] = useState(false);
  const [saving, setSaving] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== "visible" || !pendingRef.current) return;
      pendingRef.current = false; // مرة واحدة لكل فتح محادثة
      setAsk(true);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setAsk(false), 15_000);
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  function dismiss() {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setAsk(false);
  }

  async function no() {
    setSaving(true);
    const r = await postFollowup(leadId, noAnswerBody(stage, "WHATSAPP"));
    setSaving(false);
    dismiss();
    if (r.ok) onLogged();
  }

  return (
    <>
      <a href={href} target="_blank" rel="noopener noreferrer" className={className} onClick={() => { pendingRef.current = true; }}>
        {children}
      </a>
      {ask && (
        <div className="fixed inset-x-3 bottom-20 z-50 mx-auto flex max-w-md flex-wrap items-center justify-between gap-2 rounded-2xl border border-gold/40 bg-card/95 px-4 py-3 shadow-2xl backdrop-blur" dir="rtl">
          <span className="text-sm font-medium text-foreground">رد العميل؟</span>
          <div className="flex items-center gap-1.5">
            <button type="button" disabled={saving} onClick={() => { dismiss(); onYes(); }} className="rounded-lg bg-success/15 px-3 py-1.5 text-xs font-semibold text-success hover:bg-success/25">نعم — سجّل</button>
            <button type="button" disabled={saving} onClick={no} className="rounded-lg bg-destructive/15 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/25 disabled:opacity-50">{saving ? "جارٍ…" : "لا — لم يرد"}</button>
            <button type="button" onClick={dismiss} className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground">تجاهل</button>
          </div>
        </div>
      )}
    </>
  );
}
