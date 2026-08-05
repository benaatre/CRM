"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { buildLeadsQuery, type LeadFilterValues } from "@/lib/lead-filters";

/** نفس اتحاد LeadTab في lib/data/leads — معرَّف محليًا لأن ذاك الملف server-only. */
type LeadTab = Parameters<typeof buildLeadsQuery>[0];
import { MOBILE_COLORS } from "@/lib/mobile-tokens";
import { BottomSheet } from "@/components/mobile/bottom-sheet";

const fieldStyle = {
  boxSizing: "border-box" as const,
  width: "100%", minHeight: 44,
  background: MOBILE_COLORS.bg, border: `1px solid ${MOBILE_COLORS.border}`,
  borderRadius: 10, padding: "0 12px", fontSize: 13, color: MOBILE_COLORS.textPrimary, outline: "none",
};

/**
 * شريحة «نطاق مخصص» لفلتر المواعيد — نظير DateRangeChip بالديسكتوب:
 * تفتح ورقة من/إلى وتكتب from/to في الرابط عبر buildLeadsQuery نفسها
 * (النطاق لا يسري إلا مع «زيارة»/«موعد لاحق» — الشرط في parseLeadFilters).
 */
export function MobileDateRangeChip({
  tab, values,
}: {
  tab: LeadTab;
  values: LeadFilterValues;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(values.from);
  const [to, setTo] = useState(values.to);
  const active = !values.range && (!!values.from || !!values.to);

  function apply(nextFrom: string, nextTo: string) {
    setOpen(false);
    const qs = buildLeadsQuery(tab, { ...values, range: "", from: nextFrom, to: nextTo });
    router.push(qs ? `/m/leads?${qs}` : "/m/leads");
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex flex-none items-center"
        style={{ paddingBlock: 5, border: "none", background: "none" }}
      >
        <span
          className="flex items-center whitespace-nowrap"
          style={{
            boxSizing: "border-box", height: 32, padding: "0 13px", borderRadius: 16,
            fontSize: 12, fontWeight: 600,
            ...(active
              ? { background: MOBILE_COLORS.goldBg, color: MOBILE_COLORS.gold, border: `1px solid ${MOBILE_COLORS.goldBorder}` }
              : { background: MOBILE_COLORS.card, color: MOBILE_COLORS.textSecondary, border: `1px solid ${MOBILE_COLORS.border}` }),
          }}
        >
          نطاق مخصص{active ? " ✓" : ""}
        </span>
      </button>

      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title="نطاق المواعيد"
        subtitle="على موعد المتابعة/الزيارة — الطرفان شاملان"
        footer={
          <div className="flex" style={{ gap: 8 }}>
            <button type="button" onClick={() => apply(from, to)} disabled={!from && !to}
              className="flex-1 m-sweep"
              style={{
                boxSizing: "border-box", height: 48, borderRadius: 12, border: "none",
                background: MOBILE_COLORS.gold, color: MOBILE_COLORS.bg, fontSize: 14, fontWeight: 700,
                opacity: !from && !to ? 0.5 : 1,
              }}>
              طبّق
            </button>
            {active && (
              <button type="button" onClick={() => { setFrom(""); setTo(""); apply("", ""); }}
                style={{
                  boxSizing: "border-box", height: 48, padding: "0 16px", borderRadius: 12,
                  border: `1px solid ${MOBILE_COLORS.border}`, background: MOBILE_COLORS.card,
                  color: MOBILE_COLORS.textSecondary, fontSize: 13, fontWeight: 600,
                }}>
                امسح
              </button>
            )}
          </div>
        }
      >
        <div className="grid grid-cols-2" style={{ gap: 10, marginTop: 14 }}>
          <label className="block">
            <span className="block" style={{ fontSize: "12.5px", color: MOBILE_COLORS.textSecondary, marginBottom: 6 }}>من تاريخ</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={fieldStyle} />
          </label>
          <label className="block">
            <span className="block" style={{ fontSize: "12.5px", color: MOBILE_COLORS.textSecondary, marginBottom: 6 }}>إلى تاريخ</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={fieldStyle} />
          </label>
        </div>
      </BottomSheet>
    </>
  );
}

export default MobileDateRangeChip;
