"use client";

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
}: {
  open: boolean;
  onClose: () => void;
  phone: string;
  leadName: string;
  meName: string;
}) {
  const wa = waPhone(phone);
  const first = leadName.trim().split(/\s+/)[0] || leadName;
  const templates = templatesFor(first, meName);

  const openWa = (text?: string) => {
    const url = `https://wa.me/${wa}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
    window.open(url, "_blank", "noopener,noreferrer");
    onClose();
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={`واتساب — ${first}`}
      subtitle="تنرسل من واتساب جوالك"
      maxHeight="80%"
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
      <button
        type="button"
        onClick={() => openWa()}
        className="w-full"
        style={{
          boxSizing: "border-box",
          marginTop: 12,
          height: 46,
          borderRadius: 13,
          border: `1px solid ${MOBILE_COLORS.border}`,
          background: "none",
          color: MOBILE_COLORS.textPrimary,
          fontSize: 14,
          fontWeight: 600,
        }}
      >
        رسالة جديدة
      </button>
    </BottomSheet>
  );
}

export default WaSheet;
