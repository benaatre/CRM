"use client";

import { useState } from "react";
import { Moon, Sun } from "lucide-react";
import { MOBILE_COLORS, MOBILE_THEME_COOKIE, type MobileTheme } from "@/lib/mobile-tokens";

/**
 * زر ليلي/نهاري — الخانة التي يحجزها النموذج في الترويسة.
 *
 * لا حالة على الخادم ولا أكشن: يكتب كوكي `m-theme` ويبدّل السمة `data-theme`
 * على غلاف (mobile) مباشرة، فالتبديل فوري بلا إعادة تحميل. التخطيط يقرأ نفس
 * الكوكي في العرض الخادمي، فلا وميض عند فتح الصفحة ولا اختلاف ترطيب.
 */
export function MobileThemeToggle({ initial }: { initial: MobileTheme }) {
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
      className="m-iconbtn flex items-center justify-center"
      style={{
        boxSizing: "border-box", width: 42, height: 42, borderRadius: 14,
        background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`,
        cursor: "pointer",
      }}
    >
      <Icon size={19} strokeWidth={1.8} style={{ color: MOBILE_COLORS.textSecondary }} aria-hidden />
    </button>
  );
}

export default MobileThemeToggle;
