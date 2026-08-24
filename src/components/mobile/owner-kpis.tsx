"use client";

import { useEffect, useState } from "react";
import { Users, Eye, SquareCheckBig } from "lucide-react";
import { SOP } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";

/**
 * حبوب «أرقام الأداء» (رئيسية المالك — owner-home-final): شبكة ٢×٢ بأسلوب
 * النيومورفيزم الناعم (.m-raise): إجمالي العملاء (ذهبي) · تحويل لحجز بحلقة (أخضر)
 * · زيارات (أزرق) · حجوزات (كهرماني). client لأجل rAF فقط؛ البيانات كلها props
 * من getDashboard (لا استعلامات هنا). العدّ والحلقة يحترمان prefers-reduced-motion.
 */

const ZAIN = { fontFamily: "var(--font-zain), var(--font-sans)", fontVariantNumeric: "tabular-nums" as const };

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

/** حلقة تقدّم SVG (٤٤px، النموذج حرفيًا) — تمتلئ بتزامن مع رقم العدّ (نفس قيمة rAF الواحدة). */
function Ring({ pct, color, size = 44, stroke = 4 }: { pct: number; color: string; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.min(pct, 100) / 100);
  return (
    <svg
      data-svg-free
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ maxWidth: size, maxHeight: size, transform: "rotate(-90deg)" }}
      aria-hidden
    >
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={SOP.sd} strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={off}
      />
    </svg>
  );
}

/** حبة رقم: أيقونة داخل صندوق ملوّن خافت + التسمية + القيمة بخط Zain. */
function Pill({
  icon: Icon, label, value, suffix = "", color, delayMs,
}: {
  icon: typeof Users;
  label: string;
  value: number;
  suffix?: string;
  color: string;
  delayMs: number;
}) {
  const n = useCountUp(value);
  return (
    <div
      className="m-raise m-rise m-press-sc flex items-center"
      style={{ boxSizing: "border-box", borderRadius: 15, padding: 12, gap: 11, animationDelay: `${delayMs}ms` }}
    >
      <span
        className="flex flex-none items-center justify-center"
        style={{
          boxSizing: "border-box", width: 36, height: 36, borderRadius: 11,
          background: `color-mix(in srgb, ${color} 15%, transparent)`,
        }}
      >
        <Icon size={18} strokeWidth={1.7} style={{ color, maxWidth: 24, maxHeight: 24 }} aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block truncate" style={{ fontSize: "9.5px", color: SOP.tx2 }}>{label}</span>
        <span className="block" style={{ ...ZAIN, fontSize: 23, fontWeight: 800, lineHeight: 1.1, color }}>
          {toArabicDigits(n)}{suffix}
        </span>
      </span>
    </div>
  );
}

/** حبة الحلقة (تحويل لحجز): النسبة داخل الحلقة، والتسمية بجانبها. */
function RingPill({ label, pct, color, delayMs }: { label: string; pct: number; color: string; delayMs: number }) {
  const n = useCountUp(pct);
  return (
    <div
      className="m-raise m-rise m-press-sc flex items-center"
      style={{ boxSizing: "border-box", borderRadius: 15, padding: 12, gap: 11, animationDelay: `${delayMs}ms` }}
    >
      <span className="relative flex-none" style={{ width: 44, height: 44 }}>
        <Ring pct={n} color={color} />
        <span
          className="absolute inset-0 flex items-center justify-center"
          style={{ ...ZAIN, fontSize: 12, fontWeight: 800, color }}
        >
          {toArabicDigits(n)}٪
        </span>
      </span>
      <span className="min-w-0" style={{ fontSize: "9.5px", color: SOP.tx2 }}>{label}</span>
    </div>
  );
}

export function OwnerKpis({
  totalClients, conversion, bookings, visits,
}: {
  totalClients: number;
  conversion: number;
  bookings: number;
  visits: number;
}) {
  return (
    <div className="grid grid-cols-2" style={{ gap: 10 }}>
      <Pill icon={Users} label="إجمالي العملاء" value={totalClients} color={SOP.gold2} delayMs={100} />
      <RingPill label="تحويل لحجز" pct={conversion} color={SOP.green} delayMs={150} />
      <Pill icon={Eye} label="زيارات" value={visits} color={SOP.blue} delayMs={200} />
      <Pill icon={SquareCheckBig} label="حجوزات" value={bookings} color={SOP.amber} delayMs={250} />
    </div>
  );
}

export default OwnerKpis;
