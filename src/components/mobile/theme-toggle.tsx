"use client";

import { useState } from "react";
import { Moon, Sun } from "lucide-react";
import { MOBILE_COLORS, SOP, MOBILE_THEME_COOKIE, type MobileTheme } from "@/lib/mobile-tokens";

/**
 * زر ليلي/نهاري — الخانة التي يحجزها النموذج في الترويسة.
 *
 * لا حالة على الخادم ولا أكشن: يكتب كوكي `m-theme` ويبدّل السمة `data-theme`
 * على غلاف (mobile) مباشرة، فالتبديل فوري بلا إعادة تحميل. التخطيط يقرأ نفس
 * الكوكي في العرض الخادمي، فلا وميض عند فتح الصفحة ولا اختلاف ترطيب.
 */
export function MobileThemeToggle({
  initial,
  compact = false,
}: {
  initial: MobileTheme;
  /** توسعة معلنة (توب بار الديوان): مقاس ٣٦×٣٦ بنصف قطر ١٢ — الافتراضي الشكل القائم حرفيًا. */
  compact?: boolean;
}) {
  const [theme, setTheme] = useState<MobileTheme>(initial);

  const toggle = () => {
    const next: MobileTheme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    // سنة كاملة — تفضيل عرض، ليس بيانات حسّاسة.
    document.cookie = `${MOBILE_THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    document.querySelector<HTMLElement>("[data-theme]")?.setAttribute("data-theme", next);
  };

  const Icon = theme === "dark" ? Sun : Moon;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "dark" ? "التبديل للوضع النهاري" : "التبديل للوضع الليلي"}
      className={compact ? "m-iconbtn flex items-center justify-center" : "m-raise m-press-sc flex items-center justify-center"}
      style={
        compact
          ? {
              boxSizing: "border-box", width: 36, height: 36, borderRadius: 12,
              background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.hair}`,
              cursor: "pointer",
            }
          : // هندسة ترويسة المالك (owner-home-final): ٣٥×٣٥ · نصف قطر ١١ · سطح بارز.
            { boxSizing: "border-box", width: 35, height: 35, borderRadius: 11, cursor: "pointer" }
      }
    >
      <Icon
        size={compact ? 16 : 15}
        strokeWidth={1.7}
        style={{ color: compact ? MOBILE_COLORS.textSecondary : SOP.tx2, maxWidth: 24, maxHeight: 24 }}
        aria-hidden
      />
    </button>
  );
}

export default MobileThemeToggle;
