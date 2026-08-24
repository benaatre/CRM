"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Contact, CalendarCheck, Inbox, ScrollText, User } from "lucide-react";
import { SOP } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";

/**
 * التنقّل السفلي — تصميم «الخط العلوي المضيء» (owner-home-final): شريط طافٍ
 * بأسطح النيومورفيزم، الخلية النشطة لها خط ذهبي متوهّج فوقها وأيقونتها ذهبية
 * بتوهّج، وشارة «غير موزّعين» حمراء نابضة. (يستبدل شريط الزئبق goo — مظهر فقط:
 * نفس الطقوم والمسارات ومنطق الشارة حرفيًا.)
 *
 * ⚠️ نفس القاعدة القائمة: `manager` prop من تخطيط (shell) الخادمي حصرًا —
 * لا اشتقاق دور هنا (اختلاف ترطيب). الطقمان ثابتان على مستوى الوحدة.
 */

type Tab = { href: string; label: string; icon: typeof Home; badge?: boolean };

/** الموظف: الرئيسية · العملاء · المتابعات (شارة الفايتة) · حسابي. */
const EMPLOYEE_TABS: Tab[] = [
  { href: "/m", label: "الرئيسية", icon: Home },
  { href: "/m/leads", label: "العملاء", icon: Contact },
  { href: "/m/today", label: "المتابعات", icon: CalendarCheck, badge: true },
  { href: "/m/more", label: "حسابي", icon: User },
];

/** المدير المالي (2026-08-20): بلا عملاء — الرئيسية · خط المبيعات · المشاريع · حسابي. */
const FINANCE_TABS: Tab[] = [
  { href: "/m", label: "الرئيسية", icon: Home },
  { href: "/m/bookings", label: "المبيعات", icon: Inbox },
  { href: "/m/projects", label: "المشاريع", icon: ScrollText },
  { href: "/m/more", label: "حسابي", icon: User },
];

/** الإدارة: خمس خلايا — التدقيق خلية مباشرة، وبلاطته في «حسابي» باقية. */
const MANAGER_TABS: Tab[] = [
  { href: "/m", label: "الرئيسية", icon: Home },
  { href: "/m/leads", label: "العملاء", icon: Contact },
  { href: "/m/unassigned", label: "غير موزّعين", icon: Inbox, badge: true },
  { href: "/m/audit", label: "التدقيق", icon: ScrollText },
  { href: "/m/more", label: "حسابي", icon: User },
];

export function MercuryNav({
  manager = false,
  badgeCount = 0,
  finance = false,
}: {
  /** الدور من تخطيط (shell) الخادمي — يختار الطقم فقط. */
  manager?: boolean;
  /** شارة الخلية الثالثة: للموظف = مواعيد اليوم الفايتة؛ للإدارة = غير الموزّعين. */
  badgeCount?: number;
  /** المدير المالي — طقم بلا عملاء (قرار 2026-08-20). */
  finance?: boolean;
}) {
  const pathname = usePathname();
  const tabs = finance ? FINANCE_TABS : manager ? MANAGER_TABS : EMPLOYEE_TABS;

  // «/m» تُطابَق تمامًا حتى لا تبقى الرئيسية نشطة داخل كل تبويب.
  const activeIdx = tabs.findIndex((t) => (t.href === "/m" ? pathname === "/m" : pathname.startsWith(t.href)));

  return (
    <nav
      dir="rtl"
      aria-label="التنقّل السفلي"
      className="fixed inset-x-0 bottom-0 z-50"
      style={{
        // تلاشي أرضية الصفحة خلف الشريط (المرجع حرفيًا).
        background: `linear-gradient(0deg, ${SOP.page} 60%, transparent)`,
        padding: `8px 14px calc(14px + env(safe-area-inset-bottom))`,
      }}
    >
      <div
        className="mx-auto flex max-w-lg"
        style={{
          boxSizing: "border-box",
          background: SOP.plane,
          border: `1px solid ${SOP.edge}`,
          borderRadius: "20px 20px 16px 16px",
          padding: "10px 6px 8px",
          boxShadow: `5px 5px 13px ${SOP.sd}, -5px -5px 13px ${SOP.sl}`,
        }}
      >
        {tabs.map((tab, i) => {
          const Icon = tab.icon;
          const active = i === activeIdx;
          const badge = tab.badge ? badgeCount : 0;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className="relative flex flex-1 flex-col items-center"
              style={{ gap: 4, padding: "6px 0" }}
            >
              {/* الخط العلوي المضيء — للخلية النشطة فقط */}
              {active && (
                <span
                  aria-hidden
                  className="absolute"
                  style={{
                    top: -10, width: 26, height: 3, borderRadius: 2,
                    background: SOP.gold, boxShadow: `0 0 10px ${SOP.gold}`,
                  }}
                />
              )}
              <span className="relative">
                <Icon
                  size={21}
                  strokeWidth={1.8}
                  style={{
                    maxWidth: 24, maxHeight: 24,
                    color: active ? SOP.gold : SOP.mut,
                    filter: active ? `drop-shadow(0 0 6px color-mix(in srgb, ${SOP.gold} 55%, transparent))` : undefined,
                  }}
                  aria-hidden
                />
                {badge > 0 && (
                  <span
                    className="m-pulse absolute flex items-center justify-center"
                    style={{
                      fontFamily: "var(--font-zain), var(--font-sans)",
                      boxSizing: "border-box", top: -5, insetInlineStart: -12, minWidth: 16, height: 16,
                      borderRadius: 9, background: SOP.red, color: SOP.tx,
                      fontSize: 8, fontWeight: 800, padding: "0 4px",
                      boxShadow: `0 2px 6px color-mix(in srgb, ${SOP.red} 50%, transparent)`,
                    }}
                  >
                    {toArabicDigits(badge > 99 ? 99 : badge)}
                  </span>
                )}
              </span>
              <span
                className="whitespace-nowrap"
                style={{ fontSize: "8.5px", fontWeight: active ? 700 : 600, color: active ? SOP.gold : SOP.mut }}
              >
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export default MercuryNav;
