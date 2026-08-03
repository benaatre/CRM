"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, UserPlus, CalendarCheck, Contact, Menu } from "lucide-react";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";

type TabKey = "home" | "new" | "today" | "leads" | "more";
const TABS: { key: TabKey; href: string; label: string; icon: typeof Home }[] = [
  { key: "home", href: "/m", label: "الرئيسية", icon: Home },
  { key: "new", href: "/m/new", label: "جدد", icon: UserPlus },
  { key: "today", href: "/m/today", label: "متابعات", icon: CalendarCheck },
  { key: "leads", href: "/m/leads", label: "العملاء", icon: Contact },
  { key: "more", href: "/m/more", label: "المزيد", icon: Menu },
];

/**
 * الشريط السفلي — خمسة تبويبات ثابتة أسفل الشاشة.
 * كل هدف لمس ≥ ٤٤ بكسل (min-h-11)، والشريط يرتفع فوق شريط الإيماءات
 * عبر padding سفلي بمقدار safe-area-inset-bottom.
 * الشارات تصل من تخطيط (shell) — نفس مصدر أرقام الشاشات (buildAgenda).
 */
export function BottomNav({
  newCount = 0,
  todayCount = 0,
}: {
  newCount?: number;
  todayCount?: number;
}) {
  const pathname = usePathname();
  const badges: Partial<Record<TabKey, number>> = { new: newCount, today: todayCount };

  return (
    <nav
      dir="rtl"
      aria-label="التنقّل السفلي"
      className="fixed inset-x-0 bottom-0 z-50 border-t"
      style={{
        // --tabbar: شفاف مع ضبابية خلفية (زجاج) — مطابق للنموذج.
        backgroundColor: MOBILE_COLORS.tabbar,
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderColor: MOBILE_COLORS.line3,
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <ul className="mx-auto flex max-w-lg items-stretch">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          // «/m» تُطابَق تمامًا حتى لا تبقى الرئيسية نشطة داخل كل تبويب.
          const active = tab.href === "/m" ? pathname === "/m" : pathname.startsWith(tab.href);
          const badge = badges[tab.key] ?? 0;
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className="flex min-h-11 flex-col items-center justify-center gap-1 py-2 text-[0.6875rem] transition-colors"
                style={{ color: active ? MOBILE_COLORS.gold : MOBILE_COLORS.textMuted }}
              >
                <span className="relative">
                  <Icon className="size-5" strokeWidth={active ? 2.4 : 1.8} aria-hidden />
                  {badge > 0 && (
                    <span
                      className="absolute flex items-center justify-center"
                      style={{
                        boxSizing: "border-box", top: -6, left: -10, minWidth: 17, height: 17,
                        borderRadius: 9, background: MOBILE_STATUS.danger.base, color: "#FFFFFF",
                        fontSize: 9, fontWeight: 700, padding: "0 4px",
                        border: `2px solid ${MOBILE_COLORS.bg}`,
                      }}
                    >
                      {toArabicDigits(badge > 99 ? 99 : badge)}
                    </span>
                  )}
                </span>
                <span>{tab.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export default BottomNav;
