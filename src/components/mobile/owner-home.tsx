import Link from "next/link";
import { getDashboard, normalizePeriod, type Period } from "@/lib/data/dashboard";
import { getNoResponseCount } from "@/lib/data/no-response";
import { getActivityReport } from "@/lib/data/activity-report";
import { getNotifications } from "@/lib/actions/notifications";
import { activeDuplicateGroupCount } from "@/lib/data/duplicates";
import { MobileEmployeeCards, type EmpStatCard } from "@/components/mobile/employee-cards";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";
import { MobileChips } from "@/components/mobile/chips";
import { MobileHeaderActions } from "@/components/mobile/header-actions";
import { OwnerKpis } from "@/components/mobile/owner-kpis";

/**
 * لوحة المالك/المدير (isOwnerHome في النموذج) — البيانات من getDashboard:
 * محجَّمة للمدير وهي لوحة مدير فعلًا، فثقلها هنا في محله (بخلاف شاشة الموظف).
 */
export async function MobileOwnerHome({
  user,
  period: rawPeriod,
}: {
  user: { name?: string | null; role: string };
  period?: string;
}) {
  const period = normalizePeriod(rawPeriod);
  const owner = user.role === "OWNER";
  const [data, dupCount, noResponseCount, notif, activity] = await Promise.all([
    getDashboard(period),
    owner ? activeDuplicateGroupCount() : Promise.resolve(0),
    owner ? getNoResponseCount() : Promise.resolve(0),
    getNotifications(),
    // «استقبل / سُحب منه / متابعات» — نفس تقرير نشاط الديسكتوب (يرجّع فارغًا لغير المالك).
    getActivityReport({ all: true }),
  ]);

  // بطاقات الموظفين: دمج مصدرَي الديسكتوب على المعرّف — بلا أي حساب جديد.
  const actById = new Map(activity.rows.map((r) => [r.id, r]));
  const empCards: EmpStatCard[] = data.team.map((t): EmpStatCard => {
    const a = actById.get(t.id);
    return {
      id: t.id,
      name: t.name,
      calls: t.attempts,
      followups: a?.followups ?? null,
      visits: t.visits,
      bookings: t.bookings,
      received: a?.received ?? null,
      pulled: a?.lateLost ?? null,
    };
  });

  const firstName = (user.name ?? "").trim().split(/\s+/)[0] || "مرحبًا";

  // «متابعات اليوم للفريق» — أشرطة التقدم (أحمر لمن عنده متأخرات).
  const teamRows = data.teamFollowupsToday;

  // تنبيهات من مصادر فعلية فقط — صفرها يُسقطها.
  const alerts = [
    noResponseCount > 0 ? { text: "عملاء «لم يتم الرد» بانتظار قرارك", count: noResponseCount, color: MOBILE_STATUS.danger.base, href: "/m/no-response" } : null,
    dupCount > 0 ? { text: "العملاء المكررون", count: dupCount, color: MOBILE_STATUS.warning.base, href: "/m/duplicates" } : null,
    data.kpis.unassigned > 0 ? { text: "عملاء غير موزّعين", count: data.kpis.unassigned, color: MOBILE_STATUS.danger.base, href: "/m/distribution" } : null,
  ].filter((a): a is NonNullable<typeof a> => a !== null);

  const PERIODS: { key: Period; label: string }[] = [
    { key: "24h", label: "٢٤ ساعة" },
    { key: "48h", label: "٤٨ ساعة" },
    { key: "72h", label: "٧٢ ساعة" },
    { key: "week", label: "أسبوع" },
    { key: "all", label: "الكل" },
  ];

  return (
    <div className="flex flex-col" style={{ gap: 16 }}>
      {/* ===== الترويسة ===== */}
      <header className="flex items-start justify-between" style={{ padding: "0 2px" }}>
        <div className="min-w-0">
          <div className="truncate" style={{ fontSize: 21, fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>
            مرحبًا {firstName}
          </div>
          <div style={{ fontSize: 13, color: MOBILE_COLORS.textSecondary, marginTop: 4 }}>
            نظرة على الفريق اليوم
          </div>
        </div>
        {/* ثيم · بحث · جرس — نفس هندسة النموذج (الصورة الرمزية في /m/more). */}
        <MobileHeaderActions unread={notif.unread} />
      </header>

      {/* ===== فلتر الفترة — الفعّال بتدرّج ذهبي ===== */}
      <MobileChips param="p" current={period} base="/m" items={PERIODS} goldGradient />

      {/* ===== المؤشرات الحية: بانر «غير موزّعين» + شبكة KPI بعدّ تصاعدي ===== */}
      <OwnerKpis
        unassigned={data.kpis.unassigned}
        total={data.kpis.newInPeriod}
        conversion={data.kpis.conversion}
        bookings={data.kpis.bookings}
        visits={data.kpis.visits}
      />

      {/* ===== ٦) بطاقات إحصاءات الموظفين — شريط أفقي بالتقاط ===== */}
      {empCards.length > 0 && (
        <section className="flex flex-col" style={{ gap: 11 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: MOBILE_COLORS.textPrimary, marginTop: 6, padding: "0 2px" }}>
            إحصاءات الموظفين
          </h2>
          <MobileEmployeeCards cards={empCards} />
        </section>
      )}

      {/* ===== متابعات اليوم بأشرطة التقدم ===== */}
      {teamRows.length > 0 && (
        <section className="flex flex-col" style={{ gap: 11 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: MOBILE_COLORS.textPrimary, marginTop: 6, padding: "0 2px" }}>
            متابعات اليوم
          </h2>
          {teamRows.map((t) => {
            const pct = t.total > 0 ? Math.round((t.done / t.total) * 100) : 0;
            const barColor = t.missed > 0 ? MOBILE_STATUS.danger.base : MOBILE_COLORS.gold;
            return (
              <div
                key={t.id}
                className="flex flex-col"
                style={{
                  boxSizing: "border-box",
                  background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`,
                  borderRadius: 16, padding: "13px 14px", gap: 9,
                }}
              >
                <div className="flex items-center justify-between">
                  <div style={{ fontSize: "14.5px", fontWeight: 600, color: MOBILE_COLORS.textPrimary }}>
                    {t.name}
                  </div>
                </div>
                <div style={{ fontSize: "11.5px", color: MOBILE_COLORS.textMuted }}>
                  {toArabicDigits(t.done)} من {toArabicDigits(t.total)} متابعات اليوم
                  {t.missed > 0 ? ` · ${toArabicDigits(t.missed)} متأخرة` : ""}
                </div>
                <div className="flex items-center" style={{ gap: 9 }}>
                  <div
                    className="flex-1 overflow-hidden"
                    style={{ height: 6, borderRadius: 3, background: MOBILE_COLORS.border }}
                  >
                    <div style={{ height: "100%", borderRadius: 3, width: `${pct}%`, background: barColor }} />
                  </div>
                  <span style={{ fontSize: "11.5px", fontWeight: 600, color: barColor }}>
                    {toArabicDigits(pct)}٪
                  </span>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* ===== تنبيهات تحتاج انتباه ===== */}
      {alerts.length > 0 && (
        <section className="flex flex-col" style={{ gap: 9 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: MOBILE_COLORS.textPrimary, marginTop: 6, padding: "0 2px" }}>
            تنبيهات تحتاج انتباه
          </h2>
          {alerts.map((a) => (
            <Link
              key={a.text}
              href={a.href}
              className="flex items-center"
              style={{
                boxSizing: "border-box", gap: 11, minHeight: 44,
                background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`,
                borderRadius: 14, padding: "12px 13px",
              }}
            >
              <span className="flex-none" style={{ width: 8, height: 8, borderRadius: 5, background: a.color }} />
              <span className="flex-1" style={{ fontSize: 13, color: MOBILE_COLORS.textPrimary }}>{a.text}</span>
              <span style={{ fontSize: 11, color: MOBILE_COLORS.textMuted }}>{toArabicDigits(a.count)}</span>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}

export default MobileOwnerHome;
