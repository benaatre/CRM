import { requireMobileUser, isManager } from "@/lib/auth-guards";
import { getLeads, getLeadCounts } from "@/lib/data/leads";
import { buildAgenda, buildDayAppointments } from "@/lib/mobile-agenda";
import { MercuryNav } from "@/components/mobile/mercury-nav";
import { DiwanNav } from "@/components/mobile/diwan-nav";
import { AttendanceShellProvider } from "@/components/mobile/attendance-shell";
import { PushRegistrar } from "@/components/mobile/push-registrar";
import { Heartbeat } from "@/components/layout/heartbeat";
import { DecisionGate } from "@/components/attendance/decision-gate";
import { LocationPriming } from "@/components/attendance/location-priming";

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
   * شارة شريط الزئبق — من نفس مصدر الشاشات حتى لا تخالف أرقامها:
   * الموظف: مواعيد اليوم **الفايتة** (نفس مصدر البانر buildDayAppointments — دلالة
   * معتمدة: الفائت فقط، لا كل اليوم). الإدارة: «غير موزّعين» (getLeadCounts) كما كان.
   */
  const manager = isManager(user.role);
  let badgeCount = 0;
  if (manager) {
    badgeCount = (await getLeadCounts()).unassigned;
  } else {
    const agenda = buildAgenda(await getLeads({ tab: "working", sort: "activity" }));
    const nowMs = Date.now();
    badgeCount = buildDayAppointments(agenda).filter((a) => a.at.getTime() < nowMs).length;
  }

  return (
    <AttendanceShellProvider enabled={!manager}>
      {/* تسجيل الجهاز لإشعارات Push — داخل غلاف Capacitor فقط، لا أثر في المتصفح. */}
      <PushRegistrar />
      {/* نبضة «آخر ظهور» — كانت بقشرة الويب فقط، فموظف التطبيق كان يظهر
          «غير متصل» بعد ٥ دقائق ويُستبعد من التوزيع التلقائي بعد distPresenceMin. */}
      <Heartbeat />
      {/* شاشة الحسم الإجبارية (الدوام الواقعي) — OWNER مستثنى خادميًا وfail-open. */}
      <DecisionGate />
      {/* تفعيل الموقع (الحضور بالرادار) — بعد الإفصاح v3، المالك لا يراه (لا يقبل الإفصاح). */}
      <LocationPriming />
      {/*
        المساحة السفلية = ارتفاع الشريط (٤rem) + شريط الإيماءات،
        حتى لا يغطّي الشريط الثابت آخر عنصر في الصفحة.
      */}
      {/*
        حشوة الشاشة من النموذج حرفيًا: 64px أعلى · 18px جانبًا · 96px أسفل.
        الأعلى يُستبدل بـsafe-area + 18 (النموذج يحجز 64 لشريط حالة وهمي مرسوم
        داخل إطار الجهاز، ونحن تحت شريط النظام الحقيقي).
      */}
      {/* الحشوة السفلية 110: كبسولة الزئبق 58 + بروز القطرة 34 + متنفس. */}
      <div
        className="m-noscroll mx-auto w-full max-w-lg"
        style={{
          padding: "calc(env(safe-area-inset-top) + 18px) 18px calc(110px + env(safe-area-inset-bottom))",
        }}
      >
        {children}
      </div>
      {/* الإدارة على شريط الزئبق القائم بلا مساس؛ الموظف على كبسولة «الديوان» بزر الدوام. */}
      {manager ? <MercuryNav manager badgeCount={badgeCount} /> : <DiwanNav badgeCount={badgeCount} />}
    </AttendanceShellProvider>
  );
}
