"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CalendarCheck, Contact, Home, User } from "lucide-react";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";
import { shellElapsedMinutes, useAttendanceShell } from "@/components/mobile/attendance-shell";

/**
 * كبسولة «الديوان» العائمة — تنقّل الموظف السفلي بالزر المرتفع (§٢ من المرجع).
 *
 * كبسولة زجاجية منفصلة عن الحافة (blur 22 + radius 26 + ظل) بأربعة تبويبات،
 * وبمنتصفها زر الدوام المرتفع ٦٤px: بصمة ذهبية قبل البصم، وبعده أخضر بحلقة
 * تقدّم وعدّاد س:دد حي و«مداوم». زر إضافة العميل غير موجود (قرار معتمد).
 *
 * الإدارة تبقى على MercuryNav القائم بلا مساس — هذا للموظف حصرًا.
 * الزر عرض + تنقّل فقط: البصم نفسه يبقى في بطاقة الدوام واللوحة (منطق v2).
 */

const TABS_START = [
  { href: "/m", label: "الرئيسية", icon: Home },
  { href: "/m/leads", label: "العملاء", icon: Contact },
] as const;
const TABS_END = [
  { href: "/m/today", label: "المتابعات", icon: CalendarCheck, badge: true },
  { href: "/m/more", label: "حسابي", icon: User },
] as const;

const FAB = 64;
const RING_R = 29;
const RING_DASH = 2 * Math.PI * RING_R; // ≈ 182.2

