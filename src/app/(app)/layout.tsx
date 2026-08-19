import { requireUser, isManager } from "@/lib/auth-guards";
import { roleLabel } from "@/lib/labels";
import { getSettings } from "@/lib/data/settings";
import { getEmployees } from "@/lib/data/leads";
import { activeDuplicateGroupCount } from "@/lib/data/duplicates";
import { getNoResponseCount } from "@/lib/data/no-response";
import { getMyAvailability } from "@/lib/actions/availability";
import { Topbar } from "@/components/layout/topbar";
import { SideRail, type RailItem } from "@/components/layout/side-rail";
import { Heartbeat } from "@/components/layout/heartbeat";
import { DecisionGate } from "@/components/attendance/decision-gate";
import { FloatingAssistant } from "@/components/layout/floating-assistant";
import { NotificationCenter } from "@/components/layout/notification-center";

// تخطيط المنطقة المحميّة — يتطلب دخولًا، ويعرض تنقّلًا حسب الدور.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const manager = isManager(user.role);
  const owner = user.role === "OWNER"; // ميزة المكررين للمالك فقط
  const [settings, employees, availability, dupCounts, noResponseCount] = await Promise.all([
    getSettings(),
    manager ? getEmployees() : Promise.resolve([]),
    getMyAvailability(),
    owner ? activeDuplicateGroupCount() : Promise.resolve({ total: 0, newToday: 0 }),
    owner ? getNoResponseCount() : Promise.resolve(0),
  ]);

  // نفس الروابط والصلاحيات حرفيًا — الأيقونة مفتاح نصّي (لا تُسلسَل المكوّنات للعميل).
  const nav: RailItem[] = ([
    { href: "/dashboard", label: "لوحة التحكم", icon: "dashboard", show: true, badge: 0 },
    { href: "/leads", label: "كل العملاء", icon: "leads", show: true, badge: 0 },
    { href: "/leads/duplicates", label: "العملاء المكررون", icon: "duplicates", show: owner, badge: dupCounts.total },
    { href: "/no-response", label: "لم يتم الرد", icon: "noResponse", show: owner, badge: noResponseCount },
    { href: "/pipeline", label: "مراحل العملاء", icon: "pipeline", show: true, badge: 0 },
    { href: "/projects", label: "المشاريع", icon: "projects", show: true, badge: 0 },
    { href: "/bookings", label: "خط المبيعات", icon: "bookings", show: true, badge: 0 },
    { href: "/chat", label: "الشات الداخلي", icon: "chat", show: true, badge: 0 },
    { href: "/analytics", label: "التحليلات", icon: "analytics", show: true, badge: 0 },
    { href: "/admin", label: "الفريق", icon: "team", show: manager, badge: 0 },
    { href: "/distribution", label: "التوزيع التلقائي", icon: "distribution", show: manager, badge: 0 },
    { href: "/leaves", label: "الإجازات", icon: "leaves", show: true, badge: 0 },
    { href: "/attendance", label: "حوكمة الدوام", icon: "attendance", show: owner, badge: 0 },
    { href: "/audit", label: "سجل التدقيق", icon: "audit", show: manager, badge: 0 },
    { href: "/settings", label: "الإعدادات", icon: "settings", show: manager, badge: 0 },
  ] satisfies (RailItem & { show: boolean })[])
    .filter((n) => n.show)
    .map(({ href, label, icon, badge }) => ({ href, label, icon, badge }));

  return (
    <div className="flex min-h-dvh">
      <Heartbeat />
      {/* شاشة الحسم الإجبارية (الدوام الواقعي) — OWNER مستثنى خادميًا وfail-open. */}
      <DecisionGate />
      <NotificationCenter />
      {/*
        الشريط الجانبي الزجاجي (RTL — يمين الشاشة) من ١٠٢٤ بكسل فقط؛ تحتها الدرج المنزلق.
        خانته في الـflex ثابتة ٧٠px والتمدد بالمرور يقع **فوق** المحتوى لا يدفعه.
      */}
      <SideRail items={nav} falLicense={settings.falLicense ?? null} brandName={settings.companyName} />

      {/*
        min-w-0: الإصلاح البنيوي الذي يغني عن قصّ المحتوى عالميًا.
        عنصر flex-1 قيمته الافتراضية min-width:auto — أي لا ينكمش تحت عرض محتواه،
        فأي جدول عريض كان يدفع العمود كله فيجرّ الصفحة. مع min-w-0 ينكمش العمود
        لعرض الشاشة، ويبقى التمرير داخل حاوية الجدول وحدها.
      */}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          userName={user.name ?? "مستخدم"}
          roleLabel={roleLabel(user.role)}
          companyName={settings.companyName}
          logoUrl={settings.logoUrl}
          falLicense={settings.falLicense ?? null}
          isManager={manager}
          isOwner={owner}
          employees={employees}
          availability={manager ? null : availability}
          dupCount={dupCounts.total}
        />
        <main className="w-full min-w-0 flex-1 px-4 py-6 md:px-6 md:py-8">{children}</main>
      </div>
      <FloatingAssistant />
    </div>
  );
}
