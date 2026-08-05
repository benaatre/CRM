"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Share2, Archive, ArchiveRestore, Trash2, CalendarClock, Check, Contact, X } from "lucide-react";
import type { Channel, LeadStage } from "@prisma/client";
import { STAGE_HEX, stageChipClass } from "@/lib/stage-colors";
import { stageLabel, channelLabel } from "@/lib/labels";
import type { LeadFilterValues } from "@/lib/lead-filters";
import type { TransferMode } from "@/lib/transfer-mode";
import { MODE_OPTIONS } from "@/components/leads/transfer-mode-dialog";
import {
  transferLeads, recoverLeads, bulkArchive, bulkDelete, unarchiveLeads,
  type UnarchiveMode,
} from "@/lib/actions/leads";
import { avatarColor, avatarInitials } from "@/lib/mobile-avatar";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { toArabicDigits, waitingLabel, waitingBasisOf } from "@/lib/mobile-format";
import { BottomSheet } from "@/components/mobile/bottom-sheet";
import { MobilePortal } from "@/components/mobile/portal";
import { MobileActionBar } from "@/components/mobile/action-bar";
import { MobileLeadsFilters } from "@/components/mobile/leads-filters";
import type { FilterSection, FilterSelection } from "@/components/mobile/filter-sheet";

export type MobileLeadRow = {
  id: string;
  name: string;
  stage: LeadStage;
  channel: Channel;
  daysWaiting: number;
  /** لتحديد أساس نص الانتظار (آخر تواصل أم الإسناد) — لا يُخمَّن. */
  lastContact: Date | null;
  assignedAt: Date | null;
  /** ⇄ «محوَّل» يدويًا بالبيانات (نفس وسم TransferBadge بالديسكتوب). */
  manualTransferred: boolean;
  /** مسترد/معاد توجيهه (نجمة التحويل بالديسكتوب). */
  isTransferred: boolean;
  /** «في الانتظار» (آخر متابعة لم يستجب) — نفس شارة الديسكتوب. */
  waiting: boolean;
  /** نص موعد الزيارة الجاهز (توقيت الرياض) — يُحسب بالخادم، null بلا زيارة. */
  visitText: string | null;
  /** اسم الموظف — للمدير فقط (null للموظف). */
  assignedToName: string | null;
};

type Employee = { id: string; name: string };
type LeadTab = Parameters<typeof import("@/lib/lead-filters").buildLeadsQuery>[0];
/** نفس أوضاع نافذة تحويل الديسكتوب: بالبيانات · كجديد · استرداد للنظام. */
type BulkTransferMode = TransferMode | "recover";

const PAGE = 20;

/** نصوص الأوضاع من مصدرها المشترك + «استرداد» بنصّ نافذة الديسكتوب حرفيًا. */
const TRANSFER_OPTIONS: { value: BulkTransferMode; label: string; desc: string }[] = [
  ...MODE_OPTIONS.transfer.map((o) => ({ value: o.value as BulkTransferMode, label: o.label, desc: o.desc })),
  { value: "recover", label: "استرداد للنظام كعميل جديد", desc: "يُسحب من الموظف الحالي — يرجع بدون موظف — المرحلة ترجع «جديد»." },
];

const UNARCHIVE_OPTIONS: { value: UnarchiveMode; label: string; desc: string }[] = [
  { value: "asis", label: "رجّعه زي ما كان", desc: "يشيل الأرشفة بس — المرحلة والمتابعات تبقى كما هي. يرجع لتبويبه الطبيعي." },
  { value: "freshUnassigned", label: "رجّعه جديد غير موزّع", desc: "يشيل الأرشفة + المرحلة «جديد» + بلا موظف — يروح حوض «غير موزّعين». المتابعات محفوظة." },
  { value: "freshKeepEmployee", label: "رجّعه جديد مع نفس الموظف", desc: "يشيل الأرشفة + المرحلة «جديد» + يبقى مع موظفه الحالي. المتابعات محفوظة." },
];

