import Link from "next/link";
import { ChevronLeft, Handshake } from "lucide-react";
import { getBookings } from "@/lib/data/bookings";
import { bookingStageLabels } from "@/lib/labels";
import { formatCurrencyFull } from "@/lib/format";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";

export const dynamic = "force-dynamic";

/**
 * خط المبيعات — غلاف جوال لـgetBookings() حرفيًا: نفس تقييد الأدوار والمبالغ
 * (الحساسات null لغير صاحب الحجز/المدير — نعرض «محجوب» بدلها).
 * القراءة للكل كما في الديسكتوب؛ تسجيل/تعديل الحجز (نموذج الوحدة والدفعات)
 * لم يُنقل — من الديسكتوب.
 */
export default async function MobileBookingsPage() {
  const data = await getBookings(); // الحارس والحجب داخل الدالة نفسها.

  const kpiCards = [
    { label: "إجمالي الحجوزات", value: toArabicDigits(data.kpis.total), color: MOBILE_COLORS.textPrimary },
    { label: "قيد الإجراء", value: toArabicDigits(data.kpis.inProgress), color: MOBILE_STATUS.warning.fg },
    { label: "تم البيع", value: toArabicDigits(data.kpis.sold), color: MOBILE_STATUS.success.fg },
    ...(data.manager
      ? [{ label: "قيمة المبيعات", value: formatCurrencyFull(data.kpis.salesValue), color: MOBILE_COLORS.gold }]
      : []),
  ];

  return (
    <div className="m-screen flex flex-col" style={{ gap: 13 }}>
      <div className="flex items-center" style={{ gap: 11 }}>
        <Link href="/m/more" aria-label="رجوع" className="flex items-center justify-center"
          style={{ minWidth: 44, minHeight: 44, marginInlineStart: -10, color: MOBILE_COLORS.textPrimary }}>
          <ChevronLeft size={20} strokeWidth={2} style={{ transform: "scaleX(-1)" }} aria-hidden />
        </Link>
        <div>
          <h1 style={{ fontSize: 17, fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>خط المبيعات</h1>
          <div style={{ fontSize: "11.5px", color: MOBILE_COLORS.textMuted, marginTop: 3 }}>
            الحجوزات — التسجيل والتعديل من الديسكتوب
          </div>
        </div>
      </div>

      {/* ===== المؤشرات ===== */}
      <div className="grid grid-cols-2" style={{ gap: 9 }}>
        {kpiCards.map((k) => (
          <div key={k.label} className="flex flex-col justify-center"
            style={{ boxSizing: "border-box", background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`, borderRadius: 16, padding: "13px 12px", minHeight: 74, gap: 4 }}>
            <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.15, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: 11, color: MOBILE_COLORS.textSecondary }}>{k.label}</div>
          </div>
        ))}
      </div>

      {data.cards.length === 0 ? (
        <div className="flex flex-col items-center text-center"
          style={{ boxSizing: "border-box", gap: 9, padding: "34px 16px", background: MOBILE_COLORS.card, borderRadius: 16, border: `1px solid ${MOBILE_COLORS.border}` }}>
          <Handshake size={34} style={{ color: MOBILE_COLORS.textMuted }} aria-hidden />
          <p style={{ fontSize: "12.5px", color: MOBILE_COLORS.textSecondary }}>ما فيه حجوزات بعد</p>
        </div>
      ) : (
        data.cards.map((b, i) => {
          const mineOrManager = b.collected != null; // الحجب صار على الخادم — null = محجوب.
          return (
            <Link key={b.id} href={`/m/leads/${b.leadId}`} className="m-rise block"
              style={{
                boxSizing: "border-box", background: MOBILE_COLORS.card,
                border: `1px solid ${b.financeRejected ? MOBILE_STATUS.danger.border : MOBILE_COLORS.border}`,
                borderRadius: 16, padding: "13px 14px", animationDelay: `${Math.min(i, 8) * 50}ms`,
              }}>
              <div className="flex items-center justify-between" style={{ gap: 8 }}>
                <span className="min-w-0 truncate" style={{ fontSize: "14.5px", fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>
                  {b.leadName}
                </span>
                <span className="shrink-0 whitespace-nowrap"
                  style={{
                    boxSizing: "border-box", fontSize: "10.5px", fontWeight: 600, padding: "4px 9px", borderRadius: 7,
                    background: b.stage === "SOLD" ? MOBILE_STATUS.success.bg : MOBILE_COLORS.goldBg,
                    color: b.stage === "SOLD" ? MOBILE_STATUS.success.fg : MOBILE_COLORS.gold,
                  }}>
                  {bookingStageLabels[b.stage]}
                </span>
              </div>
              <div style={{ fontSize: "11.5px", color: MOBILE_COLORS.textMuted, marginTop: 5 }}>
                {b.projectName ?? "بلا مشروع"} · وحدة {toArabicDigits(b.unitNumber)}
                {b.sellerName ? ` · ${b.sellerName}` : ""}
              </div>
              {b.financeRejected && (
                <div style={{ fontSize: "11.5px", color: MOBILE_STATUS.danger.fg, marginTop: 5 }}>
                  رفض تمويل{b.financeRejectedReason ? ` — ${b.financeRejectedReason}` : ""}
                </div>
              )}
              <div style={{ height: 1, background: MOBILE_COLORS.border, margin: "10px 0 9px" }} aria-hidden />
              <div className="flex items-center justify-between" style={{ fontSize: 12 }}>
                <span style={{ color: MOBILE_COLORS.textSecondary }}>
                  المحصّل:{" "}
                  <b style={{ color: mineOrManager ? MOBILE_STATUS.success.fg : MOBILE_COLORS.dim1 }}>
                    {mineOrManager ? formatCurrencyFull(b.collected!) : "محجوب"}
                  </b>
                </span>
                <span style={{ color: MOBILE_COLORS.textSecondary }}>
                  المتبقي:{" "}
                  <b style={{ color: mineOrManager ? MOBILE_STATUS.warning.fg : MOBILE_COLORS.dim1 }}>
                    {b.remaining != null ? formatCurrencyFull(b.remaining) : "محجوب"}
                  </b>
                </span>
              </div>
            </Link>
          );
        })
      )}
    </div>
  );
}
