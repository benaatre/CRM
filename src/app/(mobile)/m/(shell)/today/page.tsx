import { CheckCircle2 } from "lucide-react";
import type { LeadRow } from "@/lib/data/leads";
import { requireUser } from "@/lib/auth-guards";
import { getLeads } from "@/lib/data/leads";
import { buildAgenda, STALE_DAYS } from "@/lib/mobile-agenda";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { toArabicDigits, waitingBasisOf } from "@/lib/mobile-format";
import { channelLabel } from "@/lib/labels";
import { dayStartKSA, DAY_MS } from "@/lib/ksa-time";
import { MobileLeadCard } from "@/components/mobile/lead-card";
import { MobileChips } from "@/components/mobile/chips";

export const dynamic = "force-dynamic";

type Tab = "all" | "late" | "visits" | "calls";
const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "الكل" },
  { key: "late", label: "متأخر" },
  { key: "visits", label: "زيارات" },
  { key: "calls", label: "اتصالات" },
];

type Group = {
  title: string;
  color: string;
  items: LeadRow[];
  late: boolean;
  /** سطر السياق أسفل الاسم (نمط النموذج: «كان المفروض أمس · مشروع ٨٠»). */
  reason: (l: LeadRow) => string;
  /** الوقت مكان شارة المرحلة (يمين البطاقة في RTL) بلونه — نمط النموذج. */
  trailing: (l: LeadRow) => { text: string; color: string };
};

export default async function MobileTodayPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const tab: Tab = (TABS.find((t) => t.key === sp.t)?.key ?? "all") as Tab;

  const leads = await getLeads({ tab: "working", sort: "activity" });
  // كل التقسيم الزمني من المصدر المشترك — لا منطق تاريخ هنا.
  const { dueToday, overdueRecent, overdueOld, visitsToday } = buildAgenda(leads);

  const groups: Group[] = [];
  if (tab === "all" || tab === "late") {
    groups.push({
      title: `متأخرة (${toArabicDigits(overdueRecent.length)})`,
      color: MOBILE_STATUS.danger.fg,
      items: overdueRecent,
      late: true,
      reason: (l) => `كان المفروض ${relDay(l.nextFollowup!)} · ${channelLabel(l.channel)}`,
      trailing: (l) => ({ text: fmtShort(l.nextFollowup!), color: MOBILE_STATUS.danger.fg }),
    });
  }
  if (tab === "all" || tab === "visits") {
    groups.push({
      title: `زيارات اليوم (${toArabicDigits(visitsToday.length)})`,
      color: MOBILE_COLORS.gold,
      items: visitsToday,
      late: false,
      reason: (l) => `زيارة${l.projectName ? ` · ${l.projectName}` : ""} · ${channelLabel(l.channel)}`,
      trailing: (l) => ({ text: fmtTime(l.visitAt!), color: MOBILE_COLORS.gold }),
    });
  }
  if (tab === "all" || tab === "calls") {
    groups.push({
      title: `اتصالات اليوم (${toArabicDigits(dueToday.length)})`,
      color: MOBILE_COLORS.textSecondary,
      items: dueToday,
      late: false,
      reason: (l) => `اتصال · ${channelLabel(l.channel)}`,
      trailing: (l) => ({ text: fmtTime(l.nextFollowup!), color: MOBILE_COLORS.gold }),
    });
  }

  const showOld = (tab === "all" || tab === "late") && overdueOld.length > 0;
  const total = groups.reduce((s, g) => s + g.items.length, 0) + (showOld ? overdueOld.length : 0);

  return (
    <div className="flex flex-col" style={{ gap: 14 }}>
      <h1 style={{ fontSize: 21, fontWeight: 700, color: MOBILE_COLORS.textPrimary, padding: "0 2px" }}>
        متابعات اليوم
      </h1>

      <MobileChips param="t" current={tab} base="/m/today" items={TABS} />

      {total === 0 ? (
        <div className="flex flex-col items-center text-center" style={{ gap: 9, padding: "26px 0 6px", opacity: 0.55 }}>
          <CheckCircle2 size={34} style={{ color: MOBILE_COLORS.textMuted }} aria-hidden />
          <div style={{ fontSize: "12.5px", color: MOBILE_COLORS.textMuted }}>خلّصت متابعات اليوم 🎉</div>
        </div>
      ) : (
        <>
          {groups
            .filter((g) => g.items.length > 0)
            .map((g) => (
              <section key={g.title} className="flex flex-col" style={{ gap: 10, marginTop: 6 }}>
                <h2 style={{ fontSize: "12.5px", fontWeight: 700, padding: "0 2px", color: g.color }}>
                  {g.title}
                </h2>
                {g.items.map((l) => (
                  <MobileLeadCard
                    key={l.id}
                    lead={l}
                    late={g.late}
                    reason={g.reason(l)}
                    trailing={g.trailing(l)}
                    waitingBasis={waitingBasisOf(l)}
                  />
                ))}
              </section>
            ))}

          {/*
            المتأخر أكثر من ٣٠ يومًا مطويّ افتراضيًا: كان يتصدّر الشاشة بعميل من
            أبريل فيدفن متابعات اليوم. <details> بلا جافاسكربت — يعمل حتى قبل الترطيب.
          */}
          {showOld && (
            <details style={{ marginTop: 6 }}>
              <summary
                className="flex items-center"
                style={{
                  boxSizing: "border-box", minHeight: 44, cursor: "pointer", listStyle: "none",
                  fontSize: "12.5px", fontWeight: 700, color: MOBILE_COLORS.textMuted,
                  background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`,
                  borderRadius: 12, padding: "0 13px",
                }}
              >
                متأخرة من زمن ({toArabicDigits(overdueOld.length)}) — أكثر من {toArabicDigits(STALE_DAYS)} يومًا
              </summary>
              <div className="flex flex-col" style={{ gap: 10, marginTop: 10 }}>
                {overdueOld.map((l) => (
                  <MobileLeadCard
                    key={l.id}
                    lead={l}
                    late
                    reason={`كان المفروض ${relDay(l.nextFollowup!)} · ${channelLabel(l.channel)}`}
                    trailing={{ text: fmtShort(l.nextFollowup!), color: MOBILE_STATUS.danger.fg }}
                    waitingBasis={waitingBasisOf(l)}
                  />
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}

function fmtTime(d: Date): string {
  return new Intl.DateTimeFormat("ar-SA-u-nu-arab", {
    timeZone: "Asia/Riyadh", hour: "numeric", minute: "2-digit",
  }).format(d);
}
function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat("ar-SA-u-nu-arab", {
    timeZone: "Asia/Riyadh", day: "numeric", month: "short",
  }).format(d);
}
/** «أمس ٤:٠٠» لمتأخر الأمس، وتاريخ قصير لما قبله — عرض فقط (الحدود من buildAgenda). */
function fmtShort(d: Date): string {
  const days = Math.floor((dayStartKSA().getTime() - dayStartKSA(d).getTime()) / DAY_MS);
  if (days === 1) return `أمس ${fmtTime(d)}`;
  return fmtDate(d);
}
/** «أمس» / «قبل ٣ أيام» — لسطر السياق. */
function relDay(d: Date): string {
  const days = Math.floor((dayStartKSA().getTime() - dayStartKSA(d).getTime()) / DAY_MS);
  if (days <= 1) return "أمس";
  if (days === 2) return "قبل يومين";
  if (days <= 10) return `قبل ${toArabicDigits(days)} أيام`;
  return `قبل ${toArabicDigits(days)} يومًا`;
}
