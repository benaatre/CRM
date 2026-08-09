"use client";

import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";
import { useCountUp } from "@/components/mobile/owner-kpis";

/**
 * كروت «متابعات الموظفين» — التزام كل موظف بمواعيده (أنجز/فاته/الكل + نسبة وشريط).
 * client لأجل rAF (العدّ والشريط) فقط — الصفوف تصل جاهزة ومرتّبة من الخادم.
 * الحركة: m-rise (دخول متتابع) + m-press (ضغط scale) — transform/opacity، تحترم تقليل الحركة.
 */

export type CommitmentRow = {
  id: string;
  name: string;
  done: number;
  missed: number;
  total: number;
  pct: number;
  lastLabel: string;
};

/** خانة إحصاء صغيرة بلون حالتها (أنجز أخضر · فاته أحمر · الكل ذهبي). */
function StatBox({ label, value, base, bg, fg, border }: {
  label: string; value: number; base: string; bg: string; fg: string; border: string;
}) {
  const n = useCountUp(value);
  return (
    <div
      className="flex flex-col items-center justify-center"
      style={{
        boxSizing: "border-box", minHeight: 52, gap: 3,
        background: bg, border: `1px solid ${border}`, borderRadius: 11,
      }}
    >
      <span style={{ fontSize: 17, fontWeight: 700, lineHeight: 1, color: base }}>{toArabicDigits(n)}</span>
      <span style={{ fontSize: "10.5px", color: fg }}>{label}</span>
    </div>
  );
}

function CommitmentCard({ row, delayMs }: { row: CommitmentRow; delayMs: number }) {
  const pct = useCountUp(row.pct);
  return (
    <div
      className="m-rise m-press relative flex flex-col overflow-hidden"
      style={{
        boxSizing: "border-box",
        background: `linear-gradient(165deg, ${MOBILE_COLORS.goldBg} 0%, ${MOBILE_COLORS.card} 55%)`,
        border: `1px solid ${MOBILE_COLORS.border}`,
        borderRadius: 16, padding: "13px 14px", gap: 10,
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
      <div className="flex items-baseline justify-between" style={{ gap: 8 }}>
        <span className="truncate" style={{ fontSize: "14.5px", fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>
          {row.name}
        </span>
        <span className="flex-none" style={{ fontSize: "10.5px", color: MOBILE_COLORS.textMuted }}>
          {row.lastLabel}
        </span>
      </div>

      <div className="grid grid-cols-3" style={{ gap: 7 }}>
        <StatBox label="أنجز" value={row.done} base={MOBILE_STATUS.success.base} bg={MOBILE_STATUS.success.bg} fg={MOBILE_STATUS.success.fg} border={MOBILE_STATUS.success.border} />
        <StatBox label="فاته" value={row.missed} base={MOBILE_STATUS.danger.base} bg={MOBILE_STATUS.danger.bg} fg={MOBILE_STATUS.danger.fg} border={MOBILE_STATUS.danger.border} />
        <StatBox label="الكل" value={row.total} base={MOBILE_COLORS.gold} bg={MOBILE_COLORS.goldBg} fg={MOBILE_COLORS.goldLight} border={MOBILE_COLORS.goldBorder} />
      </div>

      <div className="flex items-center" style={{ gap: 9 }}>
        <div className="flex-1 overflow-hidden" style={{ height: 6, borderRadius: 3, background: MOBILE_COLORS.line2 }}>
          {/* الامتلاء بـscaleX (transform فقط) — الأصل يمين لاتجاه RTL، يتحرك مع نفس rAF النسبة */}
          <div
            style={{
              height: "100%", borderRadius: 3, background: MOBILE_COLORS.gold,
              transform: `scaleX(${pct / 100})`, transformOrigin: "right",
            }}
          />
        </div>
        <span style={{ fontSize: "11.5px", fontWeight: 700, color: MOBILE_COLORS.gold }}>
          {toArabicDigits(pct)}٪
        </span>
      </div>
    </div>
  );
}

export function TeamCommitment({ rows }: { rows: CommitmentRow[] }) {
  return (
    <div className="flex flex-col" style={{ gap: 10 }}>
      {rows.map((r, i) => (
        <CommitmentCard key={r.id} row={r} delayMs={i * 70} />
      ))}
    </div>
  );
}

export default TeamCommitment;