/**
 * لوحة العملاء — صف الأدوات + القائمة (تمرير لانهائي) + وضع التحديد وإجراءاته.
 *
 * الإجراءات كلها أكشنات الديسكتوب نفسها بحراسها الخادمية:
 * transferLeads · recoverLeads · bulkArchive · unarchiveLeads · bulkDelete.
 * الواجهة تخفي ما لا يملكه الدور، والخادم هو خط الدفاع الأول لا الإخفاء.
 */
export function MobileLeadsList({
  rows, isManager = false, employees = [], hiddenTab = false,
  tab, values, sections, selection, dateApplies, todayISO,
}: {
  rows: MobileLeadRow[];
  isManager?: boolean;
  employees?: Employee[];
  /** تبويب «مؤرشف» — يستبدل «أرشفة» بـ«إرجاع من الأرشيف». */
  hiddenTab?: boolean;
  tab: LeadTab;
  values: LeadFilterValues;
  sections: FilterSection[];
  selection: FilterSelection;
  dateApplies: boolean;
  todayISO: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useState(Math.min(PAGE, rows.length));
  const [selectMode, setSelectMode] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showTransfer, setShowTransfer] = useState(false);
  const [trMode, setTrMode] = useState<BulkTransferMode>("full");
  const [trTo, setTrTo] = useState("");
  const [showUnarchive, setShowUnarchive] = useState(false);
  const [unMode, setUnMode] = useState<UnarchiveMode>("asis");
  const sentinel = useRef<HTMLDivElement | null>(null);

  // الفلاتر تغيّر الصفوف — نرجّع العدّاد والتحديد.
  useEffect(() => { setShown(Math.min(PAGE, rows.length)); setSel(new Set()); }, [rows]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || shown >= rows.length) return;
    const io = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) setShown((n) => Math.min(n + PAGE, rows.length)); },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown, rows.length]);

  const allSelected = rows.length > 0 && sel.size === rows.length;
  const toggleSel = (id: string) =>
    setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) =>
    startTransition(async () => {
      setMsg(null);
      const r = await fn();
      setMsg(r.ok ? { ok: true, text: okText } : { ok: false, text: r.error ?? "صار خطأ" });
      if (r.ok) { setSel(new Set()); setSelectMode(false); router.refresh(); }
    });

  const trTarget = employees.find((e) => e.id === trTo);

  return (
    <>
      {/* ===== ١-د) صف الأدوات + ١-هـ) الموعد الذكي ===== */}
      <MobileLeadsFilters
        tab={tab}
        values={values}
        sections={sections}
        selection={selection}
        dateApplies={dateApplies}
        todayISO={todayISO}
        selectMode={selectMode}
        onToggleSelect={() => { setSelectMode((v) => !v); setSel(new Set()); }}
      />

      <div style={{ fontSize: "11.5px", color: MOBILE_COLORS.textMuted, padding: "0 2px" }}>
        {toArabicDigits(rows.length)} عميل
      </div>

      {msg && (
        <p style={{
          boxSizing: "border-box", borderRadius: 10, padding: "9px 12px", fontSize: "12.5px",
          background: msg.ok ? MOBILE_STATUS.success.bg : MOBILE_STATUS.danger.bg,
          color: msg.ok ? MOBILE_STATUS.success.fg : MOBILE_STATUS.danger.fg,
          border: `1px solid ${msg.ok ? MOBILE_STATUS.success.border : MOBILE_STATUS.danger.border}`,
        }}>
          {msg.text}
        </p>
      )}

      {rows.length === 0 ? (
        <div className="flex flex-col items-center text-center"
          style={{
            boxSizing: "border-box", gap: 9, padding: "34px 16px",
            background: MOBILE_COLORS.card, borderRadius: 16, border: `1px solid ${MOBILE_COLORS.border}`,
          }}>
          <Contact size={34} style={{ color: MOBILE_COLORS.textMuted }} aria-hidden />
          <p style={{ fontSize: "12.5px", color: MOBILE_COLORS.textSecondary }}>ما فيه نتائج لهذا الفلتر</p>
        </div>
      ) : (
        <div className="flex flex-col" style={{ gap: 9 }}>
          {rows.slice(0, shown).map((l, i) => {
            const on = sel.has(l.id);
            const inner = (
              <>
                <span className="absolute bottom-0 right-0 top-0" style={{ width: 3, background: STAGE_HEX[l.stage] }} aria-hidden />
                {selectMode && (
                  <span
                    className="flex flex-none items-center justify-center"
                    style={{
                      boxSizing: "border-box", width: 24, height: 24, borderRadius: 12,
                      border: `2px solid ${on ? MOBILE_COLORS.gold : MOBILE_COLORS.dim2}`,
                      background: on ? MOBILE_COLORS.gold : "transparent",
                      color: MOBILE_COLORS.bg,
                      transition: "background .18s, border-color .18s",
                    }}
                    aria-hidden
                  >
                    {on && <Check size={14} strokeWidth={3} />}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center" style={{ gap: 6 }}>
                    <span className="min-w-0 truncate" style={{ fontSize: "14.5px", fontWeight: 600, color: MOBILE_COLORS.textPrimary }}>
                      {l.name}
                    </span>
                    {l.manualTransferred && (
                      <span className="flex-none" title="محوَّل يدويًا بالبيانات"
                        style={{ boxSizing: "border-box", fontSize: 9.5, fontWeight: 700, padding: "2px 7px", borderRadius: 6, background: MOBILE_STATUS.info.bg, color: MOBILE_STATUS.info.fg, border: `1px solid ${MOBILE_STATUS.info.border}` }}>
                        ⇄ محوَّل
                      </span>
                    )}
                    {!l.manualTransferred && l.isTransferred && (
                      <span className="flex-none" title="مسترد / معاد توجيهه" style={{ fontSize: 11, color: MOBILE_COLORS.gold }}>✦</span>
                    )}
                    {l.waiting && (
                      <span className="flex-none" title="آخر متابعة: في الانتظار"
                        style={{ boxSizing: "border-box", fontSize: 9.5, fontWeight: 700, padding: "2px 7px", borderRadius: 6, background: MOBILE_STATUS.warning.bg, color: MOBILE_STATUS.warning.fg }}>
                        في الانتظار
                      </span>
                    )}
                  </span>
                  <span className="block truncate" style={{ fontSize: "11.5px", color: MOBILE_COLORS.textMuted, marginTop: 4 }}>
                    {waitingLabel(l.daysWaiting, waitingBasisOf(l))} · {channelLabel(l.channel)}
                    {l.assignedToName ? ` · ${l.assignedToName}` : ""}
                  </span>
                  {l.visitText && (
                    <span className="flex items-center" style={{ gap: 5, fontSize: "11.5px", fontWeight: 600, color: MOBILE_STATUS.info.fg, marginTop: 4 }}>
                      <CalendarClock size={12} aria-hidden /> زيارة {l.visitText}
                    </span>
                  )}
                </span>
                <span
                  className={`shrink-0 whitespace-nowrap border font-semibold ${stageChipClass[l.stage]}`}
                  style={{ fontSize: "10.5px", padding: "4px 9px", borderRadius: 7 }}
                >
                  {stageLabel(l.stage)}
                </span>
              </>
            );
            const style = {
              boxSizing: "border-box" as const,
              background: selectMode && on ? MOBILE_COLORS.goldBg : MOBILE_COLORS.card,
              border: `1px solid ${selectMode && on ? MOBILE_COLORS.goldBorder : MOBILE_COLORS.border}`,
              borderRadius: 15,
              padding: "12px 16px 12px 13px",
              gap: 10,
              minHeight: 44,
              animationDelay: `${Math.min(i, 10) * 35}ms`,
            };
            return selectMode ? (
              <button key={l.id} type="button" onClick={() => toggleSel(l.id)}
                className="m-rise m-press relative flex w-full items-center overflow-hidden text-start" style={style}>
                {inner}
              </button>
            ) : (
              <Link key={l.id} href={`/m/leads/${l.id}`}
                className="m-rise m-press m-leadcard relative flex items-center overflow-hidden text-right" style={style}>
                {inner}
              </Link>
            );
          })}

          {shown < rows.length && (
            <div ref={sentinel} className="flex flex-col" style={{ gap: 9 }} aria-hidden>
              <div style={{ height: 66, borderRadius: 15, background: MOBILE_COLORS.card }} className="animate-pulse" />
              <div style={{ height: 66, borderRadius: 15, background: MOBILE_COLORS.card, opacity: 0.6 }} className="animate-pulse" />
            </div>
          )}
        </div>
      )}

      {/* ===== ٢-أ) الترويسة تتحوّل في وضع التحديد ===== */}
      {selectMode && (
        <MobilePortal>
        <div
          className="fixed inset-x-0 top-0 z-[45]"
          style={{
            boxSizing: "border-box",
            paddingTop: "env(safe-area-inset-top)",
            background: MOBILE_COLORS.sheet,
            borderBottom: `1px solid ${MOBILE_COLORS.border}`,
          }}
        >
          <div className="mx-auto flex w-full max-w-lg items-center justify-between" style={{ padding: "0 8px", minHeight: 56 }}>
            <button
              type="button"
              onClick={() => { setSelectMode(false); setSel(new Set()); }}
              className="m-press flex items-center"
              style={{ boxSizing: "border-box", gap: 5, minHeight: 44, padding: "0 10px", border: "none", background: "none", color: MOBILE_COLORS.textSecondary, fontSize: 13, fontWeight: 600 }}
            >
              <X size={16} aria-hidden /> إلغاء
            </button>
            <span style={{ fontSize: "14.5px", fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>
              حُدّد {toArabicDigits(sel.size)}
            </span>
            <button
              type="button"
              onClick={() => setSel(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
              className="m-press"
              style={{ boxSizing: "border-box", minHeight: 44, padding: "0 10px", border: "none", background: "none", color: MOBILE_COLORS.gold, fontSize: 13, fontWeight: 600 }}
            >
              {allSelected ? "إلغاء الكل" : "تحديد الكل"}
            </button>
          </div>
        </div>
        </MobilePortal>
      )}

      {/* ===== ٢) شريط الإجراءات — ينزلق من الأسفل ===== */}
      {sel.size > 0 && (
        <MobileActionBar count={sel.size}>
            {isManager && (
              <BarBtn icon={Share2} label={`تحويل (${toArabicDigits(sel.size)})`} tone="gold" disabled={pending}
                onClick={() => { setShowTransfer(true); setTrMode("full"); setTrTo(""); }} />
            )}
            {hiddenTab ? (
              <BarBtn icon={ArchiveRestore} label={`إرجاع (${toArabicDigits(sel.size)})`} tone="gold" disabled={pending}
                onClick={() => { setShowUnarchive(true); setUnMode("asis"); }} />
            ) : (
              <BarBtn icon={Archive} label={`أرشفة (${toArabicDigits(sel.size)})`} tone="plain" disabled={pending}
                onClick={() => run(() => bulkArchive([...sel]), "أُرشفوا")} />
            )}
            {isManager && (
              <BarBtn icon={ArchiveRestore} label={`استرداد (${toArabicDigits(sel.size)})`} tone="plain" disabled={pending}
                onClick={() => run(() => recoverLeads([...sel]), "استُردّوا للنظام")} />
            )}
            {isManager && (
              <BarBtn icon={Trash2} label={`حذف (${toArabicDigits(sel.size)})`} tone="danger" disabled={pending}
                onClick={() => {
                  if (confirm(`متأكد تبي تحذف ${toArabicDigits(sel.size)} عميل نهائيًا؟ ما يمكن التراجع.`))
                    run(() => bulkDelete([...sel]), "حُذفوا");
                }} />
            )}
        </MobileActionBar>
      )}

      {/* ===== ٢) ورقة التحويل — خطوتان في شاشة واحدة ===== */}
      <BottomSheet
        open={showTransfer}
        onClose={() => setShowTransfer(false)}
        title={`تحويل ${toArabicDigits(sel.size)} عميل`}
        subtitle="اختر الموظف ثم طريقة النقل"
        tall
        footer={
        <button
            type="button"
            disabled={pending || (trMode !== "recover" && !trTo)}
            onClick={() => {
              const ids = [...sel];
              const mode = trMode;
              const to = trTo;
              setShowTransfer(false);
              run(
                () => (mode === "recover" ? recoverLeads(ids) : transferLeads(ids, to, mode)),
                mode === "recover" ? "استُردّوا للنظام" : "حُوّلوا",
              );
            }}
            className="m-press m-sweep w-full"
            style={{
              boxSizing: "border-box", marginTop: 20, height: 50, borderRadius: 12, border: "none",
              background: MOBILE_COLORS.gold, color: MOBILE_COLORS.bg, fontSize: 14, fontWeight: 700,
              opacity: pending || (trMode !== "recover" && !trTo) ? 0.5 : 1,
            }}
          >
            {pending
              ? "جارٍ…"
              : trMode === "recover"
                ? `استرد ${toArabicDigits(sel.size)} عملاء للنظام`
                : `حوّل ${toArabicDigits(sel.size)} عملاء${trTarget ? ` لـ${trTarget.name}` : ""}`}
          </button>
        }
      >
        {trMode !== "recover" && (
          <section style={{ marginTop: 18 }}>
            <h3 style={{ fontSize: "12.5px", fontWeight: 700, color: MOBILE_COLORS.textMuted, marginBottom: 10 }}>
              ١) الموظف المستلم
            </h3>
            <div className="m-noscroll flex overflow-x-auto" style={{ gap: 12, paddingBottom: 2 }}>
              {employees.map((e) => {
                const on = trTo === e.id;
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => setTrTo(on ? "" : e.id)}
                    className="m-press flex flex-none flex-col items-center"
                    style={{ gap: 6, border: "none", background: "none", padding: 0, opacity: trTo && !on ? 0.45 : 1 }}
                  >
                    <span
                      className="flex items-center justify-center"
                      style={{
                        boxSizing: "border-box", width: 44, height: 44, borderRadius: 22,
                        background: on ? MOBILE_COLORS.gold : avatarColor(e.id),
                        color: on ? MOBILE_COLORS.bg : "#FFFFFF", fontSize: 13, fontWeight: 700,
                        border: `2px solid ${on ? MOBILE_COLORS.goldLight : "transparent"}`,
                        transition: "background .2s, border-color .2s",
                      }}
                      aria-hidden
                    >
                      {avatarInitials(e.name)}
                    </span>
                    {/* الاسم الكامل لا الأول — قد يتشابه أول اسمين في الفريق. */}
                    <span className="whitespace-nowrap text-center" style={{ fontSize: 10.5, color: on ? MOBILE_COLORS.gold : MOBILE_COLORS.textSecondary, fontWeight: on ? 700 : 500 }}>
                      {e.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <section style={{ marginTop: 18 }}>
          <h3 style={{ fontSize: "12.5px", fontWeight: 700, color: MOBILE_COLORS.textMuted, marginBottom: 10 }}>
            {trMode !== "recover" ? "٢) طريقة النقل" : "طريقة النقل"}
          </h3>
          <div className="flex flex-col" style={{ gap: 8 }}>
            {TRANSFER_OPTIONS.map((o) => (
              <button key={o.value} type="button" onClick={() => setTrMode(o.value)} className="m-press text-start"
                style={{
                  boxSizing: "border-box", borderRadius: 12, padding: "11px 13px",
                  ...(trMode === o.value
                    ? { background: MOBILE_COLORS.goldBg, border: `1px solid ${MOBILE_COLORS.goldBorder}` }
                    : { background: MOBILE_COLORS.bg, border: `1px solid ${MOBILE_COLORS.border}` }),
                }}>
                <span className="block" style={{ fontSize: 13, fontWeight: 700, color: trMode === o.value ? MOBILE_COLORS.gold : MOBILE_COLORS.textPrimary }}>{o.label}</span>
                <span className="block" style={{ fontSize: 11, color: MOBILE_COLORS.textMuted, marginTop: 4, lineHeight: 1.7 }}>{o.desc}</span>
              </button>
            ))}
          </div>
        </section>

      </BottomSheet>

      {/* ===== ورقة الإرجاع من الأرشيف — الأنماط الثلاثة نفسها ===== */}
      <BottomSheet
        open={showUnarchive}
        onClose={() => setShowUnarchive(false)}
        title={`إرجاع ${toArabicDigits(sel.size)} عميل من الأرشيف`}
        footer={
        <button
            type="button"
            disabled={pending}
            onClick={() => {
              const ids = [...sel];
              const mode = unMode;
              setShowUnarchive(false);
              run(() => unarchiveLeads(ids, mode), "رجعوا من الأرشيف");
            }}
            className="m-press m-sweep w-full"
            style={{
              boxSizing: "border-box", marginTop: 18, height: 50, borderRadius: 12, border: "none",
              background: MOBILE_COLORS.gold, color: MOBILE_COLORS.bg, fontSize: 14, fontWeight: 700,
              opacity: pending ? 0.5 : 1,
            }}
          >
            {pending ? "جارٍ…" : `أرجع ${toArabicDigits(sel.size)} عملاء`}
          </button>
        }
      >
        <div className="flex flex-col" style={{ gap: 8, marginTop: 14 }}>
          {UNARCHIVE_OPTIONS.map((o) => (
            <button key={o.value} type="button" onClick={() => setUnMode(o.value)} className="m-press text-start"
              style={{
                boxSizing: "border-box", borderRadius: 12, padding: "11px 13px",
                ...(unMode === o.value
                  ? { background: MOBILE_COLORS.goldBg, border: `1px solid ${MOBILE_COLORS.goldBorder}` }
                  : { background: MOBILE_COLORS.bg, border: `1px solid ${MOBILE_COLORS.border}` }),
              }}>
              <span className="block" style={{ fontSize: 13, fontWeight: 700, color: unMode === o.value ? MOBILE_COLORS.gold : MOBILE_COLORS.textPrimary }}>{o.label}</span>
              <span className="block" style={{ fontSize: 11, color: MOBILE_COLORS.textMuted, marginTop: 4, lineHeight: 1.7 }}>{o.desc}</span>
            </button>
          ))}
        </div>
      </BottomSheet>
    </>
  );
}

function BarBtn({ icon: Icon, label, tone, disabled, onClick }: {
  icon: typeof Share2;
  label: React.ReactNode;
  tone: "gold" | "plain" | "danger";
  disabled: boolean;
  onClick: () => void;
}) {
  const style =
    tone === "gold" ? { background: MOBILE_COLORS.goldBg, color: MOBILE_COLORS.gold, border: `1px solid ${MOBILE_COLORS.goldBorder}` }
      : tone === "danger" ? { background: MOBILE_STATUS.danger.bg, color: MOBILE_STATUS.danger.fg, border: `1px solid ${MOBILE_STATUS.danger.border}` }
        : { background: MOBILE_COLORS.card, color: MOBILE_COLORS.textPrimary, border: `1px solid ${MOBILE_COLORS.border}` };
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      className="m-press flex flex-none items-center whitespace-nowrap"
      style={{ boxSizing: "border-box", gap: 6, minHeight: 40, padding: "0 12px", borderRadius: 11, fontSize: 12, fontWeight: 600, opacity: disabled ? 0.6 : 1, ...style }}>
      <Icon size={14} aria-hidden /> {label}
    </button>
  );
}

export default MobileLeadsList;
