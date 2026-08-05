import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireManager } from "@/lib/auth-guards";
import { getDashboard, type Period } from "@/lib/data/dashboard";
import { getTeam } from "@/lib/data/team";
import { getActivityReport } from "@/lib/data/activity-report";
import { roleLabel } from "@/lib/labels";
import { pauseReasonLabel, formatPauseRemaining } from "@/lib/availability";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { toArabicDigits, exactWhen } from "@/lib/mobile-format";
import { MobileTeamRoster, type RosterRow } from "@/components/mobile/team-roster";
import { MobileEmployeeCards, type EmpStatCard } from "@/components/mobile/employee-cards";
import { MobileChips } from "@/components/mobile/chips";
import { RIYADH_TZ } from "@/lib/format";

/*
 * ٥) فلتر فترة الإحصاءات — مقصور على ما **يدعمه المصدران فعلًا**، بلا أي حساب
 * جديد. المفرداتان مختلفتان وهذا قيد حقيقي لا نخفيه:
 *   • getDashboard(period)     ⟵ 24h · 48h · 72h · week · all   (اتصالات/زيارات/حجوزات)
 *   • getActivityReport({day}) ⟵ يوم واحد بتوقيت الرياض أو all  (متابعات/استقبل/سُحب منه)
 * فما تدعمه جهة دون الأخرى تُعرض إحصاءاته وحدها، والبطاقة تُسقط الغائب بدل
 * ما تعرض صفرًا كاذبًا. «نطاق مخصص من/إلى» لا يقبله أيٌّ منهما — غير مدعوم.
 */
const STAT_PERIODS = [
  { key: "today", label: "اليوم" },
  { key: "yesterday", label: "أمس" },
  { key: "week", label: "هذا الأسبوع" },
  { key: "all", label: "الكل" },
] as const;
type StatPeriod = (typeof STAT_PERIODS)[number]["key"];

/** مفتاح يوم بتوقيت الرياض (YYYY-MM-DD) — نفس صيغة getActivityReport. */
function riyadhDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: RIYADH_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export const dynamic = "force-dynamic";

const card = {
  boxSizing: "border-box" as const,
  background: MOBILE_COLORS.card,
  border: `1px solid ${MOBILE_COLORS.border}`,
  borderRadius: 16,
  padding: "13px 14px",
};

/**
 * «الفريق» — قائمة الموظفين (بآخر ظهور بالضبط، وكل صف يفتح إعداداته)
 * + جدول متابعات اليوم (عليه/أنجز/فاته).
 *
 * المصدران هما مصدرا الديسكتوب حرفيًا — صفر استعلام جديد:
 *   • getTeam()      ← نفس دالة شاشة الفريق ((app)/admin/page.tsx) وفيها
 *                       lastSeenAt/online/target/total/closed/activityRate.
 *   • getDashboard() ← كتلة الفريق مسوَّرة بـif (manager) داخلها.
 * الحارس requireManager() قبلهما، تمامًا كصفحة الديسكتوب.
 */
