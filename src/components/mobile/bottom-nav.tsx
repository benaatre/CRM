"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, UserPlus, CalendarCheck, Contact, Menu } from "lucide-react";
import { MOBILE_COLORS } from "@/lib/mobile-tokens";

const TABS = [
  { href: "/m", label: "الرئيسية", icon: Home },
  { href: "/m/new", label: "جدد", icon: UserPlus },
  { href: "/m/today", label: "متابعات", icon: CalendarCheck },
  { href: "/m/leads", label: "العملاء", icon: Contact },
  { href: "/m/more", label: "المزيد", icon: Menu },
] as const;

/**
 * الشريط السفلي — خمسة تبويبات ثابتة أسفل الشاشة.
 * كل هدف لمس ≥ ٤٤ بكسل (min-h-11)، والشريط يرتفع فوق شريط الإيماءات
 * عبر padding سفلي بمقدار safe-area-inset-bottom.
 */
export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      dir="rtl"
      aria-label="التنقّل السفلي"
      className="fixed inset-x-0 bottom-0 z-50 border-t"
      style={{
        backgroundColor: MOBILE_COLORS.bg,
        borderColor: "#1E1E21",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <ul className="mx-auto flex max-w-lg items-stretch">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          // «/m» تُطابَق تمامًا حتى لا تبقى الرئيسية نشطة داخل كل تبويب.
          const active = tab.href === "/m" ? pathname === "/m" : pathname.startsWith(tab.href);
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className="flex min-h-11 flex-col items-center justify-center gap-1 py-2 text-[0.6875rem] transition-colors"
                style={{ color: active ? MOBILE_COLORS.gold : MOBILE_COLORS.textMuted }}
              >
                <Icon className="size-5" strokeWidth={active ? 2.4 : 1.8} aria-hidden />
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
