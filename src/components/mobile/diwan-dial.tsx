import { MOBILE_COLORS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";

/**
 * دائرة تقدّم «الديوان» ١٢٨×١٢٨ — منجز/إجمالي مواعيد اليوم.
 *
 * server + CSS خالص (لا عميل): التكات الستون تُرسم بحلقة JSX حتمية،
 * وامتلاء الحلقة بنمط m-ringfill — keyframe «from» الممتلئ والقيمة النهائية
 * من style السطري، والترس المنقّط والتوهج كلاسات mobile.css (تحترم
 * reduced-motion). الأرقام عربية (قرار معتمد) بخط Zain tabular.
 */

const R = 49;
const DASH = 2 * Math.PI * R; // ≈ 307.9 — نفس قيمة keyframe m-ringfill

export function DiwanDial({ done, total }: { done: number; total: number }) {
  const ratio = total > 0 ? Math.min(1, done / total) : 0;

  // التكات: ٦٠ خطًا كل ٦ درجات — الخامس أطول وبلون ذهبي شفاف.
  const ticks = Array.from({ length: 60 }, (_, i) => {
    const a = (i * 6 * Math.PI) / 180;
    const big = i % 5 === 0;
    const r1 = big ? 55 : 57.5;
    const r2 = 60.5;
    return {
      key: i,
      x1: 64 + r1 * Math.sin(a), y1: 64 - r1 * Math.cos(a),
      x2: 64 + r2 * Math.sin(a), y2: 64 - r2 * Math.cos(a),
      big,
    };
  });

  return (
    <div className="relative flex-none" style={{ width: 128, height: 128 }}>
      {/* الترس المنقّط الدوّار */}
      <span
        aria-hidden
        className="m-gearspin absolute rounded-full"
        style={{ inset: -6, border: `1px dashed ${MOBILE_COLORS.accA32}` }}
      />
      {/* التوهج المتنفّس */}
      <span aria-hidden className="m-dialbreathe absolute rounded-full" style={{ inset: 8 }} />

      <svg viewBox="0 0 128 128" className="absolute inset-0" aria-hidden>
        <g>
          {ticks.map((t) => (
            <line
              key={t.key}
              x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
              stroke={t.big ? MOBILE_COLORS.accA32 : MOBILE_COLORS.hair}
              strokeWidth={t.big ? 1.3 : 1}
            />
          ))}
        </g>
        <circle cx="64" cy="64" r={R} fill="none" stroke={MOBILE_COLORS.border} strokeWidth="4.5" />
        {/* الامتلاء يبدأ من فوق ومع عقارب الساعة بصريًا في RTL (انعكاس المرجع نفسه) */}
        <circle
          className="m-ringfill"
          cx="64" cy="64" r={R}
          fill="none" stroke={MOBILE_COLORS.gold} strokeWidth="4.5" strokeLinecap="round"
          strokeDasharray={DASH}
          strokeDashoffset={DASH - DASH * ratio}
          transform="rotate(-90 64 64) scale(-1,1) translate(-128,0)"
        />
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span
          dir="ltr"
          style={{
            fontFamily: "var(--font-zain), var(--font-sans)",
            fontVariantNumeric: "tabular-nums",
            fontSize: 27, fontWeight: 700, lineHeight: 1,
            background: `linear-gradient(165deg, ${MOBILE_COLORS.gradA}, ${MOBILE_COLORS.gradB} 55%, ${MOBILE_COLORS.gradC})`,
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
          }}
        >
          {toArabicDigits(done)}
          <span style={{ fontWeight: 400, fontSize: 15 }}> /{toArabicDigits(total)}</span>
        </span>
        <span style={{ fontSize: 9, letterSpacing: "0.18em", color: MOBILE_COLORS.textMuted, marginTop: 4 }}>
          مهام اليوم
        </span>
      </div>
    </div>
  );
}

export default DiwanDial;
