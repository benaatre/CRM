"use client";

import { useState } from "react";
import Link from "next/link";
import { Phone, MessageCircle, ClipboardCheck, MoreHorizontal } from "lucide-react";
import type { LeadRow } from "@/lib/data/leads";
import { purchaseMethodLabels, purchaseGoalLabels, stageLabels } from "@/lib/labels";
import { formatDate, toArabicDigits, daysAgoLabel } from "@/lib/format";
import { STAGE_HEX } from "@/lib/stage-colors";
import { WAITING_TONE } from "@/lib/stage-colors";
import { avatarInitials } from "@/lib/mobile-avatar";
import { waPhone } from "@/lib/value-normalize";
import { Clip } from "@/components/ui/clip";
import { TransferStar, TransferBadge } from "./transfer-star";
import { PullCountdown, SweepCountdown } from "./pull-countdown";

type Tab = "working" | "archived" | "hidden" | "unassigned";

/** الأرقام والتواريخ: Zain + خانات جدولية — لا تهتزّ الأعمدة بين صف وصف. */
const NUM: React.CSSProperties = { fontFamily: "var(--font-zain), var(--font-sans)", fontVariantNumeric: "tabular-nums" };

/** شارة صغيرة موحّدة (تلقائي · مسوّق · في الانتظار · راكد) — بلا حد ثقيل. */
function Tag({ tone, title, children }: { tone: string; title?: string; children: React.ReactNode }) {
  return <span className={`cell-keep rounded-md px-1.5 py-px text-[12.5px] font-semibold ${tone}`} title={title}>{children}</span>;
}

/** زر فعل دائري: أيقونة خطية ١.٦ بلا إطار — اللون دلالي (اتصال أزرق · واتساب أخضر). */
const ACTION_BTN = "grid size-[34px] place-items-center rounded-xl bg-[var(--elev)] transition-colors hover:bg-[var(--elev-hover)]";

/**
 * جدول العملاء (سطح المكتب ≥md) — التصميم المعتمد ٢٠٢٦.
 *
 * الدور يصل من الخادم (`isManager` من requireUser في الصفحة): عمودا «الموظف»
 * و«خيارات» لا يُبنيان أصلًا للموظف — ولا تُمرَّر له قائمة الموظفين من الخادم.
 * الأعمدة الوصفية (الاستلام · الشراء · المرحلة · أول تواصل · الموظف) بلا عرض
 * معلن فتتقاسم الفائض بالتساوي (table-layout: fixed) — لا فراغ ميت؛ والاسم
 * والجوال وأزرار التواصل بعرض ثابت لا ينكمش.
 */
