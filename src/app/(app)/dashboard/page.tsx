import { Role } from "@prisma/client";
import Link from "next/link";
import { requireUser } from "@/lib/auth-guards";
import { getDashboard, normalizePeriod } from "@/lib/data/dashboard";
import { getMyNoResponseAlert } from "@/lib/data/no-response";
import { getMyRank, getLeaderboard } from "@/lib/data/leaderboard";
import { getMyOverdue, normalizeBucket } from "@/lib/data/my-overdue";
import { getMyRecentFollowups } from "@/lib/data/my-log";
import { getLeads } from "@/lib/data/leads";
import { INTEREST_UMBRELLA } from "@/lib/lead-filters";
import { dayStartKSA } from "@/lib/ksa-time";
import { lastSeenAgo } from "@/lib/format";
import type { RiverLead } from "@/components/dashboard/interested-river";
import { toArabicDigits } from "@/lib/format";
import { PeriodFilter } from "@/components/dashboard/period-filter";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { NoResponseBanner } from "@/components/dashboard/no-response-banner";
import { EmployeeDashboard } from "@/components/dashboard/employee-dashboard";
import { AttendanceCard } from "@/components/attendance/attendance-card";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; late?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const period = normalizePeriod(sp.period);
  // بانر الإنذار للموظف فقط (المالك/المدير يشوفون لوحة «لم يتم الرد» الكاملة).
  const [data, alert, myRank, board] = await Promise.all([
    getDashboard(period),
    user.role === Role.EMPLOYEE ? getMyNoResponseAlert(user.id) : Promise.resolve({ lines: [], late: 0, pulled: 0, warningCount: 0, warningMinHoursLeft: null }),
    user.role === Role.EMPLOYEE ? getMyRank(user.id) : Promise.resolve(null),
    // أعلى ثلاثة للوحة المالك/المدير المصغّرة.
    user.role !== Role.EMPLOYEE ? getLeaderboard() : Promise.resolve(null),
  ]);
  const top3 = board?.rows.slice(0, 3) ?? [];

  /*
   * داشبورد الموظف ٢٠٢٦ — شاشة مستقلة بلغة دليل التصميم الجديد. مسار المالك/المدير
   * (DashboardView وبطاقة أعلى الثلاثة والبانر القديم) يبقى كما هو حرفيًا بلا لمسة.
   */
  if (user.role === Role.EMPLOYEE) {
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
        {/* تسجيل الدوام — بصمة جغرافية، القراءة لحظة الضغط فقط */}
        <div className="mb-6 max-w-md">
          <AttendanceCard theme="web" />
        </div>
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

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <NoResponseBanner warningCount={alert.warningCount} warningMinHoursLeft={alert.warningMinHoursLeft} pulled={alert.pulled} />
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">هلا {user.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.manager ? "نظرة عامة على كل النشاط." : "نظرة على عملائك ومتابعاتك."}
          </p>
        </div>
        <PeriodFilter current={period} />
      </header>

      {/* تسجيل الدوام — للمدير فقط؛ المالك مراقب لا يبصم */}
      {user.role === Role.ADMIN && (
        <div className="max-w-md">
          <AttendanceCard theme="web" />
        </div>
      )}

      {/* بطاقة لوحة الأسبوع المصغّرة — للمالك/المدير: أعلى ثلاثة بدرجاتهم */}
      {top3.length > 0 && (
        <Link href="/leaderboard" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gold/30 bg-gold/5 px-4 py-3 transition-colors hover:bg-gold/10">
          <div className="text-sm font-bold text-foreground">🏆 لوحة الأسبوع — أعلى الثلاثة</div>
          <div className="flex flex-wrap items-center gap-4">
            {top3.map((r, i) => (
              <span key={r.id} className="flex items-center gap-1.5 text-sm">
                <span>{["🥇", "🥈", "🥉"][i]}</span>
                <span className="font-medium text-foreground">{r.name.split(" ")[0]}</span>
                <span className="font-bold text-gold" style={{ fontVariantNumeric: "tabular-nums" }}>{toArabicDigits(r.score)}</span>
              </span>
            ))}
          </div>
        </Link>
      )}

      {/* بطاقة لوحة الأسبوع المصغّرة — للموظف: ترتيبه بالكفاءة + الفارق عن اللي قدامه */}
      {myRank?.ranked && (
        <Link href="/leaderboard" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gold/30 bg-gold/5 px-4 py-3 transition-colors hover:bg-gold/10">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{myRank.rank === 1 ? "🥇" : myRank.rank === 2 ? "🥈" : myRank.rank === 3 ? "🥉" : "🏆"}</span>
            <div>
              <div className="text-sm font-bold text-foreground">ترتيبك هالأسبوع: {toArabicDigits(myRank.rank)} من {toArabicDigits(myRank.total)}</div>
              <div className="text-xs text-muted-foreground">
                {myRank.gapToNext
                  ? `تحتاج ${toArabicDigits(myRank.gapToNext.pts)} درجة تعدّي ${myRank.gapToNext.name}`
                  : "أنت الأول — حافظ على الصدارة 🔥"}
              </div>
            </div>
          </div>
          <div className="text-left">
            <div className="text-xl font-bold text-gold" style={{ fontVariantNumeric: "tabular-nums" }}>{toArabicDigits(myRank.score)}</div>
            <div className="text-[11px] text-muted-foreground">درجة</div>
          </div>
        </Link>
      )}

      <DashboardView data={data} />
    </div>
  );
}
