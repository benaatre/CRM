import Link from "next/link";
import { cookies } from "next/headers";
import { Bell, Search } from "lucide-react";
import { SOP, MOBILE_THEME_COOKIE, normalizeTheme } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";
import { MobileThemeToggle } from "@/components/mobile/theme-toggle";

/**
 * أزرار ترويسة رئيسية المالك — هندسة owner-home-final حرفيًا: ٣٥×٣٥ ·
 * نصف قطر ١١ · سطح بارز (.m-raise) · فجوة ٧ · أيقونة ١٥.
 *
 * البحث لا يبني محركًا جديدًا: يفتح بحث /m/leads الموجود (getLeads({ q }))
 * بعلامة focus فيصل المؤشّر داخل الحقل مباشرة.
 */
export async function MobileHeaderActions({ unread }: { unread: number }) {
  const theme = normalizeTheme((await cookies()).get(MOBILE_THEME_COOKIE)?.value);

  const iconBtn = {
    boxSizing: "border-box" as const, width: 35, height: 35, borderRadius: 11,
    color: SOP.tx2,
  };

  return (
    <div className="flex items-center" style={{ gap: 7 }}>
      <MobileThemeToggle initial={theme} />

      <Link href="/m/leads?focus=1" aria-label="بحث" className="m-raise m-press-sc flex items-center justify-center" style={iconBtn}>
        <Search size={15} strokeWidth={1.7} style={{ maxWidth: 24, maxHeight: 24 }} aria-hidden />
      </Link>

      {/* الجرس ← شاشة الإشعارات الفعلية، والشارة = غير المقروء (نفس مصدر الويب). */}
      <Link href="/m/notifications" aria-label="الإشعارات" className="m-raise m-press-sc relative flex items-center justify-center" style={iconBtn}>
        <Bell size={15} strokeWidth={1.7} style={{ maxWidth: 24, maxHeight: 24 }} aria-hidden />
        {unread > 0 && (
          <span
            className="absolute flex items-center justify-center"
            style={{
              ...{ fontFamily: "var(--font-zain), var(--font-sans)" },
              boxSizing: "border-box", top: -3, insetInlineStart: -3, minWidth: 15, height: 15,
              borderRadius: 8, background: SOP.red, color: SOP.tx,
              fontSize: 8, fontWeight: 700, padding: "0 4px",
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
