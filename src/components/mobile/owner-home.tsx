import Link from "next/link";
import { getDashboard, normalizePeriod, type Period } from "@/lib/data/dashboard";
import { getNoResponseCount } from "@/lib/data/no-response";
import { getNotifications } from "@/lib/actions/notifications";
import { activeDuplicateGroupCount } from "@/lib/data/duplicates";
import { getTeamCommitment, normalizeFuWindow, FU_WINDOWS } from "@/lib/data/team-commitment";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { toArabicDigits, elapsedLabel } from "@/lib/mobile-format";
import { MobileChips } from "@/components/mobile/chips";
import { MobileHeaderActions } from "@/components/mobile/header-actions";
import { OwnerKpis } from "@/components/mobile/owner-kpis";
import { TeamCommitment, type CommitmentRow } from "@/components/mobile/team-commitment";

/**
 * لوحة المالك/المدير (isOwnerHome في النموذج) — البيانات من getDashboard:
 * محجَّمة للمدير وهي لوحة مدير فعلًا، فثقلها هنا في محله (بخلاف شاشة الموظف).
 */
export async function MobileOwnerHome({
  user,
  period: rawPeriod,
  fuWindow: rawFu,
}: {
  user: { name?: string | null; role: string };
  period?: string;
  /** فلتر قسم «متابعات الموظفين» (?fu=) — مستقل تمامًا عن فلتر البطاقات (?p=). */
  fuWindow?: string;
}) {
  const period = normalizePeriod(rawPeriod);
  const fuWin = normalizeFuWindow(rawFu);
  const owner = user.role === "OWNER";
  const now = new Date();
  const [data, dupCount, noResponseCount, notif, commitment] = await Promise.all([
    getDashboard(period),
    owner ? activeDuplicateGroupCount() : Promise.resolve(0),
    owner ? getNoResponseCount() : Promise.resolve(0),
    getNotifications(),
    getTeamCommitment(fuWin, now),
  ]);

  // «متابعات الموظفين»: أسماء الفريق من getDashboard (موظفون نشطون فقط — المالك ليس بينهم)
  // + إحصاءات الالتزام، مرتّبين بالنسبة تنازليًا (الأعلى التزامًا أولًا).
  const commitRows: CommitmentRow[] = data.team
    .map((t): CommitmentRow => {
      const c = commitment.get(t.id);
      const done = c?.done ?? 0;
      const missed = c?.missed ?? 0;
      const total = done + missed;
      return {
        id: t.id,
        name: t.name,
        done,
        missed,
        total,
        pct: total > 0 ? Math.round((done / total) * 100) : 0,
        lastLabel: c?.lastAt ? `آخر نشاط قبل ${elapsedLabel(c.lastAt, now)}` : "لا نشاط مسجّل",
      };
    })
    .sort((a, b) => b.pct - a.pct || b.done - a.done);

  const firstName = (user.name ?? "").trim().split(/\s+/)[0] || "مرحبًا";

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

      {/* ===== فلتر الفترة — الفعّال بتدرّج ذهبي (يحفظ فلتر ?fu المستقل) ===== */}
      <MobileChips param="p" current={period} base="/m" items={PERIODS} goldGradient keep={fuWin !== "today" ? { fu: fuWin } : undefined} />

      {/* ===== المؤشرات الحية: بانر «غير موزّعين» + شبكة KPI بعدّ تصاعدي ===== */}
      <OwnerKpis
        unassigned={data.kpis.unassigned}
        total={data.kpis.newInPeriod}
        conversion={data.kpis.conversion}
        bookings={data.kpis.bookings}
        visits={data.kpis.visits}
      />

      {/* ===== متابعات الموظفين — التزام كل موظف بمواعيده (اتصالات + زيارات) ===== */}
      {commitRows.length > 0 && (
        <section className="flex flex-col" style={{ gap: 11 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: MOBILE_COLORS.textPrimary, marginTop: 6, padding: "0 2px" }}>
            متابعات الموظفين
          </h2>
          {/* فلتر القسم المستقل (?fu=) — يحفظ فلتر البطاقات ?p ولا يتأثر به */}
          <MobileChips
            param="fu"
            current={fuWin}
            base="/m"
            items={FU_WINDOWS}
            goldGradient
            keep={period !== "24h" ? { p: period } : undefined}
          />
          <TeamCommitment rows={commitRows} />
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
