import { avatarColor, avatarInitials } from "@/lib/mobile-avatar";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";

export type EmpStatCard = {
  id: string;
  name: string;
  /** كل إحصاءة اختيارية — تُخفى إن لم يوفّرها مصدر الدور الحالي (لا صفر كاذب). */
  calls: number | null;      // اتصالات (محاولات) — TeamRow.attempts
  followups: number | null;  // متابعات — ActivityRow.followups
  visits: number | null;     // زيارات
  bookings: number | null;   // حجوزات
  received: number | null;   // استقبل — ActivityRow.received
  pulled: number | null;     // سُحب منه — ActivityRow.lateLost
};

const STATS: { key: keyof Omit<EmpStatCard, "id" | "name">; label: string; tone?: "success" | "danger" }[] = [
  { key: "calls", label: "اتصالات" },
  { key: "followups", label: "متابعات" },
  { key: "visits", label: "زيارات" },
  { key: "bookings", label: "حجوزات", tone: "success" },
  { key: "received", label: "استقبل" },
  { key: "pulled", label: "سُحب منه", tone: "danger" },
];

/**
 * بطاقات إحصاءات الموظفين — شريط أفقي بالتقاط (scroll-snap) بدل قائمة عمودية
 * طويلة. عرض بحت: كل رقم يصل جاهزًا من مصدره (getDashboard().team و
 * getActivityReport().rows) بلا أي حساب هنا.
 */
export function MobileEmployeeCards({ cards }: { cards: EmpStatCard[] }) {
  if (cards.length === 0) return null;

  return (
    <div
      className="m-noscroll m-snap flex overflow-x-auto"
      style={{ gap: 10, paddingBottom: 2, scrollPaddingInlineStart: 2 }}
    >
      {cards.map((c, i) => {
        const shown = STATS.filter((s) => c[s.key] != null);
        return (
          <div
            key={c.id}
            className="m-rise flex flex-none flex-col"
            style={{
              boxSizing: "border-box", width: 172, gap: 11,
              background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`,
              borderRadius: 16, padding: "13px 13px 14px",
              animationDelay: `${Math.min(i, 8) * 50}ms`,
            }}
          >
            <div className="flex items-center" style={{ gap: 9 }}>
              <span
                className="flex flex-none items-center justify-center"
                style={{
                  boxSizing: "border-box", width: 34, height: 34, borderRadius: 17,
                  background: avatarColor(c.id), color: "#FFFFFF", fontSize: 12, fontWeight: 700,
                }}
                aria-hidden
              >
                {avatarInitials(c.name)}
              </span>
              <span className="min-w-0 truncate" style={{ fontSize: "13.5px", fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>
                {c.name}
              </span>
            </div>

            <div className="grid grid-cols-2" style={{ gap: 7 }}>
              {shown.map((s) => (
                <div
                  key={s.key}
                  className="flex flex-col items-center justify-center"
                  style={{
                    boxSizing: "border-box", minHeight: 50, borderRadius: 11, gap: 3,
                    background: MOBILE_COLORS.bg, border: `1px solid ${MOBILE_COLORS.line3}`,
                  }}
                >
                  <span
                    style={{
                      fontSize: 16, fontWeight: 700, lineHeight: 1,
                      color:
                        s.tone === "success" ? MOBILE_STATUS.success.fg
                          : s.tone === "danger" && (c[s.key] as number) > 0 ? MOBILE_STATUS.danger.fg
                            : MOBILE_COLORS.textPrimary,
                    }}
                  >
                    {toArabicDigits(c[s.key] as number)}
                  </span>
                  <span style={{ fontSize: 9.5, color: MOBILE_COLORS.textMuted }}>{s.label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default MobileEmployeeCards;
