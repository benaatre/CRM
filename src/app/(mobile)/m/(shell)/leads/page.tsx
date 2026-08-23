import Link from "next/link";
import { Bell, Check, Sparkles } from "lucide-react";
import type { LeadStage } from "@prisma/client";
import { requireClientAccess, isManager } from "@/lib/auth-guards";
import {
  getLeads, getLeadCounts, getNotContactedCount, getWaitingCount,
  getBankCheckCount, getVisitStagesCount,
  type LeadTab,
} from "@/lib/data/leads";
import { getNotifications } from "@/lib/actions/notifications";
import { getTeam } from "@/lib/data/team";
import { STAGE_HEX } from "@/lib/stage-colors";
import { purchaseMethodLabels, purchaseMethodOptions, purchaseGoalLabels } from "@/lib/labels";
import { formatNumberShort } from "@/lib/format";
import {
  parseLeadFilters, buildLeadsQuery, INTEREST_UMBRELLA, VISIT_FILTER_STAGES,
  type LeadFilterValues,
} from "@/lib/lead-filters";
import { stageLabels, stageOrder } from "@/lib/labels";
import { RIYADH_TZ } from "@/lib/format";
import { SOP } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";
import type { FilterSection, FilterSelection } from "@/components/mobile/filter-sheet";
import { MobileSearchBox } from "@/components/mobile/search-box";
import { MobileLeadsList, type MobileLeadRow } from "@/components/mobile/leads-list";
import { MobileNewLeadButton } from "@/components/mobile/new-lead-button";
import { MobileEmployeeAvatars, type EmpChip } from "@/components/mobile/employee-avatars";

export const dynamic = "force-dynamic";

/*
 * شاشة العملاء v4 («أوبسيديان ناعم Pro» — clients-page-final2):
 *   الترويسة (عملائي + عدّادان + «+» + جرس) · البحث · ٣ تبويبات (جاري العمل/مبيعاتي/أرشفة)
 *   · أفاتارات الموظفين (مدير) · زر «عملاء جدد (N)» الأخضر · شبكة كروت المراحل (٣ أعمدة)
 *   · صف الأدوات (ترتيب/الفلتر المتقدم/تحديد) ورقائق المختارات · القائمة.
 *
 * كل الفلترة الخادمية عبر parseLeadFilters/buildLeadsQuery/getLeads نفسها — صفر باراميتر
 * جديد. «طريقة الشراء» و«الفلاتر المحفوظة» عميل فقط داخل القائمة/الورقة (لا رابط ولا عدّادات).
 * تبويب «غير موزّعين» ليس هنا: له شاشته /m/unassigned في الشريط السفلي.
 */

/** التبويبات الثلاثة — المفاتيح خادمية ثابتة (getLeads/getLeadCounts)، التسميات فقط تغيّرت:
 *  archived = المرحلة RESERVED/CLOSED_WON (تم الحجز/الشراء) ⇒ «مبيعاتي». */
const TABS: { key: LeadTab; label: string }[] = [
  { key: "working", label: "جاري العمل" },
  { key: "archived", label: "مبيعاتي" },
  { key: "hidden", label: "أرشفة" },
];

/**
 * ترتيب شبكة المراحل الحرفي (clients-page-final2): كل المراحل · محاولة/لم يرد · مهتم · موعد لاحق
 * · زيارة (المرحلتان معًا) · تفاوض. «جديد» له زر «عملاء جدد» المستقل، والمقفلة
 * (محجوز/مقفول-بيع/غير مهتم) لا تظهر في «جاري العمل» أصلًا.
 */
const GRID_ORDER: (LeadStage | "visit")[] = ["ATTEMPTED", "INTERESTED", "FOLLOW_UP_LATER", "visit", "NEGOTIATION"];

