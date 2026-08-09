"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";

/**
 * رأس لوحة المالك الحي — بانر «غير موزّعين» + شبكة KPI ٢×٢ بعدّ تصاعدي.
 * client لأجل rAF فقط؛ البيانات كلها تصل props من getDashboard (لا استعلامات هنا).
 * الحركة transform/opacity (m-rise/m-press/m-ctapulse) والعدّ يحترم prefers-reduced-motion.
 */

/** عدّ تصاعدي من صفر بـrAF — يقفز للقيمة النهائية مباشرة مع تفضيل تقليل الحركة. */
export function useCountUp(target: number, durationMs = 750): number {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVal(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      setVal(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return val;
}

/** حلقة تقدّم SVG — تمتلئ بتزامن مع رقم العدّ (نفس قيمة rAF الواحدة). */
function Ring({ pct, size = 46, stroke = 4 }: { pct: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.min(pct, 100) / 100);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }} aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={MOBILE_COLORS.line2} strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={MOBILE_COLORS.gold} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={off}
      />
    </svg>
  );
}

/** بطاقة KPI زجاجية: تدرّج ذهبي خافت + خط علوي ذهبي مضيء + دخول متدرّج + ضغط scale. */
function KpiCard({
  label, value, suffix = "", color, delayMs, ring = false,
}: {
  label: string;
  value: number;
  suffix?: string;
  color: string;
  delayMs: number;
  ring?: boolean;
}) {
  const n = useCountUp(value);
  return (
    <div
      className="m-rise m-press relative flex items-center justify-between overflow-hidden"
      style={{
        boxSizing: "border-box",
        background: `linear-gradient(165deg, ${MOBILE_COLORS.goldBg} 0%, ${MOBILE_COLORS.card} 55%)`,
        border: `1px solid ${MOBILE_COLORS.border}`,
        borderRadius: 16, padding: "14px 13px", minHeight: 86, gap: 8,
        animationDelay: `${delayMs}ms`,
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute", top: 0, insetInline: 10, height: 2, borderRadius: 2,
          background: `linear-gradient(90deg, transparent, ${MOBILE_COLORS.gold}, transparent)`,
          boxShadow: `0 0 10px ${MOBILE_COLORS.gold}`,
        }}
      />
      <div className="flex flex-col justify-center" style={{ gap: 5 }}>
        <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1, color }}>
          {toArabicDigits(n)}{suffix}
        </div>
        <div style={{ fontSize: "11.5px", color: MOBILE_COLORS.textSecondary }}>{label}</div>
      </div>
      {ring && <Ring pct={n} />}
    </div>
  );
}

/** بانر «غير موزّعين»: تدرّج أحمر داكن + حد علوي مضيء + زر «وزّع الآن» ينبض. */
function UnassignedBanner({ count }: { count: number }) {
  const n = useCountUp(count);
  return (
    <Link
      href="/m/distribution"
      className="m-rise m-press relative flex items-center justify-between overflow-hidden"
      style={{
        boxSizing: "border-box",
        background: `linear-gradient(160deg, ${MOBILE_STATUS.danger.bg} 0%, ${MOBILE_COLORS.card} 80%)`,
        border: `1px solid ${MOBILE_STATUS.danger.border}`,
        borderRadius: 18, padding: "15px 14px", gap: 10,
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute", top: 0, insetInline: 0, height: 2,
          background: MOBILE_STATUS.danger.base,
          boxShadow: `0 0 14px ${MOBILE_STATUS.danger.base}`,
        }}
      />
      <div>
        <div style={{ fontSize: 32, fontWeight: 800, lineHeight: 1, color: MOBILE_STATUS.danger.fg }}>
          {toArabicDigits(n)}
        </div>
        <div style={{ fontSize: "11.5px", color: MOBILE_STATUS.danger.fg, opacity: 0.85, marginTop: 6 }}>
          عملاء غير موزّعين — ينتظرون قرارك
        </div>
      </div>
      <span
        className="m-ctapulse flex flex-none items-center"
        style={{
          boxSizing: "border-box", height: 40, padding: "0 18px", borderRadius: 12,
          background: MOBILE_STATUS.danger.base, color: "#FFFFFF",
          fontSize: 13, fontWeight: 700,
        }}
      >
        وزّع الآن ←
      </span>
    </Link>
  );
}

export function OwnerKpis({
  unassigned, total, conversion, bookings, visits,
}: {
  unassigned: number;
  total: number;
  conversion: number;
  bookings: number;
  visits: number;
}) {
  return (
    <div className="flex flex-col" style={{ gap: 9 }}>
      {unassigned > 0 && <UnassignedBanner count={unassigned} />}
      <div className="grid grid-cols-2" style={{ gap: 9 }}>
        <KpiCard label="إجمالي العملاء" value={total} color={MOBILE_COLORS.textPrimary} delayMs={90} />
        <KpiCard label="معدل التحويل" value={conversion} suffix="٪" ring color={MOBILE_COLORS.gold} delayMs={160} />
        <KpiCard label="عدد الحجوزات" value={bookings} color={MOBILE_COLORS.gold} delayMs={230} />
        <KpiCard label="عدد الزيارات" value={visits} color={MOBILE_COLORS.textPrimary} delayMs={300} />
      </div>
    </div>
  );
}

export default OwnerKpis;
