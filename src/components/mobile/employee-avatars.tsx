"use client";

import { useRouter } from "next/navigation";
import { buildLeadsQuery, type LeadFilterValues } from "@/lib/lead-filters";
import { MOBILE_COLORS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";

type LeadTab = Parameters<typeof buildLeadsQuery>[0];

export type EmpChip = {
  id: string;
  name: string;
  /** عملاؤه الحاليون — من getTeam().members[].total. */
  total: number;
  closed: number;
  activityRate: number;
};

/**
 * شريط فلتر الموظفين — شرائح بالاسم الكامل والعدد، بتمرير أفقي.
 *
 * (كان دوائر أفاتار بحرفين؛ الاسم الكامل أوضح ولا يحتاج تخمينًا، والشريحة
 * الواحدة تحمل الاسم والعدد معًا فتوفّر سطرًا كاملًا.)
 *
 * لا فلتر جديد: يكتب على نفس `emps` في الرابط عبر `buildLeadsQuery` الموجودة،
 * فالخادم يفلتر بـ`assigneeIds` كما هو. مدير/مالك فقط.
 */
export function MobileEmployeeAvatars({
  tab, values, employees, selectedId,
}: {
  tab: LeadTab;
  values: LeadFilterValues;
  /** مرتّبون بالأكثر عملاءً. */
  employees: EmpChip[];
  /** الموظف المفلتَر عليه حاليًا (واحد في نمط الجوال) — null = الكل. */
  selectedId: string | null;
}) {
  const router = useRouter();

  const go = (id: string | null) => {
    const qs = buildLeadsQuery(tab, { ...values, emps: id ? [id] : [] });
    router.push(qs ? `/m/leads?${qs}` : "/m/leads");
  };

  const total = employees.reduce((n, e) => n + e.total, 0);

  const chip = (on: boolean) => ({
    boxSizing: "border-box" as const,
    minHeight: 36,
    padding: "0 13px",
    borderRadius: 18,
    fontSize: "12.5px",
    fontWeight: 600,
    whiteSpace: "nowrap" as const,
    ...(on
      ? { background: MOBILE_COLORS.gold, color: MOBILE_COLORS.bg, border: `1px solid ${MOBILE_COLORS.gold}` }
      : { background: MOBILE_COLORS.card, color: MOBILE_COLORS.textSecondary, border: `1px solid ${MOBILE_COLORS.border}` }),
  });

  return (
    <div className="m-noscroll flex overflow-x-auto" style={{ gap: 7, paddingBottom: 2 }}>
      <button
        type="button"
        onClick={() => go(null)}
        className="m-press flex flex-none items-center"
        style={chip(!selectedId)}
      >
        الكل {toArabicDigits(total)}
      </button>

      {employees.map((e) => {
        const on = e.id === selectedId;
        return (
          <button
            key={e.id}
            type="button"
            onClick={() => go(on ? null : e.id)}
            className="m-press flex flex-none items-center"
            style={chip(on)}
          >
            {e.name} {toArabicDigits(e.total)}
          </button>
        );
      })}
    </div>
  );
}

export default MobileEmployeeAvatars;
