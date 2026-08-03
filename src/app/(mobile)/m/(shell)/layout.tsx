import { requireUser } from "@/lib/auth-guards";
import { BottomNav } from "@/components/mobile/bottom-nav";

/**
 * قشرة التطبيق المحميّة — كل تبويبات /m عداها شاشة الدخول.
 *
 * الجلسة تُقرأ بنفس دالة الويب `requireUser()` فتنطبق كل ضمانات الإبطال
 * (حساب موقوف / «خروج من كل الأجهزة»). تحويل غير المسجّل إلى /m/login يتم
 * في بوابة المصادقة (auth.config.ts) قبل وصول الطلب إلى هنا.
 */
export default async function MobileShellLayout({ children }: { children: React.ReactNode }) {
  await requireUser();

  return (
    <>
      {/*
        المساحة السفلية = ارتفاع الشريط (٤rem) + شريط الإيماءات،
        حتى لا يغطّي الشريط الثابت آخر عنصر في الصفحة.
      */}
      <div
        className="mx-auto w-full max-w-lg px-4 pt-4"
        style={{ paddingBottom: "calc(4rem + env(safe-area-inset-bottom))" }}
      >
        {children}
      </div>
      <BottomNav />
    </>
  );
}
