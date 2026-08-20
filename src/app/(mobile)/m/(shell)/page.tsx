import { requireUser, isManager } from "@/lib/auth-guards";
import { getLeads } from "@/lib/data/leads";
import { getDashboard } from "@/lib/data/dashboard";
import { getMyRecentFollowups } from "@/lib/data/my-log";
import { getNotifications } from "@/lib/actions/notifications";
import { getSettings } from "@/lib/data/settings";
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
  if (isManager(user.role) || user.role === "FINANCE") {
    const sp = await searchParams;
    return <MobileOwnerHome user={user} period={sp.p} fuWindow={sp.fu} />;
  }

  /*
   * رئيسية الموظف v2 — عرض خالص من مصادر قائمة:
   * getLeads (نطاقه عبر scopeForUser) + buildAgenda (المصدر الوحيد للتقسيم الزمني)
   * للمواعيد والمنتظرين، وgetDashboard("all") (محجّمة به تلقائيًا) للمربعات والقمع،
   * وgetMyRecentFollowups (هويته من الجلسة) لسجل متابعاته، وgetSettings لاسم
   * الشركة في التوب بار.
   */
  // take كبير (قرار الديوان المعتمد): يغطي أثقل يوم واقعي — منه عدّاد الدائرة
  // «المنجز اليوم»، والسجل المعروض يبقى أول ٥ فقط.
  const [leads, notif, dash, recent, settings] = await Promise.all([
    getLeads({ tab: "working", sort: "activity" }),
    getNotifications(),
    getDashboard("all"),
    getMyRecentFollowups(user.id, 200),
    getSettings(),
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

  // عدّاد الدائرة «X/Y» (قرار الديوان المعتمد): Y = كل مواعيد اليوم،
  // X = ما سُجّلت لعميله متابعة اليوم (بيوم الرياض). «المتعثر» = فات وقته بلا إنجاز.
  const doneLeads = new Set(
    recent
      .filter((f) => f.createdAt >= agenda.dayStart && f.createdAt < agenda.dayEnd)
      .map((f) => f.leadId),
  );
  const nowMs = Date.now();
  const doneCount = appointments.filter((a) => doneLeads.has(a.leadId)).length;
  const lateCount = appointments.filter((a) => !doneLeads.has(a.leadId) && a.at.getTime() < nowMs).length;

  // ملاحظة آخر متابعة لكل عميل — LeadRow.lastNote المحسوبة سلفًا (بلا رفع take
  // وبلا مساس بـDayAppointment). تُبنى للمواعيد المعروضة فقط.
  const noteById = new Map(leads.map((l) => [l.id, l.lastNote]));
  const notes: Record<string, string | null> = {};
  for (const a of appointments) notes[a.leadId] = noteById.get(a.leadId) ?? null;

  return (
    <EmployeeHome
      firstName={firstName}
      companyName={settings.companyName}
      doneCount={doneCount}
      lateCount={lateCount}
      doneLeadIds={[...doneLeads]}
      notes={notes}
      backlogCount={agenda.overdueOld.length}
      unread={notif.unread}
      appointments={appointments}
      waiting={waiting}
      recent={recent.slice(0, 4)}
      funnel={dash.funnel}
      totalClients={dash.kpis.totalClients}
      falLicense={settings.falLicense}
    />
  );
}
