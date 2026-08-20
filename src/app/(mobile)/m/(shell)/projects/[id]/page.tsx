import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireUser, isManager } from "@/lib/auth-guards";
import { getProject } from "@/lib/data/projects";
import { unitTypeLabels, unitStatusLabels, projectStatusLabels } from "@/lib/labels";
import { formatCurrencyFull } from "@/lib/format";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";

export const dynamic = "force-dynamic";

const UNIT_TONE: Record<string, { bg: string; fg: string }> = {
  AVAILABLE: { bg: MOBILE_STATUS.success.bg, fg: MOBILE_STATUS.success.fg },
  RESERVED: { bg: MOBILE_STATUS.warning.bg, fg: MOBILE_STATUS.warning.fg },
  SOLD: { bg: MOBILE_STATUS.danger.bg, fg: MOBILE_STATUS.danger.fg },
};

/** تفاصيل المشروع — غلاف getProject(id) بنفس حارس الديسكتوب (requireUser). */
export default async function MobileProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const manager = (isManager(user.role) || user.role === "FINANCE");
  const { id } = await params;
  const p = await getProject(id);
  if (!p) notFound();

  return (
    <div className="m-screen flex flex-col" style={{ gap: 13 }}>
      <div className="flex items-center" style={{ gap: 11 }}>
        <Link href="/m/projects" aria-label="رجوع" className="flex items-center justify-center"
          style={{ minWidth: 44, minHeight: 44, marginInlineStart: -10, color: MOBILE_COLORS.textPrimary }}>
          <ChevronLeft size={20} strokeWidth={2} style={{ transform: "scaleX(-1)" }} aria-hidden />
        </Link>
        <div className="min-w-0">
          <h1 className="truncate" style={{ fontSize: 17, fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>{p.name}</h1>
          <div style={{ fontSize: "11.5px", color: MOBILE_COLORS.textMuted, marginTop: 3 }}>
            {projectStatusLabels[p.status]}
            {p.district ? ` · ${p.district}` : ""}
            {p.falLicense ? ` · فال ${toArabicDigits(p.falLicense)}` : ""}
          </div>
        </div>
      </div>

      <div style={{ fontSize: 11, color: MOBILE_COLORS.textSecondary, padding: "0 2px" }}>
        متاح {toArabicDigits(p.units.available)} · محجوز {toArabicDigits(p.units.reserved)} · مباع {toArabicDigits(p.units.sold)} من {toArabicDigits(p.units.total)}
      </div>

      <div className="flex flex-col"
        style={{ boxSizing: "border-box", background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`, borderRadius: 16, padding: "4px 13px" }}>
        {p.unitRows.map((u, i) => {
          const tone = UNIT_TONE[u.status] ?? UNIT_TONE.AVAILABLE;
          return (
            <div key={u.id} className="flex items-center justify-between"
              style={{ boxSizing: "border-box", gap: 8, minHeight: 48, borderTop: i === 0 ? "none" : `1px solid ${MOBILE_COLORS.line3}` }}>
              <span className="min-w-0 flex-1">
                <span className="block" style={{ fontSize: 13, fontWeight: 600, color: MOBILE_COLORS.textPrimary }}>
                  وحدة {toArabicDigits(u.number)} · {unitTypeLabels[u.type]}
                </span>
                <span className="block truncate" style={{ fontSize: 11, color: MOBILE_COLORS.textMuted, marginTop: 2 }}>
                  {u.finalPrice != null ? formatCurrencyFull(u.finalPrice) : "بلا سعر"}
                  {manager && u.buyerName ? ` · ${u.buyerName}` : ""}
                </span>
              </span>
              <span className="shrink-0 whitespace-nowrap"
                style={{ boxSizing: "border-box", fontSize: "10.5px", fontWeight: 600, padding: "3px 8px", borderRadius: 7, background: tone.bg, color: tone.fg }}>
                {unitStatusLabels[u.status]}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
