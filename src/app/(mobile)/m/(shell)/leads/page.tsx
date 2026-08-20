import Link from "next/link";
import { Bell } from "lucide-react";
import { requireClientAccess, requireUser, isManager } from "@/lib/auth-guards";
import {
  getLeads, getLeadCounts, getNotContactedCount, getWaitingCount,
  getBankCheckCount, getVisitStagesCount,
  type LeadTab,
} from "@/lib/data/leads";
import { getNotifications } from "@/lib/actions/notifications";
import { getTeam } from "@/lib/data/team";
import { STAGE_HEX } from "@/lib/stage-colors";
import { purchaseMethodLabels } from "@/lib/labels";
import { formatNumberShort } from "@/lib/format";
import {
  parseLeadFilters, buildLeadsQuery, INTEREST_UMBRELLA, VISIT_FILTER_STAGES,
  type LeadFilterValues,
} from "@/lib/lead-filters";
import { stageLabels, stageOrder } from "@/lib/labels";
import { RIYADH_TZ } from "@/lib/format";
import { MOBILE_COLORS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";
import type { FilterSection, FilterSelection } from "@/components/mobile/filter-sheet";
import { MobileSearchBox } from "@/components/mobile/search-box";
import { MobileLeadsList, type MobileLeadRow } from "@/components/mobile/leads-list";
import { MobileNewLeadButton } from "@/components/mobile/new-lead-button";
import { MobileEmployeeAvatars, type EmpChip } from "@/components/mobile/employee-avatars";

export const dynamic = "force-dynamic";

/*
 * شاشة العملاء — قرار واحد لكل صف:
 *   ١-أ بحث + «+»  ·  ١-ب التبويبات  ·  ١-جـ أفاتارات الموظفين (مدير) ·
 *   ١-د أدوات (فلاتر/ترتيب/تحديد)  ·  ١-هـ الموعد الذكي  ·  القائمة.
 *
 * كل الفلترة عبر parseLeadFilters/buildLeadsQuery/getLeads نفسها — صفر باراميتر
 * جديد. تبويب «غير موزّعين» ليس هنا: له شاشته /m/unassigned في الشريط السفلي.
 */

const TABS: { key: LeadTab; label: string }[] = [
  { key: "working", label: "جاري العمل" },
  { key: "archived", label: "تم الحجز / الشراء" },
  { key: "hidden", label: "مؤرشف" },
];

/** «اليوم/التاريخ + الساعة» لموعد الزيارة — توقيت الرياض ميلادي (عرض فقط). */
function visitWhen(d: Date, now: Date): string {
  const dayKey = (x: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: RIYADH_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(x);
  const time = new Intl.DateTimeFormat("ar-SA-u-nu-arab", {
    calendar: "gregory", timeZone: RIYADH_TZ, hour: "numeric", minute: "2-digit",
  }).format(d);
  if (dayKey(d) === dayKey(now)) return `اليوم ${time}`;
  const date = new Intl.DateTimeFormat("ar-SA-u-nu-arab", {
    calendar: "gregory", timeZone: RIYADH_TZ, day: "numeric", month: "short",
  }).format(d);
  return `${date} ${time}`;
}

/** تاريخ اليوم بتوقيت الرياض (YYYY-MM-DD) — لشريحة «اليوم» في فلتر الموعد. */
function riyadhToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: RIYADH_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function chipHref(tab: LeadTab, v: LeadFilterValues): string {
  const qs = buildLeadsQuery(tab, v);
  return qs ? `/m/leads?${qs}` : "/m/leads";
}

export default async function MobileLeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireClientAccess(true);
  const manager = isManager(user.role);
  const sp = await searchParams;
  const now = new Date();

  // نفس محلّل الديسكتوب حرفيًا — أي قيمة خاطئة تسقط بدل ٥٠٠.
  const filters = parseLeadFilters(sp);
  const tab: LeadTab = (TABS.find((t) => t.key === sp.tab)?.key ?? "working") as LeadTab;
  const v = filters.values;

  const [rows, counts, team, notContacted, waitingCount, bankCount, visitCount, notif] = await Promise.all([
    getLeads({
      tab,
      stages: filters.stages,
      assigneeIds: filters.assigneeIds,
      includeUnassigned: filters.includeUnassigned,
      waiting: filters.waiting,
      transferred: filters.transferred,
      bankCheck: filters.bankCheck,
      archiveReason: filters.archiveReason,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      q: filters.q,
      sort: filters.sort,
    }),
    getLeadCounts(),
    // نفس دالة شاشة الفريق — فيها عملاء كل موظف (total/closed/activityRate).
    manager ? getTeam() : Promise.resolve(null),
    getNotContactedCount(),
    getWaitingCount(),
    getBankCheckCount(),
    getVisitStagesCount(),
    getNotifications(),
  ]);

  // الموظفون: النشطون فقط، مرتّبون بالأكثر عملاءً (أول أربعة يظهرون بالشريط).
  const empChips: EmpChip[] = (team?.members ?? [])
    .filter((m) => (m.role === "EMPLOYEE" || m.role === "HR") && m.active)
    .map((m) => ({ id: m.id, name: m.name, total: m.total, closed: m.closed, activityRate: m.activityRate }))
    .sort((a, b) => b.total - a.total);
  const employees = empChips.map((e) => ({ id: e.id, name: e.name }));
  // نمط الجوال: موظف واحد مفلتَر عليه (الرابط يقبل عدّة، ونعرض الأول).
  const selectedEmp = v.emps.find((id) => id !== "none") ?? null;

  // «زيارة» الموحّدة نشطة لمّا المرحلتان معًا (نفس شرط الديسكتوب).
  const visitActive = VISIT_FILTER_STAGES.every((s) => filters.stages.includes(s));
  const umbrellaActive = INTEREST_UMBRELLA.every((s) => filters.stages.includes(s));
  // مراحل الشريحة: بترتيب الديسكتوب مع طي مرحلتَي الزيارة في واحدة.
  const chipStages = stageOrder.filter((s) => !(VISIT_FILTER_STAGES as string[]).includes(s));

  /*
   * أقسام ورقة الفلاتر — «المراحل» متعدّد و«العلامات» متعدّد.
   * القيم مركّبة: «زيارة» و«مهتم» تُوسَّعان لمراحلهما عند التطبيق (نفس ما يفعله
   * الديسكتوب بالضغط على الشريحة)، فالورقة تعرض قيمًا رمزية والصفحة تفكّها.
   */
  const stageOptions = [
    { value: "visit", label: "زيارة", count: visitCount },
    { value: "umbrella", label: "مهتم (المظلة)" },
    ...chipStages.map((s) => ({
      value: s as string,
      label: stageLabels[s],
      count: s === "NEW" ? notContacted : undefined,
      tone: s === "NEW" ? ("danger" as const) : undefined,
    })),
  ];
  const sections: FilterSection[] = [
    { key: "stages", title: "المراحل", multi: true, options: stageOptions },
    {
      key: "flags", title: "علامات", multi: true,
      options: [
        { value: "wait", label: "في الانتظار", count: waitingCount, tone: "warning" },
        { value: "bank", label: "حسبة البنك", count: bankCount },
        { value: "tr", label: "محوَّل" },
      ],
    },
  ];
  const selection: FilterSelection = {
    stages: [
      ...(visitActive ? ["visit"] : []),
      ...(umbrellaActive ? ["umbrella"] : []),
      ...filters.stages.filter(
        (s) =>
          !(visitActive && (VISIT_FILTER_STAGES as string[]).includes(s)) &&
          !(umbrellaActive && (INTEREST_UMBRELLA as string[]).includes(s)),
      ),
    ],
    flags: [
      ...(filters.waiting ? ["wait"] : []),
      ...(filters.bankCheck ? ["bank"] : []),
      ...(filters.transferred ? ["tr"] : []),
    ],
  };

  /*
   * صف الموعد يظهر مع المراحل ذات البُعد الزمني (زيارة/موعد لاحق) — نفس شرط
   * سريان النطاق على الخادم (dateRangeApplies)، فلا نعرض فلترًا لا أثر له.
   */
  const dateApplies = visitActive || filters.stages.includes("FOLLOW_UP_LATER");

  return (
    <div className="m-screen flex flex-col" style={{ gap: 11 }}>
      {/* ===== v3) الترويسة: عملائي + عدّادان + إضافة + جرس ===== */}
      <header className="flex items-center justify-between" style={{ padding: "0 2px", gap: 10 }}>
        <div className="min-w-0">
          <h1 style={{ fontSize: 22, fontWeight: 800, color: MOBILE_COLORS.textPrimary }}>عملائي</h1>
          <div style={{ fontSize: "12.5px", color: MOBILE_COLORS.textSecondary, marginTop: 4 }}>
            عندك{" "}
            <span style={{ fontFamily: "var(--font-zain), var(--font-sans)", fontWeight: 800, color: MOBILE_COLORS.gold }}>
              {toArabicDigits(counts.working)}
            </span>{" "}
            عميل ·{" "}
            <span style={{ fontFamily: "var(--font-zain), var(--font-sans)", fontWeight: 800, color: MOBILE_COLORS.gold }}>
              {toArabicDigits(notContacted)}
            </span>{" "}
            ينتظرون أول تواصل
          </div>
        </div>
        <div className="flex flex-none items-center" style={{ gap: 8 }}>
          <MobileNewLeadButton isManager={manager} employees={employees} />
          <Link
            href="/m/notifications"
            aria-label="الإشعارات"
            className="m-press relative flex items-center justify-center"
            style={{
              boxSizing: "border-box", width: 44, height: 44, borderRadius: 13,
              background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`,
              color: MOBILE_COLORS.textSecondary,
            }}
          >
            <Bell size={19} aria-hidden />
            {notif.unread > 0 && (
              <span
                className="absolute flex items-center justify-center"
                style={{
                  boxSizing: "border-box", top: 5, left: 5, minWidth: 17, height: 17,
                  borderRadius: 9, background: MOBILE_COLORS.rose, color: MOBILE_COLORS.bg,
                  fontSize: 9, fontWeight: 700, padding: "0 4px",
                }}
              >
                {toArabicDigits(notif.unread > 99 ? 99 : notif.unread)}
              </span>
            )}
          </Link>
        </div>
      </header>

      {/* ===== ١-أ) البحث ===== */}
      <MobileSearchBox
        defaultValue={filters.q}
        base={`/m/leads${tab !== "working" ? `?tab=${tab}` : ""}`}
        autoFocus={sp.focus === "1"}
      />

      {/* ===== ١-ب) التبويبات الأساسية بأعدادها ===== */}
      <div className="m-noscroll flex overflow-x-auto" style={{ gap: 7, paddingBottom: 2 }}>
        {TABS.map((t) => {
          const on = tab === t.key;
          return (
            <Link
              key={t.key}
              href={chipHref(t.key, { ...v, stages: [], wait: false, tr: false, bank: false, ar: "" })}
              scroll={false}
              className="m-press flex flex-none items-center"
              style={{ paddingBlock: 5 }}
            >
              <span
                className="flex items-center whitespace-nowrap"
                style={{
                  boxSizing: "border-box", height: 34, padding: "0 14px", borderRadius: 17,
                  fontSize: "12.5px", fontWeight: 600,
                  ...(on
                    ? { background: MOBILE_COLORS.goldBg, color: MOBILE_COLORS.gold, border: `1px solid ${MOBILE_COLORS.goldBorder}` }
                    : { background: MOBILE_COLORS.card, color: MOBILE_COLORS.textSecondary, border: `1px solid ${MOBILE_COLORS.border}` }),
                }}
              >
                {t.label} ({toArabicDigits(counts[t.key as "working" | "archived" | "hidden"])})
              </span>
            </Link>
          );
        })}
      </div>

      {/* ===== ١-جـ) أفاتارات الموظفين — مدير/مالك فقط ===== */}
      {manager && empChips.length > 0 && (
        <MobileEmployeeAvatars tab={tab} values={v} employees={empChips} selectedId={selectedEmp} />
      )}

      {/* ===== v3) صف المراحل — متعدد الاختيار بعدّاداتها وألوان STAGE_HEX ===== */}
      {tab === "working" && (
        <div className="m-noscroll flex overflow-x-auto" style={{ gap: 7, paddingBottom: 2 }}>
          <Link href={chipHref(tab, { ...v, stages: [] })} scroll={false} className="m-press flex flex-none items-center" style={{ paddingBlock: 5 }}>
            <span
              className="flex items-center whitespace-nowrap"
              style={{
                boxSizing: "border-box", height: 34, padding: "0 13px", borderRadius: 17, fontSize: 12, fontWeight: 700,
                ...(filters.stages.length === 0
                  ? { background: MOBILE_COLORS.gold, color: MOBILE_COLORS.bg, border: `1px solid ${MOBILE_COLORS.gold}` }
                  : { background: MOBILE_COLORS.card, color: MOBILE_COLORS.textSecondary, border: `1px solid ${MOBILE_COLORS.border}` }),
              }}
            >
              {filters.stages.length === 0 ? "✓ " : ""}كل المراحل
            </span>
          </Link>
          {/* «زيارة» الموحّدة (المرحلتان معًا — النمط المعتمد) */}
          <Link
            href={chipHref(tab, {
              ...v,
              stages: visitActive
                ? v.stages.filter((s) => !(VISIT_FILTER_STAGES as string[]).includes(s))
                : [...new Set([...v.stages, ...VISIT_FILTER_STAGES])],
            })}
            scroll={false} className="m-press flex flex-none items-center" style={{ paddingBlock: 5 }}
          >
            <span
              className="flex items-center whitespace-nowrap"
              style={{
                boxSizing: "border-box", height: 34, padding: "0 13px", borderRadius: 17, fontSize: 12, fontWeight: 700,
                border: `1px solid ${STAGE_HEX.VISIT_SCHEDULED}`,
                ...(visitActive
                  ? { background: STAGE_HEX.VISIT_SCHEDULED, color: MOBILE_COLORS.bg }
                  : { background: MOBILE_COLORS.card, color: STAGE_HEX.VISIT_SCHEDULED }),
              }}
            >
              {visitActive ? "✓ " : ""}زيارة ({toArabicDigits(visitCount)})
            </span>
          </Link>
          {chipStages.map((s) => {
            const on = filters.stages.includes(s);
            const count = counts.stageCounts[s] ?? 0;
            return (
              <Link
                key={s}
                href={chipHref(tab, { ...v, stages: on ? v.stages.filter((x) => x !== s) : [...v.stages, s] })}
                scroll={false} className="m-press flex flex-none items-center" style={{ paddingBlock: 5 }}
              >
                <span
                  className="flex items-center whitespace-nowrap"
                  style={{
                    boxSizing: "border-box", height: 34, padding: "0 13px", borderRadius: 17, fontSize: 12, fontWeight: 700,
                    border: `1px solid ${STAGE_HEX[s]}`,
                    ...(on ? { background: STAGE_HEX[s], color: MOBILE_COLORS.bg } : { background: MOBILE_COLORS.card, color: STAGE_HEX[s] }),
                  }}
                >
                  {on ? "✓ " : ""}{stageLabels[s]} ({toArabicDigits(count)})
                </span>
              </Link>
            );
          })}
        </div>
      )}

      {/* ===== v3) صف الفلاتر الخاصة — أحادي، الضغط الثاني يلغي ===== */}
      {tab === "working" && (() => {
        const ncActive = filters.stages.length === 1 && filters.stages[0] === "NEW" && !filters.transferred && !filters.bankCheck;
        const clean = { ...v, stages: [] as string[], wait: false, tr: false, bank: false };
        const specials = [
          { key: "nc", label: `لم يتم التواصل (${toArabicDigits(notContacted)})`, active: ncActive, next: ncActive ? clean : { ...clean, stages: ["NEW"] }, base: MOBILE_COLORS.rose, bg: MOBILE_COLORS.roseBg },
          { key: "tr", label: "⇄ محوَّل", active: filters.transferred, next: { ...clean, tr: !filters.transferred }, base: MOBILE_COLORS.sky, bg: MOBILE_COLORS.skyBg },
          { key: "bank", label: `حسبة البنك (${toArabicDigits(bankCount)})`, active: filters.bankCheck, next: { ...clean, bank: !filters.bankCheck }, base: MOBILE_COLORS.amber, bg: MOBILE_COLORS.amberBg },
        ];
        return (
          <div className="m-noscroll flex overflow-x-auto" style={{ gap: 7, paddingBottom: 2 }}>
            {specials.map((c) => (
              <Link key={c.key} href={chipHref(tab, c.next)} scroll={false} className="m-press flex flex-none items-center" style={{ paddingBlock: 5 }}>
                <span
                  className="flex items-center whitespace-nowrap"
                  style={{
                    boxSizing: "border-box", height: 32, padding: "0 13px", borderRadius: 16, fontSize: 12, fontWeight: 600,
                    border: `1px solid ${c.active ? c.base : MOBILE_COLORS.border}`,
                    ...(c.active ? { background: c.bg, color: c.base } : { background: MOBILE_COLORS.card, color: MOBILE_COLORS.textSecondary }),
                  }}
                >
                  {c.active ? "✓ " : ""}{c.label}
                </span>
              </Link>
            ))}
          </div>
        );
      })()}

      {/* ===== ١-د + ١-هـ + القائمة (كلها داخل اللوحة العميلة) ===== */}
      <MobileLeadsList
        rows={rows.map((l): MobileLeadRow => ({
          id: l.id,
          name: l.name,
          phone: l.phone,
          stage: l.stage,
          channel: l.channel,
          daysWaiting: l.daysWaiting,
          lastContact: l.lastContact,
          assignedAt: l.assignedAt,
          manualTransferred: l.manualTransferred,
          isTransferred: l.isTransferred,
          waiting: l.waiting,
          visitText: l.visitAt ? visitWhen(l.visitAt, now) : null,
          // كرت v3: حالة الموعد + السياق الذكي — كلها من حقول القائمة القائمة (تُحسب هنا بالخادم).
          overdueFu: !!l.nextFollowup && l.nextFollowup < now,
          followupText: l.nextFollowup ? visitWhen(l.nextFollowup, now) : null,
          booking: l.booking,
          pmLabel: l.purchaseMethod ? purchaseMethodLabels[l.purchaseMethod] : null,
          budgetLabel: l.budget ? formatNumberShort(l.budget) : null,
          assignedToName: manager ? (l.assignedTo?.name ?? "غير موزّع") : null,
        }))}
        isManager={manager}
        employees={employees}
        hiddenTab={tab === "hidden"}
        tab={tab}
        values={v}
        sections={sections}
        selection={selection}
        dateApplies={dateApplies}
        todayISO={riyadhToday(now)}
      />
    </div>
  );
}