const ZAIN = { fontFamily: "var(--font-zain), var(--font-sans)", fontVariantNumeric: "tabular-nums" as const };

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
  // مراحل ورقة الفلتر: بترتيب الديسكتوب مع طي مرحلتَي الزيارة في واحدة، وبلا المراحل المقفلة.
  const chipStages = stageOrder.filter((s) => !(VISIT_FILTER_STAGES as string[]).includes(s) && !["RESERVED", "CLOSED_WON", "CLOSED_LOST"].includes(s));
  // «عملاء جدد»: الفلتر الوحيد = NEW (بلا علامات) — يبدّل القائمة لكروت العميل الجديد.
  const newMode = filters.stages.length === 1 && filters.stages[0] === "NEW" && !filters.transferred && !filters.bankCheck && !filters.waiting;

  /*
   * أقسام ورقة الفلاتر المتقدمة — «المراحل» متعدّد · «الموعد» مفرد (معطّل إلا مع زيارة/موعد
   * لاحق — نفس شرط سريان النطاق على الخادم dateRangeApplies) · «طريقة الشراء» متعدّد
   * (عميل فقط) · «علامات» متعدّد (في الانتظار/حسبة البنك/محوَّل — هنا فقط، لا رقائق تحت الشبكة).
   * القيم مركّبة: «زيارة» و«مهتم» تُوسَّعان لمراحلهما عند التطبيق (نفس ما يفعله الديسكتوب).
   */
  const dateApplies = visitActive || filters.stages.includes("FOLLOW_UP_LATER");
  const todayISO = riyadhToday(now);
  const stageOptions = [
    { value: "visit", label: "زيارة", count: visitCount },
    { value: "umbrella", label: "مهتم (المظلة)" },
    ...chipStages.map((s) => ({
      value: s as string,
      label: stageLabels[s],
      count: s === "NEW" ? notContacted : undefined,
      tone: s === "NEW" ? ("success" as const) : undefined,
    })),
  ];
  const sections: FilterSection[] = [
    { key: "stages", title: "المراحل", multi: true, options: stageOptions },
    {
      key: "date", title: "الموعد", multi: false,
      disabled: !dateApplies,
      hint: dateApplies ? "على موعد المتابعة/الزيارة" : "يُفعَّل مع فلتر «زيارة» أو «موعد لاحق»",
      options: [
        { value: "today", label: "اليوم" },
        { value: "week", label: "هذا الأسبوع" },
        { value: "next", label: "الأسبوع الجاي" },
        { value: "custom", label: "تاريخ محدد" },
      ],
    },
    {
      key: "pm", title: "طريقة الشراء", multi: true,
      hint: "فلتر على هذا الجهاز فقط — لا يدخل في العدّادات",
      options: purchaseMethodOptions.map((m) => ({ value: m, label: purchaseMethodLabels[m] })),
    },
    {
      key: "flags", title: "علامات", multi: true,
      options: [
        { value: "wait", label: "في الانتظار", count: waitingCount, tone: "warning" },
        { value: "bank", label: "حسبة البنك", count: bankCount },
        { value: "tr", label: "محوَّل" },
      ],
    },
  ];
  const customActive = !v.range && (!!v.from || !!v.to);
  const todayActive = v.from === todayISO && v.to === todayISO;
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
    date: todayActive ? ["today"] : v.range ? [v.range] : customActive ? ["custom"] : [],
    flags: [
      ...(filters.waiting ? ["wait"] : []),
      ...(filters.bankCheck ? ["bank"] : []),
      ...(filters.transferred ? ["tr"] : []),
    ],
  };

  // «عملاء جدد»: نفس رابط شريحة «لم يتم التواصل» السابقة (stages=NEW بلا علامات).
  const cleanBase = { ...v, stages: [] as string[], wait: false, tr: false, bank: false };
  const newHref = chipHref(tab, newMode ? cleanBase : { ...cleanBase, stages: ["NEW"] });

  /** كرت مرحلة في الشبكة — خط علوي + نقطة متوهّجة + رقم + تسمية. */
  const StageCard = ({
    href, on, color, label, count, glow = false, goldFill = false,
  }: {
    href: string; on: boolean; color: string; label: string; count: number; glow?: boolean; goldFill?: boolean;
  }) => (
    <Link
      href={href}
      scroll={false}
      aria-pressed={on}
      className={`${on && goldFill ? "" : "m-raise"} m-press-sc relative flex flex-col overflow-hidden`}
      style={{
        boxSizing: "border-box", minHeight: 74, borderRadius: 14, padding: "10px 11px 9px",
        ...(on && goldFill
          ? { background: `linear-gradient(135deg, ${SOP.gold2}, ${SOP.gold})`, color: SOP.onGold, boxShadow: `0 8px 20px color-mix(in srgb, ${SOP.gold} 35%, transparent)` }
          : on
            ? { background: `color-mix(in srgb, ${color} 16%, ${SOP.plane})`, border: `1px solid ${color}`, boxShadow: glow ? `0 0 16px color-mix(in srgb, ${color} 45%, transparent)` : undefined }
            : { boxShadow: glow ? `6px 6px 16px ${SOP.sd}, -5px -5px 14px ${SOP.sl}, 0 0 14px color-mix(in srgb, ${color} 28%, transparent)` : undefined }),
      }}
    >
      {/* الخط العلوي بلون المرحلة */}
      <span aria-hidden style={{ position: "absolute", top: 0, insetInline: 12, height: 3, borderRadius: "0 0 3px 3px", background: on && goldFill ? SOP.onGold : color, opacity: on && goldFill ? 0.35 : 1 }} />
      <span className="flex items-center" style={{ gap: 5, marginTop: 2 }}>
        <span aria-hidden style={{ width: 7, height: 7, borderRadius: 4, background: on && goldFill ? SOP.onGold : color, boxShadow: `0 0 8px ${on && goldFill ? SOP.onGold : color}` }} />
        {on && <Check size={12} strokeWidth={3} aria-hidden />}
      </span>
      <span style={{ ...ZAIN, fontSize: 20, fontWeight: 800, lineHeight: 1.1, marginTop: 6, color: on && goldFill ? SOP.onGold : color }}>
        {toArabicDigits(count)}
      </span>
      <span className="truncate" style={{ fontSize: 11, fontWeight: 700, marginTop: 3, color: on && goldFill ? SOP.onGold : SOP.tx2 }}>
        {label}
      </span>
    </Link>
  );

  return (
    <div className="m-screen flex flex-col" style={{ gap: 11 }}>
      {/* ===== الترويسة: عملائي + عدّادان + إضافة + جرس ===== */}
      <header className="flex items-center justify-between" style={{ padding: "0 2px", gap: 10 }}>
        <div className="min-w-0">
          <h1 style={{ fontSize: 22, fontWeight: 800, color: SOP.tx }}>عملائي</h1>
          <div style={{ fontSize: 12.5, color: SOP.tx2, marginTop: 4 }}>
            عندك{" "}
            <span style={{ ...ZAIN, fontWeight: 800, color: SOP.gold }}>{toArabicDigits(counts.working)}</span>{" "}
            عميل ·{" "}
            <span style={{ ...ZAIN, fontWeight: 800, color: SOP.gold }}>{toArabicDigits(notContacted)}</span>{" "}
            ينتظرون أول تواصل
          </div>
        </div>
        <div className="flex flex-none items-center" style={{ gap: 8 }}>
          <MobileNewLeadButton isManager={manager} employees={employees} />
          <Link
            href="/m/notifications"
            aria-label="الإشعارات"
            className="m-raise m-press-sc relative flex items-center justify-center"
            style={{ boxSizing: "border-box", width: 44, height: 44, borderRadius: 13, color: SOP.tx2 }}
          >
            <Bell size={19} strokeWidth={1.8} aria-hidden />
            {notif.unread > 0 && (
              <span
                className="absolute flex items-center justify-center"
                style={{
                  ...ZAIN, boxSizing: "border-box", top: 5, left: 5, minWidth: 17, height: 17,
                  borderRadius: 9, background: SOP.red, color: SOP.tx,
                  fontSize: 9, fontWeight: 700, padding: "0 4px",
                }}
              >
                {toArabicDigits(notif.unread > 99 ? 99 : notif.unread)}
              </span>
            )}
          </Link>
        </div>
      </header>

      {/* ===== البحث — بارز ومستقل (raised)، بمسافة تحته قبل التبويبات ===== */}
      <div className="flex" style={{ marginBottom: 4 }}>
        <MobileSearchBox
          defaultValue={filters.q}
          base={`/m/leads${tab !== "working" ? `?tab=${tab}` : ""}`}
          autoFocus={sp.focus === "1"}
          raised
        />
      </div>

      {/* ===== التبويبات الثلاثة بأعدادها — حاوية غائرة واحدة (.gtabs): كل شريحة flex 1، النشطة غائرة بنص ذهبي ===== */}
      <div className="m-inset flex" style={{ boxSizing: "border-box", gap: 5, padding: 5, borderRadius: 14 }}>
        {TABS.map((t) => {
          const on = tab === t.key;
          return (
            <Link
              key={t.key}
              href={chipHref(t.key, { ...v, stages: [], wait: false, tr: false, bank: false, ar: "" })}
              scroll={false}
              aria-current={on ? "page" : undefined}
              className="m-press-sc flex min-w-0 flex-1 items-center justify-center whitespace-nowrap"
              style={{
                boxSizing: "border-box", height: 38, padding: "0 8px", borderRadius: 11,
                fontSize: 12.5, fontWeight: 700, gap: 4,
                ...(on
                  ? { background: SOP.plane, color: SOP.gold, boxShadow: `inset 2px 2px 5px ${SOP.sd}, inset -2px -2px 5px ${SOP.sl}` }
                  : { color: SOP.tx2 }),
              }}
            >
              <span className="truncate">{t.label}</span>
              <span style={{ ...ZAIN, fontSize: 11.5, opacity: on ? 1 : 0.8 }}>{toArabicDigits(counts[t.key as "working" | "archived" | "hidden"])}</span>
            </Link>
          );
        })}
      </div>

      {/* ===== أفاتارات الموظفين — مدير/مالك فقط ===== */}
      {manager && empChips.length > 0 && (
        <MobileEmployeeAvatars tab={tab} values={v} employees={empChips} selectedId={selectedEmp} />
      )}

      {/* ===== «عملاء جدد (N)» — زر أخضر مميز فوق الشبكة (يبدّل القائمة لكروت العميل الجديد) ===== */}
      {tab === "working" && (
        <Link
          href={newHref}
          scroll={false}
          aria-pressed={newMode}
          className={`${newMode ? "" : "m-raise"} m-press-sc flex items-center justify-between`}
          style={{
            boxSizing: "border-box", minHeight: 48, borderRadius: 14, padding: "0 14px", marginTop: 4, gap: 10,
            ...(newMode
              ? { background: `linear-gradient(135deg, color-mix(in srgb, ${SOP.green} 85%, white), ${SOP.green})`, color: SOP.onGold, boxShadow: `0 8px 20px color-mix(in srgb, ${SOP.green} 30%, transparent)` }
              : { background: `color-mix(in srgb, ${SOP.green} 14%, ${SOP.plane})`, border: `1px solid color-mix(in srgb, ${SOP.green} 45%, transparent)`, color: SOP.green }),
          }}
        >
          <span className="flex items-center" style={{ gap: 8, fontSize: 13.5, fontWeight: 800 }}>
            {newMode ? <Check size={16} strokeWidth={2.5} aria-hidden /> : <Sparkles size={16} strokeWidth={2} aria-hidden />}
            عملاء جدد
          </span>
          <span style={{ ...ZAIN, fontSize: 16, fontWeight: 800 }}>{toArabicDigits(notContacted)}</span>
        </Link>
      )}

      {/* ===== شبكة كروت المراحل — ٣ أعمدة، نظيفة (المراحل فقط) ===== */}
      {tab === "working" && (
        <div className="grid grid-cols-3" style={{ gap: 8 }}>
          <StageCard
            href={chipHref(tab, { ...v, stages: [] })}
            on={filters.stages.length === 0}
            color={SOP.gold}
            label="كل المراحل"
            count={counts.working}
            goldFill
          />
          {GRID_ORDER.map((s) => {
            if (s === "visit") {
              return (
                <StageCard
                  key="visit"
                  href={chipHref(tab, {
                    ...v,
                    stages: visitActive
                      ? v.stages.filter((x) => !(VISIT_FILTER_STAGES as string[]).includes(x))
                      : [...new Set([...v.stages, ...VISIT_FILTER_STAGES])],
                  })}
                  on={visitActive}
                  color={STAGE_HEX.VISIT_SCHEDULED}
                  label="زيارة"
                  count={visitCount}
                />
              );
            }
            const on = filters.stages.includes(s);
            return (
              <StageCard
                key={s}
                href={chipHref(tab, { ...v, stages: on ? v.stages.filter((x) => x !== s) : [...v.stages, s] })}
                on={on}
                color={STAGE_HEX[s]}
                label={stageLabels[s]}
                count={counts.stageCounts[s] ?? 0}
                glow={s === "ATTEMPTED"}
              />
            );
          })}
        </div>
      )}

      {/* ===== صف الأدوات + رقائق المختارات + القائمة (كلها داخل اللوحة العميلة) ===== */}
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
          purchaseMethod: l.purchaseMethod,
          purchaseGoalLabel: l.purchaseGoal ? purchaseGoalLabels[l.purchaseGoal] : null,
          followUpsCount: l.followUpsCount,
          assignedToName: manager ? (l.assignedTo?.name ?? "غير موزّع") : null,
        }))}
        isManager={manager}
        employees={employees}
        hiddenTab={tab === "hidden"}
        newMode={newMode}
        tab={tab}
        values={v}
        sections={sections}
        selection={selection}
        dateApplies={dateApplies}
        todayISO={todayISO}
      />
    </div>
  );
}
