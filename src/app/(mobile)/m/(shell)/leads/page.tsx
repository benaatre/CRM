import type { LeadStage } from "@prisma/client";
import { Contact } from "lucide-react";
import { requireUser } from "@/lib/auth-guards";
import { getLeads, type LeadTab } from "@/lib/data/leads";
import { stageLabel } from "@/lib/labels";
import { MOBILE_COLORS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";
import { MobileSearchBox } from "@/components/mobile/search-box";
import { MobileLeadsList } from "@/components/mobile/leads-list";
import { MobileChips } from "@/components/mobile/chips";

export const dynamic = "force-dynamic";

// شرائح المراحل — قيمها من enum Prisma وأسماؤها من labels (لا نصوص مخترعة).
const STAGE_CHIPS: LeadStage[] = [
  "NEW", "ATTEMPTED", "INTERESTED", "FOLLOW_UP_LATER",
  "VISIT_SCHEDULED", "VIEWING", "NEGOTIATION",
];

export default async function MobileLeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; stage?: string; tab?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const stage = STAGE_CHIPS.find((s) => s === sp.stage);
  // تبويب «المؤرشفون» (hidden) — نفس تبويبات الويب؛ الافتراضي «جاري العمل».
  const tab: LeadTab = sp.tab === "hidden" ? "hidden" : sp.tab === "archived" ? "archived" : "working";

  // البحث والفلترة على الخادم عبر نفس دالة الويب المحجَّمة.
  const rows = await getLeads({
    tab,
    sort: "activity",
    ...(q ? { q } : {}),
    ...(stage ? { stages: [stage] } : {}),
  });

  const chips = [
    { key: "all" as const, label: "الكل" },
    ...STAGE_CHIPS.map((s) => ({ key: s, label: stageLabel(s) })),
  ];

  return (
    <div className="flex flex-col" style={{ gap: 11 }}>
      <div className="flex items-center" style={{ gap: 9 }}>
        <MobileSearchBox defaultValue={q} base="/m/leads" />
      </div>

      <MobileChips
        param="stage"
        current={(stage ?? "all") as string}
        base="/m/leads"
        items={chips as { key: string; label: string }[]}
      />

      <div style={{ fontSize: "11.5px", color: MOBILE_COLORS.textMuted, padding: "0 2px" }}>
        {tab === "hidden" ? "مؤرشف · " : tab === "archived" ? "تم الحجز / الشراء · " : ""}
        {toArabicDigits(rows.length)} عميل
      </div>

      {rows.length === 0 ? (
        <div
          className="flex flex-col items-center text-center"
          style={{
            boxSizing: "border-box", gap: 9, padding: "34px 16px",
            background: MOBILE_COLORS.card, borderRadius: 16,
            border: `1px solid ${MOBILE_COLORS.border}`,
          }}
        >
          <Contact size={34} style={{ color: MOBILE_COLORS.textMuted }} aria-hidden />
          <p style={{ fontSize: "12.5px", color: MOBILE_COLORS.textSecondary }}>
            {q || stage ? "ما فيه نتائج لهذا الفلتر" : "ما عندك عملاء بعد"}
          </p>
        </div>
      ) : (
        <MobileLeadsList rows={rows} />
      )}
    </div>
  );
}
