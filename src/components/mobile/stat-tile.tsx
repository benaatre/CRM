import Link from "next/link";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";

/**
 * بطاقة عدّاد في صف الرئيسية. العدّاد الصفري يفقد تمييزه اللوني عمدًا —
 * «صفر» ليس إنذارًا، فلا يستحق لون تنبيه.
 */
export function MobileStatTile({
  count,
  label,
  href,
  bg,
  countColor,
  labelColor,
  badge,
}: {
  count: number;
  label: string;
  href: string;
  /** خلفية الحالة عند وجود عدد (تُتجاهل عند الصفر). */
  bg?: string;
  /** لون الرقم عند وجود عدد (يُتجاهل عند الصفر). */
  countColor?: string;
  /** لون التسمية عند وجود عدد. */
  labelColor?: string;
  /** شارة حمراء صغيرة أسفل التسمية (المتأخرات مثلًا) — تظهر مهما كان العدّاد. */
  badge?: string;
}) {
  const zero = count === 0;

  return (
    <Link
      href={href}
      className="flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-[10px] p-2.5"
      style={{ backgroundColor: zero ? MOBILE_COLORS.card : (bg ?? MOBILE_COLORS.card) }}
    >
      <span
        className="text-[1.3125rem] font-semibold leading-none"
        style={{ color: zero ? MOBILE_COLORS.textMuted : (countColor ?? MOBILE_COLORS.gold) }}
      >
        {toArabicDigits(count)}
      </span>
      <span
        className="text-center text-[0.6875rem] leading-tight"
        style={{ color: zero ? MOBILE_COLORS.textMuted : (labelColor ?? MOBILE_COLORS.textSecondary) }}
      >
        {label}
      </span>
      {badge ? (
        <span
          className="mt-1 whitespace-nowrap rounded-full border px-1.5 py-px text-[0.625rem] font-semibold"
          style={{
            backgroundColor: MOBILE_STATUS.danger.bg,
            color: MOBILE_STATUS.danger.fg,
            borderColor: MOBILE_STATUS.danger.border,
          }}
        >
          {badge}
        </span>
      ) : null}
    </Link>
  );
}

export default MobileStatTile;
