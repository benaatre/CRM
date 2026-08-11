"use client";

import { useState } from "react";
import type { LeadStage } from "@prisma/client";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";
import { SalesFunnel } from "@/components/mobile/sales-funnel";

/**
 * «قمع المبيعات» المطوي (رئيسية المالك v3) — الملخص الثلاثي ظاهر دائمًا
 * (مهتم = INTERESTED · زيارة = VISIT_SCHEDULED · حجز/بيع = RESERVED + CLOSED_WON)
 * والمراحل الكاملة تنفتح بالضغط: SalesFunnel القائم يُركَّب عند الفتح فتتعبّى
 * أشرطته بأنيميشن m-fillx (transform فقط — يحترم تقليل الحركة تلقائيًا).
 */
export function OwnerFunnel({ funnel }: { funnel: { stage: LeadStage; count: number }[] }) {
  const [open, setOpen] = useState(false);
  const of = (s: LeadStage) => funnel.find((f) => f.stage === s)?.count ?? 0;
  const trio = [
    { label: "مهتم", value: of("INTERESTED"), color: MOBILE_STATUS.success.base },
    { label: "زيارة", value: of("VISIT_SCHEDULED"), color: MOBILE_STATUS.info.base },
    { label: "حجز/بيع", value: of("RESERVED") + of("CLOSED_WON"), color: MOBILE_COLORS.gold },
  ];

  return (
    <div className="overflow-hidden" style={{ borderRadius: 18, background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}` }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center text-start"
        style={{ gap: 9, padding: "13px 15px", background: "none", border: "none" }}
      >
        <span className="flex-1" style={{ fontSize: "13.5px", fontWeight: 800, color: MOBILE_COLORS.textPrimary }}>📊 القمع الكامل</span>
        <span aria-hidden style={{ fontSize: 13, color: MOBILE_COLORS.textMuted, transition: "transform .3s", transform: open ? "rotate(90deg)" : "none" }}>←</span>
      </button>
      <div className="flex" style={{ gap: 8, padding: "0 14px 12px" }}>
        {trio.map((t) => (
          <div key={t.label} className="flex-1 text-center" style={{ boxSizing: "border-box", borderRadius: 12, background: MOBILE_COLORS.sheet, border: `1px solid ${MOBILE_COLORS.border}`, padding: 10 }}>
            <div style={{ fontFamily: "var(--font-zain), var(--font-sans)", fontSize: 18, fontWeight: 800, color: t.color }}>{toArabicDigits(t.value)}</div>
            <div style={{ fontSize: "9.5px", color: MOBILE_COLORS.textMuted, fontWeight: 700, marginTop: 2 }}>{t.label}</div>
          </div>
        ))}
      </div>
      {open && (
        <div style={{ padding: "4px 14px 14px" }}>
          <SalesFunnel funnel={funnel} />
        </div>
      )}
    </div>
  );
}

export default OwnerFunnel;
