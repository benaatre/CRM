"use client";

import { MOBILE_COLORS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";
import { useCountUp } from "@/components/mobile/owner-kpis";

/**
 * المربعات الأربعة (٢×٢) في رئيسية الموظف v2 — أرقام تعدّ تصاعديًا بخط Zain.
 * client لأجل useCountUp فقط؛ القيم تصل props من getDashboard (نطاق الموظف).
 */

const ZAIN = { fontFamily: "var(--font-zain), var(--font-sans)" };

function Kpi({ icon, label, value, color, delayMs }: {
  icon: string; label: string; value: number; color: string; delayMs: number;
}) {
  const n = useCountUp(value, 900);
  return (
    <div
      className="m-rise m-press flex flex-col justify-center"
      style={{
        boxSizing: "border-box",
        background: MOBILE_COLORS.card,
        border: `1px solid ${MOBILE_COLORS.border}`,
        borderRadius: 16, padding: "13px 14px", minHeight: 92, gap: 6,
        animationDelay: `${delayMs}ms`,
      }}
    >
      <span style={{ fontSize: 15 }} aria-hidden>{icon}</span>
      <span style={{ ...ZAIN, fontSize: 34, fontWeight: 800, lineHeight: 1, color }}>{toArabicDigits(n)}</span>
      <span style={{ fontSize: 13, color: MOBILE_COLORS.textMuted }}>{label}</span>
    </div>
  );
}

export function EmployeeKpis({ total, visits, bookings, closed }: {
  total: number; visits: number; bookings: number; closed: number;
}) {
  return (
    <div className="grid grid-cols-2" style={{ gap: 9 }}>
      <Kpi icon="👥" label="إجمالي عملائي" value={total} color={MOBILE_COLORS.textPrimary} delayMs={130} />
      <Kpi icon="🏠" label="إجمالي زياراتي" value={visits} color={MOBILE_COLORS.amber} delayMs={195} />
      <Kpi icon="📑" label="حجوزاتي" value={bookings} color={MOBILE_COLORS.gold} delayMs={260} />
      <Kpi icon="🏆" label="صفقات مقفولة" value={closed} color={MOBILE_COLORS.mint} delayMs={325} />
    </div>
  );
}

export default EmployeeKpis;
