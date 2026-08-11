import { requireUser, isManager } from "@/lib/auth-guards";
import { getLeads } from "@/lib/data/leads";
import { getDashboard } from "@/lib/data/dashboard";
import { getMyRecentFollowups } from "@/lib/data/my-log";
import { getNotifications } from "@/lib/actions/notifications";
import { buildAgenda, buildDayAppointments } from "@/lib/mobile-agenda";
import { MobileOwnerHome } from "@/components/mobile/owner-home";
import { EmployeeHome, type WaitingLead } from "@/components/mobile/employee-home";

// البيانات تتغيّر مع كل متابعة — لا تُخزَّن الصفحة.
export const dynamic = "force-dynamic";

export default async function MobileHomePage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; fu?: string }>;
}) {
  const user = await requireUser();
  if (isManager(user.role)) {
    const sp = await searchParams;
    return <MobileOwnerHome user={user} period={sp.p} fuWindow={sp.fu} />;
  }

  /*
   * رئيسية الموظف v2 — عرض خالص من مصادر قائمة:
   * getLeads (نطاقه عبر scopeForUser) + buildAgenda (المصدر الوحيد للتقسيم الزمني)
   * للمواعيد والمنتظرين، وgetDashboard("all") (محجّمة به تلقائيًا) للمربعات والقمع،
   * وgetMyRecentFollowups (هويته من الجلسة) لسجل متابعاته.
   */
  const [leads, notif, dash, recent] = await Promise.all([
    getLeads({ tab: "working", sort: "activity" }),
    getNotifications(),
    getDashboard("all"),
    getMyRecentFollowups(user.id, 5),
  ]);

  const agenda = buildAgenda(leads);
  const appointments = buildDayAppointments(agenda);
  const firstName = (user.name ?? "").trim().split(/\s+/)[0] || "زميلي";
  // الأقدم انتظارًا أولًا — نفس ترتيب البطاقة السابقة.
  const waiting: WaitingLead[] = [...agenda.notContacted]
    .sort((a, b) => b.daysWaiting - a.daysWaiting)
    .map((l) => ({
      id: l.id,
      name: l.name,
      phone: l.phone,
      channel: l.channel,
      assignedAt: l.assignedAt,
      daysWaiting: l.daysWaiting,
    }));

  return (
    <EmployeeHome
      firstName={firstName}
      unread={notif.unread}
      appointments={appointments}
      kpis={{
        total: dash.kpis.totalClients,
        visits: dash.kpis.visits,
        bookings: dash.kpis.bookings,
        closed: dash.kpis.closedWon,
      }}
      waiting={waiting}
      recent={recent}
      funnel={dash.funnel}
    />
  );
}
