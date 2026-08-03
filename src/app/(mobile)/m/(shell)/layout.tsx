import { requireUser, isManager } from "@/lib/auth-guards";
import { getLeads } from "@/lib/data/leads";
import { buildAgenda } from "@/lib/mobile-agenda";
import { BottomNav } from "@/components/mobile/bottom-nav";

/**
 * قشرة التطبيق المحميّة — كل تبويبات /m عداها شاشة الدخول.
 *
 * الجلسة تُقرأ بنفس دالة الويب `requireUser()` فتنطبق كل ضمانات الإبطال
 * (حساب موقوف / «خروج من كل الأجهزة»). تحويل غير المسجّل إلى /m/login يتم
 * في بوابة المصادقة (auth.config.ts) قبل وصول الطلب إلى هنا.
 */
export default async function MobileShellLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  /*
   * شارات الشريط السفلي (جدد/متابعات) — من نفس مصدر الشاشات (buildAgenda)
   * حتى لا يظهر رقم في الشارة يخالف رقم الشاشة. للموظف فقط: أرقام المدير
   * الجماعية ما لها معنى في شريط تنقّل شخصي.
   */
  let newCount = 0;
  let todayCount = 0;
  if (!isManager(user.role)) {
    const agenda = buildAgenda(await getLeads({ tab: "working", sort: "activity" }));
    newCount = agenda.notContacted.length;
    todayCount = agenda.dueToday.length;
  }

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
      <BottomNav newCount={newCount} todayCount={todayCount} />
    </>
  );
}
