import Link from "next/link";
import { Bell } from "lucide-react";
import { getDashboard, normalizePeriod, type Period } from "@/lib/data/dashboard";
import { getNoResponseCount } from "@/lib/data/no-response";
import { getNotifications } from "@/lib/actions/notifications";
import { activeDuplicateGroupCount } from "@/lib/data/duplicates";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";
import { MobileChips } from "@/components/mobile/chips";
import { MobileExternalLink } from "@/components/mobile/external-link";

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
  const [data, dupCount, noResponseCount, notif] = await Promise.all([
    getDashboard(period),
    owner ? activeDuplicateGroupCount() : Promise.resolve(0),
    owner ? getNoResponseCount() : Promise.resolve(0),
    getNotifications(),
  ]);

  const firstName = (user.name ?? "").trim().split(/\s+/)[0] || "مرحبًا";

  const kpis = [
    { value: data.kpis.newInPeriod, label: "إجمالي العملاء", color: MOBILE_COLORS.textPrimary },
    { value: data.kpis.bookings, label: "عدد الحجوزات", color: MOBILE_COLORS.gold },
    { value: data.kpis.visits, label: "عدد الزيارات", color: MOBILE_COLORS.textPrimary },
    { value: data.kpis.closedWon, label: "صفقات مقفولة", color: MOBILE_STATUS.success.fg },
  ];

  // «متابعات اليوم للفريق» — أشرطة التقدم (أحمر لمن عنده متأخرات).
  const teamRows = data.teamFollowupsToday;

  // تنبيهات من مصادر فعلية فقط — صفرها يُسقطها.
  const alerts = [
    noResponseCount > 0 ? { text: "عملاء «لم يتم الرد» بانتظار قرارك", count: noResponseCount, color: MOBILE_STATUS.danger.base, href: "/no-response" } : null,
    dupCount > 0 ? { text: "العملاء المكررون", count: dupCount, color: MOBILE_STATUS.warning.base, href: "/leads/duplicates" } : null,
    data.kpis.unassigned > 0 ? { text: "عملاء غير موزّعين", count: data.kpis.unassigned, color: MOBILE_STATUS.danger.base, href: "/distribution" } : null,
  ].filter((a): a is NonNullable<typeof a> => a !== null);

  const PERIODS: { key: Period; label: string }[] = [
    { key: "24h", label: "٢٤ ساعة" },
    { key: "48h", label: "٤٨ ساعة" },
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
        <div className="flex items-center" style={{ gap: 9 }}>
          <Link
            href="/m/notifications"
            aria-label="الإشعارات"
            className="relative flex items-center justify-center"
            style={{
              boxSizing: "border-box", width: 42, height: 42, borderRadius: 14,
              background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`,
            }}
          >
            <Bell size={19} style={{ color: MOBILE_COLORS.textSecondary }} aria-hidden />
            {notif.unread > 0 && (
              <span
                className="absolute flex items-center justify-center"
                style={{
                  boxSizing: "border-box", top: -6, left: -6, minWidth: 19, height: 19,
                  borderRadius: 10, background: MOBILE_STATUS.danger.base, color: "#FFFFFF",
                  fontSize: 10, fontWeight: 700, padding: "0 5px",
                  border: `2px solid ${MOBILE_COLORS.bg}`,
                }}
              >
                {toArabicDigits(notif.unread)}
              </span>
            )}
          </Link>
          <div
            className="flex items-center justify-center"
            style={{
              boxSizing: "border-box", width: 42, height: 42, borderRadius: 21,
              background: MOBILE_COLORS.sheet, border: `1px solid ${MOBILE_COLORS.border}`,
              fontSize: 13, fontWeight: 700, color: MOBILE_COLORS.gold,
            }}
            aria-hidden
          >
            {firstName.slice(0, 1)}
          </div>
        </div>
      </header>

      {/* ===== فلتر الفترة ===== */}
      <MobileChips param="p" current={period} base="/m" items={PERIODS} />

      {/* ===== المؤشرات ===== */}
      <div className="grid grid-cols-2" style={{ gap: 9 }}>
        {data.kpis.unassigned > 0 && (
          <div
            className="col-span-2 flex items-center justify-between"
            style={{
              boxSizing: "border-box",
              background: MOBILE_STATUS.danger.bg,
              border: `1px solid ${MOBILE_STATUS.danger.border}`,
              borderRadius: 16, padding: 14,
            }}
          >
            <div>
              <div style={{ fontSize: 24, fontWeight: 700, color: MOBILE_STATUS.danger.fg, lineHeight: 1 }}>
                {toArabicDigits(data.kpis.unassigned)}
              </div>
              <div style={{ fontSize: "11.5px", color: MOBILE_STATUS.danger.fg, opacity: 0.8, marginTop: 5 }}>
                عملاء غير موزّعين
              </div>
            </div>
            {/* شاشة التوزيع في الويب — تُفتح بمتصفح النظام لا داخل WebView */}
            <MobileExternalLink
              href="/distribution"
              className="flex items-center"
              showIcon={false}
              style={{
                boxSizing: "border-box", height: 38, padding: "0 16px", borderRadius: 10,
                background: MOBILE_STATUS.danger.base, color: "#FFFFFF",
                fontSize: 13, fontWeight: 700,
              }}
            >
              وزّعهم الآن
            </MobileExternalLink>
          </div>
        )}
        {kpis.map((k) => (
          <div
            key={k.label}
            className="flex flex-col justify-center"
            style={{
              boxSizing: "border-box",
              background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`,
              borderRadius: 16, padding: "14px 13px", minHeight: 82, gap: 5,
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1, color: k.color }}>
              {toArabicDigits(k.value)}
            </div>
            <div style={{ fontSize: "11.5px", color: MOBILE_COLORS.textSecondary }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* ===== أداء الفريق (متابعات اليوم بأشرطة التقدم) ===== */}
      {teamRows.length > 0 && (
        <section className="flex flex-col" style={{ gap: 11 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: MOBILE_COLORS.textPrimary, marginTop: 6, padding: "0 2px" }}>
            أداء الموظفين
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
            <MobileExternalLink
              key={a.text}
              href={a.href}
              className="flex items-center"
              showIcon={false}
              style={{
                boxSizing: "border-box", gap: 11, minHeight: 44,
                background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`,
                borderRadius: 14, padding: "12px 13px",
              }}
            >
              <span className="flex-none" style={{ width: 8, height: 8, borderRadius: 5, background: a.color }} />
              <span className="flex-1" style={{ fontSize: 13, color: MOBILE_COLORS.textPrimary }}>{a.text}</span>
              <span style={{ fontSize: 11, color: MOBILE_COLORS.textMuted }}>{toArabicDigits(a.count)}</span>
            </MobileExternalLink>
          ))}
        </section>
      )}
    </div>
  );
}

export default MobileOwnerHome;
