import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireUser, isManager } from "@/lib/auth-guards";
import { getAnalytics, getEmployeeDeepAnalysis } from "@/lib/data/analytics";
import { stageLabels, channelLabels } from "@/lib/labels";
import { STAGE_HEX } from "@/lib/stage-colors";
import { formatCurrencyFull } from "@/lib/format";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";

export const dynamic = "force-dynamic";

/*
 * التحليلات — نفس تفريع الديسكتوب حرفيًا ((app)/analytics/page.tsx):
 *   الموظف ⟵ getEmployeeDeepAnalysis(user.id) — تحليله الشخصي فقط.
 *   المالك/المدير ⟵ getAnalytics() الكاملة.
 * الرسوم أشرطة CSS — لا مكتبة رسم في المشروع أصلًا (نفس أسلوب الديسكتوب).
 */

const card = {
  boxSizing: "border-box" as const,
  background: MOBILE_COLORS.card,
  border: `1px solid ${MOBILE_COLORS.border}`,
  borderRadius: 16,
  padding: "13px 14px",
};

function Kpi({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <div className="flex flex-col justify-center" style={{ ...card, minHeight: 74, gap: 4, padding: "12px" }}>
      <div style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.15, color: color ?? MOBILE_COLORS.textPrimary }}>{value}</div>
      <div style={{ fontSize: 11, color: MOBILE_COLORS.textSecondary }}>{label}</div>
    </div>
  );
}

function Bar({ label, count, max, color }: { label: string; count: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div className="flex items-center" style={{ gap: 9, minHeight: 30 }}>
      <span className="flex-none truncate" style={{ width: 92, fontSize: "11.5px", color: MOBILE_COLORS.textSecondary }}>{label}</span>
      <div className="flex-1 overflow-hidden" style={{ height: 7, borderRadius: 4, background: MOBILE_COLORS.border }}>
        <div style={{ height: "100%", borderRadius: 4, width: `${pct}%`, background: color }} />
      </div>
      <span className="flex-none" style={{ width: 34, fontSize: "11.5px", fontWeight: 600, color: MOBILE_COLORS.textPrimary, textAlign: "left" }}>
        {toArabicDigits(count)}
      </span>
    </div>
  );
}

