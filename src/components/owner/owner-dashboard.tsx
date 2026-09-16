import { Role } from "@prisma/client";
import { Zain } from "next/font/google";
import "./owner-sop.css";
import {
  getOwnerKpis, getOwnerFollowups, getOwnerAudit, getOwnerChannels, getOwnerWeekTrend,
  getOwnerTeamFollowups, getOwnerActivity, normalizeOwnerPeriod, ownerPeriodLabels,
} from "@/lib/data/owner-dashboard";
import { OwnerAnalytics } from "@/components/owner/owner-analytics";
import { OwnerAttendance } from "@/components/owner/owner-attendance";
import { OwnerActivity } from "@/components/owner/owner-activity";
import { OwnerDateFilter } from "@/components/owner/owner-date-filter";
import { KpiCards } from "@/components/owner/kpi-cards";
import { OwnerWeekCard } from "@/components/owner/owner-week-card";
import { getLeaderboard } from "@/lib/data/leaderboard";
import { getTeamStaleHome, getStaleByEmployee } from "@/lib/stale-leads";
import { OwnerStale } from "@/components/owner/owner-stale";
import { OwnerFollowups } from "@/components/owner/owner-followups";
import { OwnerAuditFeed } from "@/components/owner/owner-audit-feed";
import { AutoRefresh } from "@/components/auto-refresh";
import { toArabicDigits } from "@/lib/format";
import { AttendanceCard } from "@/components/attendance/attendance-card";

// خط الأرقام (Zain) — نفس عرف صفحتي القمم والعملاء: متغيّر على غلاف الصفحة.
const zain = Zain({ subsets: ["arabic"], weight: ["700", "800", "900"], variable: "--font-zain", display: "swap" });

/**
 * لوحة المالك — التجميع الكامل بدستور «أوبسيديان ناعم Pro v2»
 * (docs/design/SOP-THEME-REFERENCE-V2.md · روح owner-dashboard-v2-themed.html).
 *
 * جزيرة hex القديمة (OD_TOKENS) حُلّت محلها ورقة owner-sop.css: توكنات v2
 * بالثيمين على غلاف .od-scope (النهاري عبر html.light) + جسر أسماء --od-* —
 * فكل مستهلك قائم (day-timeline ضمنًا) يتلبّس الثيمين بلا لمسه. الثيم من
 * مبدّل الهيدر العام وحده (html.light — سكربت layout يضبطه قبل الرسم فلا وميض).
 */

/** رأس قسم — شرطة ذهبية متدرجة + عنوان + خانة يسار (فلتر/رابط). */
export function SecHeader({ title, count, accent, children }: {
  title: string;
  count?: string;
  accent?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-[17px] mt-8 flex flex-wrap items-center gap-2.5 px-0.5 text-xl font-bold text-foreground">
      <span
        className="h-6 w-1 rounded-sm"
        style={{ background: accent ?? "linear-gradient(180deg, var(--gold2), var(--gold))" }}
        aria-hidden
      />
      {title}
      {count && <span className="text-xs font-normal" style={{ color: "var(--mut)" }}>{count}</span>}
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
  const [kpis, followups, audit, channels, trend, teamFu, activity, board, staleHome, staleByEmp] = await Promise.all([
    getOwnerKpis(period, sp.df, sp.dt),
    getOwnerFollowups(fuPeriod, sp.ff, sp.ft),
    getOwnerAudit(30),
    getOwnerChannels(chPeriod, sp.af, sp.at),
    getOwnerWeekTrend(),
    getOwnerTeamFollowups(empPeriod, sp.ef, sp.et),
    getOwnerActivity(),
    // بطاقة جسر لوحة الأسبوع — نفس دالة اللوحة القائمة حرفيًا, لا استعلام جديد.
    getLeaderboard(),
    // العملاء الراكدين (المرحلة ٥) — كرت الفريق + قائمة + شيت التوزيع.
    getTeamStaleHome(),
    getStaleByEmployee(),
  ]);

  return (
    <div className={`${zain.variable} od-scope mx-auto max-w-[1500px] rounded-3xl p-4 sm:p-5`}>
      {/* رأس الصفحة — الثيم يحكمه مبدّل الهيدر العام وحده (زر واحد للنظام كله) */}
      <header className="od-su mb-5">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">هلا إدارة المبيعات</h1>
        <p className="mt-1 text-[14.5px]" style={{ color: "var(--mut)" }}>نظرة اليوم الكاملة</p>
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
          {/* ١) الأرقام الأساسية — دخول متدرج ٦٥ms بين الأقسام (v2 §5) */}
          <div className="od-su" style={{ animationDelay: "65ms" }}>
          <SecHeader title="الأرقام الأساسية">
            <OwnerDateFilter period={kpis.range.period} fromKey={kpis.range.fromKey} toKey={kpis.range.toKey} allowAll />
          </SecHeader>
          <KpiCards kpis={kpis} />

          {/* بطاقة جسر «لوحة الأسبوع» — عرض وتنقل فقط، البطاقة كلها تفتح /leaderboard */}
          <OwnerWeekCard top={board.rows.slice(0, 3).map((r) => ({ id: r.id, name: r.name, score: r.score }))} />
          </div>

          {/* ٢) متابعات اليوم + سجل التدقيق الحي — follow-layout من المرجع (1.5fr/1fr) */}
          <div className="od-su" style={{ animationDelay: "130ms" }}>
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
          </div>

          {/*
            ٣) التحليلات — داخل عمود المحتوى لا تحت الشبكة كلها: كانت تحت الغلاف
            فتنتظر نهاية العمود الجانبي (الأطول غالبًا) وتترك فجوة ميتة تحت
            المتابعات. هنا تتصل مباشرة بما فوقها مهما اختلف طول العمودين.
          */}
          <div className="od-su" style={{ animationDelay: "195ms" }}>
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

          {/* العملاء الراكدين — كرت الفريق + قائمة أقدم الحارّ + شيت التوزيع */}
          <OwnerStale
            counts={staleHome.counts}
            rows={staleHome.rows}
            restCount={staleHome.restCount}
            dist={staleByEmp.rows}
            activeTotal={staleByEmp.activeTotal}
          />
        </div>

        {/* العمود الجانبي: الدوام (عدّاد حي) + معدّل النشاط — sticky كما بالمرجع */}
        <aside className="od-su min-w-0 xl:sticky xl:top-20" style={{ animationDelay: "130ms" }}>
          <OwnerAttendance isOwner={userRole === Role.OWNER} />
          <OwnerActivity rows={activity} />
        </aside>
      </div>

      {/* ذيل الهوية — رخصة فال (SOP v2 §9.5) */}
      <footer className="mt-9 border-t pt-4 text-center text-[11px]" style={{ borderColor: "var(--edge)", color: "var(--mut)" }}>
        ترخيص فال (REGA) <span style={{ fontFamily: "var(--font-zain), var(--font-sans)", fontVariantNumeric: "tabular-nums" }}>١٢٠٠٠٢١٠٢٩</span>
      </footer>

      {/* «مباشر»: تدقيق ومتابعات تتحدث كل ٣٠ث — نفس آلية صفحة /audit. */}
      <AutoRefresh seconds={30} />
    </div>
  );
}
