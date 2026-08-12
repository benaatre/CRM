"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LeadStage } from "@prisma/client";
import { stageLabels, stageOrder } from "@/lib/labels";
import { toArabicDigits } from "@/lib/format";
import {
  DEFAULT_LEAD_SORT, VISIT_FILTER_STAGES, collapseStagesParam, dateRangeApplies,
  type ArchiveReason, type LeadFilterValues,
} from "@/lib/lead-filters";
import { STAGE_HEX, WAITING_HEX, BANK_HEX } from "@/lib/stage-colors";
import { avatarColor } from "@/lib/mobile-avatar";
import { DateRangeChip } from "./date-range-chip";
import { PURCHASE_BUCKETS, type PurchaseBucket } from "./purchase-buckets";

type Employee = { id: string; name: string };
type Tab = "working" | "archived" | "hidden" | "unassigned";

/** أرقام اللوح بخط Zain وأرقام جدولية — لا تهتزّ خانتها بين صف وصف. */
const NUM: React.CSSProperties = { fontFamily: "var(--font-zain), var(--font-sans)", fontVariantNumeric: "tabular-nums", fontWeight: 700 };

/**
 * صفّ فلتر واحد: نقطة دلالية + اسم + عدّاد. بلا حدود — الفصل بالمسافة والطبقة،
 * والذهبي محجوز للصف الفعّال وحده (دليل ٢٠٢٦).
 */
