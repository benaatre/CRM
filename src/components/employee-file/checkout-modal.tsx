"use client";

import { useState } from "react";
import type { EFBundle } from "./types";
import type { ToastFn } from "./employee-file-view";

/**
 * مودال «تسجيل انصراف» — نصوص التصميم حرفيًا. ثلاثة أوقات: آخر إثبات موقع
 * (افتراض session-repair نفسه عند حذف atIso) · الآن · مخصص. والإشعار خيار
 * المالك: رسالة (notify:true — نص ownerCheckoutEmployeeText) أو صامت (تدقيق فقط).
 */
export function CheckoutModal({
  bundle, onClose, showToast, refresh,
}: {
  bundle: EFBundle;
  onClose: () => void;
  showToast: ToastFn;
  refresh: () => void;
}) {
  const [timeMode, setTimeMode] = useState<"proof" | "now" | "custom">(bundle.openSession?.lastProofText ? "proof" : "now");
  const [customLocal, setCustomLocal] = useState("");
  const [notifyOn, setNotifyOn] = useState(true);
  const [busy, setBusy] = useState(false);

  const proofText = bundle.openSession?.lastProofText ?? null;
  const nowLocal = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 16);

  const confirm = async () => {
    if (!bundle.openSession) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        op: "CLOSE",
        sessionId: bundle.openSession.id,
        reason: "انصراف سجّله المالك من ملف الموظف",
        notify: notifyOn,
      };
      if (timeMode === "now") body.atIso = nowLocal();
      else if (timeMode === "custom") {
        if (!customLocal) { showToast("حدّد الوقت المخصص", true); setBusy(false); return; }
        body.atIso = customLocal;
      }
      // proof: بلا atIso — الافتراض الخادمي نفسه (آخر إثبات حياة).
      const res = await fetch("/api/attendance/session-repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = (await res.json()) as { ok: boolean; error?: string };
      if (d.ok) {
        onClose();
        showToast(
          notifyOn
            ? "✓ سُجّل الانصراف · أُرسل الإشعار · قُيّد بالتدقيق"
            : "✓ سُجّل الانصراف · صامت — ما وصله شيء · قُيّد بالتدقيق",
        );
        refresh();
      } else showToast(d.error ?? "تعذّر تسجيل الانصراف", true);
    } catch {
      showToast("تعذّر الاتصال — حاول مرة ثانية", true);
    }
    setBusy(false);
  };

  return (
    <div className="ef ef-overlay" dir="rtl" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <h3>تسجيل انصراف — {bundle.user.name}</h3>
        <div className="ms">مشى بدون ما يبصم والنظام ما التقطه؟ سجّله أنت — وأنت تقرر توصله رسالة أو لا.</div>
        <div className="mrow">
          <label>وقت الانصراف</label>
          <div className="timebox">
            <button type="button" className={`tchip ${timeMode === "proof" ? "on" : ""}`} onClick={() => setTimeMode("proof")} disabled={!proofText}>
              {proofText ? `آخر إثبات موقع — ${proofText}` : "لا إثبات موقع للجلسة"}
            </button>
            <button type="button" className={`tchip ${timeMode === "now" ? "on" : ""}`} onClick={() => setTimeMode("now")}>الآن</button>
            <button type="button" className={`tchip ${timeMode === "custom" ? "on" : ""}`} onClick={() => setTimeMode("custom")}>وقت مخصص…</button>
          </div>
          {timeMode === "custom" && (
            <input type="datetime-local" value={customLocal} onChange={(e) => setCustomLocal(e.target.value)} style={{ marginTop: 8 }} dir="ltr" />
          )}
        </div>
        <div className="mrow">
          <label>الإشعار — أنت المتحكم</label>
          <div className={`notify-opt ${notifyOn ? "on" : ""}`} onClick={() => setNotifyOn(true)}>
            <span className="radio2" />
            <div style={{ flex: 1 }}>
              <div className="nt">أرسل له إشعارًا</div>
              <div className="ns">توصله رسالة push فورية:</div>
              <div className="msg-preview">«تم تسجيل انصراف لك الساعة {timeMode === "proof" && proofText ? proofText : "…"} — غادرت موقع العمل بدون تسجيل. لو فيه خطأ كلّم الإدارة.»</div>
            </div>
          </div>
          <div className={`notify-opt ${!notifyOn ? "on" : ""}`} onClick={() => setNotifyOn(false)}>
            <span className="radio2" />
            <div>
              <div className="nt">بدون رسالة — تسجيل صامت</div>
              <div className="ns">يُقيَّد بملفه وسجل التدقيق فقط.</div>
            </div>
          </div>
        </div>
        <div className="mfoot">
          <button type="button" className="btn red" onClick={() => void confirm()} disabled={busy}>
            {busy ? "جاري…" : "تأكيد الانصراف"}
          </button>
          <button type="button" className="btn ghost" onClick={onClose}>إلغاء</button>
        </div>
      </div>
    </div>
  );
}