function Header({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="flex items-center" style={{ gap: 11 }}>
      <Link href="/m/more" aria-label="رجوع" className="flex items-center justify-center"
        style={{ minWidth: 44, minHeight: 44, marginInlineStart: -10, color: MOBILE_COLORS.textPrimary }}>
        <ChevronLeft size={20} strokeWidth={2} style={{ transform: "scaleX(-1)" }} aria-hidden />
      </Link>
      <div>
        <h1 style={{ fontSize: 17, fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>{title}</h1>
        <div style={{ fontSize: "11.5px", color: MOBILE_COLORS.textMuted, marginTop: 3 }}>{sub}</div>
      </div>
    </div>
  );
}

export default async function MobileAnalyticsPage() {
  const user = await requireUser();

  // ===== الموظف: أداؤه الشخصي فقط — نفس فرع الديسكتوب =====
  if (!isManager(user.role) && user.role !== "FINANCE") {
    const me = await getEmployeeDeepAnalysis(user.id, Date.now());
    return (
      <div className="m-screen flex flex-col" style={{ gap: 13 }}>
        <Header title="أدائي" sub="تحليل أدائك الشخصي" />
        {!me ? (
          <p style={{ fontSize: "12.5px", color: MOBILE_COLORS.textMuted }}>تعذّر تحميل البيانات.</p>
        ) : (
          <>
            <div className="grid grid-cols-2" style={{ gap: 9 }}>
              <Kpi value={toArabicDigits(me.active)} label="عملائي النشطون" />
              <Kpi value={toArabicDigits(me.followups)} label="المتابعات" color={MOBILE_COLORS.gold} />
              <Kpi value={toArabicDigits(me.visits)} label="الزيارات" />
              <Kpi value={toArabicDigits(me.bookings)} label="الحجوزات" color={MOBILE_STATUS.success.fg} />
              <Kpi value={`${toArabicDigits(me.conversion)}٪`} label="تحويل الزيارات إلى حجوزات" color={MOBILE_COLORS.gold} />
              <Kpi
                value={me.targetPct != null ? `${toArabicDigits(me.targetPct)}٪` : "—"}
                label={`نحو الهدف (${toArabicDigits(me.target)})`}
                color={me.targetPct != null && me.targetPct >= 100 ? MOBILE_STATUS.success.fg : MOBILE_STATUS.warning.fg}
              />
            </div>
            {me.avgResponseHours != null && (
              <div style={card}>
                <div style={{ fontSize: 13, fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>سرعة الاستجابة</div>
                <div style={{ fontSize: "12.5px", color: MOBILE_COLORS.textSecondary, marginTop: 6, lineHeight: 1.8 }}>
                  متوسط أول تواصل: {toArabicDigits(Math.round(me.avgResponseHours))} ساعة
                </div>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // ===== المالك/المدير: التحليلات الكاملة =====
  const a = await getAnalytics();
  const maxFunnel = Math.max(...a.funnel.map((f) => f.count), 1);
  const maxChannel = Math.max(...a.channels.map((c) => c.count), 1);

  return (
    <div className="m-screen flex flex-col" style={{ gap: 13 }}>
      <Header title="التحليلات" sub="الأداء والقمع والمال" />

      {/* المال */}
      <div className="grid grid-cols-2" style={{ gap: 9 }}>
        <Kpi value={formatCurrencyFull(a.finance.collected)} label="المحصّل" color={MOBILE_STATUS.success.fg} />
        <Kpi value={formatCurrencyFull(a.finance.notCollected)} label="غير المحصّل" color={MOBILE_STATUS.warning.fg} />
        <Kpi value={`${toArabicDigits(a.metrics.winRate)}٪`} label="نسبة الكسب" color={MOBILE_COLORS.gold} />
        <Kpi value={`${toArabicDigits(a.metrics.responseRate)}٪`} label="نسبة الاستجابة" />
      </div>

      {/* القمع */}
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, color: MOBILE_COLORS.textPrimary, marginBottom: 9 }}>قمع المراحل</div>
        {a.funnel.map((f) => (
          <Bar key={f.stage} label={stageLabels[f.stage]} count={f.count} max={maxFunnel} color={STAGE_HEX[f.stage]} />
        ))}
      </div>

      {/* القنوات */}
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, color: MOBILE_COLORS.textPrimary, marginBottom: 9 }}>قنوات الوصول</div>
        {a.channels.map((c) => (
          <Bar key={c.channel} label={channelLabels[c.channel]} count={c.count} max={maxChannel} color={MOBILE_COLORS.gold} />
        ))}
      </div>

      {/* مؤشر الحضور */}
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, color: MOBILE_COLORS.textPrimary, marginBottom: 6 }}>حضور الزيارات</div>
        <div style={{ fontSize: "12.5px", color: MOBILE_COLORS.textSecondary, lineHeight: 1.8 }}>
          زار {toArabicDigits(a.attendance.visited)} · ما حضر {toArabicDigits(a.attendance.noShow)}
          {a.attendance.ratePct != null ? ` · نسبة الحضور ${toArabicDigits(a.attendance.ratePct)}٪` : ""}
        </div>
      </div>

      {/* الفريق */}
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, color: MOBILE_COLORS.textPrimary, marginBottom: 9 }}>أداء الموظفين</div>
        {a.team.map((t) => (
          <div key={t.id} style={{ borderTop: `1px solid ${MOBILE_COLORS.line3}`, padding: "9px 0" }}>
            <div className="flex items-center justify-between">
              <span style={{ fontSize: 13, fontWeight: 600, color: MOBILE_COLORS.textPrimary }}>{t.name}</span>
              <span style={{ fontSize: "11.5px", fontWeight: 600, color: MOBILE_COLORS.gold }}>
                حجز/زيارة {toArabicDigits(t.conversion)}٪
              </span>
            </div>
            <div style={{ fontSize: 11, color: MOBILE_COLORS.textMuted, marginTop: 3 }}>
              {toArabicDigits(t.assigned)} عميل · {toArabicDigits(t.followups)} متابعة · {toArabicDigits(t.visits)} زيارة · {toArabicDigits(t.bookings)} حجز · {toArabicDigits(t.closed)} صفقة
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