export function DiwanNav({ badgeCount = 0 }: { badgeCount?: number }) {
  const pathname = usePathname();
  const router = useRouter();
  const shell = useAttendanceShell();
  const [now, setNow] = useState(() => Date.now());

  const s = shell?.status;
  const working = s?.state === "in" && !s.noResponse;

  // دقيقة تكفي — العدّاد س:دد.
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [working]);

  const minutes = s && working ? shellElapsedMinutes(s, now) : 0;
  const counter = `${toArabicDigits(Math.floor(minutes / 60))}:${toArabicDigits(String(minutes % 60).padStart(2, "0"))}`;
  const pct = s ? Math.min(1, minutes / s.targetMinutes) : 0;

  /** الزر: أثناء الدوام يفتح اللوحة؛ وقبله يوصلك لبطاقة الدوام بالرئيسية. */
  const onFab = () => {
    if (working) {
      if (pathname !== "/m") router.push("/m");
      shell?.setPanelOpen(true);
      return;
    }
    if (pathname !== "/m") {
      router.push("/m");
      return;
    }
    document.getElementById("att-card")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const item = (tab: { href: string; label: string; icon: typeof Home; badge?: boolean }) => {
    const Icon = tab.icon;
    const active = tab.href === "/m" ? pathname === "/m" : pathname.startsWith(tab.href);
    const badge = tab.badge ? badgeCount : 0;
    return (
      <Link
        key={tab.href}
        href={tab.href}
        aria-current={active ? "page" : undefined}
        className="flex flex-1 flex-col items-center"
        style={{ gap: 3, padding: "4px 0", fontSize: 9, fontWeight: active ? 700 : 500, color: active ? MOBILE_COLORS.gold : MOBILE_COLORS.textMuted }}
      >
        <span className="relative" style={{ filter: active ? `drop-shadow(0 0 9px ${MOBILE_COLORS.goldBg})` : undefined }}>
          <Icon className="size-5" strokeWidth={active ? 2.2 : 1.6} aria-hidden />
          {badge > 0 && (
            <span
              className="absolute flex items-center justify-center"
              style={{
                boxSizing: "border-box", top: -5, left: -9, minWidth: 16, height: 16,
                borderRadius: 8, background: MOBILE_STATUS.danger.base, color: "var(--sop-tx)",
                fontSize: 8.5, fontWeight: 700, padding: "0 4px",
                border: `1.5px solid ${MOBILE_COLORS.sheet}`,
              }}
            >
              {toArabicDigits(badge > 99 ? 99 : badge)}
            </span>
          )}
        </span>
        <span className="whitespace-nowrap">{tab.label}</span>
      </Link>
    );
  };

  return (
    <nav
      dir="rtl"
      aria-label="التنقّل السفلي"
      className="fixed inset-x-0 bottom-0 z-50 flex justify-center"
      style={{ pointerEvents: "none", paddingBottom: "max(14px, env(safe-area-inset-bottom))" }}
    >
      <div
        className="relative flex items-center justify-around"
        style={{
          pointerEvents: "auto",
          width: "min(402px, calc(100% - 28px))",
          background: MOBILE_COLORS.navBg,
          backdropFilter: "blur(22px) saturate(1.3)",
          WebkitBackdropFilter: "blur(22px) saturate(1.3)",
          border: `1px solid ${MOBILE_COLORS.hair}`,
          borderRadius: 26,
          padding: "10px 8px",
          boxShadow: "0 12px 32px rgba(0, 0, 0, 0.42)",
        }}
      >
        {TABS_START.map(item)}

        {/* ===== زر الدوام المرتفع ===== */}
        <div className="flex flex-none justify-center" style={{ width: 70, pointerEvents: "none" }}>
          <button
            type="button"
            onClick={onFab}
            aria-label={working ? `الدوام — مداوم منذ ${counter}` : "تسجيل الدوام"}
            className={`m-press relative${working ? " m-fab-live" : ""}`}
            style={{ pointerEvents: "auto", top: -24, width: FAB, height: FAB }}
          >
            {/* data-svg-free: حلقة التقدّم ٦٤px مستثناة من سقف أيقونات الأزرار (mobile.css). */}
            <svg data-svg-free width={FAB} height={FAB} className="absolute inset-0" style={{ transform: "rotate(-90deg)" }} aria-hidden>
              <circle cx={FAB / 2} cy={FAB / 2} r={RING_R} fill="none" strokeWidth="3.2" style={{ stroke: "rgba(255,255,255,0.14)" }} />
              {working && (
                <circle
                  cx={FAB / 2} cy={FAB / 2} r={RING_R}
                  fill="none" strokeWidth="3.2" strokeLinecap="round"
                  style={{
                    stroke: MOBILE_COLORS.dwGreen,
                    strokeDasharray: RING_DASH,
                    strokeDashoffset: RING_DASH * (1 - pct),
                    transition: "stroke-dashoffset 1s linear",
                  }}
                />
              )}
            </svg>
            <span
              className="absolute flex flex-col items-center justify-center rounded-full"
              style={{
                inset: 5, gap: 1,
                background: working
                  ? `linear-gradient(150deg, ${MOBILE_COLORS.dwGreen}, ${MOBILE_COLORS.dwGreenD})`
                  : MOBILE_COLORS.gold,
                color: working ? "var(--sop-ongold)" : "var(--m-gold-bg)",
                boxShadow: working
                  ? "0 8px 22px color-mix(in srgb, var(--m-dw-green) 40%, transparent), inset 0 1px 0 rgba(255,255,255,0.25)"
                  : `0 8px 22px ${MOBILE_COLORS.accGlow}, inset 0 1px 0 rgba(255,255,255,0.25)`,
                transition: "background 0.35s",
              }}
            >
              {working ? (
                <>
                  <span dir="ltr" style={{ fontFamily: "var(--font-zain), var(--font-sans)", fontSize: 13, fontWeight: 800, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                    {counter}
                  </span>
                  <span style={{ fontSize: 7, fontWeight: 700, opacity: 0.85 }}>مداوم</span>
                </>
              ) : (
                /* أيقونة البصمة — svg المرجع حرفيًا */
                <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden>
                  <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
                  <circle cx="12" cy="12" r="4" />
                </svg>
              )}
            </span>
          </button>
        </div>

        {TABS_END.map(item)}
      </div>
    </nav>
  );
}

export default DiwanNav;