export default async function MobileTeamPage({
  searchParams,
}: {
  searchParams: Promise<{ sp?: string }>;
}) {
  await requireManager(); // OWNER + ADMIN — نفس حارس (app)/admin.

  const sp = await searchParams;
  const period: StatPeriod = STAT_PERIODS.some((p) => p.key === sp.sp) ? (sp.sp as StatPeriod) : "today";
  const now = new Date();

  // ترجمة الفترة إلى مفردات كل مصدر — undefined = المصدر لا يدعمها.
  const dashPeriod: Period | undefined =
    period === "today" ? "24h" : period === "week" ? "week" : period === "all" ? "all" : undefined;
  const actArg: { day?: string; all?: boolean } | undefined =
    period === "today" ? {}
      : period === "yesterday" ? { day: riyadhDay(new Date(now.getTime() - 86_400_000)) }
        : period === "all" ? { all: true }
          : undefined;

  const [team, dash, activity] = await Promise.all([
    getTeam(),
    // قائمة الموظفين والمتابعات تحتاج لوحة دائمًا — الفترة تخصّ الإحصاءات فقط.
    getDashboard(dashPeriod ?? "24h"),
    actArg ? getActivityReport(actArg) : Promise.resolve(null),
  ]);

  // ٦) بطاقات الإحصاءات: دمج مصدرَي الديسكتوب على المعرّف — بلا حساب جديد.
  const actById = new Map((activity?.rows ?? []).map((r) => [r.id, r]));
  const empCards: EmpStatCard[] = dash.team.map((t): EmpStatCard => {
    const a = actById.get(t.id);
    return {
      id: t.id, name: t.name,
      // المصدر لا يدعم الفترة ⟵ null فتُسقط الإحصاءة بدل عرض رقم فترة أخرى.
      calls: dashPeriod ? t.attempts : null,
      followups: a?.followups ?? null,
      visits: dashPeriod ? t.visits : null,
      bookings: dashPeriod ? t.bookings : null,
      received: a?.received ?? null,
      pulled: a?.lateLost ?? null,
    };
  });

  // كل النصوص الزمنية تُحسب هنا (خادم) — فلا يختلف الترطيب عند انقلاب اليوم.
  const rows: RosterRow[] = team.members.map((m) => ({
    id: m.id,
    name: m.name,
    roleText: roleLabel(m.role),
    isOwnerRole: m.role === "OWNER",
    phone: m.phone,
    online: m.online,
    active: m.active,
    paused: m.paused,
    pauseText: m.paused
      ? `موقّف الاستقبال — ${pauseReasonLabel(m.pauseReason)} · ${formatPauseRemaining(m.pauseUntil)}`
      : null,
    lastSeenText: exactWhen(m.lastSeenAt, now),
    total: m.total,
    closed: m.closed,
    target: m.target,
    activityRate: m.activityRate,
  }));

  return (
    <div className="m-screen flex flex-col" style={{ gap: 13 }}>
      <div className="flex items-center" style={{ gap: 11 }}>
        <Link href="/m/more" aria-label="رجوع" className="flex items-center justify-center"
          style={{ minWidth: 44, minHeight: 44, marginInlineStart: -10, color: MOBILE_COLORS.textPrimary }}>
          <ChevronLeft size={20} strokeWidth={2} style={{ transform: "scaleX(-1)" }} aria-hidden />
        </Link>
        <div>
          <h1 style={{ fontSize: 17, fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>الفريق</h1>
          <div style={{ fontSize: "11.5px", color: MOBILE_COLORS.textMuted, marginTop: 3 }}>
            {toArabicDigits(team.employeeCount)} موظف · {toArabicDigits(team.unassigned)} عميل غير موزّع
          </div>
        </div>
      </div>

      {/* ===== ٦) بطاقات إحصاءات الموظفين — شريط أفقي بالتقاط + فلتر الفترة ===== */}
      {empCards.length > 0 && (
        <section className="flex flex-col" style={{ gap: 9 }}>
          <MobileChips param="sp" current={period} base="/m/team" items={[...STAT_PERIODS]} />
          <MobileEmployeeCards cards={empCards} />
          {(!dashPeriod || !actArg) && (
            <p style={{ fontSize: 10.5, color: MOBILE_COLORS.textMuted, lineHeight: 1.7, padding: "0 2px" }}>
              {!dashPeriod
                ? "«أمس» يدعمه تقرير النشاط وحده — الاتصالات والزيارات والحجوزات تُعرض في اليوم/الأسبوع/الكل."
                : "«هذا الأسبوع» تدعمه لوحة المؤشرات وحدها — المتابعات والاستقبال والسحب تُعرض في اليوم/أمس/الكل."}
            </p>
          )}
        </section>
      )}

      {/* ===== المتابعات (عليه/أنجز/فاته) ===== */}
      <div className="m-rise" style={{ ...card, borderInlineStart: `3px solid ${MOBILE_COLORS.gold}` }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: MOBILE_COLORS.textPrimary, marginBottom: 8 }}>متابعات اليوم</div>
        {dash.teamFollowupsToday.length === 0 ? (
          <p style={{ fontSize: "12.5px", color: MOBILE_COLORS.textMuted }}>ما فيه متابعات اليوم للفريق</p>
        ) : (
          dash.teamFollowupsToday.map((t, i) => (
            <div key={t.id} className="flex items-center justify-between"
              style={{ boxSizing: "border-box", gap: 8, minHeight: 40, borderTop: i === 0 ? "none" : `1px solid ${MOBILE_COLORS.line3}` }}>
              <span className="min-w-0 flex-1 truncate" style={{ fontSize: "12.5px", color: MOBILE_COLORS.textPrimary }}>{t.name}</span>
              <span className="flex-none" style={{ fontSize: "11.5px", color: MOBILE_COLORS.textSecondary }}>
                عليه {toArabicDigits(t.total)} · أنجز <b style={{ color: MOBILE_STATUS.success.fg }}>{toArabicDigits(t.done)}</b>
                {" · "}فاته <b style={{ color: t.missed > 0 ? MOBILE_STATUS.danger.fg : MOBILE_COLORS.textMuted }}>{toArabicDigits(t.missed)}</b>
              </span>
            </div>
          ))
        )}
      </div>

      {/* ===== الموظفون — الصف يفتح إعداداته ===== */}
      {rows.length === 0 ? (
        <p style={{ ...card, fontSize: "12.5px", color: MOBILE_COLORS.textMuted, textAlign: "center", padding: "30px 16px" }}>
          ما فيه موظفون بعد.
        </p>
      ) : (
        <MobileTeamRoster rows={rows} />
      )}
    </div>
  );
}
