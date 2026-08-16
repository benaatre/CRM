import Link from "next/link";
import { cookies } from "next/headers";
import { Bell, Search } from "lucide-react";
import { MOBILE_COLORS, MOBILE_THEME_COOKIE, normalizeTheme } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";
import { MobileThemeToggle } from "@/components/mobile/theme-toggle";

/**
 * التوب بار اللاصق «الديوان» — شعار الشركة + بحث + جرس بشارة + ليلي/نهاري.
 *
 * يمتد بعرض الشاشة بهوامش سالبة تعادل حشوة قشرة (shell) حرفيًا
 * (18px جانبًا + safe-area+18 علويًا) — علاج داخل الصفحة، القشرة المشتركة لا تُمس.
 * زجاج مموّه --m-nav-bg + حد سفلي شعري، والأزرار ٣٦×٣٦ بنصف قطر ١٢ كما في المرجع.
 *
 * يرث وظائف `MobileHeaderActions` حرفيًا (نفس الروابط ونفس مصدر غير المقروء
 * ونفس زر الثيم) — البديل البصري لها في رئيسية الموظف وحدها؛ رئيسية المالك
 * تبقى على المكوّن القديم بلا مساس.
 */

/** سطر الهوية الثاني — نصّ المرجع البصري المعتمد (لا حقل له في Settings). */
const BRAND_TAGLINE = "بنائات العقارية";

export async function DiwanTopbar({ companyName, unread }: { companyName: string; unread: number }) {
  const theme = normalizeTheme((await cookies()).get(MOBILE_THEME_COOKIE)?.value);

  const tbtn = {
    boxSizing: "border-box" as const, width: 36, height: 36, borderRadius: 12,
    background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.hair}`,
  };

  return (
    <div
      className="sticky flex items-center"
      style={{
        // فوق بطاقات الصفحة وتحت شريط الزئبق (z:50) والأوراق.
        zIndex: 40,
        gap: 8,
        // إلغاء حشوة القشرة: علويًا safe-area+18 وجانبًا 18 — ثم إعادة حشوة داخلية.
        margin: "calc(-1 * (env(safe-area-inset-top) + 18px)) -18px 0",
        top: 0,
        padding: "calc(env(safe-area-inset-top) + 12px) 18px 12px",
        background: MOBILE_COLORS.navBg,
        backdropFilter: "blur(20px) saturate(1.15)",
        WebkitBackdropFilter: "blur(20px) saturate(1.15)",
        borderBottom: `1px solid ${MOBILE_COLORS.hair}`,
      }}
    >
      <div className="flex min-w-0 flex-1 items-center" style={{ gap: 9 }}>
        <span
          className="flex flex-none items-center justify-center"
          style={{
            boxSizing: "border-box", width: 32, height: 32, borderRadius: 16,
            border: `1px solid ${MOBILE_COLORS.accA32}`,
            fontFamily: "var(--font-zain), var(--font-sans)",
            fontWeight: 700, fontSize: 13, color: MOBILE_COLORS.gold,
          }}
          aria-hidden
        >
          {companyName.trim().charAt(0) || "س"}
        </span>
        <div className="min-w-0">
          <div className="truncate" style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.2, color: MOBILE_COLORS.textPrimary }}>
            {companyName}
          </div>
          <div style={{ fontSize: 9.5, color: MOBILE_COLORS.textMuted, marginTop: 1 }}>{BRAND_TAGLINE}</div>
        </div>
      </div>

      <Link href="/m/leads?focus=1" aria-label="بحث" className="m-press flex flex-none items-center justify-center" style={tbtn}>
        <Search size={16} strokeWidth={1.6} style={{ color: MOBILE_COLORS.textSecondary }} aria-hidden />
      </Link>

      {/* الجرس ← شاشة الإشعارات، والشارة = غير المقروء (نفس مصدر الويب). */}
      <Link href="/m/notifications" aria-label="الإشعارات" className="m-press relative flex flex-none items-center justify-center" style={tbtn}>
        <Bell size={16} strokeWidth={1.6} style={{ color: unread > 0 ? MOBILE_COLORS.amber : MOBILE_COLORS.textSecondary }} aria-hidden />
        {unread > 0 && (
          <span
            className="absolute flex items-center justify-center"
            style={{
              boxSizing: "border-box", top: -4, left: -4, minWidth: 15, height: 15,
              borderRadius: 8, background: MOBILE_COLORS.amber, color: MOBILE_COLORS.bg,
              fontSize: 8.5, fontWeight: 700, padding: "0 3px",
              fontFamily: "var(--font-zain), var(--font-sans)",
              border: `1.5px solid ${MOBILE_COLORS.bg}`,
            }}
          >
            {toArabicDigits(unread > 99 ? 99 : unread)}
          </span>
        )}
      </Link>

      <MobileThemeToggle initial={theme} compact />
    </div>
  );
}

export default DiwanTopbar;
