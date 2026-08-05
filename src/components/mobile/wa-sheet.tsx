"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { waPhone } from "@/lib/value-normalize";
import { MOBILE_COLORS } from "@/lib/mobile-tokens";
import { BottomSheet } from "./bottom-sheet";

/**
 * قوالب واتساب — نصوصها من نموذج التصميم (docs/design/prototype.html:1840)
 * بلهجة سعودية، مع تعبئة الاسم الأول للعميل واسم الموظف.
 * الإرسال يفتح واتساب الجوال عبر wa.me — لا نرسل نيابة عن أحد.
 */
function templatesFor(leadFirstName: string, meName: string) {
  return [
    {
      name: "ترحيب",
      body: `هلا ${leadFirstName}، معك ${meName} من مشاريع السلطان. وصلني طلبك وأحب أخدمك — أبغى أفهم وش تدور بالضبط؟`,
    },
    {
      name: "تذكير موعد",
      body: `هلا ${leadFirstName}، تذكير بموعد المعاينة. يناسبك؟`,
    },
    {
      name: "متابعة",
      body: `هلا ${leadFirstName}، حبيت أطمن عليك — وصلتك التفاصيل؟ أي استفسار أنا حاضر.`,
    },
  ];
}

export function WaSheet({
  open,
  onClose,
  phone,
  leadName,
  meName,
  leadId,
}: {
  open: boolean;
  onClose: () => void;
  phone: string;
  leadName: string;
  meName: string;
  /** لتسجيل الإرسال متابعةً عبر المسار القائم /api/leads/[id]/whatsapp. */
  leadId: string;
}) {
  const router = useRouter();
  const wa = waPhone(phone);
  const first = leadName.trim().split(/\s+/)[0] || leadName;
  const templates = templatesFor(first, meName);
  // بعد فتح واتساب نسأل «أرسلت؟» بدل الإغلاق الصامت — التسجيل بيد الموظف لا تخمينًا.
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  const openWa = (text?: string) => {
    const url = `https://wa.me/${wa}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
    window.open(url, "_blank", "noopener,noreferrer");
    setConfirming(true);
  };

  const close = () => {
    setConfirming(false);
    setSaving(false);
    onClose();
  };

  // «نعم أرسلت» ⟵ المسار القائم (متابعة WHATSAPP + منع تكرار الدقيقة + جديد⟵محاولة).
  const confirmSent = async () => {
    setSaving(true);
    try {
      await fetch(`/api/leads/${leadId}/whatsapp`, { method: "POST" });
      router.refresh();
    } catch {
      /* الإغلاق على أي حال — التسجيل تحسين لا شرط */
    }
    close();
  };

  if (open && confirming) {
    return (
      <BottomSheet open onClose={close} title={`أرسلت لـ${first}؟`} subtitle="نسجّلها متابعة واتساب في ملفه">
        <div className="flex" style={{ gap: 8, marginTop: 18 }}>
          <button
            type="button"
            onClick={confirmSent}
            disabled={saving}
            className="flex-1"
            style={{
              boxSizing: "border-box", height: 52, borderRadius: 14, border: "none",
              background: MOBILE_COLORS.gold, color: MOBILE_COLORS.bg,
              fontSize: 15, fontWeight: 700, opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? "جارٍ التسجيل…" : "نعم، سجّلها"}
          </button>
          <button
            type="button"
            onClick={close}
            className="flex-1"
            style={{
              boxSizing: "border-box", height: 52, borderRadius: 14,
              border: `1px solid ${MOBILE_COLORS.border}`, background: "none",
              color: MOBILE_COLORS.textSecondary, fontSize: 15, fontWeight: 600,
            }}
          >
            لا
          </button>
        </div>
      </BottomSheet>
    );
  }

  return (
    <BottomSheet
      open={open}
      onClose={close}
      title={`واتساب — ${first}`}
      subtitle="تنرسل من واتساب جوالك"
      maxHeight="85dvh"
      footer={
        <button
          type="button"
          onClick={() => openWa()}
          className="m-press w-full"
          style={{
            boxSizing: "border-box", height: 46, borderRadius: 13,
            border: `1px solid ${MOBILE_COLORS.border}`, background: "none",
            color: MOBILE_COLORS.textPrimary, fontSize: 14, fontWeight: 600,
          }}
        >
          رسالة جديدة
        </button>
      }
    >
      <div className="flex flex-col" style={{ gap: 10, marginTop: 16 }}>
        {templates.map((t) => (
          <button
            key={t.name}
            type="button"
            onClick={() => openWa(t.body)}
            className="flex flex-col text-right"
            style={{
              boxSizing: "border-box",
              background: MOBILE_COLORS.bg,
              border: `1px solid ${MOBILE_COLORS.border}`,
              borderRadius: 15,
              padding: "13px 14px",
              gap: 8,
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 700, color: MOBILE_COLORS.gold }}>{t.name}</span>
            <span style={{ fontSize: 13, color: MOBILE_COLORS.textSecondary, lineHeight: 1.75 }}>
              {t.body}
            </span>
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}

export default WaSheet;