function Row({
  label, dot, count, active, onClick, title,
}: {
  label: string;
  /** لون النقطة (hex من مصدر ألوان المراحل) — بلا نقطة إن لم يُمرَّر. */
  dot?: string;
  /** العدّاد — undefined = بلا رقم (تبويب لا تُعرف أعداده بدقة: رقم كاذب أسوأ من لا رقم). */
  count?: number;
  active: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-[7px] text-right text-[13.5px] transition-colors ${
        active ? "bg-gold/10 font-semibold text-gold" : "text-muted-foreground hover:bg-[var(--elev)] hover:text-foreground"
      }`}
    >
      {dot !== undefined && (
        <span aria-hidden className="size-2 flex-none rounded-full" style={{ background: dot, opacity: active ? 1 : 0.75 }} />
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && (
        <span className={`flex-none text-[12.5px] ${active ? "text-gold" : "text-muted-foreground/70"}`} style={NUM}>
          {toArabicDigits(count)}
        </span>
      )}
    </button>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-0.5">
      <h3 className="px-2.5 pb-1.5 text-[12.5px] font-medium text-muted-foreground/70">{title}</h3>
      {children}
    </section>
  );
}

/**
 * لوح فلاتر العملاء (سطح المكتب) — يقابل شريط الشرائح الأفقي على الجوال.
 * كل الفلاتر الخادمية تمرّ بالرابط كما هي اليوم (نفس مفاتيح lead-filters بالضبط)؛
 * «طريقة الشراء» وحدها حالة محلية تُطبَّق على الصفوف المحمَّلة (بلا لمس الخادم).
 *
 * الدور: `isManager` قادم من الخادم (requireUser في الصفحة) — مجموعة الموظفين لا
 * تُبنى أصلًا للموظف، وقائمة الموظفين تصل فارغة من الخادم في حالته.
 */
export function LeadsSidebar({
  basePath, tab, isManager, employees, filters, stageCounts, showCounts,
  notContacted, waiting, bankCheck, purchase, purchaseCounts, onPurchase,
}: {
  basePath: string;
  tab: Tab;
  isManager: boolean;
  employees: Employee[];
  filters: LeadFilterValues;
  /** عدّادات المراحل — نطاق «جاري العمل» ضمن صلاحية المستخدم. */
  stageCounts: Partial<Record<LeadStage, number>>;
  /** تُعرض الأرقام في «جاري العمل» فقط؛ غيره بلا أرقام (النطاق مختلف). */
  showCounts: boolean;
  notContacted?: number;
  waiting?: number;
  bankCheck?: number;
  purchase: PurchaseBucket | "";
  purchaseCounts: Record<PurchaseBucket, number>;
  onPurchase: (next: PurchaseBucket | "") => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // بناء الرابط — نفس منطق شريط الفلاتر حرفيًا، مع حفظ التبويب وسبب الأرشفة.
  function build(next: Partial<LeadFilterValues>): string {
    const p = new URLSearchParams();
    if (tab !== "working") p.set("tab", tab);
    const q = next.q ?? filters.q;
    if (q) p.set("q", q);
    const stages = next.stages ?? filters.stages;
    if (stages.length) p.set("stages", collapseStagesParam(stages).join(",")); // زوج الزيارة ⟵ "visit"
    const emps = next.emps ?? filters.emps;
    if (emps.length) p.set("emps", emps.join(","));
    const sort = next.sort ?? filters.sort;
    if (sort !== DEFAULT_LEAD_SORT) p.set("sort", sort);
    const wait = next.wait ?? filters.wait;
    if (wait) p.set("wait", "1");
    const tr = next.tr ?? filters.tr;
    if (tr) p.set("tr", "1");
    const bank = next.bank ?? filters.bank;
    if (bank) p.set("bank", "1");
    const ar = next.ar ?? filters.ar;
    if (tab === "hidden" && ar) p.set("ar", ar);
    // النطاق الزمني يُحمل ما دام فلتر «زيارة»/«موعد لاحق» مفعّلًا (يتصفّر مع إلغائه).
    if (dateRangeApplies(stages)) {
      const range = next.range ?? filters.range;
      const from = next.from ?? filters.from;
      const to = next.to ?? filters.to;
      if (range) p.set("range", range);
      else { if (from) p.set("from", from); if (to) p.set("to", to); }
    }
    const s = p.toString();
    return s ? `${basePath}?${s}` : basePath;
  }
  function go(next: Partial<LeadFilterValues>) {
    startTransition(() => router.push(build(next)));
  }

  // «زيارة» شريحة واحدة: المرحلتان تُضافان وتُزالان معًا (الرابط يحملهما "visit").
  const visitActive = VISIT_FILTER_STAGES.every((s) => filters.stages.includes(s));
  function toggleStage(s: LeadStage) {
    if ((VISIT_FILTER_STAGES as string[]).includes(s)) {
      go({
        stages: visitActive
          ? filters.stages.filter((x) => !(VISIT_FILTER_STAGES as string[]).includes(x))
          : [...new Set([...filters.stages, ...VISIT_FILTER_STAGES])],
      });
      return;
    }
    go({ stages: filters.stages.includes(s) ? filters.stages.filter((x) => x !== s) : [...filters.stages, s] });
  }

  const notContactedActive = filters.stages.length === 1 && filters.stages[0] === "NEW";
  // البحث ليس من فلاتر اللوح (مكانه شريط الأدوات) — فلا يمسحه زر «مسح كل الفلاتر».
  const hasFilters = filters.stages.length > 0 || filters.emps.length > 0
    || filters.wait || filters.tr || filters.bank || !!filters.ar || !!purchase;
  const customRangeActive = !filters.range && (!!filters.from || !!filters.to);
  const visitCount = showCounts ? (stageCounts.VISIT_SCHEDULED ?? 0) + (stageCounts.VIEWING ?? 0) : undefined;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between px-2.5">
        <h2 className="text-[13.5px] font-semibold text-foreground">الفلاتر</h2>
        {pending && <span className="text-[12.5px] text-muted-foreground/70">جارٍ التحديث…</span>}
      </div>

      {/* المرحلة — «زيارة» صفٌّ واحد لمرحلتيها (الرابط والاستعلام يوحّدانهما أصلًا) */}
      <Group title="المرحلة">
        <Row
          label="كل المراحل"
          count={showCounts ? Object.values(stageCounts).reduce((a, b) => a + b, 0) : undefined}
          active={filters.stages.length === 0}
          onClick={() => go({ stages: [] })}
        />
        {stageOrder.map((s) =>
          s === "VIEWING" ? null : s === "VISIT_SCHEDULED" ? (
            <Row
              key="visit"
              label="زيارة"
              dot={STAGE_HEX.VISIT_SCHEDULED}
              count={visitCount}
              active={visitActive}
              onClick={() => toggleStage("VISIT_SCHEDULED")}
              title="موعد زيارة + زار المشروع"
            />
          ) : (
            <Row
              key={s}
              label={stageLabels[s]}
              dot={STAGE_HEX[s]}
              count={showCounts ? stageCounts[s] ?? 0 : undefined}
              active={filters.stages.includes(s)}
              onClick={() => toggleStage(s)}
            />
          ),
        )}
      </Group>

      {/* الموعد — يظهر مع «زيارة» (على موعد الزيارة) أو «موعد لاحق» (على موعد المتابعة) */}
      {dateRangeApplies(filters.stages) && (
        <Group title="الموعد">
          <Row label="الكل" active={!filters.range && !customRangeActive} onClick={() => go({ range: "", from: "", to: "" })} />
          <Row label="هذا الأسبوع" active={filters.range === "week"} onClick={() => go({ range: "week", from: "", to: "" })} />
          <Row label="الأسبوع الجاي" active={filters.range === "next"} onClick={() => go({ range: "next", from: "", to: "" })} />
          <div className="px-1.5 pt-1.5">
            <DateRangeChip from={filters.from} to={filters.to} active={customRangeActive} onChange={(next) => go({ range: "", ...next })} />
          </div>
        </Group>
      )}

      {/* الحالة */}
      <Group title="الحالة">
        <Row
          label="لم يتم التواصل"
          dot={STAGE_HEX.NEW}
          count={notContacted}
          active={notContactedActive}
          onClick={() => go({ stages: notContactedActive ? [] : ["NEW"] })}
        />
        <Row label="محوَّل" dot="var(--warning)" active={filters.tr} onClick={() => go({ tr: !filters.tr })} title="محوَّل يدويًا بالبيانات" />
        <Row label="حسبة البنك" dot={BANK_HEX} count={bankCheck} active={filters.bank} onClick={() => go({ bank: !filters.bank })} />
        <Row label="في الانتظار" dot={WAITING_HEX} count={waiting} active={filters.wait} onClick={() => go({ wait: !filters.wait })} />
      </Group>

      {/* طريقة الشراء — فلتر محلي على الصفوف المحمّلة (بلا بارامتر رابط ولا استعلام) */}
      <Group title="طريقة الشراء">
        {PURCHASE_BUCKETS.map((b) => (
          <Row
            key={b.key}
            label={b.label}
            dot="var(--muted-foreground)"
            count={purchaseCounts[b.key]}
            active={purchase === b.key}
            onClick={() => onPurchase(purchase === b.key ? "" : b.key)}
          />
        ))}
      </Group>

      {/* سبب الأرشفة — تبويب «مؤرشف» وحده */}
      {tab === "hidden" && (
        <Group title="سبب الأرشفة">
          {([["", "الكل"], ["final", "غير مهتم نهائيًا"], ["marketer", "مسوّق"], ["manual", "أرشفة يدوية"]] as [ArchiveReason, string][]).map(([v, label]) => (
            <Row key={v || "all"} label={label} active={filters.ar === v} onClick={() => go({ ar: v })} />
          ))}
        </Group>
      )}

      {/* الموظفون — للمدير/المالك فقط (الموظف لا تصله القائمة من الخادم أصلًا) */}
      {isManager && employees.length > 0 && (
        <Group title="الموظفون">
          <Row label="كل الموظفين" active={filters.emps.length === 0} onClick={() => go({ emps: [] })} />
          {employees.map((e) => (
            <Row
              key={e.id}
              label={e.name}
              dot={avatarColor(e.id)}
              active={filters.emps.includes(e.id)}
              onClick={() => go({ emps: filters.emps.includes(e.id) ? filters.emps.filter((x) => x !== e.id) : [...filters.emps, e.id] })}
            />
          ))}
          {/* «غير موزّع» لا معنى له في «جاري العمل» (كله مُسند) — كما في شريط الجوال */}
          {tab !== "working" && (
            <Row
              label="غير موزّع"
              active={filters.emps.includes("none")}
              onClick={() => go({ emps: filters.emps.includes("none") ? filters.emps.filter((x) => x !== "none") : [...filters.emps, "none"] })}
            />
          )}
        </Group>
      )}

      {hasFilters && (
        <button
          type="button"
          onClick={() => {
            onPurchase("");
            startTransition(() => router.push(build({ q: filters.q, stages: [], emps: [], wait: false, tr: false, bank: false, ar: "", range: "", from: "", to: "" })));
          }}
          className="w-full rounded-xl bg-[var(--elev)] px-2.5 py-2 text-[13px] text-muted-foreground transition-colors hover:bg-[var(--elev-hover)] hover:text-foreground"
        >
          مسح كل الفلاتر
        </button>
      )}
    </div>
  );
}
