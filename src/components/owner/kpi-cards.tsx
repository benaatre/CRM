import type { OwnerKpiCard, OwnerKpis } from "@/lib/data/owner-dashboard";
import { toArabicDigits } from "@/lib/format";

/**
 * «الأرقام الأساسية» — ست بطاقات نيومورفية بارزة (SOP v2 §3): سطح raise يهمس،
 * بئر أيقونة غائر ملوّن، والرقم Zain بلون الدلالة. الزجاجية القديمة أُلغيت —
 * كل الألوان توكنات، والخلفيات الملوّنة color-mix من التوكن نفسه.
 */

type CardDef = {
  label: string;
  color: string;
  bg: string;
  icon: React.ReactNode;
  /** لاحقة الرقم (٪ للتحويل). */
  suffix?: string;
  /** نص بديل عن الدلتا (غير موزّعين → «ينتظرون»). */
  flatText?: string;
};

function Svg({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="size-[26px]" fill="none" stroke="currentColor"
      strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

// مسارات الأيقونات والألوان من بطاقات المرجع الست حرفيًا.
const DEFS: Record<keyof Omit<OwnerKpis, "range">, CardDef> = {
  unassigned: {
    label: "غير موزّعين", color: "var(--amber)", bg: "color-mix(in srgb, var(--amber) 12%, transparent)", flatText: "ينتظرون",
    icon: <Svg d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M17 8l5 5M22 8l-5 5" />,
  },
  totalClients: {
    label: "إجمالي العملاء", color: "var(--gold)", bg: "var(--gold-glow)",
    icon: <Svg d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />,
  },
  conversion: {
    label: "تحويل الزيارات", color: "var(--purple)", bg: "color-mix(in srgb, var(--purple) 12%, transparent)", suffix: "٪",
    icon: <Svg d="M3 3v18h18M18 9l-5 5-3-3-4 4" />,
  },
  closedWon: {
    label: "صفقات مقفولة", color: "var(--green)", bg: "color-mix(in srgb, var(--green) 12%, transparent)",
    icon: <Svg d="M22 11.1V12a10 10 0 1 1-5.9-9.1M22 4L12 14l-3-3" />,
  },
  visits: {
    label: "عدد الزيارات", color: "var(--blue)", bg: "color-mix(in srgb, var(--blue) 12%, transparent)",
    icon: <Svg d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0M12 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4" />,
  },
  bookings: {
    label: "عدد الحجوزات", color: "var(--gold)", bg: "var(--gold-glow)",
    icon: <Svg d="M20 7h-9M14 17H5M17 3l3 3-3 3M7 21l-3-3 3-3" />,
  },
};

const ORDER: (keyof Omit<OwnerKpis, "range">)[] = [
  "unassigned", "totalClients", "conversion", "closedWon", "visits", "bookings",
];

function Delta({ card, def }: { card: OwnerKpiCard; def: CardDef }) {
  if (card.delta === null) {
    // بلا دلتا (فترة «الكل» — ما فيه فترة سابقة نقارن بها): يظهر النص البديل إن وُجد فقط.
    if (!def.flatText) return null;
    return <div className="mt-[7px] text-xs" style={{ color: "var(--mut)" }}>{def.flatText}</div>;
  }
  const up = card.delta > 0;
  const down = card.delta < 0;
  const text = `${up ? "▲ +" : down ? "▼ −" : "="} ${toArabicDigits(Math.abs(card.delta))}${def.suffix ?? ""}`;
  return (
    <div
      className="mt-[7px] text-xs"
      style={{ color: up ? "var(--green)" : down ? "var(--red)" : "var(--mut)", fontVariantNumeric: "tabular-nums" }}
    >
      {card.delta === 0 ? "بلا تغيّر" : text}
    </div>
  );
}

export function KpiCards({ kpis }: { kpis: OwnerKpis }) {
  return (
    <div>
      <div className="grid grid-cols-2 gap-[13px] md:grid-cols-3 xl:grid-cols-6">
        {ORDER.map((key) => {
          const def = DEFS[key];
          const card = kpis[key];
          return (
            <div key={key} className="sop-raise n-btn px-[19px] py-5">
              <span
                className="sop-inset mb-[14px] flex size-[46px] items-center justify-center"
                style={{ background: def.bg, color: def.color, borderRadius: 14 }}
              >
                {def.icon}
              </span>
              <div
                className="text-[34px] font-black leading-none"
                style={{ fontFamily: "var(--font-zain), var(--font-sans)", color: def.color, fontVariantNumeric: "tabular-nums" }}
              >
                {toArabicDigits(card.value)}
                {def.suffix ?? ""}
              </div>
              <div className="mt-2 text-sm" style={{ color: "var(--tx2)" }}>{def.label}</div>
              <Delta card={card} def={def} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
