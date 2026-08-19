import { Role } from "@prisma/client";
import { Zain } from "next/font/google";
import {
  getOwnerKpis, getOwnerFollowups, getOwnerAudit, getOwnerChannels, getOwnerWeekTrend,
  getOwnerTeamFollowups, getOwnerActivity, normalizeOwnerPeriod, ownerPeriodLabels,
} from "@/lib/data/owner-dashboard";
import { OwnerAnalytics } from "@/components/owner/owner-analytics";
import { OwnerAttendance } from "@/components/owner/owner-attendance";
import { OwnerActivity } from "@/components/owner/owner-activity";
import { OwnerDateFilter } from "@/components/owner/owner-date-filter";
import { KpiCards } from "@/components/owner/kpi-cards";
import { OwnerFollowups } from "@/components/owner/owner-followups";
import { OwnerAuditFeed } from "@/components/owner/owner-audit-feed";
import { AutoRefresh } from "@/components/auto-refresh";
import { toArabicDigits } from "@/lib/format";
import { AttendanceCard } from "@/components/attendance/attendance-card";

// خط الأرقام (Zain) — نفس عرف صفحتي القمم والعملاء: متغيّر على غلاف الصفحة.
const zain = Zain({ subsets: ["arabic"], weight: ["700", "800", "900"], variable: "--font-zain", display: "swap" });

/**
 * لوحة المالك — التجميع الكامل (المرجع owner-final-structure.html).
 *
 * توكنات المرجع تُعرَّف مرة واحدة هنا كمتغيّرات CSS بنطاق اللوحة (--od-*)
 * فتقرأها كل الأقسام — لا نلمس globals.css ولا ثيم بقية التطبيق.
 */
const OD_TOKENS = {
  "--od-raised": "#15171b",
  "--od-raised2": "#1a1d22",
  "--od-hair": "rgba(255,255,255,.06)",
  "--od-t1": "#F4F5F7",
  "--od-t2": "#9A9CA4",
  "--od-t3": "#65676E",
  "--od-won": "#34d494",
  "--od-red": "#ff7a8a",
  "--od-try": "#e8a54d",
  "--od-visit": "#5b9def",
  "--od-nego": "#a98edb",
  "--od-later": "#5bbccb",
  "--od-int": "#34d494",
  "--od-new": "#8b93a3",
} as React.CSSProperties;

/** رأس قسم — شرطة ذهبية + عنوان + خانة يسار (فلتر/رابط) على نمط `.sec` من المرجع. */
export function SecHeader({ title, count, accent = "var(--gold)", children }: {
  title: string;
  count?: string;
  accent?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-[17px] mt-8 flex flex-wrap items-center gap-2.5 px-0.5 text-xl font-bold text-foreground">
      <span className="h-6 w-1 rounded-sm" style={{ background: accent }} aria-hidden />
      {title}
      {count && <span className="text-xs font-normal" style={{ color: "var(--od-t3)" }}>{count}</span>}
      {children}
    </div>
  );
}

export type OwnerSearchParams = {
  dp?: string; df?: string; dt?: string;
  fp?: string; ff?: string; ft?: string;
  ep?: string; ef?: string; et?: string;
  ap?: string; af?: string; at?: string;
};

