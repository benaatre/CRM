"use client";

import Link from "next/link";
import { MOBILE_COLORS } from "@/lib/mobile-tokens";

/**
 * شريحة فلتر أفقية — روابط لا أزرار، فالحالة في الرابط (قابلة للمشاركة والرجوع).
 * مقاسات النموذج: ارتفاع ٣٤ · زوايا ١٧ · حشوة أفقية ١٥ · نص ١٢٫٥/٦٠٠.
 * مساحة اللمس ٤٤ عبر حشوة رأسية شفافة (نفس نمط أزرار البطاقة).
 */
export function MobileChips<T extends string>({
  param,
  current,
  base,
  items,
  goldGradient = false,
}: {
  param: string;
  current: T;
  base: string;
  items: { key: T; label: string }[];
  /** الشريحة الفعّالة بتدرّج ذهبي مصمت (رئيسية المالك) بدل الخلفية الذهبية الخافتة. */
  goldGradient?: boolean;
}) {
  return (
    <div className="flex overflow-x-auto" style={{ gap: 8, paddingBottom: 2 }}>
      {items.map((it) => {
        const on = it.key === current;
        const href = it.key === items[0].key ? base : `${base}?${param}=${it.key}`;
        return (
          <Link
            key={it.key}
            href={href}
            scroll={false}
            className="flex flex-none items-center"
            style={{ paddingBlock: 5 }}
          >
            <span
              className="flex items-center whitespace-nowrap"
              style={{
                boxSizing: "border-box",
                height: 34,
                padding: "0 15px",
                borderRadius: 17,
                fontSize: "12.5px",
                fontWeight: 600,
                background: on
                  ? goldGradient
                    ? `linear-gradient(135deg, ${MOBILE_COLORS.goldLight}, ${MOBILE_COLORS.gold})`
                    : MOBILE_COLORS.goldBg
                  : MOBILE_COLORS.card,
                color: on ? (goldGradient ? MOBILE_COLORS.bg : MOBILE_COLORS.gold) : MOBILE_COLORS.textSecondary,
                border: `1px solid ${on ? (goldGradient ? "transparent" : MOBILE_COLORS.goldBorder) : MOBILE_COLORS.border}`,
              }}
            >
              {it.label}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

export default MobileChips;
