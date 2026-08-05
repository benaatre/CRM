import Link from "next/link";
import { cookies } from "next/headers";
import { Bell, Search } from "lucide-react";
import { MOBILE_COLORS, MOBILE_STATUS, MOBILE_THEME_COOKIE, normalizeTheme } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";
import { MobileThemeToggle } from "@/components/mobile/theme-toggle";

/**
 * أزرار ترويسة الرئيسية — ثلاثتها بهندسة النموذج نفسها: ٤٢×٤٢ · نصف قطر ١٤ ·
 * نفس الخلفية والحد · فجوة ٩ · ارتداد `m-iconbtn`.
 *
 * البحث لا يبني محركًا جديدًا: يفتح بحث /m/leads الموجود (getLeads({ q }))
 * بعلامة focus فيصل المؤشّر داخل الحقل مباشرة.
 */
export async function MobileHeaderActions({ unread }: { unread: number }) {
  const theme = normalizeTheme((await cookies()).get(MOBILE_THEME_COOKIE)?.value);

  const iconBtn = {
    boxSizing: "border-box" as const, width: 42, height: 42, borderRadius: 14,
    background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`,
  };

  return (
    <div className="flex items-center" style={{ gap: 9 }}>
      <MobileThemeToggle initial={theme} />

      <Link href="/m/leads?focus=1" aria-label="بحث" className="m-iconbtn flex items-center justify-center" style={iconBtn}>
        <Search size={19} strokeWidth={1.8} style={{ color: MOBILE_COLORS.textSecondary }} aria-hidden />
      </Link>

      {/* الجرس ← شاشة الإشعارات الفعلية، والشارة = غير المقروء (نفس مصدر الويب). */}
      <Link href="/m/notifications" aria-label="الإشعارات" className="m-iconbtn relative flex items-center justify-center" style={iconBtn}>
        <Bell size={19} strokeWidth={1.8} style={{ color: MOBILE_COLORS.textSecondary }} aria-hidden />
        {unread > 0 && (
          <span
            className="m-pulse absolute flex items-center justify-center"
            style={{
              boxSizing: "border-box", top: -6, left: -6, minWidth: 19, height: 19,
              borderRadius: 10, background: MOBILE_STATUS.danger.base, color: "#FFFFFF",
              fontSize: 10, fontWeight: 700, padding: "0 5px",
              border: `2px solid ${MOBILE_COLORS.bg}`,
            }}
          >
            {toArabicDigits(unread)}
          </span>
        )}
      </Link>
    </div>
  );
}

export default MobileHeaderActions;
