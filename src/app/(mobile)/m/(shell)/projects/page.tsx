import Link from "next/link";
import { ChevronLeft, Building2 } from "lucide-react";
import { requireUser, isManager } from "@/lib/auth-guards";
import { getProjectsOverview } from "@/lib/data/projects";
import { projectStatusLabels } from "@/lib/labels";
import { formatCurrencyFull } from "@/lib/format";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";

export const dynamic = "force-dynamic";

/** المشاريع — غلاف getProjectsOverview() (الإجماليات المالية null للموظف — تُخفى). */
export default async function MobileProjectsPage() {
  const user = await requireUser();
  const manager = (isManager(user.role) || user.role === "FINANCE");
  const data = await getProjectsOverview();

  return (
    <div className="m-screen flex flex-col" style={{ gap: 13 }}>
      <div className="flex items-center" style={{ gap: 11 }}>
        <Link href="/m/more" aria-label="رجوع" className="flex items-center justify-center"
          style={{ minWidth: 44, minHeight: 44, marginInlineStart: -10, color: MOBILE_COLORS.textPrimary }}>
          <ChevronLeft size={20} strokeWidth={2} style={{ transform: "scaleX(-1)" }} aria-hidden />
        </Link>
        <div>
          <h1 style={{ fontSize: 17, fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>المشاريع والوحدات</h1>
          <div style={{ fontSize: "11.5px", color: MOBILE_COLORS.textMuted, marginTop: 3 }}>
            {toArabicDigits(data.kpis.projects)} مشاريع · {toArabicDigits(data.kpis.available)} متاحة
            {" · "}{toArabicDigits(data.kpis.reserved)} محجوزة · {toArabicDigits(data.kpis.sold)} مباعة
          </div>
        </div>
      </div>

      {manager && data.kpis.salesValue != null && (
        <div className="flex" style={{ gap: 9 }}>
          <div className="flex flex-1 flex-col justify-center"
            style={{ boxSizing: "border-box", background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`, borderRadius: 16, padding: "12px", gap: 4 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: MOBILE_COLORS.gold }}>{formatCurrencyFull(data.kpis.salesValue)}</div>
            <div style={{ fontSize: 11, color: MOBILE_COLORS.textSecondary }}>قيمة المبيعات</div>
          </div>
          <div className="flex flex-1 flex-col justify-center"
            style={{ boxSizing: "border-box", background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`, borderRadius: 16, padding: "12px", gap: 4 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: MOBILE_STATUS.success.fg }}>{formatCurrencyFull(data.kpis.deposits ?? 0)}</div>
            <div style={{ fontSize: 11, color: MOBILE_COLORS.textSecondary }}>العرابين</div>
          </div>
        </div>
      )}

      {data.cards.length === 0 ? (
        <div className="flex flex-col items-center text-center"
          style={{ boxSizing: "border-box", gap: 9, padding: "34px 16px", background: MOBILE_COLORS.card, borderRadius: 16, border: `1px solid ${MOBILE_COLORS.border}` }}>
          <Building2 size={34} style={{ color: MOBILE_COLORS.textMuted }} aria-hidden />
          <p style={{ fontSize: "12.5px", color: MOBILE_COLORS.textSecondary }}>ما فيه مشاريع بعد</p>
        </div>
      ) : (
        data.cards.map((p, i) => {
          const pct = p.units.total > 0 ? Math.round(((p.units.reserved + p.units.sold) / p.units.total) * 100) : 0;
          return (
            <Link key={p.id} href={`/m/projects/${p.id}`} className="m-rise block"
              style={{
                boxSizing: "border-box", background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`,
                borderRadius: 18, padding: "14px 15px", animationDelay: `${Math.min(i, 8) * 60}ms`,
              }}>
              <div className="flex items-center justify-between" style={{ gap: 8 }}>
                <span style={{ fontSize: "15.5px", fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>{p.name}</span>
                <span style={{ boxSizing: "border-box", fontSize: "10.5px", fontWeight: 600, padding: "4px 9px", borderRadius: 7, background: MOBILE_COLORS.goldBg, color: MOBILE_COLORS.gold }}>
                  {projectStatusLabels[p.status]}
                </span>
              </div>
              {p.district && (
                <div style={{ fontSize: "11.5px", color: MOBILE_COLORS.textMuted, marginTop: 4 }}>{p.district}</div>
              )}
              <div className="flex items-center" style={{ gap: 9, marginTop: 11 }}>
                <div className="flex-1 overflow-hidden" style={{ height: 7, borderRadius: 4, background: MOBILE_COLORS.border }}>
                  <div style={{ height: "100%", borderRadius: 4, width: `${pct}%`, background: MOBILE_COLORS.gold }} />
                </div>
                <span style={{ fontSize: "11.5px", fontWeight: 600, color: MOBILE_COLORS.gold }}>{toArabicDigits(pct)}٪</span>
              </div>
              <div style={{ fontSize: 11, color: MOBILE_COLORS.textSecondary, marginTop: 7 }}>
                متاح {toArabicDigits(p.units.available)} · محجوز {toArabicDigits(p.units.reserved)} · مباع {toArabicDigits(p.units.sold)} من {toArabicDigits(p.units.total)}
              </div>
            </Link>
          );
        })
      )}
    </div>
  );
}
