import { requireMobileUser, isManager } from "@/lib/auth-guards";
import { getLeads, getLeadCounts } from "@/lib/data/leads";
import { buildAgenda } from "@/lib/mobile-agenda";
import { BottomNav } from "@/components/mobile/bottom-nav";
import { PushRegistrar } from "@/components/mobile/push-registrar";

/**
 * قشرة التطبيق المحميّة — كل تبويبات /m عداها شاشة الدخول.
 *
 * الجلسة تُقرأ بـ`requireMobileUser()` — نفس ضمانات إبطال الويب حرفيًا
 * (حساب موقوف / «خروج من كل الأجهزة») لكن كل تحويلاتها تنتهي داخل التطبيق.
 * القشرة هي الأب الذي يُحسم قبل عرض أي صفحة تحتها، فتحويلها يسبق أي
 * `requireUser` في الصفحات ولا يتسرّب المستخدم لتخطيط الويب.
 * تحويل غير المسجّل إلى /m/login يتم أصلًا في بوابة المصادقة (auth.config.ts).
 */
export default async function MobileShellLayout({ children }: { children: React.ReactNode }) {
  const user = await requireMobileUser();

  /*
   * شارات الشريط السفلي (جدد/متابعات) — من نفس مصدر الشاشات (buildAgenda)
   * حتى لا يظهر رقم في الشارة يخالف رقم الشاشة. للموظف فقط: أرقام المدير
   * الجماعية ما لها معنى في شريط تنقّل شخصي.
   */
  const manager = isManager(user.role);
  let newCount = 0;
  let todayCount = 0;
  let unassignedCount = 0;
  if (manager) {
    // شارة تبويب «غير موزّعين» — نفس عدّاد صفحة العملاء (getLeadCounts).
    unassignedCount = (await getLeadCounts()).unassigned;
  } else {
    const agenda = buildAgenda(await getLeads({ tab: "working", sort: "activity" }));
    newCount = agenda.notContacted.length;
    todayCount = agenda.dueToday.length;
  }

  return (
    <>
      {/* تسجيل الجهاز لإشعارات Push — داخل غلاف Capacitor فقط، لا أثر في المتصفح. */}
      <PushRegistrar />
      {/*
        المساحة السفلية = ارتفاع الشريط (٤rem) + شريط الإيماءات،
        حتى لا يغطّي الشريط الثابت آخر عنصر في الصفحة.
      */}
      {/*
        حشوة الشاشة من النموذج حرفيًا: 64px أعلى · 18px جانبًا · 96px أسفل.
        الأعلى يُستبدل بـsafe-area + 18 (النموذج يحجز 64 لشريط حالة وهمي مرسوم
        داخل إطار الجهاز، ونحن تحت شريط النظام الحقيقي).
      */}
      <div
        className="m-noscroll mx-auto w-full max-w-lg"
        style={{
          padding: "calc(env(safe-area-inset-top) + 18px) 18px calc(96px + env(safe-area-inset-bottom))",
        }}
      >
        {children}
      </div>
      <BottomNav newCount={newCount} todayCount={todayCount} unassignedCount={unassignedCount} manager={manager} />
    </>
  );
}
