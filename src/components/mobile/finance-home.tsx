import Link from "next/link";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { toArabicDigits, formatCurrency, formatCount } from "@/lib/format";
import type { FinanceDashboardData } from "@/lib/data/finance-dashboard";
import { AttendanceCard } from "@/components/attendance/attendance-card";

/**
 * رئيسية المدير المالي — جوال (قرار 2026-08-20): نفس ترتيب الديسكتوب المعتمد
 * (الأرقام ← دوامه ← الأمور المالية ← المبيعات) بتوكنز الجوال، بلا أي عنصر عملاء.
 */
export function MobileFinanceHome({ data, firstName }: { data: FinanceDashboardData; firstName: string }) {
  const k = data.kpis;
  const card = {
    background: MOBILE_COLORS.card,
    border: `1px solid ${MOBILE_COLORS.border}`,
    borderRadius: 16,
    padding: 14,
  } as const;
  const kpis = [
    { label: "إجمالي العملاء", v: formatCount(k.totalClients.value), c: MOBILE_COLORS.gold },
    { label: "الحجوزات", v: formatCount(k.bookings.value), c: MOBILE_STATUS.info?.base ?? "#5b9bd8" },
    { label: "صفقات مقفولة", v: formatCount(k.closedWon.value), c: MOBILE_STATUS.success.base },
    { label: "الزيارات", v: formatCount(k.visits.value), c: MOBILE_STATUS.warning.base },
    { label: "نسبة التحويل", v: `${toArabicDigits(k.conversion.value)}٪`, c: MOBILE_COLORS.gold },
  ];

  return (
    <div className="m-screen flex flex-col" style={{ gap: 13 }}>
      <div style={{ padding: "0 2px" }}>
        <h1 style={{ fontSize: 21, fontWeight: 800, color: MOBILE_COLORS.textPrimary }}>هلا {firstName}</h1>
        <p style={{ fontSize: 11.5, color: MOBILE_COLORS.textMuted, marginTop: 3 }}>لوحتك المالية — الأرقام والتحصيل والمبيعات</p>
      </div>

      {/* ١) الأرقام الأساسية — بلا «غير موزّعين» */}
      <div className="grid grid-cols-2" style={{ gap: 9 }}>
        {kpis.map((x) => (
          <div key={x.label} style={card}>
            <div style={{ fontSize: 20, fontWeight: 800, color: x.c, fontVariantNumeric: "tabular-nums" }}>{x.v}</div>
            <div style={{ fontSize: 10.5, color: MOBILE_COLORS.textMuted, marginTop: 4 }}>{x.label}</div>
          </div>
        ))}
      </div>

      {/* ٢) دوامه الشخصي */}
      <AttendanceCard theme="mobile" />

      {/* ٣) الأمور المالية */}
      <div style={card}>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: MOBILE_COLORS.gold, marginBottom: 9 }}>ملخص التحصيل</div>
        <div className="flex justify-between" style={{ fontSize: 12, padding: "3px 0" }}>
          <span style={{ color: MOBILE_COLORS.textMuted }}>المحصّل</span>
          <b style={{ color: MOBILE_STATUS.success.base }}>{formatCurrency(data.collection.collected)}</b>
        </div>
        <div className="flex justify-between" style={{ fontSize: 12, padding: "3px 0" }}>
          <span style={{ color: MOBILE_COLORS.textMuted }}>المتبقي</span>
          <b style={{ color: MOBILE_STATUS.warning.base }}>{formatCurrency(data.collection.remaining)}</b>
        </div>
        <div style={{ height: 6, borderRadius: 4, background: MOBILE_COLORS.line2, overflow: "hidden", marginTop: 8 }}>
          <div style={{ height: "100%", width: `${data.collection.pct}%`, background: MOBILE_STATUS.success.base, borderRadius: 4 }} />
        </div>
        <div style={{ fontSize: 10, color: MOBILE_COLORS.textMuted, marginTop: 5 }}>{toArabicDigits(data.collection.pct)}٪ محصّلة</div>
      </div>

      {data.attention.length > 0 && (
        <div style={{ ...card, borderColor: MOBILE_STATUS.warning.border, background: MOBILE_STATUS.warning.bg }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: MOBILE_STATUS.warning.fg, marginBottom: 8 }}>
            قريبة من التسليم وتحصيلها غير مكتمل ({toArabicDigits(data.attention.length)})
          </div>
          {data.attention.slice(0, 4).map((a) => (
            <div key={a.id} style={{ fontSize: 11, lineHeight: 1.9, borderBottom: `1px solid ${MOBILE_COLORS.border}`, padding: "5px 0" }}>
              <b style={{ color: MOBILE_COLORS.textPrimary }}>{a.leadName}</b>
              <span style={{ color: MOBILE_COLORS.textMuted }}> · {a.unitLabel}</span>
              <div>المتبقي <b style={{ color: MOBILE_STATUS.warning.base }}>{formatCurrency(a.remaining)}</b></div>
            </div>
          ))}
        </div>
      )}

      <div style={card}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: MOBILE_COLORS.textPrimary, marginBottom: 8 }}>آخر دفعات التحصيل</div>
        {data.recentPayments.length === 0 && <div style={{ fontSize: 11, color: MOBILE_COLORS.textMuted }}>ما فيه دفعات مسجّلة بعد.</div>}
        {data.recentPayments.slice(0, 4).map((p, i) => (
          <div key={i} style={{ fontSize: 10.5, lineHeight: 1.8, color: MOBILE_COLORS.textSecondary, padding: "4px 0", borderBottom: `1px solid ${MOBILE_COLORS.border}` }}>
            {p.summary}
            <div style={{ color: MOBILE_COLORS.textMuted }}>{p.byName} · {p.whenText}</div>
          </div>
        ))}
      </div>

      {/* ٤) المبيعات */}
      <div style={card}>
        <div className="flex items-center justify-between" style={{ marginBottom: 9 }}>
          <span style={{ fontSize: 12.5, fontWeight: 800, color: MOBILE_COLORS.textPrimary }}>خط المبيعات بمراحله</span>
          <Link href="/m/bookings" style={{ fontSize: 10.5, color: MOBILE_COLORS.gold, fontWeight: 700 }}>فتحه ←</Link>
        </div>
        <div className="grid grid-cols-4" style={{ gap: 6 }}>
          {data.stageCounts.map((s) => (
            <div key={s.stage} style={{ background: MOBILE_COLORS.sheet, border: `1px solid ${MOBILE_COLORS.border}`, borderRadius: 10, padding: "7px 3px", textAlign: "center" }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: MOBILE_COLORS.textPrimary, fontVariantNumeric: "tabular-nums" }}>{toArabicDigits(s.count)}</div>
              <div style={{ fontSize: 8.5, color: MOBILE_COLORS.textMuted, marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2" style={{ gap: 9 }}>
        <div style={{ ...card, borderColor: MOBILE_COLORS.goldBorder, background: MOBILE_COLORS.goldBg }}>
          <div style={{ fontSize: 10.5, color: MOBILE_COLORS.gold, fontWeight: 700 }}>نجم الأسبوع</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: MOBILE_COLORS.textPrimary, marginTop: 4 }}>{data.weekStar?.name ?? "—"}</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: 10.5, color: MOBILE_STATUS.success.base, fontWeight: 700 }}>متصلون الآن ({toArabicDigits(data.online.length)})</div>
          <div style={{ fontSize: 11, color: MOBILE_COLORS.textSecondary, marginTop: 4, lineHeight: 1.8 }}>
            {data.online.length === 0 ? "ما فيه أحد" : data.online.map((u) => u.name).join(" · ")}
          </div>
        </div>
      </div>
    </div>
  );
}
