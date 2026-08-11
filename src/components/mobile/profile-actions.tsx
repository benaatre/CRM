"use client";

import { useState, useEffect } from "react";
import type { LeadStage } from "@prisma/client";
import { markCall } from "@/lib/mobile-call-tracker";
import { MOBILE_COLORS } from "@/lib/mobile-tokens";
import { FollowupSheet } from "./followup-sheet";
import { WaSheet } from "./wa-sheet";

/** شريط إجراءات ملف العميل — اتصال · واتساب (ورقة قوالب) · تسجيل متابعة (ورقة). */
export function MobileProfileActions({
  leadId,
  phone,
  leadName,
  stage,
  firstContact,
  meName,
  projects,
  autoOpenFollowup = false,
}: {
  leadId: string;
  phone: string;
  leadName: string;
  stage: LeadStage;
  firstContact: boolean;
  meName: string;
  projects: { id: string; name: string }[];
  /** فتح ورقة المتابعة تلقائيًا (عودة من مكالمة عبر جسر Capacitor — ?log=call). */
  autoOpenFollowup?: boolean;
}) {
  const [sheet, setSheet] = useState<"wa" | "fu" | null>(null);

  useEffect(() => {
    if (autoOpenFollowup) setSheet("fu");
  }, [autoOpenFollowup]);

  const btn = {
    boxSizing: "border-box" as const,
    height: 42,
    borderRadius: 11,
    fontSize: 13,
    fontWeight: 600,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };

  return (
    <>
      <div className="flex" style={{ gap: 8, padding: "14px 0 13px" }}>
        <a
          href={`tel:${phone}`}
          onClick={() => markCall(leadId)}
          style={{
            ...btn, flex: 1,
            border: `1px solid ${MOBILE_COLORS.border}`,
            background: MOBILE_COLORS.sheet,
            color: MOBILE_COLORS.textPrimary,
          }}
        >
          اتصال
        </a>
        <button
          type="button"
          onClick={() => setSheet("wa")}
          style={{
            ...btn, flex: 1,
            border: `1px solid ${MOBILE_COLORS.border}`,
            background: MOBILE_COLORS.sheet,
            color: MOBILE_COLORS.textPrimary,
          }}
        >
          واتساب
        </button>
        <button
          type="button"
          onClick={() => setSheet("fu")}
          style={{
            ...btn, flex: 1.3, border: "none",
            background: MOBILE_COLORS.gold,
            color: MOBILE_COLORS.bg,
            fontWeight: 700,
          }}
        >
          {firstContact ? "أول تواصل" : "تسجيل متابعة"}
        </button>
      </div>

      <WaSheet
        open={sheet === "wa"}
        onClose={() => setSheet(null)}
        phone={phone}
        leadName={leadName}
        meName={meName}
        leadId={leadId}
      />
      <FollowupSheet
        open={sheet === "fu"}
        onClose={() => setSheet(null)}
        leadId={leadId}
        leadName={leadName}
        phone={phone}
        stage={stage}
        firstContact={firstContact}
        projects={projects}
      />
    </>
  );
}

export default MobileProfileActions;
