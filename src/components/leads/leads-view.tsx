"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { LeadStage } from "@prisma/client";
import { stageLabels, stageColor } from "@/lib/labels";
import { toArabicDigits, daysAgoLabel } from "@/lib/format";
import type { LeadRow } from "@/lib/data/leads";
import { TransferStar, TransferBadge } from "./transfer-star";
import { TransferModeDialog } from "./transfer-mode-dialog";
// اسم مستعار: TransferMode المحلي في هذا الملف يشمل "recover" (نافذة التحويل الجماعية)،
// أما وضع التوزيع فهو الثنائي المشترك في lib/transfer-mode.
import type { TransferMode as LeadReceiveMode } from "@/lib/transfer-mode";
import { PullCountdown, SweepCountdown } from "./pull-countdown";
import {
  transferLeads, recoverLeads, bulkArchive, bulkDelete, unarchiveLeads,
} from "@/lib/actions/leads";
import type { UnarchiveMode } from "@/lib/actions/leads";
import { distributeUnassigned, distributeLeastLoaded, distributeCustom, getEmployeeLoads } from "@/lib/actions/team";
import { admitToAutoPool } from "@/lib/actions/distribution";
import { LeadsFilterBar } from "./leads-filter-bar";
import { LeadsSidebar } from "./leads-sidebar";
import { LeadsToolbar } from "./leads-toolbar";
import { LeadsTable } from "./leads-table";
import { purchaseBucketOf, PURCHASE_BUCKETS, type PurchaseBucket } from "./purchase-buckets";
import { FilterChip } from "./filter-chip";
import { NewLeadDialog } from "./new-lead-dialog";
import { FollowUpsDrawer } from "./followups-drawer";
import { ImportDialog } from "@/components/team/import-dialog";
import { useLeads } from "./use-leads";

import { DEFAULT_LEAD_SORT, collapseStagesParam, dateRangeApplies, type ArchiveReason, type LeadFilterValues } from "@/lib/lead-filters";
import { WAITING_TONE } from "@/lib/stage-colors";

type Employee = { id: string; name: string };
type Tab = "working" | "archived" | "hidden" | "unassigned";
type Filters = LeadFilterValues;

// شرائح فلتر «سبب الأرشفة» بتبويب «مؤرشف».
const ARCHIVE_REASON_CHIPS: { value: ArchiveReason; label: string }[] = [
  { value: "", label: "الكل" },
  { value: "final", label: "غير مهتم نهائيًا" },
  { value: "marketer", label: "مسوّق" },
  { value: "manual", label: "أرشفة يدوية" },
];
const PAGE_SIZE = 12;

/** أرقام الواجهة: Zain + خانات جدولية (نفس وصفة الجدول واللوح). */
const NUM: React.CSSProperties = { fontFamily: "var(--font-zain), var(--font-sans)", fontVariantNumeric: "tabular-nums" };