export async function OwnerDashboard({ userRole, sp }: { userRole: Role; sp: OwnerSearchParams }) {
  // الأرقام افتراضيها «الكل» (الإجماليات الكاملة عند الفتح)؛ بقية الفلاتر «اليوم».
  const period = normalizeOwnerPeriod(sp.dp, "all");
  const fuPeriod = normalizeOwnerPeriod(sp.fp);
  const empPeriod = normalizeOwnerPeriod(sp.ep);
  // فترة المنصّات الافتراضية «أسبوع» — عنوان المرجع: «مصدر العملاء هذا الأسبوع».
  const chPeriod = normalizeOwnerPeriod(sp.ap ?? "week");
  const [kpis, followups, audit, channels, trend, teamFu, activity] = await Promise.all([
    getOwnerKpis(period, sp.df, sp.dt),
    getOwnerFollowups(fuPeriod, sp.ff, sp.ft),
    getOwnerAudit(30),
    getOwnerChannels(chPeriod, sp.af, sp.at),
    getOwnerWeekTrend(),
    getOwnerTeamFollowups(empPeriod, sp.ef, sp.et),
    getOwnerActivity(),
  ]);

  return (
    <div className={`${zain.variable} mx-auto max-w-[1500px]`} style={OD_TOKENS}>
      {/* رأس الصفحة — pagehead من المرجع */}
      <header className="mb-5 flex items-center gap-3.5">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">هلا إدارة المبيعات</h1>
          <p className="mt-1 text-[14.5px]" style={{ color: "var(--od-t3)" }}>نظرة اليوم الكاملة</p>
        </div>
      </header>

      {/* تسجيل الدوام — للمدير (ADMIN) فقط: المالك مراقب لا يبصم. حاجة وظيفية خارج المرجع. */}
      {userRole === Role.ADMIN && (
        <div className="mb-5 max-w-md">
          <AttendanceCard theme="web" />
        </div>
      )}

      {/* الغلاف الرئيسي — mainshell من المرجع: المحتوى + عمود جانبي ٢٩٠px (يسارًا في RTL) */}
      <div className="grid items-start gap-[22px] xl:grid-cols-[minmax(0,1fr)_290px]">
        <div className="min-w-0">
          {/* ١) الأرقام الأساسية */}
          <SecHeader title="الأرقام الأساسية">
            <OwnerDateFilter period={kpis.range.period} fromKey={kpis.range.fromKey} toKey={kpis.range.toKey} allowAll />
          </SecHeader>
          <KpiCards kpis={kpis} />

          {/* ٢) متابعات اليوم + سجل التدقيق الحي — follow-layout من المرجع (1.5fr/1fr) */}
          <SecHeader
            title="متابعات اليوم — كل العملاء"
            count={`${toArabicDigits(followups.rows.length)} عميل عليهم متابعة بالفترة · مرتّبة بالوقت`}
          >
            <OwnerDateFilter
              period={followups.range.period}
              fromKey={followups.range.fromKey}
              toKey={followups.range.toKey}
              keys={["fp", "ff", "ft"]}
              compact
            />
          </SecHeader>
          <div className="grid items-start gap-4 2xl:grid-cols-[1.5fr_1fr] [&>*]:min-w-0">
            <OwnerFollowups rows={followups.rows} isOwner={userRole === Role.OWNER} />
            <OwnerAuditFeed rows={audit} />
          </div>

          {/*
            ٣) التحليلات — داخل عمود المحتوى لا تحت الشبكة كلها: كانت تحت الغلاف
            فتنتظر نهاية العمود الجانبي (الأطول غالبًا) وتترك فجوة ميتة تحت
            المتابعات. هنا تتصل مباشرة بما فوقها مهما اختلف طول العمودين.
          */}
          <SecHeader title="التحليلات" />
          <OwnerAnalytics
            channels={channels.rows}
            channelsSub={`مصدر العملاء — ${ownerPeriodLabels[channels.range.period]}`}
            trend={trend}
            teamFu={teamFu.rows}
            teamFuSub={`كم عنده · أنجز · فاته — ${ownerPeriodLabels[teamFu.range.period]}`}
            teamFuFilter={
              <OwnerDateFilter
                period={teamFu.range.period}
                fromKey={teamFu.range.fromKey}
                toKey={teamFu.range.toKey}
                keys={["ep", "ef", "et"]}
                compact
              />
            }
          />
        </div>

        {/* العمود الجانبي: الدوام (عدّاد حي) + معدّل النشاط — sticky كما بالمرجع */}
        <aside className="min-w-0 xl:sticky xl:top-20">
          <OwnerAttendance isOwner={userRole === Role.OWNER} />
          <OwnerActivity rows={activity} />
        </aside>
      </div>

      {/* «مباشر»: تدقيق ومتابعات تتحدث كل ٣٠ث — نفس آلية صفحة /audit. */}
      <AutoRefresh seconds={30} />
    </div>
  );
}