export function LeadsTable({
  pageRows, startIndex, loading, isManager, tab, sel, allSelected, someSelected,
  onToggle, onToggleAll, onFollowUp, onTransfer,
}: {
  pageRows: LeadRow[];
  /** رقم أول صف في الصفحة (للعمود #). */
  startIndex: number;
  loading: boolean;
  isManager: boolean;
  tab: Tab;
  sel: Set<string>;
  allSelected: boolean;
  someSelected: boolean;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onFollowUp: (l: LeadRow) => void;
  onTransfer: (ids: string[]) => void;
}) {
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const cols = 11 + (isManager ? 2 : 0);

  return (
    <>
      <div className="hidden scroll-x rounded-2xl bg-card md:block">
        <table className={`crm-table text-sm ${isManager ? "min-w-[1225px]" : "min-w-[1010px]"}`}>
          <thead className="text-[12.5px] text-muted-foreground/70">
            <tr className="border-b border-[var(--hairline)]">
              <th className="w-[2.75rem] px-3 py-2.5">
                <input
                  type="checkbox" checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected; }}
                  onChange={onToggleAll} aria-label="تحديد الكل" title="تحديد / إلغاء تحديد الكل"
                  className="size-4 accent-[var(--gold)]"
                />
              </th>
              <th className="w-[2.5rem] px-2 py-2.5 font-medium">#</th>
              <th className="w-[14.5rem] px-3 py-2.5 font-medium">الاسم</th>
              <th className="w-[8rem] px-3 py-2.5 font-medium">الجوال</th>
              <th className="px-3 py-2.5 font-medium">الاستلام</th>
              <th className="px-3 py-2.5 font-medium">الشراء والهدف</th>
              <th className="px-3 py-2.5 font-medium">المرحلة</th>
              <th className="w-[4.5rem] px-2 py-2.5 font-medium">المتابعات</th>
              <th className="px-3 py-2.5 font-medium">أول تواصل</th>
              {isManager && <th className="px-3 py-2.5 font-medium">{tab === "hidden" ? "آخر موظف" : "الموظف"}</th>}
              <th className="w-[8.5rem] px-3 py-2.5 font-medium">تواصل</th>
              {isManager && <th className="w-[3.5rem] px-2 py-2.5 font-medium">خيارات</th>}
              <th className="w-[4.25rem] px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--hairline)]">
            {pageRows.length === 0 ? (
              <tr><td colSpan={cols} className="px-4 py-12 text-center text-muted-foreground">{loading ? "جارٍ التحميل…" : "ما فيه عملاء."}</td></tr>
            ) : (
              pageRows.map((l, i) => {
                const picked = sel.has(l.id);
                return (
                  <tr key={l.id} className={`transition-colors ${picked ? "bg-gold/[0.06]" : "hover:bg-[var(--elev)]"}`}>
                    <td className="cell-keep px-3 py-2.5">
                      <input type="checkbox" checked={picked} onChange={() => onToggle(l.id)} aria-label={`تحديد ${l.name}`} className="size-4 accent-[var(--gold)]" />
                    </td>
                    <td className="cell-keep px-2 py-2.5 text-[12.5px] text-muted-foreground/60" style={NUM}>{toArabicDigits(startIndex + i + 1)}</td>

                    {/* الاسم: صورة رمزية حية (حرف/حرفان بلون المرحلة) + الاسم + شاراته */}
                    <td className="px-3 py-2.5">
                      <span className="flex items-center gap-2.5">
                        <span
                          aria-hidden
                          className="grid size-[34px] flex-none place-items-center rounded-full text-[13px] font-bold"
                          style={{ background: STAGE_HEX[l.stage], color: "#0F0F11" }}
                        >
                          {avatarInitials(l.name)}
                        </span>
                        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
                          <span className="min-w-0 max-w-full truncate text-[16.5px] font-semibold text-foreground" title={l.name}>{l.name}</span>
                          <TransferStar show={l.isTransferred} exhausted={l.transferredExhausted} />
                          <TransferBadge show={l.manualTransferred} />
                          <SweepCountdown info={l.sweepPull} manager={isManager} />
                          {!isManager && !l.sweepPull && <PullCountdown pull={l.pull} />}
                          {l.inAutoPool && <Tag tone="bg-gold/10 text-gold" title="داخل بركة التوزيع التلقائي">تلقائي</Tag>}
                          {l.marketer && <Tag tone="bg-destructive/12 text-destructive">مسوّق</Tag>}
                          {l.waiting && (
                            <Tag tone={WAITING_TONE.chip} title="آخر متابعة: في الانتظار">
                              في الانتظار{l.waitingCount > 1 ? ` ×${toArabicDigits(l.waitingCount)}` : ""}
                            </Tag>
                          )}
                        </span>
                      </span>
                    </td>

                    {/* الجوال — خانته الخاصة بأرقام جدولية (لا لون ذهبي: الذهبي للفعّال وحده) */}
                    <td className="cell-keep px-3 py-2.5 text-[13.5px] text-foreground/90" dir="ltr" style={NUM}>{l.phone}</td>

                    {/* الاستلام: لحظة استلام الموظف + سطر خافت (المدير يرى تاريخ الإضافة، والموظف «منذ كذا») */}
                    <td className="px-3 py-2.5">
                      <span className="block truncate text-[13px] text-muted-foreground" style={NUM}>
                        {l.assignedAt ? formatDate(l.assignedAt) : "—"}
                      </span>
                      <span className="block truncate text-[12.5px] text-muted-foreground/60">
                        {isManager
                          ? (l.createdAt ? `أُضيف ${formatDate(l.createdAt)}` : "")
                          : daysAgoLabel(l.daysWaiting)}
                      </span>
                    </td>

                    {/* الشراء + الهدف في عمود واحد (سطران) */}
                    <td className="px-3 py-2.5">
                      <Clip title={l.purchaseMethod ? purchaseMethodLabels[l.purchaseMethod] : undefined}>
                        <span className="text-[13px] text-muted-foreground">{l.purchaseMethod ? purchaseMethodLabels[l.purchaseMethod] : "—"}</span>
                      </Clip>
                      <Clip title={l.purchaseGoal ? purchaseGoalLabels[l.purchaseGoal] : undefined}>
                        <span className="text-[12.5px] text-muted-foreground/60">{l.purchaseGoal ? purchaseGoalLabels[l.purchaseGoal] : "—"}</span>
                      </Clip>
                    </td>

                    {/* المرحلة: نقطة + نص (بلا شارة محاطة) */}
                    <td className="px-3 py-2.5">
                      <span className="flex items-center gap-2">
                        <span aria-hidden className="size-2 flex-none rounded-full" style={{ background: STAGE_HEX[l.stage] }} />
                        <span className="min-w-0 truncate text-[13px] text-foreground/90">{stageLabels[l.stage]}</span>
                        {l.stale && <Tag tone="bg-warning/12 text-warning" title="مهتم بلا متابعة من ٧ أيام">راكد</Tag>}
                      </span>
                    </td>

                    {/* المتابعات — رقم يفتح درج المتابعات */}
                    <td className="cell-keep px-2 py-2.5">
                      {l.followUpsCount > 0 ? (
                        <button
                          onClick={() => onFollowUp(l)}
                          title="عرض متابعات العميل"
                          className="rounded-lg px-2 py-1 text-[14px] font-bold text-foreground/90 transition-colors hover:bg-[var(--elev-hover)] hover:text-gold"
                          style={NUM}
                        >{toArabicDigits(l.followUpsCount)}</button>
                      ) : (
                        <span className="px-2 text-muted-foreground/50" style={NUM}>—</span>
                      )}
                    </td>

                    <td className="px-3 py-2.5 text-[13px] text-muted-foreground" style={NUM}>
                      <span className="block truncate">{l.firstContactDate ? formatDate(l.firstContactDate) : "—"}</span>
                    </td>

                    {/* الموظف — للمدير/المالك فقط */}
                    {isManager && (
                      <td className="px-3 py-2.5 text-[13px] text-muted-foreground">
                        <Clip title={l.assignedTo?.name ?? "غير موزّع"}>{l.assignedTo?.name ?? "غير موزّع"}</Clip>
                      </td>
                    )}

                    {/* التواصل: اتصال · واتساب · تسجيل متابعة (بلا مغادرة الصفحة) */}
                    <td className="cell-keep px-3 py-2.5">
                      <span className="flex items-center gap-1.5">
                        <a href={`tel:${l.phone}`} title="اتصال" aria-label={`اتصال بـ${l.name}`} className={`${ACTION_BTN} text-info`}>
                          <Phone className="size-4" strokeWidth={1.6} />
                        </a>
                        <a
                          href={`https://wa.me/${waPhone(l.phone)}`} target="_blank" rel="noopener noreferrer"
                          title="واتساب" aria-label={`واتساب لـ${l.name}`}
                          className={ACTION_BTN} style={{ color: "#25D366" }}
                        >
                          <MessageCircle className="size-4" strokeWidth={1.6} />
                        </a>
                        <button
                          onClick={() => onFollowUp(l)} title="تسجيل متابعة" aria-label={`تسجيل متابعة لـ${l.name}`}
                          className={`${ACTION_BTN} text-muted-foreground hover:text-foreground`}
                        >
                          <ClipboardCheck className="size-4" strokeWidth={1.6} />
                        </button>
                      </span>
                    </td>

                    {/* خيارات (تحويل / استرداد) — للمدير/المالك فقط */}
                    {isManager && (
                      <td className="cell-keep relative px-2 py-2.5">
                        <button
                          onClick={() => setMenuFor(menuFor === l.id ? null : l.id)}
                          title="خيارات" aria-label={`خيارات ${l.name}`}
                          className={`${ACTION_BTN} text-muted-foreground hover:text-foreground`}
                        >
                          <MoreHorizontal className="size-4" strokeWidth={1.6} />
                        </button>
                        {menuFor === l.id && (
                          <div className="absolute left-2 top-full z-20 mt-1 w-44 overflow-hidden rounded-xl bg-popover shadow-xl">
                            <button
                              onClick={() => { setMenuFor(null); onTransfer([l.id]); }}
                              className="block w-full px-3 py-2.5 text-right text-[13px] text-foreground transition-colors hover:bg-[var(--elev)]"
                            >تحويل / استرداد</button>
                          </div>
                        )}
                      </td>
                    )}

                    <td className="cell-keep px-3 py-2.5">
                      <Link
                        href={`/leads/${l.id}`} title="فتح الملف"
                        className="rounded-lg bg-[var(--elev)] px-3 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-[var(--elev-hover)] hover:text-foreground"
                      >فتح</Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* طبقة إغلاق قائمة «خيارات» بالنقر خارجها */}
      {menuFor && <div className="fixed inset-0 z-10" onClick={() => setMenuFor(null)} />}
    </>
  );
}
