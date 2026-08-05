import { cookies } from "next/headers";
import "./mobile.css";
import { MOBILE_COLORS, MOBILE_THEME_COOKIE, normalizeTheme } from "@/lib/mobile-tokens";
import { CapacitorBridge } from "@/components/mobile/capacitor-bridge";

/**
 * تخطيط تطبيق الجوال — الغلاف المشترك لكل مسارات /m (بما فيها شاشة الدخول).
 * مستقل تمامًا عن قشرة الويب: لا شريط جانبي ولا Topbar ولا مساعد عائم.
 *
 * الحارس (requireUser) والشريط السفلي في تخطيط المجموعة `(shell)` وحده —
 * حتى تبقى /m/login خارجهما (بلا شريط سفلي وبلا حلقة تحويل).
 *
 * `data-theme` هنا هو حامل متغيّرات ألوان mobile.css: يُقرأ من الكوكي على
 * الخادم فيصل الوضع الصحيح مع أول بايت — بلا وميض ولا اختلاف ترطيب.
 */
export default async function MobileLayout({ children }: { children: React.ReactNode }) {
  const theme = normalizeTheme((await cookies()).get(MOBILE_THEME_COOKIE)?.value);

  return (
    <div
      dir="rtl"
      data-theme={theme}
      className="min-h-dvh w-full"
      style={{
        backgroundColor: MOBILE_COLORS.bg,
        color: MOBILE_COLORS.textPrimary,
        paddingTop: "env(safe-area-inset-top)",
      }}
    >
      {/* جسر Capacitor: لا يعمل إلا داخل التطبيق الأصلي (isNativePlatform) */}
      <CapacitorBridge />
      {children}
    </div>
  );
}
