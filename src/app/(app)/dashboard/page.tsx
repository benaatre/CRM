import { Role } from "@prisma/client";
import { requireUser } from "@/lib/auth-guards";
import { getDashboard, normalizePeriod } from "@/lib/data/dashboard";
import { getMyNoResponseAlert } from "@/lib/data/no-response";
import { getMyRank } from "@/lib/data/leaderboard";
import { getMyOverdue, normalizeBucket } from "@/lib/data/my-overdue";
import { getMyRecentFollowups } from "@/lib/data/my-log";
import { getLeads } from "@/lib/data/leads";
import { INTEREST_UMBRELLA } from "@/lib/lead-filters";
import { dayStartKSA } from "@/lib/ksa-time";
import { lastSeenAgo } from "@/lib/format";
import type { RiverLead } from "@/components/dashboard/interested-river";
import { PeriodFilter } from "@/components/dashboard/period-filter";
import { EmployeeDashboard } from "@/components/dashboard/employee-dashboard";
import { OwnerDashboard } from "@/components/owner/owner-dashboard";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; late?: string; dp?: string; df?: string; dt?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;

  /*
   * لوحة المالك ٢٠٢٦ (المرجع owner-final-structure.html) — استبدال كامل لمسار
   * المالك/المدير: الأرقام النطاقية والدلتا وبقية الأقسام داخل OwnerDashboard.
   * مسار الموظف أدناه باقٍ حرفيًا بلا لمسة.
   */
  if (user.role === Role.OWNER || user.role === Role.ADMIN || user.role === Role.FINANCE) {
    return <OwnerDashboard userRole={user.role} sp={{ dp: sp.dp, df: sp.df, dt: sp.dt }} />;
  }

  const period = normalizePeriod(sp.period);
  const [data, alert, myRank] = await Promise.all([
    getDashboard(period),
    getMyNoResponseAlert(user.id),
    getMyRank(user.id),
  ]);

  /*
   * داشبورد الموظف ٢٠٢٦ — شاشة مستقلة بلغة دليل التصميم الجديد. مسار المالك/المدير
   * (DashboardView وبطاقة أعلى الثلاثة والبانر القديم) يبقى كما هو حرفيًا بلا لمسة.
   */
  if (user.role === Role.EMPLOYEE || user.role === Role.HR) {
    const firstName = (user.name ?? "").trim().split(/\s+/)[0] || "زميلي";
    const bucket = normalizeBucket(sp.late);
    const [overdue, recent, interestedRaw] = await Promise.all([
      getMyOverdue(bucket),
      // سجل متابعاته (هويته من الجلسة) — نقتطع منه منجزات اليوم فقط.
      getMyRecentFollowups(user.id, 50),
      /*
       * «عملاء مهتمون» — getLeads القائمة (محجّمة بالموظف تلقائيًا عبر scopeForUser)
       * بمظلة INTEREST_UMBRELLA المعتمدة وفرز activity (الأنشط أولًا، بلا نشاط آخرًا).
       * صفر استعلام جديد وصفر دالة جديدة.
       */
      getLeads({ tab: "working", sort: "activity", stages: [...INTEREST_UMBRELLA] }),
    ]);

    // النص النسبي يُحسب على الخادم (توقيت الرياض) فلا يختلف بين خادم وعميل.
    const interested: RiverLead[] = interestedRaw.map((l) => ({
      id: l.id,
      name: l.name,
      phone: l.phone,
      stage: l.stage,
      lastNote: l.lastNote,
      agoText: l.lastContact ? lastSeenAgo(l.lastContact) : "بلا تواصل",
    }));

    // منجزات اليوم بيوم الرياض.
    const dayStart = dayStartKSA().getTime();
    const doneToday = recent.filter((f) => f.createdAt.getTime() >= dayStart);

    /*
     * منع التكرار: المتابعة التي سُجّلت نتيجتها بلا موعد جديد يبقى `nextFollowup`
     * على حاله فيظل العميل ضمن مواعيد اليوم — فيظهر «قادمًا/فائتًا» و«منجزًا» معًا.
     * المطابقة بمعرّف العميل: كل عميل ظهر في منجزات اليوم يُستبعد من المواعيد.
     */
    const doneLeadIds = new Set(doneToday.map((f) => f.leadId));
    const openAppts = data.todayAppointments.filter((a) => !doneLeadIds.has(a.leadId));

    return (
      <div className="mx-auto max-w-[1400px]">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-[22px] font-semibold tracking-tight text-foreground">لوحتك</h1>
          <PeriodFilter current={period} />
        </header>
        {/* بطاقة الدوام انتقلت لعمود الإحصائيات داخل EmployeeDashboard —
            الترتيب المقفول: الدوام ← شبكة 2×2 ← التحويل + الترتيب جنبًا إلى جنب. */}
        <EmployeeDashboard
          data={data}
          alert={alert}
          myRank={myRank}
          firstName={firstName}
          overdue={overdue}
          openAppts={openAppts}
          doneToday={doneToday}
          interested={interested}
          period={sp.period}
        />
      </div>
    );
  }

  // غير مُدرَك: غير الموظف عاد من فرع لوحة المالك أعلاه — الشرط باقٍ لتصغير الفرق.
  return null;
}
