"use client";

import { useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Contact, CalendarCheck, Inbox, ScrollText, User } from "lucide-react";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";

/**
 * شريط الزئبق 💧 — التنقل السفلي الجديد (يستبدل BottomNav).
 *
 * طبقتان: طبقة أشكال بفلتر SVG goo (كبسولة 58px + قطرة 58px تنزلق وتنغمس/تنبثق)
 * وطبقة أيقونات فوقها بلا فلتر — النشطة ترتفع داخل القطرة بتوهج ذهبي واسمها
 * يبقى بالشريط. الموضع بالبكسل من عرض الحاوية (٤ خلايا) مع إعادة حساب عند resize.
 *
 * ⚠️ نفس قاعدة BottomNav القديم: `manager` prop من تخطيط (shell) الخادمي حصرًا —
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

/** الإدارة: خمس خلايا (v3) — التدقيق صار خلية مباشرة، وبلاطته في «حسابي» باقية. */
const MANAGER_TABS: Tab[] = [
  { href: "/m", label: "الرئيسية", icon: Home },
  { href: "/m/leads", label: "العملاء", icon: Contact },
  { href: "/m/unassigned", label: "غير موزّعين", icon: Inbox, badge: true },
  { href: "/m/audit", label: "التدقيق", icon: ScrollText },
  { href: "/m/more", label: "حسابي", icon: User },
];

const BAR_H = 58;
const RISE = 34; // ارتفاع الأيقونة النشطة داخل القطرة
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
  // خمس خلايا (الإدارة): قطرة 56 وخط أصغر لتستوعب الأسماء بلا التفاف — الموظف كما هو.
  const five = tabs.length >= 5;
  const DROP = five ? 56 : 58;

  // «/m» تُطابَق تمامًا حتى لا تبقى الرئيسية نشطة داخل كل تبويب.
  const activeIdx = tabs.findIndex((t) => (t.href === "/m" ? pathname === "/m" : pathname.startsWith(t.href)));

  // عرض الحاوية بالبكسل → موضع القطرة (٤ خلايا) — يعاد الحساب عند resize.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const measure = () => { if (wrapRef.current) setW(wrapRef.current.offsetWidth); };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const cell = w / tabs.length;
  const dropStart = activeIdx >= 0 && w > 0 ? activeIdx * cell + cell / 2 - DROP / 2 : 0;
  const showDrop = activeIdx >= 0 && w > 0;

  return (
    <nav
      dir="rtl"
      aria-label="التنقّل السفلي"
      className="fixed inset-x-0 bottom-0 z-50"
      style={{ paddingBottom: "env(safe-area-inset-bottom)", pointerEvents: "none" }}
    >
      {/* فلتر goo — blur 9 + رفع تباين الألفا (20 / −9) */}
      <svg width="0" height="0" aria-hidden style={{ position: "absolute" }}>
        <defs>
          <filter id="m-goo">
            <feGaussianBlur in="SourceGraphic" stdDeviation="9" result="blur" />
            <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9" result="goo" />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
        </defs>
      </svg>

      <div
        ref={wrapRef}
        className="relative mx-auto max-w-lg"
        style={{ height: BAR_H + RISE, margin: "0 14px", maxWidth: "min(32rem, calc(100% - 28px))", pointerEvents: "auto" }}
      >
        {/* ═══ طبقة الأشكال (goo) ═══ */}
        <div aria-hidden className="absolute inset-0" style={{ filter: "url(#m-goo)" }}>
          {/* الكبسولة — سطح مصمت من التوكنز */}
          <div
            className="absolute inset-x-0 bottom-0"
            style={{ height: BAR_H, borderRadius: BAR_H / 2, background: MOBILE_COLORS.sheet }}
          />
          {/* القطرة — تنزلق أفقيًا وتنغمس/تنبثق عند التبديل */}
          {showDrop && (
            <div
              className="m-goo-drop absolute"
              style={{
                width: DROP, height: DROP, borderRadius: DROP / 2,
                background: MOBILE_COLORS.sheet,
                bottom: RISE - 2,
                insetInlineStart: dropStart,
              }}
            >
              {/* squish — يُعاد تشغيله بتغيّر الخلية (key) دون كسر انزلاق الأب */}
              <div key={activeIdx} className="m-goo-squish h-full w-full" style={{ borderRadius: DROP / 2, background: MOBILE_COLORS.sheet }} />
            </div>
          )}
        </div>

        {/* هالة radial خلف القطرة — خارج الفلتر، تتبع نفس الموضع */}
        {showDrop && (
          <div
            aria-hidden
            className="m-goo-drop absolute"
            style={{
              width: DROP + 26, height: DROP + 26, borderRadius: "50%",
              bottom: RISE - 15,
              insetInlineStart: dropStart - 13,
              background: `radial-gradient(closest-side, ${MOBILE_COLORS.goldBg}, transparent)`,
            }}
          />
        )}

        {/* ═══ طبقة الأيقونات (بلا فلتر) ═══ */}
        <ul className="absolute inset-x-0 bottom-0 flex" style={{ height: BAR_H }}>
          {tabs.map((tab, i) => {
            const Icon = tab.icon;
            const active = i === activeIdx;
            const badge = tab.badge ? badgeCount : 0;
            return (
              <li key={tab.href} className="flex-1">
                <Link
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className="flex h-full flex-col items-center justify-center"
                  style={{ gap: 3, color: active ? MOBILE_COLORS.gold : MOBILE_COLORS.textMuted }}
                >
                  <span
                    className="m-goo-icon relative"
                    style={{
                      transform: active ? `translateY(-${RISE}px) scale(1.15)` : "none",
                      filter: active ? `drop-shadow(0 0 9px ${MOBILE_COLORS.goldBg})` : undefined,
                    }}
                  >
                    <Icon className="size-5" strokeWidth={active ? 2.4 : 1.8} aria-hidden />
                    {badge > 0 && (
                      <span
                        className="absolute flex items-center justify-center"
                        style={{
                          boxSizing: "border-box", top: -6, left: -10, minWidth: 17, height: 17,
                          borderRadius: 9, background: MOBILE_STATUS.danger.base, color: "var(--sop-tx)",
                          fontSize: 9, fontWeight: 700, padding: "0 4px",
                          border: `2px solid ${MOBILE_COLORS.sheet}`,
                        }}
                      >
                        {toArabicDigits(badge > 99 ? 99 : badge)}
                      </span>
                    )}
                  </span>
                  <span className="whitespace-nowrap" style={{ fontSize: five ? 9 : 11, fontWeight: active ? 700 : 500 }}>{tab.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}

export default MercuryNav;