export function LeadsView({
  query, counts, notContacted, waiting, bankCheck, visitCount, tab, isManager, employees, filters,
}: {
  query: string;
  /** أعداد التبويبات + عدّادات المراحل (من getLeadCounts — نطاق «جاري العمل» ضمن صلاحية المستخدم). */
  counts: { working: number; archived: number; hidden: number; unassigned: number; stageCounts: Partial<Record<LeadStage, number>> };
  notContacted: number;
  /** عدد «في الانتظار» (آخر متابعة لم يستجب/في الانتظار) — ضمن صلاحية المستخدم. */
  waiting?: number;
  /** عدد «حسبة البنك» (آخر متابعة BANK_CHECK) — لشارة الفلتر، ضمن صلاحية المستخدم. */
  bankCheck?: number;
  /** عدد عملاء مرحلتي الزيارة معًا — رقم شريحة «زيارة» الموحّدة. */
  visitCount?: number;
  tab: Tab;
  isManager: boolean;
  employees: Employee[];
  filters: Filters;
}) {
  const router = useRouter();
  const { leads: allRows, loading, reload } = useLeads(query);
  const [pending, startTransition] = useTransition();
  // فلتر «طريقة الشراء» — محلي على الصفوف المحمّلة (اللوح الجانبي، سطح المكتب).
  const [purchase, setPurchase] = useState<PurchaseBucket | "">("");
  // العدّادات تُحسب قبل تطبيق الفلتر نفسه — فلا تنهار أرقام بقية الدلاء عند اختيار واحد.
  const purchaseCounts = useMemo(() => {
    const c = Object.fromEntries(PURCHASE_BUCKETS.map((b) => [b.key, 0])) as Record<PurchaseBucket, number>;
    for (const r of allRows) { const b = purchaseBucketOf(r.purchaseMethod); if (b) c[b]++; }
    return c;
  }, [allRows]);
  const rows = useMemo(
    () => (purchase ? allRows.filter((r) => purchaseBucketOf(r.purchaseMethod) === purchase) : allRows),
    [allRows, purchase],
  );
  const [page, setPage] = useState(1);
  const [showNew, setShowNew] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [fuLead, setFuLead] = useState<LeadRow | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [transfer, setTransfer] = useState<{ ids: string[] } | null>(null);
  const [unarchive, setUnarchive] = useState<{ ids: string[] } | null>(null);

  // إعادة الترقيم/التحديد عند تغيّر النتائج.
  useEffect(() => { setPage(1); setSel(new Set()); }, [rows]);

  // تبديل التبويب مع الحفاظ على بقية الفلاتر.
  function goTab(v: Tab) {
    const p = new URLSearchParams();
    if (v === "archived") p.set("tab", "archived");
    else if (v === "hidden") p.set("tab", "hidden");
    else if (v === "unassigned") p.set("tab", "unassigned");
    if (filters.q) p.set("q", filters.q);
    if (filters.stages.length) p.set("stages", collapseStagesParam(filters.stages).join(",")); // زوج الزيارة ⟵ "visit"
    if (filters.emps.length) p.set("emps", filters.emps.join(","));
    if (filters.sort !== DEFAULT_LEAD_SORT) p.set("sort", filters.sort); // يحفظ الترتيب عبر التبويبات
    if (filters.wait) p.set("wait", "1"); // فلتر «في الانتظار» يبقى عبر التبويبات
    if (filters.tr) p.set("tr", "1"); // فلتر «محوَّل» يبقى عبر التبويبات
    if (filters.bank) p.set("bank", "1"); // فلتر «حسبة البنك» يبقى عبر التبويبات
    // النطاق الزمني يبقى عبر التبويبات ما دام فلتر «زيارة»/«موعد لاحق» محمولًا معها.
    if (dateRangeApplies(filters.stages)) {
      if (filters.range) p.set("range", filters.range);
      else { if (filters.from) p.set("from", filters.from); if (filters.to) p.set("to", filters.to); }
    }
    if (v === "hidden" && filters.ar) p.set("ar", filters.ar); // سبب الأرشفة خاص بتبويب «مؤرشف»
    const s = p.toString();
    startTransition(() => router.push(s ? `/leads?${s}` : "/leads"));
  }

  // تبديل فلتر «سبب الأرشفة» (تبويب «مؤرشف») مع حفظ بقية الفلاتر.
  function setArchiveReason(v: ArchiveReason) {
    const p = new URLSearchParams();
    p.set("tab", "hidden");
    if (filters.q) p.set("q", filters.q);
    if (filters.stages.length) p.set("stages", collapseStagesParam(filters.stages).join(",")); // زوج الزيارة ⟵ "visit"
    if (filters.emps.length) p.set("emps", filters.emps.join(","));
    if (filters.sort !== DEFAULT_LEAD_SORT) p.set("sort", filters.sort);
    if (v) p.set("ar", v);
    startTransition(() => router.push(`/leads?${p.toString()}`));
  }

  // تبويب «غير موزّعين» له أدواته الخاصة ومرحلته واحدة (جديد) — بلا لوح فلاتر.
  const showSidebar = !(tab === "unassigned" && isManager);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const curPage = Math.min(page, pages);
  const pageRows = rows.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);
  // «تحديد الكل» على مستوى التبويب الحالي كامل (كل العملاء المطابقين، مو الصفحة فقط).
  const allSelected = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const someSelected = sel.size > 0 && !allSelected;

  function toggleSel(id: string) {
    setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function toggleSelectAll() {
    setSel(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  }
  function clearSel() { setSel(new Set()); }

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok && res.error) alert(res.error);
      reload();          // يعيد قراءة الصفوف من نفس الـ API
      router.refresh();  // يحدّث أعداد التبويبات
    });
  }


  return (
    <div className="mx-auto max-w-[1600px]">
      <header className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-foreground">العملاء</h1>
        <button onClick={() => setShowNew(true)} className="min-h-11 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90">
          عميل جديد
        </button>
      </header>

      {/* التبويبات */}
      {/* على الجوال: شريط يُسحب أفقيًا بعناوين كاملة — أربع تبويبات في ٣٨٠ بكسل تتكسّر أسطرًا */}
      <div className="scroll-x mb-4 flex gap-1 rounded-xl border border-border bg-card p-1">
        {(([
          ...(isManager ? [["unassigned", "عملاء غير موزّعين", counts.unassigned] as const] : []),
          ["working", "جاري العمل", counts.working] as const,
          ["archived", "تم الحجز / الشراء", counts.archived] as const,
          ["hidden", "مؤرشف", counts.hidden] as const,
        ])).map(([v, label, count]) => (
          <button key={v} onClick={() => goTab(v)} className={`min-h-11 shrink-0 whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-medium transition-colors sm:flex-1 sm:shrink ${tab === v ? "bg-secondary text-gold" : "text-muted-foreground hover:text-foreground"}`}>
            {label} <span className="text-xs">({toArabicDigits(count)})</span>
          </button>
        ))}
      </div>

      {/* تبويب «غير موزّعين»: طرق الإضافة + التوزيع. باقي التبويبات: شريط الفلاتر. */}
      {tab === "unassigned" && isManager ? (
        <UnassignedTools
          availableUnassigned={counts.unassigned}
          onImport={() => setShowImport(true)}
          onNew={() => setShowNew(true)}
          onChanged={() => { reload(); router.refresh(); }}
        />
      ) : (
        // الجوال: شريط الشرائح الأفقي كما هو (خارج نطاق إعادة التصميم).
        // سطح المكتب: اللوح الجانبي بالأسفل بدله.
        <div className="mb-4 md:hidden">
          <LeadsFilterBar
            basePath="/leads"
            isManager={isManager}
            employees={employees}
            filters={filters}
            preserve={{ tab: tab === "archived" || tab === "hidden" ? tab : "" }}
            hideUnassignedEmp={tab === "working"}
            notContacted={tab === "working" ? notContacted : undefined}
            waiting={tab === "working" ? waiting : undefined}
            bankCheck={tab === "working" ? bankCheck : undefined}
            visitCount={visitCount}
            showDateRange
          />
          {/* فلتر «سبب الأرشفة» — تبويب «مؤرشف» فقط */}
          {tab === "hidden" && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">سبب الأرشفة:</span>
              {ARCHIVE_REASON_CHIPS.map((c) => (
                <FilterChip
                  key={c.value}
                  active={filters.ar === c.value}
                  onClick={() => setArchiveReason(c.value)}
                  className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${filters.ar === c.value ? "border-gold bg-gold/20 text-gold" : "border-border text-muted-foreground hover:text-foreground"}`}
                >{c.label}</FilterChip>
              ))}
            </div>
          )}
        </div>
      )}

      {/*
        سطح المكتب: لوح الفلاتر يمينًا (لاصق) والجدول يسارًا. الجوال: عمود واحد
        (اللوح مخفي، وشريط الشرائح أعلاه يقوم مقامه) — منطق البطاقات لم يُمسّ.
      */}
      <div className="md:flex md:items-start md:gap-5">
        {showSidebar && (
          <aside className="sticky top-20 hidden w-[15.5rem] shrink-0 md:block">
            <LeadsSidebar
              basePath="/leads"
              tab={tab}
              isManager={isManager}
              employees={employees}
              filters={filters}
              stageCounts={counts.stageCounts}
              showCounts={tab === "working"}
              notContacted={tab === "working" ? notContacted : undefined}
              waiting={tab === "working" ? waiting : undefined}
              bankCheck={tab === "working" ? bankCheck : undefined}
              purchase={purchase}
              purchaseCounts={purchaseCounts}
              onPurchase={setPurchase}
            />
          </aside>
        )}

        <div className="min-w-0 flex-1">
      {/* شريط أدوات الجدول (بحث Ctrl K + فرز + سطر التحديد) — سطح المكتب */}
      <div className="hidden md:block">
        <LeadsToolbar
          basePath="/leads"
          tab={tab}
          filters={filters}
          total={rows.length}
          selected={sel.size}
          allSelected={allSelected}
          onToggleAll={toggleSelectAll}
          onClearSel={clearSel}
        />
      </div>

      {/* عدّاد التحديد + «تحديد الكل» — الجوال وحده (سطح المكتب في شريط الأدوات أعلاه) */}
      {rows.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-gold/30 bg-gold/5 px-4 py-2.5 text-sm md:hidden">
          <span className="font-medium text-foreground">محدّد: {toArabicDigits(sel.size)} من {toArabicDigits(rows.length)}</span>
          <button
            onClick={toggleSelectAll}
            className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${allSelected ? "border-gold bg-gold/15 text-gold" : "border-border text-foreground hover:bg-secondary"}`}
          >{allSelected ? "إلغاء تحديد الكل" : "تحديد الكل"}</button>
        </div>
      )}

      {/*
        أفعال الجملة — الغلاف البصري وحده تغيّر: نفس الاستدعاءات وحُرّاس الدور
        والتأكيدات كما هي (تحويل · بركة التوزيع · أرشفة/إرجاع · حذف).
      */}
      {sel.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl bg-gold/[0.07] px-3.5 py-2.5 text-sm">
          <span className="text-[13px] font-medium text-gold">
            {toArabicDigits(sel.size)} محدَّد
          </span>
          <div className="flex-1" />
          {isManager && (
            <button onClick={() => setTransfer({ ids: [...sel] })} disabled={pending} className="rounded-lg bg-[var(--elev)] px-3 py-1.5 text-[13px] text-foreground transition-colors hover:bg-[var(--elev-hover)] disabled:opacity-50">تحويل</button>
          )}
          {/* باب البركة ٢: غير الموزّعين فقط — لا يمسّ أي عميل مُسند. */}
          {isManager && tab === "unassigned" && (
            <button
              onClick={() => run(async () => { const r = await admitToAutoPool([...sel]); clearSel(); return r; })}
              disabled={pending}
              title="يدخلهم بركة التوزيع التلقائي — المحرك يوزّعهم بالدفعات والسقوف المضبوطة"
              className="rounded-lg bg-gold/15 px-3 py-1.5 text-[13px] font-medium text-gold transition-colors hover:bg-gold/25 disabled:opacity-50"
            >أدخلهم التوزيع التلقائي</button>
          )}
          {tab === "hidden" ? (
            <button onClick={() => setUnarchive({ ids: [...sel] })} disabled={pending} className="rounded-lg bg-gold/15 px-3 py-1.5 text-[13px] font-medium text-gold transition-colors hover:bg-gold/25 disabled:opacity-50">إرجاع من الأرشيف</button>
          ) : (
            <button onClick={() => run(async () => { const r = await bulkArchive([...sel]); clearSel(); return r; })} disabled={pending} className="rounded-lg bg-[var(--elev)] px-3 py-1.5 text-[13px] text-foreground transition-colors hover:bg-[var(--elev-hover)] disabled:opacity-50">أرشفة</button>
          )}
          {isManager && (
            <button
              onClick={() => { if (confirm(`متأكد تبي تحذف ${toArabicDigits(sel.size)} عميل نهائيًا؟ ما يمكن التراجع.`)) run(async () => { const r = await bulkDelete([...sel]); clearSel(); return r; }); }}
              disabled={pending}
              className="rounded-lg bg-destructive/10 px-3 py-1.5 text-[13px] text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-50"
            >حذف</button>
          )}
          <button onClick={clearSel} className="rounded-lg px-3 py-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground">إلغاء التحديد</button>
        </div>
      )}

      {/* بطاقات الجوال (بدل الجدول) */}
      <div className="space-y-3 md:hidden">
        {pageRows.length === 0 ? (
          <p className="rounded-2xl border border-border bg-card px-4 py-10 text-center text-muted-foreground">{loading ? "جارٍ التحميل…" : "ما فيه عملاء."}</p>
        ) : (
          pageRows.map((l) => (
            <div key={l.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {/* يلتف بدل ما يقصّ: الاسم + شاراته قد تتعدّى عرض الجوال */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <input type="checkbox" checked={sel.has(l.id)} onChange={() => toggleSel(l.id)} aria-label={`تحديد ${l.name}`} className="size-5 shrink-0 accent-[var(--gold)]" />
                    <span className="font-medium text-foreground">{l.name}</span>
                    <TransferStar show={l.isTransferred} exhausted={l.transferredExhausted} />
                    <TransferBadge show={l.manualTransferred} />
                    {/* حلقة مهلة السحب (أخضر→أصفر→أحمر نابض) — للموظف والمالك؛ عدّاد عدم الرد للموظف لما ما فيه حلقة سحب */}
                    <SweepCountdown info={l.sweepPull} manager={isManager} />
                    {!isManager && !l.sweepPull && <PullCountdown pull={l.pull} />}
                    {/* الشارة الملونة فقط — السبب يظهر في ملف العميل والدرج (القائمة بلا زحمة). */}
                    {l.waiting && <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${WAITING_TONE.chip}`} title="آخر متابعة: في الانتظار">في الانتظار{l.waitingCount > 1 ? ` ×${toArabicDigits(l.waitingCount)}` : ""}</span>}
                    {l.marketer && <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-bold text-destructive">مسوّق</span>}{l.inAutoPool && <span className="rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 text-[10px] font-bold text-gold" title="داخل بركة التوزيع التلقائي — المحرك يوزّعه ويعيد توجيهه">تلقائي</span>}
                  </div>
                  <a href={`tel:${l.phone}`} className="mt-1 block text-sm text-gold" dir="ltr">{l.phone}</a>
                </div>
                <Link href={`/leads/${l.id}`} className="flex min-h-11 shrink-0 items-center rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground hover:opacity-90">فتح</Link>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span className={`rounded-full border px-2 py-0.5 ${stageColor[l.stage]}`}>{stageLabels[l.stage]}</span>
                {l.stale && <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-bold text-warning" title="مهتم بلا متابعة من ٧ أيام — بعد ١٤ يومًا ينزل تلقائيًا «موعد لاحق»">راكد</span>}
                <span className="text-muted-foreground">الموظف: {l.assignedTo?.name ?? "غير موزّع"}</span>
                {!isManager && <span className="text-muted-foreground">استلمته {daysAgoLabel(l.daysWaiting)}</span>}
                {l.followUpsCount > 0 && (
                  <button onClick={() => setFuLead(l)} className="rounded-full border border-border px-2 py-0.5 text-gold">{toArabicDigits(l.followUpsCount)} متابعة</button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* الجدول (سطح المكتب ≥md) — التصميم المعتمد ٢٠٢٦ */}
      <LeadsTable
        pageRows={pageRows}
        startIndex={(curPage - 1) * PAGE_SIZE}
        loading={loading}
        isManager={isManager}
        tab={tab}
        sel={sel}
        allSelected={allSelected}
        someSelected={someSelected}
        onToggle={toggleSel}
        onToggleAll={toggleSelectAll}
        onFollowUp={setFuLead}
        onTransfer={(ids) => setTransfer({ ids })}
      />

      {/* ترقيم — أرقامه بخط Zain وخانات جدولية، وأزراره طبقات بلا حدود */}
      {rows.length > 0 && (
        <div className="mt-4 flex items-center justify-between text-[13px] text-muted-foreground">
          <span>
            عرض <span style={NUM}>{toArabicDigits((curPage - 1) * PAGE_SIZE + 1)}–{toArabicDigits(Math.min(curPage * PAGE_SIZE, rows.length))}</span> من <span style={NUM}>{toArabicDigits(rows.length)}</span>
          </span>
          <div className="flex items-center gap-1.5">
            <button disabled={curPage === 1} onClick={() => setPage(curPage - 1)} className="rounded-lg bg-[var(--elev)] px-3 py-1.5 transition-colors hover:bg-[var(--elev-hover)] hover:text-foreground disabled:opacity-40 disabled:hover:bg-[var(--elev)]">السابق</button>
            <span className="px-2" style={NUM}>{toArabicDigits(curPage)} / {toArabicDigits(pages)}</span>
            <button disabled={curPage === pages} onClick={() => setPage(curPage + 1)} className="rounded-lg bg-[var(--elev)] px-3 py-1.5 transition-colors hover:bg-[var(--elev-hover)] hover:text-foreground disabled:opacity-40 disabled:hover:bg-[var(--elev)]">التالي</button>
          </div>
        </div>
      )}
        </div>
      </div>

      {transfer && (
        <TransferDialog
          count={transfer.ids.length}
          employees={employees}
          onClose={() => setTransfer(null)}
          onConfirm={(mode, toUserId) => {
            const ids = transfer.ids;
            setTransfer(null);
            run(async () => {
              const res = mode === "recover"
                ? await recoverLeads(ids)
                : await transferLeads(ids, toUserId!, mode);
              clearSel();
              return res;
            });
          }}
        />
      )}

      {unarchive && (
        <UnarchiveDialog
          count={unarchive.ids.length}
          onClose={() => setUnarchive(null)}
          onConfirm={(mode) => {
            const ids = unarchive.ids;
            setUnarchive(null);
            run(async () => { const r = await unarchiveLeads(ids, mode); clearSel(); return r; });
          }}
        />
      )}

      <NewLeadDialog open={showNew} onClose={() => setShowNew(false)} isManager={isManager} employees={employees} />
      {showImport && <ImportDialog employees={employees} onClose={() => { setShowImport(false); reload(); router.refresh(); }} />}
      <FollowUpsDrawer leadId={fuLead?.id ?? null} leadName={fuLead?.name ?? ""} stage={fuLead?.stage ?? "NEW"} firstContactStage={fuLead?.firstContactStage} onClose={() => setFuLead(null)} onChanged={() => { reload(); router.refresh(); }} />
    </div>
  );
}

// أدوات تبويب «غير موزّعين»: طرق الإضافة + التوزيع.
function UnassignedTools({
  availableUnassigned, onImport, onNew, onChanged,
}: {
  availableUnassigned: number;
  onImport: () => void;
  onNew: () => void;
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [custom, setCustom] = useState(false);
  const [loads, setLoads] = useState<{ id: string; name: string; count: number; maxClients: number | null; remaining: number | null }[] | null>(null);
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  // طريقة التوزيع المنتظِرة قرار الوضع (بالبيانات/كجديد) — تُفتح النافذة قبل أي تنفيذ.
  const [askMode, setAskMode] = useState<"equal" | "least" | "custom" | null>(null);

  function runDistribution(how: "equal" | "least" | "custom", leadMode: LeadReceiveMode) {
    dist(() =>
      how === "equal" ? distributeUnassigned(leadMode)
        : how === "least" ? distributeLeastLoaded(leadMode)
          : distributeCustom((loads ?? []).map((e) => ({ userId: e.id, count: Number(alloc[e.id]) || 0 })), leadMode));
  }

  function dist(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    setMsg(null);
    startTransition(async () => {
      const res = await fn();
      setMsg(res.ok ? (res.message ?? "تم التوزيع") : res.error ?? "صار خطأ");
      onChanged();
      if (res.ok && custom) { setAlloc({}); setLoads(await getEmployeeLoads()); }
    });
  }

  function openCustom() {
    const next = !custom;
    setCustom(next);
    if (next && loads === null) {
      startTransition(async () => { setLoads(await getEmployeeLoads()); });
    }
  }

  const totalWanted = Object.values(alloc).reduce((s, v) => s + (Number(v) || 0), 0);
  const over = totalWanted > availableUnassigned;
  const overCap = (loads ?? []).some((e) => e.remaining != null && (Number(alloc[e.id]) || 0) > e.remaining);

  return (
    <div className="mb-4 space-y-3 rounded-2xl border border-border bg-card p-4">
      {/* طرق الإضافة */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">طرق الإضافة:</span>
        <button onClick={onNew} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90">عميل جديد</button>
        <button onClick={onImport} className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground hover:bg-secondary">استيراد (Excel / لصق / رابط Sheets)</button>
      </div>

      {/* التوزيع */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <span className="text-sm font-medium text-foreground">التوزيع:</span>
        {/* الوضع يُسأل مرة لكل دفعة قبل التنفيذ — لا توزيع صامت بضغطة. */}
        <button onClick={() => setAskMode("equal")} disabled={pending} className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground hover:bg-secondary disabled:opacity-50">بالتساوي</button>
        <button onClick={() => setAskMode("least")} disabled={pending} className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground hover:bg-secondary disabled:opacity-50">الأقل عملاءً</button>
        <button onClick={openCustom} className={`rounded-lg border px-3 py-1.5 text-xs ${custom ? "border-gold bg-gold/15 text-gold" : "border-border text-foreground hover:bg-secondary"}`}>مخصص</button>
        <span className="text-xs text-muted-foreground">— أو يدويًا: حدّد عملاء بالأسفل ثم «تحويل».</span>
      </div>

      {/* جدول التوزيع المخصّص */}
      {custom && (
        <div className="space-y-2 rounded-xl border border-gold/30 bg-gold/5 p-3">
          {loads === null ? (
            <p className="py-2 text-center text-xs text-muted-foreground">جارٍ التحميل…</p>
          ) : loads.length === 0 ? (
            <p className="py-2 text-center text-xs text-muted-foreground">ما فيه موظفون مفعّلون.</p>
          ) : (
            <>
              <table className="w-full text-right text-sm">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">الموظف</th>
                    <th className="px-2 py-1.5 font-medium">عملاؤه الآن</th>
                    <th className="px-2 py-1.5 font-medium">المتبقّي له</th>
                    <th className="px-2 py-1.5 font-medium">عدد العملاء</th>
                  </tr>
                </thead>
                <tbody>
                  {loads.map((e) => {
                    const rowOver = e.remaining != null && (Number(alloc[e.id]) || 0) > e.remaining;
                    return (
                      <tr key={e.id} className="border-t border-border">
                        <td className="px-2 py-2 text-foreground">{e.name}</td>
                        <td className="px-2 py-2 text-muted-foreground">{toArabicDigits(e.count)}</td>
                        <td className="px-2 py-2 text-muted-foreground">{e.remaining == null ? "بلا حد" : toArabicDigits(e.remaining)}</td>
                        <td className="px-2 py-2">
                          <input
                            value={alloc[e.id] ?? ""}
                            onChange={(ev) => setAlloc((a) => ({ ...a, [e.id]: ev.target.value.replace(/\D/g, "") }))}
                            inputMode="numeric" dir="ltr" placeholder="٠"
                            className={`w-16 rounded border bg-background px-2 py-1 text-center text-foreground outline-none focus:border-gold ${rowOver ? "border-destructive" : "border-border"}`}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="flex items-center justify-between">
                <span className={`text-xs ${over ? "text-destructive" : "text-muted-foreground"}`}>
                  المجموع: {toArabicDigits(totalWanted)} من {toArabicDigits(availableUnassigned)} متاح
                </span>
                <button
                  onClick={() => setAskMode("custom")}
                  disabled={pending || over || overCap || totalWanted === 0}
                  className="rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                >وزّع الآن</button>
              </div>
              {over && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">المجموع أكبر من عدد العملاء المتاح ({toArabicDigits(availableUnassigned)}).</p>}
              {overCap && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">في موظف تجاوز سعته المتبقية — صحّح الأعداد المظللة بالأحمر.</p>}
            </>
          )}
        </div>
      )}

      {msg && <p className="rounded-lg bg-success/10 px-3 py-2 text-xs text-success">{msg}</p>}

      {askMode && (
        <TransferModeDialog
          title="توزيع العملاء غير الموزّعين"
          variant="distribute"
          confirmLabel="وزّع"
          onClose={() => setAskMode(null)}
          onConfirm={(leadMode) => { const how = askMode; setAskMode(null); runDistribution(how, leadMode); }}
        />
      )}
    </div>
  );
}

type TransferMode = "full" | "fresh" | "recover";

function TransferDialog({
  count, employees, onClose, onConfirm,
}: {
  count: number;
  employees: Employee[];
  onClose: () => void;
  onConfirm: (mode: TransferMode, toUserId: string | null) => void;
}) {
  const [mode, setMode] = useState<TransferMode>("full");
  const [to, setTo] = useState("");
  const needsEmployee = mode === "full" || mode === "fresh";
  const canConfirm = !needsEmployee || !!to;

  const options: { value: TransferMode; label: string; desc: string }[] = [
    { value: "full", label: "تحويل بالبيانات", desc: "الموظف الجديد يرى كل المتابعات والتاريخ — ويظهر على العميل وسم ⇄ «محوَّل»." },
    { value: "fresh", label: "تحويل كجديد", desc: "يصل للموظف كعميل جديد تمامًا: بلا تاريخ ظاهر وبلا أي وسم. السجل الكامل يبقى محفوظًا للمالك والأدمن." },
    { value: "recover", label: "استرداد للنظام كعميل جديد", desc: "يُسحب من الموظف الحالي — يرجع بدون موظف — المرحلة ترجع «جديد»." },
  ];

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-card p-5 shadow-2xl">
          <h2 className="font-bold text-foreground">تحويل {toArabicDigits(count)} عميل</h2>

          <div className="space-y-2">
            {options.map((o) => (
              <label key={o.value} className={`block cursor-pointer rounded-xl border p-3 transition-colors ${mode === o.value ? "border-gold bg-gold/10" : "border-border hover:bg-secondary/40"}`}>
                <div className="flex items-center gap-2">
                  <input type="radio" name="transfer-mode" checked={mode === o.value} onChange={() => setMode(o.value)} />
                  <span className="text-sm font-medium text-foreground">{o.label}</span>
                </div>
                <p className="mt-1 pr-6 text-xs text-muted-foreground">{o.desc}</p>
              </label>
            ))}
          </div>

          {needsEmployee && (
            <select value={to} onChange={(e) => setTo(e.target.value)} className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-gold">
              <option value="">اختر الموظف…</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          )}

          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground">إلغاء</button>
            <button onClick={() => canConfirm && onConfirm(mode, needsEmployee ? to : null)} disabled={!canConfirm} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">تنفيذ</button>
          </div>
        </div>
      </div>
    </>
  );
}

// حوار الإرجاع من الأرشيف — ٣ أنماط. المتابعات محفوظة في كلها.
function UnarchiveDialog({
  count, onClose, onConfirm,
}: {
  count: number;
  onClose: () => void;
  onConfirm: (mode: UnarchiveMode) => void;
}) {
  const [mode, setMode] = useState<UnarchiveMode>("asis");

  const options: { value: UnarchiveMode; label: string; desc: string }[] = [
    { value: "asis", label: "رجّعه زي ما كان", desc: "يشيل الأرشفة بس — المرحلة والمتابعات تبقى كما هي. يرجع لتبويبه الطبيعي (جاري العمل لو مُسند، غير موزّع لو بلا موظف)." },
    { value: "freshUnassigned", label: "رجّعه جديد غير موزّع", desc: "يشيل الأرشفة + يرجّع المرحلة «جديد» + يشيله من الموظف. يروح حوض «غير موزّعين». المتابعات محفوظة." },
    { value: "freshKeepEmployee", label: "رجّعه جديد مع نفس الموظف", desc: "يشيل الأرشفة + يرجّع المرحلة «جديد» + يبقى مع نفس الموظف الحالي. المتابعات محفوظة." },
  ];

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-card p-5 shadow-2xl">
          <h2 className="font-bold text-foreground">إرجاع {toArabicDigits(count)} عميل من الأرشيف</h2>

          <div className="space-y-2">
            {options.map((o) => (
              <label key={o.value} className={`block cursor-pointer rounded-xl border p-3 transition-colors ${mode === o.value ? "border-gold bg-gold/10" : "border-border hover:bg-secondary/40"}`}>
                <div className="flex items-center gap-2">
                  <input type="radio" name="unarchive-mode" checked={mode === o.value} onChange={() => setMode(o.value)} />
                  <span className="text-sm font-medium text-foreground">{o.label}</span>
                </div>
                <p className="mt-1 pr-6 text-xs text-muted-foreground">{o.desc}</p>
              </label>
            ))}
          </div>

          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground">إلغاء</button>
            <button onClick={() => onConfirm(mode)} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">تنفيذ</button>
          </div>
        </div>
      </div>
    </>
  );
}
