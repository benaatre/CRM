"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { LeadStage, Channel, FollowUpResult, FollowUpType, PurchaseGoal, PurchaseMethod, ActivityType } from "@prisma/client";
import {
  Phone, MessageCircle, MessageSquarePlus, Settings2, ChevronRight, ChevronLeft, FileText, ClipboardList,
  ArrowLeftRight, CalendarDays, Clock, Check, Pencil, Inbox, Save, Heart, PhoneOff, Ban, MapPin, Lock,
  Archive, Undo2, Target, BadgeCheck,
} from "lucide-react";
import { STAGE_HEX, stageChipClass } from "@/lib/stage-colors";
import {
  stageLabel, stageOrder, activityTypeLabels, followUpResultLabels,
  purchaseGoalLabels, purchaseMethodOptions, purchaseMethodLabels, reasonLabel, channelLabel,
} from "@/lib/labels";
import { formatNumberShort } from "@/lib/format";
import { actionBtn, BTN_ICON, ACTION_BTN_CLASS } from "@/components/mobile/action-buttons";
import { transferLeads, recoverLeads, updateLeadStage, bulkArchive } from "@/lib/actions/leads";
import { addBookingPayment } from "@/lib/actions/bookings";
import { BottomSheet } from "@/components/mobile/bottom-sheet";
import { MOBILE_COLORS, SOP } from "@/lib/mobile-tokens";
import { toArabicDigits, elapsedLabel } from "@/lib/mobile-format";
import { avatarInitials } from "@/lib/mobile-avatar";

import { markCall } from "@/lib/mobile-call-tracker";
import { updateLeadIntake } from "@/lib/actions/leads";
import { fetchSources } from "@/lib/actions/sources";
import type { SourceListItem } from "@/lib/data/sources";
import { NI_REASONS, buildNotInterestedBody } from "@/components/leads/not-interested-dialog";
import { buildBody, buildFirstContactBody, type SaveBody } from "@/lib/mobile-followup";
import { DistrictSelect } from "@/components/leads/district-select";
import { FollowupSheet } from "@/components/mobile/followup-sheet";
import { WaSheet } from "@/components/mobile/wa-sheet";
import { EditFollowupSheet, editMinutesLeft } from "@/components/mobile/edit-followup-sheet";

/**
 * ملف العميل v3 — نسخة الموظف (المرحلة د): hero + تبويبا «بيانات» و«المتابعة والزيارات»
 * + تدفق أول التواصل الإلزامي + الخط الزمني المعرّب بفلترة خصوصية الموظف + شريط سفلي ثابت.
 * عرض وتغليف خالص: الحفظ عبر updateLeadDetails وPOST/PATCH المتابعات القائمة حرفيًا.
 */



export type ProfileFu = { id: string; result: FollowUpResult; note: string | null; nextDate: Date | null; createdAt: Date; userName: string | null };
export type ProfileAct = { id: string; type: ActivityType; note: string | null; createdAt: Date; userName: string | null };

/** إضافات نسخة المالك (المرحلة هـ) — غيابها = نسخة الموظف كما هي. */
export type OwnerExtras = {
  assignedToName: string | null;
  /** طريقة آخر إسناد معرّبة + «قبل X» — من سجل التحويلات. */
  assignMethodLabel: string | null;
  assignedAgo: string | null;
  followupsWithCurrent: number;
  employees: { id: string; name: string }[];
  /** سجل التحويلات (مالك فقط — null للأدمن فيختفي التبويب). */
  transfers: { id: string; fromName: string | null; toName: string | null; reason: string; createdAt: Date }[] | null;
  /** كل المتابعات بنصّها وكاتبها (من نفس السجل) — لأقسام «متابعات كل موظف». */
  allFollowUps: { id: string; result: FollowUpResult; type: FollowUpType; note: string | null; authorName: string | null; createdAt: Date }[] | null;
  /** الحجز النشط — بطاقة التحصيل وزر «+ دفعة» (OWNER فقط بالواجهة). */
  booking: { id: string; unit: string; collected: number; remaining: number } | null;
  canAddPayment: boolean;
  channelText: string;
};

export type ProfileData = {
  id: string;
  name: string;
  phone: string;
  stage: LeadStage;
  channel: Channel;
  assignedAt: Date | null;
  lastContact: Date | null;
  nextFollowup: Date | null;
  visitAt: Date | null;
  followUpsCount: number;
  firstContact: boolean;
  purchaseGoal: PurchaseGoal | null;
  purchaseMethod: PurchaseMethod | null;
  priceMin: number | null;
  priceMax: number | null;
  sourceId: string | null;
  preferredAreas: string[];
  preferredProjects: string[];
  followUps: ProfileFu[];
  activities: ProfileAct[];
};

function fmtDT(d: Date): string {
  // calendar صريح: ar-SA بلا gregory يطلع هجريًا في ICU.
  return new Intl.DateTimeFormat("ar-SA-u-nu-arab", { calendar: "gregory", timeZone: "Asia/Riyadh", dateStyle: "medium", timeStyle: "short" }).format(d);
}

/** لون نقطة المتابعة — نفس تصنيف الخط الزمني v2 (بألوان SOP). */
function fuTone(result: FollowUpResult): string {
  if (result.startsWith("NOT_INTERESTED")) return SOP.red;
  if (result.startsWith("NOT_ANSWERED") || result === "NO_ANSWER_INTERESTED" || result === "CALL_LATER") return SOP.blue;
  if (result === "ON_HOLD" || result === "BANK_CHECK" || result === "NEGOTIATING" || result === "VISIT_NO_SHOW_RESCHEDULED") return SOP.amber;
  return SOP.green;
}

const ZAIN = { fontFamily: "var(--font-zain), var(--font-sans)", fontVariantNumeric: "tabular-nums" as const };
/** سطح بارز ناعم (.m-raise سطريًا — الملف كله style سطري). */
const box = {
  boxSizing: "border-box" as const,
  background: SOP.plane,
  border: `1px solid ${SOP.edge}`,
  borderRadius: 16,
  boxShadow: `4px 4px 10px ${SOP.sd}, -3px -3px 8px ${SOP.sl}`,
};
/** سطح غائر (حقول/ملاحظات). */
const insetBox = {
  boxSizing: "border-box" as const,
  background: SOP.page,
  border: `1px solid ${SOP.edge}`,
  boxShadow: `inset 3px 3px 8px ${SOP.sd}, inset -3px -3px 8px ${SOP.sl}`,
};
const fieldStyle = {
  ...insetBox,
  width: "100%", minHeight: 44,
  borderRadius: 11, padding: "0 12px", fontSize: 13, color: SOP.tx, outline: "none",
};
const chip = (on: boolean, base: string = SOP.gold, bg: string = `color-mix(in srgb, ${SOP.gold} 14%, transparent)`, bd: string = SOP.gold) => ({
  boxSizing: "border-box" as const, minHeight: 40, padding: "0 13px", borderRadius: 11,
  fontSize: "12.5px", fontWeight: 600 as const,
  ...(on ? { background: bg, color: base, border: `1px solid ${bd}` } : { background: SOP.plane, color: SOP.tx2, border: `1px solid ${SOP.edge}` }),
});
/** الأزرار الذهبية الأساسية (حفظ/تأكيد) — تدرّج ذهبي موحّد. */
const goldBtn = {
  boxSizing: "border-box" as const, border: "none",
  background: `linear-gradient(135deg, ${SOP.gold2}, ${SOP.gold})`, color: SOP.onGold,
};

export function LeadProfileV3({
  lead, projects, falLicense, meName, autoOpenFollowup = false, ownerExtras = null,
}: {
  lead: ProfileData;
  projects: { id: string; name: string }[];
  falLicense: string | null;
  /** اسم المرسل الأول لقوالب واتساب (WaSheet القائمة). */
  meName: string;
  /** فتح ورقة المتابعة تلقائيًا (عودة من مكالمة عبر جسر Capacitor — ?log=call). */
  autoOpenFollowup?: boolean;
  /** إضافات المالك/الأدمن — غيابها = نسخة الموظف (المرحلة د) حرفيًا. */
  ownerExtras?: OwnerExtras | null;
}) {
  const [tab, setTab] = useState<"data" | "fu" | "transfers" | "deal">("fu");
  const [fuOpen, setFuOpen] = useState<null | { key: string | null }>(null);
  const [waOpen, setWaOpen] = useState(false);
  const [editFu, setEditFu] = useState<ProfileFu | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const nowMs = Date.now();
  const owner = !!ownerExtras;

  // عودة من مكالمة (جسر Capacitor) — نفس سلوك الملف السابق حرفيًا.
  useEffect(() => {
    if (autoOpenFollowup) setFuOpen({ key: null });
  }, [autoOpenFollowup]);

  const heroLine = lead.firstContact
    ? "استلمته اليوم · ينتظر أول تواصل"
    : `عميلك من ${lead.assignedAt ? elapsedLabel(lead.assignedAt, new Date(nowMs)) : "—"} · ${lead.lastContact ? `آخر تواصل قبل ${elapsedLabel(lead.lastContact, new Date(nowMs))}` : "لا تواصل مسجّل"}`;

  // الخط الزمني المدمج (متابعات + أنشطة) — فلترة خصوصية الموظف:
  // أحداث الإسناد تُعرض بنص عام موحّد بلا تفاصيل إدارية (توزيع/سحب/من كان معه).
  const timeline = useMemo(() => {
    return [
      ...lead.followUps.map((f) => ({ kind: "fu" as const, at: f.createdAt, f })),
      ...lead.activities.map((a) => ({ kind: "act" as const, at: a.createdAt, a })),
    ].sort((x, y) => y.at.getTime() - x.at.getTime());
  }, [lead.followUps, lead.activities]);

  return (
    <div className="m-screen flex flex-col" style={{ gap: 14, paddingBottom: 8 }}>
      {/* ===== الترويسة: رجوع + ⚙️ إدارة العميل (للمالك/الأدمن) ===== */}
      <div className="flex items-center justify-between">
        <Link href="/m/leads" className="m-press-sc flex items-center" style={{ minHeight: 40, gap: 4, color: SOP.tx2, fontSize: 13, fontWeight: 600 }}>
          <ChevronRight size={18} strokeWidth={2} aria-hidden /> رجوع
        </Link>
        {owner && (
          <button type="button" aria-label="إدارة العميل" onClick={() => setAdminOpen(true)}
            className="m-raise m-press-sc flex items-center justify-center"
            style={{ boxSizing: "border-box", width: 40, height: 40, borderRadius: 12, color: SOP.tx2 }}>
            <Settings2 size={18} strokeWidth={1.9} aria-hidden />
          </button>
        )}
      </div>

      {/* ===== بطاقة الهوية العائمة — خط علوي بلون المرحلة (STAGE_HEX) ===== */}
      <div className="m-rise relative overflow-hidden" style={{ ...box, borderRadius: 20, padding: "16px 15px 14px" }}>
        <span aria-hidden style={{ position: "absolute", top: 0, insetInline: 14, height: 3, borderRadius: "0 0 3px 3px", background: STAGE_HEX[lead.stage], boxShadow: `0 0 14px ${STAGE_HEX[lead.stage]}` }} />
        <div className="flex items-center" style={{ gap: 12 }}>
          <span
            className="flex flex-none items-center justify-center"
            style={{ boxSizing: "border-box", width: 56, height: 56, borderRadius: 16, fontSize: 18, fontWeight: 800, background: `linear-gradient(135deg, ${SOP.gold2}, ${SOP.gold})`, color: SOP.onGold, boxShadow: `3px 3px 8px ${SOP.sd}` }}
            aria-hidden
          >
            {avatarInitials(lead.name)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate" style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.01em", color: SOP.tx }}>{lead.name}</div>
            <div dir="ltr" className="truncate text-right" style={{ ...ZAIN, fontSize: 13, color: SOP.mut, marginTop: 3 }}>{lead.phone}</div>
          </div>
        </div>
        {/* الشارات: المرحلة · عدّاد المتابعات · سطر الاستلام/التواصل (يسارًا) */}
        <div className="flex flex-wrap items-center" style={{ gap: 6, marginTop: 11 }}>
          <span className={`flex-none whitespace-nowrap border font-semibold ${stageChipClass[lead.stage]}`} style={{ fontSize: "10.5px", padding: "4px 9px", borderRadius: 7 }}>
            {stageLabel(lead.stage)}
          </span>
          {lead.followUpsCount > 0 && (
            <span className="flex-none whitespace-nowrap" style={{ ...ZAIN, boxSizing: "border-box", fontSize: 10.5, fontWeight: 700, padding: "4px 9px", borderRadius: 7, background: `color-mix(in srgb, ${SOP.gold} 14%, transparent)`, color: SOP.gold }}>
              {toArabicDigits(lead.followUpsCount)} {lead.followUpsCount === 1 ? "متابعة" : lead.followUpsCount === 2 ? "متابعتان" : "متابعات"}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-left" style={{ fontSize: 11, color: SOP.tx2 }}>{heroLine}</span>
        </div>

        {/* شريحة الموظف المسؤول — للمالك/الأدمن */}
        {owner && ownerExtras && (
          <div className="flex items-center" style={{ ...insetBox, gap: 9, marginTop: 12, borderRadius: 12, padding: "9px 11px" }}>
            <span className="flex flex-none items-center justify-center" style={{ width: 32, height: 32, borderRadius: 10, fontSize: 12, fontWeight: 700, background: `color-mix(in srgb, ${SOP.gold} 14%, transparent)`, color: SOP.gold }}>
              {ownerExtras.assignedToName ? avatarInitials(ownerExtras.assignedToName) : "؟"}
            </span>
            <div className="min-w-0 flex-1">
              <div style={{ fontSize: 12.5, fontWeight: 700, color: SOP.tx }}>
                مع: {ownerExtras.assignedToName ?? "غير موزّع"}
              </div>
              <div className="truncate" style={{ fontSize: 10.5, color: SOP.mut, marginTop: 2 }}>
                {[ownerExtras.assignMethodLabel, ownerExtras.assignedAgo ? `قبل ${ownerExtras.assignedAgo}` : null, `${toArabicDigits(ownerExtras.followupsWithCurrent)} متابعات`]
                  .filter(Boolean).join(" · ")}
              </div>
            </div>
            <button type="button" onClick={() => setAdminOpen(true)} className="m-press-sc flex flex-none items-center"
              style={{ boxSizing: "border-box", gap: 5, borderRadius: 9, padding: "6px 11px", fontSize: 11.5, fontWeight: 700, background: `color-mix(in srgb, ${SOP.gold} 14%, transparent)`, color: SOP.gold, border: `1px solid ${SOP.gold}` }}>
              <ArrowLeftRight size={13} strokeWidth={2.2} aria-hidden /> تحويل
            </button>
          </div>
        )}
      </div>

      {/* ===== صف الأزرار تحت البطاقة مباشرة — اتصال (أعرض) · واتساب · متابعة (action-buttons) ===== */}
      <div className="flex" style={{ gap: 8 }}>
        <a href={`tel:${lead.phone}`} onClick={() => markCall(lead.id)} className={ACTION_BTN_CLASS} style={{ ...actionBtn("gold"), height: 48, flex: 1.3 }}>
          <Phone {...BTN_ICON} aria-hidden /> اتصال
        </a>
        <button type="button" onClick={() => setWaOpen(true)} className={ACTION_BTN_CLASS} style={{ ...actionBtn("wa"), height: 48, flex: 1 }}>
          <MessageCircle {...BTN_ICON} aria-hidden /> واتساب
        </button>
        <button type="button" onClick={() => setFuOpen({ key: null })} className={ACTION_BTN_CLASS} style={{ ...actionBtn("file"), height: 48, flex: 1 }}>
          <MessageSquarePlus {...BTN_ICON} aria-hidden /> متابعة
        </button>
      </div>

      {/* ===== شريط «بيانات العميل» — الحقول المسجّلة فعليًا فقط؛ يُخفى كله إن كانت فارغة ===== */}
      <DataStrip lead={lead} />

      {/* بطاقة الحجز النشط + «+ دفعة» — للمالك (الخادم يحرس addBookingPayment أصلًا) */}
      {owner && ownerExtras?.booking && (
        <BookingCard booking={ownerExtras.booking} canAddPayment={ownerExtras.canAddPayment} />
      )}

      {/* ===== التبويبات (٣ للموظف/الأدمن · ٤ للمالك بسجل التحويلات — شبكة ٢×٢) + «✦ إتمام» أخيرًا ===== */}
      <div className="grid" style={{ gap: 8, gridTemplateColumns: owner && ownerExtras?.transfers ? "1fr 1fr" : "1fr 1fr 1fr" }}>
        <TabCard on={tab === "fu"} color={SOP.gold} label={`المتابعة (${toArabicDigits(lead.followUpsCount)})`} onClick={() => setTab("fu")} icon={<ClipboardList size={18} strokeWidth={2} aria-hidden />} />
        <TabCard on={tab === "data"} color={SOP.blue} label="بيانات" onClick={() => setTab("data")} icon={<FileText size={18} strokeWidth={2} aria-hidden />} />
        {owner && ownerExtras?.transfers && (
          <TabCard on={tab === "transfers"} color={SOP.purple} label="سجل التحويلات" onClick={() => setTab("transfers")} icon={<ArrowLeftRight size={18} strokeWidth={2} aria-hidden />} />
        )}
        {/* «إتمام» مميز بالذهبي حتى وهو غير مفعّل (قرار 2026-08-22) — يبقى بحد ذهبي رفيع. */}
        <TabCard on={tab === "deal"} color={SOP.green} label="إتمام" onClick={() => setTab("deal")} icon={<DealIcon size={18} />} goldEdge />
      </div>

      {tab === "data" ? (
        <DataTab lead={lead} projects={projects} />
      ) : tab === "transfers" && owner && ownerExtras?.transfers ? (
        <TransfersTab extras={ownerExtras} />
      ) : tab === "deal" ? (
        <DealTab falLicense={falLicense} onBooked={() => setFuOpen({ key: "booked" })} />
      ) : (
        <FuTab
          lead={lead}
          timeline={timeline}
          nowMs={nowMs}
          owner={owner}
          onNew={() => setFuOpen({ key: null })}
          onEdit={(f) => setEditFu(f)}
        />
      )}

      {/* الأوراق */}
      {fuOpen && (
        <FollowupSheet
          open
          onClose={() => setFuOpen(null)}
          leadId={lead.id}
          leadName={lead.name}
          phone={lead.phone}
          stage={lead.stage}
          firstContact={lead.firstContact}
          projects={projects}
          initialKey={fuOpen.key}
        />
      )}
      {editFu && (
        <EditFollowupSheet
          open
          onClose={() => setEditFu(null)}
          leadId={lead.id}
          followupId={editFu.id}
          initialNote={editFu.note}
          initialDate={editFu.nextDate}
          createdAt={editFu.createdAt}
        />
      )}
      {owner && ownerExtras && (
        <AdminSheet open={adminOpen} onClose={() => setAdminOpen(false)} lead={lead} extras={ownerExtras} />
      )}
      {/* قوالب واتساب القائمة — نفس ورقة الملف السابق */}
      <WaSheet
        open={waOpen}
        onClose={() => setWaOpen(false)}
        phone={lead.phone}
        leadName={lead.name}
        meName={meName}
        leadId={lead.id}
      />
    </div>
  );
}

/* ===================== التبويب ككرت مرفوع بأيقونة ملوّنة ===================== */

function TabCard({ on, color, label, icon, onClick, goldEdge = false }: {
  on: boolean; color: string; label: string; icon: React.ReactNode; onClick: () => void;
  /** حد ذهبي رفيع دائم (تبويب «إتمام»). */
  goldEdge?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`${on ? "" : "m-raise"} m-press-sc relative flex flex-col items-center justify-center overflow-hidden`}
      style={{
        boxSizing: "border-box", minHeight: 70, borderRadius: 14, padding: "9px 6px 10px", gap: 6,
        ...(on
          ? { background: `color-mix(in srgb, ${SOP.gold} 12%, ${SOP.plane})`, border: `1px solid ${SOP.gold}`, boxShadow: `inset 2px 2px 6px ${SOP.sd}` }
          : goldEdge ? { border: `1px solid color-mix(in srgb, ${SOP.gold} 45%, transparent)` } : {}),
      }}
    >
      {/* مربّع الأيقونة — ملوّن بلون التبويب، ويمتلئ بتدرّج ذهبي عند التفعيل. سقف SVG ≤ 22px. */}
      <span
        className="flex items-center justify-center"
        style={{
          boxSizing: "border-box", width: 34, height: 34, borderRadius: 10,
          ...(on
            ? { background: `linear-gradient(135deg, ${SOP.gold2}, ${SOP.gold})`, color: SOP.onGold, boxShadow: `0 4px 12px color-mix(in srgb, ${SOP.gold} 40%, transparent)` }
            : { background: `color-mix(in srgb, ${color} 14%, transparent)`, color }),
        }}
      >
        {icon}
      </span>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: on ? SOP.gold : SOP.tx2, lineHeight: 1.2 }}>{label}</span>
      {on && <span aria-hidden style={{ position: "absolute", bottom: 0, insetInline: 14, height: 2, borderRadius: "2px 2px 0 0", background: SOP.gold }} />}
    </button>
  );
}

/* ===================== شريط «بيانات العميل — كلّه على أساسها» ===================== */

/**
 * رقائق الحقول **المسجّلة فعليًا** من بيانات الـLead الحالية (purchaseMethod/purchaseGoal/الحي/
 * السعر/المشاريع/القناة). الفارغ لا يُعرض، وإن فرغت كلها يُخفى الشريط كله. لا حقول مخترعة.
 */
function DataStrip({ lead }: { lead: ProfileData }) {
  const price =
    lead.priceMin != null && lead.priceMax != null ? `${formatNumberShort(lead.priceMin)} – ${formatNumberShort(lead.priceMax)} ر.س`
      : lead.priceMin != null ? `من ${formatNumberShort(lead.priceMin)} ر.س`
        : lead.priceMax != null ? `حتى ${formatNumberShort(lead.priceMax)} ر.س`
          : null;
  const items: { key: string; label: string; value: string }[] = [
    ...(lead.purchaseMethod ? [{ key: "pm", label: "طريقة الشراء", value: purchaseMethodLabels[lead.purchaseMethod] }] : []),
    ...(lead.purchaseGoal ? [{ key: "goal", label: "الهدف", value: purchaseGoalLabels[lead.purchaseGoal] }] : []),
    ...(price ? [{ key: "price", label: "الميزانية", value: price }] : []),
    ...(lead.preferredAreas.length ? [{ key: "areas", label: "الحي", value: lead.preferredAreas.join("، ") }] : []),
    ...(lead.preferredProjects.length ? [{ key: "projects", label: "المشاريع", value: lead.preferredProjects.join("، ") }] : []),
    { key: "channel", label: "المصدر", value: channelLabel(lead.channel) },
  ];
  if (items.length === 0) return null;
  return (
    <div className="m-rise" style={{ ...box, padding: "11px 13px 12px" }}>
      <div className="flex items-center" style={{ gap: 6, fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", color: SOP.tx2 }}>
        <FileText size={13} strokeWidth={2} aria-hidden />
        بيانات العميل — كلّه على أساسها
      </div>
      <div className="m-noscroll flex overflow-x-auto" style={{ gap: 6, marginTop: 9 }}>
        {items.map((it) => (
          <span key={it.key} className="flex flex-none items-center whitespace-nowrap" style={{ ...insetBox, gap: 5, borderRadius: 9, padding: "5px 9px", fontSize: 11 }}>
            <span style={{ color: SOP.mut, fontWeight: 600 }}>{it.label}</span>
            <span style={{ color: SOP.tx, fontWeight: 700 }}>{it.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ===================== ✦ إتمام (قرار 2026-08-22 — بدل الشريط السفلي الثابت) ===================== */

/** أيقونة «✦ إتمام» — SVG (لا إيموجي) بلون النص الحالي. */
function DealIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true" style={{ flex: "none" }}>
      <path d="M12 3c.6 3.9 3.1 6.4 7 7-3.9.6-6.4 3.1-7 7-.6-3.9-3.1-6.4-7-7 3.9-.6 6.4-3.1 7-7Z" />
      <path d="M19 15c.2 1.5 1.1 2.4 2.5 2.6-1.4.2-2.3 1.1-2.5 2.6-.2-1.5-1.1-2.4-2.5-2.6 1.4-.2 2.3-1.1 2.5-2.6Z" />
    </svg>
  );
}

/**
 * تبويب «إتمام الصفقة»: الزران القديمان بسلوكهما الحالي حرفيًا (كلاهما يفتح ورقة
 * المتابعة على «تم الحجز» — الإرشاد لنموذج الويب الكامل) + سطر رخصة فال الذي كان بالشريط.
 */
function DealTab({ falLicense, onBooked }: { falLicense: string | null; onBooked: () => void }) {
  return (
    <div className="m-rise" style={{ ...box, padding: 16 }}>
      <div className="flex items-start" style={{ gap: 12 }}>
        <div className="flex flex-none items-center justify-center" style={{ width: 40, height: 40, borderRadius: 12, background: `linear-gradient(135deg, ${SOP.gold2}, ${SOP.gold})`, color: SOP.onGold, boxShadow: `3px 3px 8px ${SOP.sd}` }}>
          <DealIcon size={20} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: SOP.tx }}>إتمام الصفقة</div>
          <div style={{ fontSize: 12.5, color: SOP.tx2, lineHeight: 1.7, marginTop: 2 }}>
            سجّل حجز العميل أو شراءه الفوري — تسجيل الحجز الكامل (الوحدة والأسعار والدفعات) من نموذج الويب.
          </div>
        </div>
      </div>
      <div className="flex" style={{ gap: 8, marginTop: 16 }}>
        <button type="button" onClick={onBooked} className={`${ACTION_BTN_CLASS} flex-1`} style={{ ...actionBtn("gold"), fontSize: 13.5 }}>
          <BadgeCheck {...BTN_ICON} aria-hidden /> تم الحجز
        </button>
        <button type="button" onClick={onBooked} className={`${ACTION_BTN_CLASS} flex-1`} style={{ ...actionBtn("wa"), fontSize: 13.5, background: `linear-gradient(135deg, color-mix(in srgb, ${SOP.green} 85%, white), ${SOP.green})`, color: SOP.onGold }}>
          <Check {...BTN_ICON} aria-hidden /> شراء فوري
        </button>
      </div>
      {falLicense && (
        <div className="text-center" style={{ fontSize: 10, color: SOP.mut, marginTop: 12 }}>
          رخصة فال (REGA) <span dir="ltr" style={ZAIN}>{falLicense}</span>
        </div>
      )}
    </div>
  );
}

/* ===================== إضافات المالك (المرحلة هـ) ===================== */

/** بطاقة الحجز النشط: شريط التحصيل + «+ دفعة» عبر addBookingPayment القائم. */
function BookingCard({ booking, canAddPayment }: { booking: NonNullable<OwnerExtras["booking"]>; canAddPayment: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const total = booking.collected + booking.remaining;
  const pct = total > 0 ? Math.round((booking.collected / total) * 100) : 0;
  const done = booking.remaining <= 0;
  const amountNum = Number(amount.replace(/[^\d]/g, "")) || 0;
  // تحقق الواجهة يعكس حمايات الخادم (صفر/سالب مرفوض · تجاوز المتبقي يرفضه الخادم).
  const amountError = !amount ? null
    : amountNum <= 0 ? "المبلغ لازم يكون أكبر من صفر"
      : amountNum > booking.remaining ? "أكبر من المتبقي — الخادم يرفضه" : null;

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await addBookingPayment(booking.id, amountNum);
      if (!res.ok) { setError(res.error ?? "صار خطأ"); return; }
      setOpen(false); setAmount("");
      router.refresh();
    });
  }

  return (
    <div className="relative overflow-hidden" style={{ ...box, padding: 14, borderInlineStart: `3px solid ${done ? SOP.green : SOP.gold}` }}>
      <div className="flex items-center justify-between" style={{ gap: 8 }}>
        <span className="flex items-center" style={{ gap: 6, fontSize: 13.5, fontWeight: 800, color: SOP.tx }}>
          <FileText size={15} strokeWidth={2} style={{ color: SOP.gold }} aria-hidden />
          {booking.unit} {done && <span className="flex items-center" style={{ gap: 4, color: SOP.green }}>· جاهزة للتسليم <Check size={13} strokeWidth={2.5} aria-hidden /></span>}
        </span>
        {canAddPayment && !done && (
          <button type="button" onClick={() => setOpen(true)} className="m-press-sc flex-none"
            style={{ ...goldBtn, borderRadius: 9, padding: "6px 12px", fontSize: 11.5, fontWeight: 700 }}>
            + دفعة
          </button>
        )}
      </div>
      <div style={{ fontSize: 12, color: SOP.tx2, marginTop: 7 }}>
        محصّل <b style={{ ...ZAIN, color: done ? SOP.green : SOP.gold }}>{toArabicDigits(booking.collected)}</b> من <span style={ZAIN}>{toArabicDigits(total)}</span>
        {" · "}المتبقي <b style={{ ...ZAIN, color: SOP.tx }}>{toArabicDigits(booking.remaining)}</b>
      </div>
      <div className="overflow-hidden" style={{ ...insetBox, height: 8, borderRadius: 4, marginTop: 8 }}>
        <div className="m-fillx" style={{ height: "100%", borderRadius: 4, width: `${Math.max(pct, 3)}%`, background: done ? SOP.green : `linear-gradient(90deg, ${SOP.gold2}, ${SOP.gold})` }} />
      </div>

      <BottomSheet open={open} onClose={() => setOpen(false)} title="+ دفعة جديدة"
        subtitle={`المحصّل ${toArabicDigits(booking.collected)} · المتبقي ${toArabicDigits(booking.remaining)}`}
        footer={
          <button type="button" onClick={save} disabled={pending || !!amountError || amountNum <= 0}
            className="m-press-sc m-sweep w-full"
            style={{ ...goldBtn, height: 50, borderRadius: 13, fontSize: 15, fontWeight: 700, opacity: pending || amountError || amountNum <= 0 ? 0.55 : 1 }}>
            {pending ? "جارٍ التسجيل…" : "سجّل الدفعة"}
          </button>
        }>
        <div className="flex flex-col" style={{ gap: 11, marginTop: 14 }}>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
            inputMode="numeric" dir="ltr" placeholder="0"
            style={{ ...fieldStyle, minHeight: 56, fontSize: 24, fontWeight: 800, textAlign: "center", fontFamily: "var(--font-zain), var(--font-sans)" }}
          />
          <div className="flex flex-wrap" style={{ gap: 7 }}>
            {[10000, 25000, 50000].map((q) => (
              <button key={q} type="button" onClick={() => setAmount(String(q))} className="m-press-sc" style={chip(amountNum === q)}>
                {toArabicDigits(q / 1000)} ألف
              </button>
            ))}
            <button type="button" onClick={() => setAmount(String(booking.remaining))} className="m-press-sc" style={chip(amountNum === booking.remaining)}>
              المتبقي كامل
            </button>
          </div>
          {(amountError || error) && (
            <p style={{ boxSizing: "border-box", borderRadius: 10, padding: "9px 12px", fontSize: "12.5px", textAlign: "center", background: MOBILE_COLORS.roseBg, color: SOP.red }}>
              {amountError ?? error}
            </p>
          )}
        </div>
      </BottomSheet>
    </div>
  );
}

/** ورقة ⚙️ إدارة العميل — كل الأزرار على الأكشنات القائمة بحراسها الخادمية. */
function AdminSheet({ open, onClose, lead, extras }: { open: boolean; onClose: () => void; lead: ProfileData; extras: OwnerExtras }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [view, setView] = useState<"menu" | "transfer" | "stage" | "archive" | "recover">("menu");
  const [target, setTarget] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setMsg(null);
      const r = await fn();
      if (!r.ok) { setMsg(r.error ?? "صار خطأ"); return; }
      onClose(); setView("menu"); setTarget("");
      router.refresh();
    });

  const item = (label: string, icon: React.ReactNode, onClick: () => void, tone: string = SOP.tx) => (
    <button type="button" onClick={onClick} className="m-raise m-press-sc flex w-full items-center"
      style={{ boxSizing: "border-box", minHeight: 50, gap: 10, borderRadius: 12, padding: "0 13px", color: tone, fontSize: 13.5, fontWeight: 600 }}>
      <span className="flex flex-none items-center justify-center" style={{ width: 30, height: 30, borderRadius: 9, background: `color-mix(in srgb, ${tone} 12%, transparent)`, color: tone }}>{icon}</span>
      <span className="flex-1 text-start">{label}</span>
      <ChevronLeft size={16} strokeWidth={2} style={{ color: SOP.mut }} aria-hidden />
    </button>
  );

  return (
    <BottomSheet open={open} onClose={() => { onClose(); setView("menu"); setMsg(null); }} title="إدارة العميل" subtitle={lead.name}>
      <div className="flex flex-col" style={{ gap: 9, marginTop: 14, paddingBottom: 10 }}>
        {msg && (
          <p style={{ boxSizing: "border-box", borderRadius: 10, padding: "9px 12px", fontSize: "12.5px", textAlign: "center", background: MOBILE_COLORS.roseBg, color: SOP.red }}>{msg}</p>
        )}

        {view === "menu" && (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, color: SOP.mut }}>الإسناد</div>
            {item("تحويل لموظف آخر", <ArrowLeftRight size={15} strokeWidth={2} aria-hidden />, () => setView("transfer"))}
            {item("سحب لغير الموزّعين", <Undo2 size={15} strokeWidth={2} aria-hidden />, () => setView("recover"))}
            <div style={{ fontSize: 11, fontWeight: 700, color: SOP.mut, marginTop: 4 }}>الحالة</div>
            {item("تغيير المرحلة يدويًا", <Target size={15} strokeWidth={2} aria-hidden />, () => setView("stage"))}
            <div style={{ fontSize: 11, fontWeight: 700, color: SOP.mut, marginTop: 4 }}>الأرشيف</div>
            {item("أرشفة العميل", <Archive size={15} strokeWidth={2} aria-hidden />, () => setView("archive"), SOP.red)}
          </>
        )}

        {view === "transfer" && (
          <>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: SOP.tx }}>حوّل إلى:</div>
            {extras.employees.map((e) => {
              const isCurrent = e.name === extras.assignedToName;
              return (
                <button key={e.id} type="button" disabled={isCurrent} onClick={() => setTarget(e.id)}
                  className="m-press-sc flex w-full items-center"
                  style={{
                    boxSizing: "border-box", minHeight: 46, gap: 9, borderRadius: 11, padding: "0 12px",
                    ...(target === e.id
                      ? { background: `color-mix(in srgb, ${SOP.gold} 14%, transparent)`, border: `1px solid ${SOP.gold}` }
                      : { background: SOP.plane, border: `1px solid ${SOP.edge}` }),
                    color: SOP.tx, fontSize: 13, fontWeight: 600, opacity: isCurrent ? 0.45 : 1,
                  }}>
                  {e.name}{isCurrent ? " (الحالي)" : ""}
                </button>
              );
            })}
            <button type="button" disabled={!target || pending}
              onClick={() => run(() => transferLeads([lead.id], target, "full"))}
              className="m-press-sc m-sweep w-full"
              style={{ ...goldBtn, height: 48, borderRadius: 12, fontSize: 14, fontWeight: 700, opacity: !target || pending ? 0.55 : 1 }}>
              {pending ? "جارٍ التحويل…" : target ? `حوّل إلى ${extras.employees.find((e) => e.id === target)?.name ?? ""}` : "اختر موظفًا"}
            </button>
          </>
        )}

        {view === "recover" && (
          <>
            <p style={{ fontSize: 13, color: SOP.tx2, lineHeight: 1.7 }}>
              يُسحب العميل من موظفه ويرجع لحوض «غير الموزّعين». متابعاته محفوظة — ما ينحذف شي.
            </p>
            <button type="button" disabled={pending} onClick={() => run(() => recoverLeads([lead.id]))}
              className="m-press-sc w-full"
              style={{ boxSizing: "border-box", height: 48, borderRadius: 12, border: "none", background: SOP.red, color: SOP.tx, fontSize: 14, fontWeight: 700, opacity: pending ? 0.55 : 1 }}>
              {pending ? "جارٍ السحب…" : "اسحب لغير الموزّعين"}
            </button>
          </>
        )}

        {view === "stage" && (
          <>
            <div className="grid grid-cols-2" style={{ gap: 7 }}>
              {stageOrder.filter((s) => s !== "CLOSED_LOST").map((s) => (
                <button key={s} type="button" disabled={pending || s === lead.stage}
                  onClick={() => run(() => updateLeadStage(lead.id, s))}
                  className="m-press-sc"
                  style={{
                    boxSizing: "border-box", minHeight: 44, borderRadius: 11, fontSize: 12.5, fontWeight: 700,
                    border: `1px solid ${STAGE_HEX[s]}`,
                    background: s === lead.stage ? STAGE_HEX[s] : SOP.plane,
                    color: s === lead.stage ? SOP.onGold : STAGE_HEX[s],
                    opacity: s === lead.stage ? 1 : pending ? 0.5 : 1,
                  }}>
                  {stageLabel(s)}
                </button>
              ))}
            </div>
            <div className="flex items-start" style={{ ...insetBox, gap: 7, borderRadius: 11, padding: "9px 12px", fontSize: 11.5, color: SOP.mut, lineHeight: 1.7 }}>
              <Lock size={13} strokeWidth={2} style={{ flex: "none", marginTop: 3 }} aria-hidden />
              <span>«غير مهتم» تمر حصريًا عبر نتيجة متابعة بسبب منظّم — والخادم يرفض التحويل المباشر.</span>
            </div>
          </>
        )}

        {view === "archive" && (
          <>
            <p style={{ fontSize: 13, color: SOP.tx2, lineHeight: 1.8 }}>
              يُنقل لتبويب «مؤرشف». الاستعادة لاحقًا بثلاثة أوضاع: كما كان · جديد غير موزّع · جديد مع نفس الموظف — المتابعات محفوظة دائمًا.
            </p>
            <button type="button" disabled={pending} onClick={() => run(() => bulkArchive([lead.id]))}
              className="m-press-sc w-full"
              style={{ boxSizing: "border-box", height: 48, borderRadius: 12, border: "none", background: SOP.red, color: SOP.tx, fontSize: 14, fontWeight: 700, opacity: pending ? 0.55 : 1 }}>
              {pending ? "جارٍ الأرشفة…" : "أرشف العميل"}
            </button>
          </>
        )}

        {view !== "menu" && (
          <button type="button" onClick={() => { setView("menu"); setMsg(null); }} className="m-press-sc flex w-full items-center justify-center"
            style={{ boxSizing: "border-box", minHeight: 42, gap: 5, borderRadius: 11, background: "none", border: `1px dashed ${SOP.edge2}`, color: SOP.tx2, fontSize: 12.5 }}>
            <ChevronRight size={15} strokeWidth={2} aria-hidden /> رجوع للقائمة
          </button>
        )}
      </div>
    </BottomSheet>
  );
}

/** تبويب «سجل التحويلات» — سلسلة التنقلات + متابعات كل موظف بنصّها وكاتبها (مالك فقط). */
function TransfersTab({ extras }: { extras: OwnerExtras }) {
  const transfers = [...(extras.transfers ?? [])].reverse(); // الأحدث أولًا
  const fus = extras.allFollowUps ?? [];
  const byAuthor = new Map<string, typeof fus>();
  for (const f of fus) {
    const k = f.authorName ?? "النظام";
    const arr = byAuthor.get(k) ?? [];
    arr.push(f);
    byAuthor.set(k, arr);
  }

  return (
    <div className="flex flex-col" style={{ gap: 12 }}>
      <div style={{ ...box, padding: 14 }}>
        <div className="flex items-center justify-between">
          <span className="flex items-center" style={{ gap: 6, fontSize: 14, fontWeight: 800, color: SOP.tx }}><ArrowLeftRight size={15} strokeWidth={2} style={{ color: SOP.purple }} aria-hidden /> سجل التحويلات</span>
          <span style={{ ...ZAIN, boxSizing: "border-box", borderRadius: 8, padding: "3px 9px", fontSize: 10.5, fontWeight: 700, background: MOBILE_COLORS.amberBg, color: SOP.amber }}>
            تحوّلت {toArabicDigits(transfers.length)} مرات
          </span>
        </div>
        <div className="flex flex-col" style={{ marginTop: 12 }}>
          {transfers.map((t, i) => {
            const current = i === 0;
            const station = t.toName ?? "غير موزّعة";
            return (
              <div key={t.id} className="flex" style={{ gap: 11 }}>
                <div className="flex flex-none flex-col items-center" style={{ width: 12 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 6, marginTop: 4, background: t.toName ? SOP.gold : SOP.red, boxShadow: `0 0 8px ${t.toName ? SOP.gold : SOP.red}` }} />
                  {i < transfers.length - 1 && <span style={{ flex: 1, width: "1.5px", background: SOP.edge2 }} />}
                </div>
                <div style={{ flex: 1, paddingBottom: 16 }}>
                  <div className="flex items-center" style={{ gap: 7 }}>
                    <span className="flex flex-none items-center justify-center" style={{ width: 26, height: 26, borderRadius: 8, fontSize: 10, fontWeight: 700, background: `color-mix(in srgb, ${SOP.gold} 14%, transparent)`, color: SOP.gold }}>
                      {t.toName ? avatarInitials(t.toName) : "؟"}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: SOP.tx, ...(current ? { border: `1px solid ${SOP.gold}`, borderRadius: 8, padding: "2px 8px", background: `color-mix(in srgb, ${SOP.gold} 14%, transparent)` } : {}) }}>
                      {station}{current ? " · الحالية" : ""}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: SOP.mut, marginTop: 4 }}>
                    {reasonLabel(t.reason)} · {new Intl.DateTimeFormat("ar-SA-u-nu-arab", { calendar: "gregory", timeZone: "Asia/Riyadh", dateStyle: "medium" }).format(t.createdAt)}
                  </div>
                </div>
              </div>
            );
          })}
          {/* آخر محطة: دخول النظام */}
          <div className="flex" style={{ gap: 11 }}>
            <div className="flex flex-none flex-col items-center" style={{ width: 12 }}>
              <span style={{ width: 10, height: 10, borderRadius: 6, marginTop: 4, background: SOP.blue }} />
            </div>
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: SOP.tx2 }}>دخلت النظام — {extras.channelText}</span>
            </div>
          </div>
        </div>
      </div>

      {/* متابعات كل موظف — أقسام قابلة للطي بنص المتابعة وكاتبها */}
      <div className="flex flex-col" style={{ gap: 8 }}>
        {[...byAuthor.entries()].map(([author, list]) => (
          <details key={author} style={{ ...box, padding: 0, overflow: "hidden" }}>
            <summary className="flex items-center" style={{ boxSizing: "border-box", minHeight: 48, gap: 9, cursor: "pointer", listStyle: "none", padding: "0 13px" }}>
              <span className="flex flex-none items-center justify-center" style={{ width: 30, height: 30, borderRadius: 9, fontSize: 11, fontWeight: 700, background: `color-mix(in srgb, ${SOP.blue} 14%, transparent)`, color: SOP.blue }}>
                {avatarInitials(author)}
              </span>
              <span className="flex-1" style={{ fontSize: 13, fontWeight: 700, color: SOP.tx }}>{author}</span>
              <span style={{ ...ZAIN, fontSize: 11, color: SOP.mut }}>{toArabicDigits(list.length)} متابعة</span>
            </summary>
            <div className="flex flex-col" style={{ gap: 9, padding: "3px 13px 13px" }}>
              {[...list].reverse().map((f) => (
                <div key={f.id} style={{ ...insetBox, borderRadius: 11, padding: "9px 11px" }}>
                  <div className="flex items-center" style={{ gap: 7 }}>
                    <span className="flex-none" style={{ width: 7, height: 7, borderRadius: 4, background: fuTone(f.result) }} />
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: SOP.tx }}>{followUpResultLabels[f.result]}</span>
                    <span className="flex-1" />
                    <span style={{ fontSize: 10, color: SOP.mut }}>{fmtDT(f.createdAt)}</span>
                  </div>
                  {f.note && <div style={{ fontSize: 11.5, color: SOP.tx2, marginTop: 5, lineHeight: 1.65 }}>{f.note}</div>}
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

/* ===================== تبويب «بيانات» — updateLeadDetails القائم ===================== */

function DataTab({ lead, projects }: { lead: ProfileData; projects: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [goal, setGoal] = useState<PurchaseGoal | null>(lead.purchaseGoal);
  const [method, setMethod] = useState<PurchaseMethod | null>(lead.purchaseMethod);
  const [priceMin, setPriceMin] = useState(lead.priceMin?.toString() ?? "");
  const [priceMax, setPriceMax] = useState(lead.priceMax?.toString() ?? "");
  const [sourceSel, setSourceSel] = useState(lead.sourceId ?? "");
  const [sources, setSources] = useState<SourceListItem[]>([]);
  const [areas, setAreas] = useState<string[]>(lead.preferredAreas);
  const [projSel, setProjSel] = useState<Set<string>>(new Set(lead.preferredProjects));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // جلب المصادر عند أول عرض للتبويب (نفس أكشن نموذج الإضافة) — بخطأ ظاهر لا صامت.
  useEffect(() => {
    fetchSources().then(setSources).catch(() => setMsg({ ok: false, text: "تعذّر تحميل قائمة المصادر — حدّث الصفحة" }));
  }, []);

  function save() {
    setMsg(null);
    startTransition(async () => {
      const res = await updateLeadIntake(lead.id, {
        purchaseGoal: goal,
        purchaseMethod: method,
        priceMin: priceMin ? Number(priceMin.replace(/[^\d]/g, "")) : null,
        priceMax: priceMax ? Number(priceMax.replace(/[^\d]/g, "")) : null,
        sourceId: sourceSel || null,
        preferredAreas: areas,
        preferredProjects: [...projSel],
      });
      setMsg(res.ok ? { ok: true, text: "تم حفظ البيانات" } : { ok: false, text: res.error ?? "صار خطأ" });
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="flex flex-col" style={{ gap: 12 }}>
      <div style={{ ...box, padding: 14 }} className="flex flex-col gap-3">
        {/* الهوية للعرض — تعديل الاسم/الجوال للمدير فقط (قاعدة الخادم القائمة) */}
        <Row label="الاسم"><input value={lead.name} disabled style={{ ...fieldStyle, opacity: 0.6 }} /></Row>
        <Row label="الجوال"><input value={lead.phone} disabled dir="ltr" style={{ ...fieldStyle, ...ZAIN, opacity: 0.6 }} /></Row>

        <Row label="هدف الشراء">
          <div className="flex flex-wrap" style={{ gap: 7 }}>
            {(Object.keys(purchaseGoalLabels) as PurchaseGoal[]).map((g) => (
              <button key={g} type="button" onClick={() => setGoal(goal === g ? null : g)} className="m-press" style={chip(goal === g)}>
                {purchaseGoalLabels[g]}
              </button>
            ))}
          </div>
        </Row>
        <Row label="طريقة الشراء">
          <div className="flex flex-wrap" style={{ gap: 7 }}>
            {purchaseMethodOptions.map((m) => (
              <button key={m} type="button" onClick={() => setMethod(method === m ? null : m)} className="m-press" style={chip(method === m)}>
                {purchaseMethodLabels[m]}
              </button>
            ))}
          </div>
        </Row>
        <div className="grid grid-cols-2" style={{ gap: 9 }}>
          <Row label="السعر من"><input value={priceMin} onChange={(e) => setPriceMin(e.target.value)} inputMode="numeric" dir="ltr" style={fieldStyle} placeholder="500000" /></Row>
          <Row label="السعر إلى"><input value={priceMax} onChange={(e) => setPriceMax(e.target.value)} inputMode="numeric" dir="ltr" style={fieldStyle} placeholder="900000" /></Row>
        </div>
        <Row label="المصدر">
          <select value={sourceSel} onChange={(e) => setSourceSel(e.target.value)} style={fieldStyle}>
            <option value="">— اختر المصدر —</option>
            {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Row>
        <DistrictSelect value={areas} onChange={setAreas} disabled={pending} />
        <Row label="المشاريع المناسبة">
          <div className="flex flex-wrap" style={{ gap: 7 }}>
            {projects.length === 0 ? (
              <span style={{ fontSize: 12, color: SOP.mut }}>ما فيه مشاريع</span>
            ) : projects.map((p) => (
              <button key={p.id} type="button" className="m-press-sc flex items-center"
                onClick={() => setProjSel((s) => { const n = new Set(s); if (n.has(p.name)) n.delete(p.name); else n.add(p.name); return n; })}
                style={{ ...chip(projSel.has(p.name)), gap: 5 }}>
                {projSel.has(p.name) && <Check size={13} strokeWidth={2.5} aria-hidden />}{p.name}
              </button>
            ))}
          </div>
        </Row>

        {msg && (
          <p style={{
            boxSizing: "border-box", borderRadius: 10, padding: "9px 12px", fontSize: "12.5px", textAlign: "center",
            background: msg.ok ? MOBILE_COLORS.mintBg : MOBILE_COLORS.roseBg,
            color: msg.ok ? SOP.green : SOP.red,
          }}>{msg.text}</p>
        )}
        <button type="button" onClick={save} disabled={pending}
          className="m-press-sc m-sweep flex w-full items-center justify-center"
          style={{ ...goldBtn, height: 48, gap: 7, borderRadius: 13, fontSize: 14, fontWeight: 700, opacity: pending ? 0.6 : 1 }}>
          <Save {...BTN_ICON} aria-hidden /> {pending ? "جارٍ الحفظ…" : "حفظ البيانات"}
        </button>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block" style={{ fontSize: 12, color: SOP.tx2, marginBottom: 6 }}>{label}</span>
      {children}
    </label>
  );
}

/* ===================== تبويب «المتابعة والزيارات» ===================== */

function FuTab({
  lead, timeline, nowMs, owner = false, onNew, onEdit,
}: {
  lead: ProfileData;
  timeline: ({ kind: "fu"; at: Date; f: ProfileFu } | { kind: "act"; at: Date; a: ProfileAct })[];
  nowMs: number;
  /** وضع المالك: السجل كامل بلا فلترة خصوصية + فلتر الكل/متابعات/إداري + شارة «إداري». */
  owner?: boolean;
  onNew: () => void;
  onEdit: (f: ProfileFu) => void;
}) {
  const [adminFilter, setAdminFilter] = useState<"all" | "fu" | "admin">("all");
  const isAdminEvent = (t: ActivityType) => t === "ASSIGNMENT";
  const shownTimeline = owner && adminFilter !== "all"
    ? timeline.filter((it) =>
        adminFilter === "admin"
          ? it.kind === "act" && isAdminEvent(it.a.type)
          : it.kind === "fu" || !isAdminEvent(it.a.type),
      )
    : timeline;
  const upcoming = lead.visitAt && lead.visitAt.getTime() > nowMs
    ? { at: lead.visitAt, label: "زيارة" }
    : lead.nextFollowup && lead.nextFollowup.getTime() > nowMs
      ? { at: lead.nextFollowup, label: "متابعة" }
      : null;
  // ✎ الموعد القادم = تعديل آخر متابعة — يظهر فقط داخل نافذة الساعة (والخادم هو الحكم).
  const latest = lead.followUps[0] ?? null;
  const latestEditable = latest && editMinutesLeft(latest.createdAt, nowMs) > 0;

  return (
    <div className="flex flex-col" style={{ gap: 12 }}>
      {lead.firstContact ? (
        <FirstContactCard lead={lead} />
      ) : (
        <>
          <button type="button" onClick={onNew}
            className="m-press-sc m-sweep flex w-full items-center justify-center"
            style={{ ...goldBtn, height: 50, borderRadius: 14, fontSize: 15, fontWeight: 700, gap: 7 }}>
            <MessageSquarePlus {...BTN_ICON} aria-hidden /> متابعة جديدة
          </button>
          {upcoming && (
            <div className="m-rise flex items-center justify-between" style={{ ...box, borderRadius: 14, padding: "10px 13px", gap: 8, borderInlineStart: `3px solid ${SOP.gold}` }}>
              <span className="flex min-w-0 items-center" style={{ gap: 7, fontSize: 12.5, fontWeight: 700, color: SOP.gold }}>
                <span className="flex flex-none items-center justify-center" style={{ width: 30, height: 30, borderRadius: 9, background: `color-mix(in srgb, ${SOP.gold} 14%, transparent)` }}>
                  <CalendarDays size={15} strokeWidth={2} aria-hidden />
                </span>
                <span className="min-w-0 truncate">الموعد القادم: {upcoming.label} — <span style={ZAIN}>{fmtDT(upcoming.at)}</span></span>
              </span>
              {latestEditable && latest && (
                <button type="button" onClick={() => onEdit(latest)} aria-label="تعديل الموعد" className="m-press-sc flex flex-none items-center justify-center"
                  style={{ boxSizing: "border-box", width: 34, height: 34, borderRadius: 9, border: `1px solid color-mix(in srgb, ${SOP.gold} 40%, transparent)`, background: "transparent", color: SOP.gold }}>
                  <Pencil size={14} strokeWidth={2} aria-hidden />
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* سجل المتابعات / الخط الزمني */}
      <section className="flex flex-col" style={{ gap: 10 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: SOP.tx, padding: "0 2px" }}>
          سجل المتابعات (<span style={ZAIN}>{toArabicDigits(lead.followUpsCount)}</span>)
        </h2>
        {/* فلتر المالك: الكل / متابعات / إداري */}
        {owner && (
          <div className="flex" style={{ gap: 6 }}>
            {([["all", "الكل"], ["fu", "متابعات"], ["admin", "إداري"]] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setAdminFilter(k)} className="m-press-sc" style={{ border: "none", background: "none", padding: 0 }}>
                <span style={{ ...chip(adminFilter === k), minHeight: 32, display: "inline-flex", alignItems: "center" }}>{l}</span>
              </button>
            ))}
          </div>
        )}
        {shownTimeline.length === 0 ? (
          <div className="flex flex-col items-center" style={{ ...insetBox, gap: 6, padding: "24px 14px", borderRadius: 16 }}>
            <Inbox size={22} strokeWidth={1.8} style={{ color: SOP.mut }} aria-hidden />
            <span style={{ fontSize: 12.5, color: SOP.tx2 }}>ما فيه أحداث بعد — سجّل أول تواصل فوق</span>
          </div>
        ) : (
          <div className="m-rise flex flex-col" style={{ ...box, padding: "14px 13px 0" }}>
            {shownTimeline.map((item, i) => (
              <div key={item.kind === "fu" ? `f-${item.f.id}` : `a-${item.a.id}`} className="flex" style={{ gap: 12 }}>
                <div className="flex flex-none flex-col items-center" style={{ width: 12 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 6, marginTop: 4, background: item.kind === "fu" ? fuTone(item.f.result) : STAGE_HEX[lead.stage], boxShadow: `0 0 8px ${item.kind === "fu" ? fuTone(item.f.result) : STAGE_HEX[lead.stage]}` }} />
                  {i < shownTimeline.length - 1 && <span style={{ flex: 1, width: "1.5px", background: SOP.edge2 }} />}
                </div>
                {item.kind === "fu" ? (
                  <div style={{ flex: 1, paddingBottom: 18 }}>
                    <div className="flex items-center justify-between" style={{ gap: 8 }}>
                      <span style={{ fontSize: "13.5px", fontWeight: 800, color: SOP.tx }}>
                        {followUpResultLabels[item.f.result]}
                      </span>
                      {editMinutesLeft(item.f.createdAt, nowMs) > 0 && (
                        <button type="button" onClick={() => onEdit(item.f)} className="m-press-sc flex flex-none items-center"
                          style={{ boxSizing: "border-box", gap: 4, borderRadius: 8, padding: "3px 9px", fontSize: 10.5, fontWeight: 700, background: `color-mix(in srgb, ${SOP.gold} 14%, transparent)`, color: SOP.gold, border: `1px solid color-mix(in srgb, ${SOP.gold} 40%, transparent)` }}>
                          <Pencil size={11} strokeWidth={2.2} aria-hidden /> <span style={ZAIN}>{toArabicDigits(editMinutesLeft(item.f.createdAt, nowMs))}</span> د
                        </button>
                      )}
                    </div>
                    {item.f.note && <div style={{ ...insetBox, fontSize: 12, color: SOP.tx2, marginTop: 6, lineHeight: 1.7, borderRadius: 10, padding: "7px 10px", background: `color-mix(in srgb, ${SOP.tx} 5%, transparent)`, boxShadow: "none", borderInlineStart: `2px solid ${SOP.edge2}` }}>{item.f.note}</div>}
                    {item.f.nextDate && item.f.nextDate.getTime() > nowMs && (
                      <span className="inline-flex items-center" style={{ boxSizing: "border-box", gap: 5, marginTop: 7, borderRadius: 8, padding: "4px 9px", fontSize: "11.5px", fontWeight: 600, background: `color-mix(in srgb, ${SOP.blue} 14%, transparent)`, color: SOP.blue }}>
                        <CalendarDays size={12} strokeWidth={2} aria-hidden /> الموعد القادم: <span style={ZAIN}>{fmtDT(item.f.nextDate)}</span>
                      </span>
                    )}
                    <div style={{ fontSize: "10.5px", color: SOP.mut, marginTop: 6 }}>
                      {fmtDT(item.f.createdAt)} · {item.f.userName ?? "النظام"}
                    </div>
                  </div>
                ) : owner && item.a.type === "ASSIGNMENT" ? (
                  /* المالك: الحدث الإداري كاملًا — خلفية كهرمانية + شارة «إداري» + بواسطة */
                  <div style={{ flex: 1, paddingBottom: 18 }}>
                    <div className="flex items-center" style={{ gap: 7 }}>
                      <span style={{ fontSize: "13.5px", fontWeight: 600, color: SOP.tx }}>{activityTypeLabels[item.a.type]}</span>
                      <span style={{ boxSizing: "border-box", borderRadius: 6, padding: "2px 8px", fontSize: 10, fontWeight: 700, background: `color-mix(in srgb, ${SOP.amber} 14%, transparent)`, color: SOP.amber }}>إداري</span>
                    </div>
                    {item.a.note && (
                      <div style={{ boxSizing: "border-box", fontSize: "12.5px", color: SOP.tx2, marginTop: 6, lineHeight: 1.65, background: `color-mix(in srgb, ${SOP.amber} 10%, transparent)`, borderInlineStart: `2px solid ${SOP.amber}`, borderRadius: 10, padding: "8px 11px" }}>
                        {item.a.note}
                      </div>
                    )}
                    <div style={{ fontSize: "10.5px", color: SOP.mut, marginTop: 6 }}>
                      {fmtDT(item.a.createdAt)} · بواسطة: {item.a.userName ?? "النظام"}
                    </div>
                  </div>
                ) : (
                  <div style={{ flex: 1, paddingBottom: 18 }}>
                    <div style={{ fontSize: "13.5px", fontWeight: 600, color: SOP.tx }}>
                      {/* خصوصية الموظف: أحداث الإسناد بنص عام موحّد — بلا تفاصيل التوزيع/السحب */}
                      {item.a.type === "ASSIGNMENT" ? "انتقل إليك العميل" : activityTypeLabels[item.a.type]}
                    </div>
                    {item.a.type !== "ASSIGNMENT" && item.a.note && (
                      <div style={{ boxSizing: "border-box", fontSize: "12.5px", color: SOP.tx2, marginTop: 6, lineHeight: 1.65, background: `color-mix(in srgb, ${SOP.tx} 5%, transparent)`, borderInlineStart: `2px solid ${SOP.edge2}`, borderRadius: 10, padding: "8px 11px" }}>
                        {item.a.note}
                      </div>
                    )}
                    <div style={{ fontSize: "10.5px", color: SOP.mut, marginTop: 6 }}>
                      {fmtDT(item.a.createdAt)}{item.a.type !== "ASSIGNMENT" && item.a.userName ? ` · ${owner ? "بواسطة: " : ""}${item.a.userName}` : ""}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* ===================== بطاقة «سجّل أول تواصل» — إلزامية بشبكة ٢×٢ ===================== */

function FirstContactCard({ lead }: { lead: ProfileData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sel, setSel] = useState<"interested" | "noanswer" | "calllater" | "notInterested" | null>(null);
  const [step, setStep] = useState<"visit" | "call" | "none" | null>(null);
  const [reasons, setReasons] = useState<Set<string>>(new Set());
  const [retry, setRetry] = useState<"yes" | "no">("no");
  const [note, setNote] = useState("");
  const [dateOnly, setDateOnly] = useState("");
  const [timeOnly, setTimeOnly] = useState("");
  const [error, setError] = useState<string | null>(null);
  const date = dateOnly ? `${dateOnly}T${timeOnly || "10:00"}` : "";

  // الإلزام حسب المواصفة المعتمدة: زيارة/اتصال/«طلب وقت آخر» = موعد إلزامي؛
  // غير مهتم = سبب إلزامي (+موعد مع «نحاول لاحقًا») — أشد من الخادم، لا يكسره.
  const needDate = (sel === "interested" && (step === "visit" || step === "call")) || sel === "calllater" || (sel === "notInterested" && retry === "yes");
  const needReason = sel === "notInterested" && reasons.size === 0;
  const needStep = sel === "interested" && step === null;
  const missing = needStep ? "اختر الخطوة الجاية" : needDate && !dateOnly ? "الموعد إلزامي — اختر التاريخ" : needReason ? "اختر سبب عدم الاهتمام" : null;

  // ألوان النتائج (المرجع): مهتم أخضر · لا يرد كهرماني · طلب لاحق تركوازي · غير مهتم أحمر.
  const options: { key: typeof sel & string; label: string; base: string; icon: React.ReactNode }[] = [
    { key: "interested", label: "مهتم", base: SOP.green, icon: <Heart size={18} strokeWidth={2} aria-hidden /> },
    { key: "noanswer", label: "لا يرد", base: SOP.amber, icon: <PhoneOff size={18} strokeWidth={2} aria-hidden /> },
    { key: "calllater", label: "طلب وقت آخر", base: SOP.teal, icon: <Clock size={18} strokeWidth={2} aria-hidden /> },
    { key: "notInterested", label: "غير مهتم", base: SOP.red, icon: <Ban size={18} strokeWidth={2} aria-hidden /> },
  ];

  function submit() {
    if (!sel || missing) return;
    let body: SaveBody | null = null;
    if (sel === "notInterested") {
      body = buildNotInterestedBody(reasons, retry, date, note) as SaveBody;
    } else if (sel === "interested" && (step === "visit" || step === "call")) {
      // مهتم بموعد — نفس مسارَي شجرة المتابعة القائمة (زيارة/اتصال).
      body = buildBody({ key: "interested", stage: lead.stage, step, visitAction: null, noShowChoice: null, note, date });
    } else {
      body = buildFirstContactBody(sel === "interested" ? "interested" : sel, note, date);
    }
    if (!body) { setError("اختر نتيجة"); return; }
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/leads/${lead.id}/followups`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { setError(data?.error ?? "صار خطأ"); return; }
        router.refresh();
      } catch {
        setError("ما وصلنا للخادم — تحقق من الإنترنت وحاول مرة ثانية");
      }
    });
  }

  const saveLabel = sel === "notInterested"
    ? retry === "yes" ? "حفظ — نحاول لاحقًا" : "حفظ — غير مهتم نهائي"
    : "حفظ النتيجة";

  return (
    <div className="m-rise relative overflow-hidden" style={{ ...box, padding: 14, borderInlineStart: `3px solid ${SOP.teal}` }}>
      <div className="flex items-center" style={{ gap: 8, fontSize: 15, fontWeight: 800, color: SOP.tx }}>
        <span className="flex flex-none items-center justify-center" style={{ width: 30, height: 30, borderRadius: 9, background: `color-mix(in srgb, ${SOP.teal} 14%, transparent)`, color: SOP.teal }}>
          <ClipboardList size={16} strokeWidth={2} aria-hidden />
        </span>
        سجّل أول تواصل مع العميل
      </div>
      <div style={{ fontSize: 12, color: SOP.tx2, marginTop: 6 }}>اختر نتيجة أول تواصل <b>(إلزامي)</b></div>

      {/* كروت النتائج — مربّع أيقونة ملوّن يمتلئ عند الاختيار مع علامة صح وتوهّج */}
      <div className="grid grid-cols-2" style={{ gap: 8, marginTop: 12 }}>
        {options.map((o) => {
          const on = sel === o.key;
          return (
            <button key={o.key} type="button"
              onClick={() => { setSel(o.key); setStep(null); setReasons(new Set()); setRetry("no"); setDateOnly(""); setTimeOnly(""); setError(null); }}
              className={`${on ? "" : "m-raise"} m-press-sc relative flex items-center`}
              style={{
                boxSizing: "border-box", minHeight: 54, gap: 9, borderRadius: 13, padding: "0 10px", fontSize: 13, fontWeight: 700, textAlign: "start",
                ...(on
                  ? { background: `color-mix(in srgb, ${o.base} 12%, ${SOP.plane})`, color: o.base, border: `1px solid ${o.base}`, boxShadow: `0 0 16px color-mix(in srgb, ${o.base} 35%, transparent)` }
                  : { color: SOP.tx2 }),
              }}>
              <span className="flex flex-none items-center justify-center" style={{ width: 32, height: 32, borderRadius: 10, background: on ? o.base : `color-mix(in srgb, ${o.base} 14%, transparent)`, color: on ? SOP.onGold : o.base }}>
                {on ? <Check size={17} strokeWidth={2.6} aria-hidden /> : o.icon}
              </span>
              <span className="min-w-0 truncate">{o.label}</span>
            </button>
          );
        })}
      </div>

      {sel === "interested" && (
        <div style={{ marginTop: 11 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: SOP.gold, marginBottom: 8 }}>وش الخطوة الجاية؟</div>
          <div className="flex flex-wrap" style={{ gap: 7 }}>
            <button type="button" onClick={() => setStep("visit")} className="m-press-sc flex items-center" style={{ ...chip(step === "visit", SOP.blue, `color-mix(in srgb, ${SOP.blue} 14%, transparent)`, SOP.blue), gap: 5 }}><MapPin size={14} strokeWidth={2} aria-hidden /> يبغى زيارة</button>
            <button type="button" onClick={() => setStep("call")} className="m-press-sc flex items-center" style={{ ...chip(step === "call", SOP.teal, `color-mix(in srgb, ${SOP.teal} 14%, transparent)`, SOP.teal), gap: 5 }}><Phone size={14} strokeWidth={2} aria-hidden /> موعد اتصال</button>
            <button type="button" onClick={() => { setStep("none"); setDateOnly(""); setTimeOnly(""); }} className="m-press-sc" style={chip(step === "none")}>مهتم بدون موعد</button>
          </div>
        </div>
      )}

      {sel === "calllater" && (
        <div style={{ fontSize: 12, fontWeight: 600, color: SOP.teal, marginTop: 11 }}>متى قال أرجع له؟ <b>(إلزامي)</b></div>
      )}

      {sel === "notInterested" && (
        <div style={{ marginTop: 11 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: SOP.red, marginBottom: 8 }}>السبب (إلزامي)</div>
          <div className="flex flex-wrap" style={{ gap: 7 }}>
            {NI_REASONS.map((r: string) => (
              <button key={r} type="button" className="m-press-sc"
                onClick={() => setReasons((s) => { const n = new Set(s); if (n.has(r)) n.delete(r); else n.add(r); return n; })}
                style={chip(reasons.has(r), SOP.red, `color-mix(in srgb, ${SOP.red} 14%, transparent)`, SOP.red)}>
                {r}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: SOP.tx2, margin: "10px 0 7px" }}>نحاول معه مرة ثانية لاحقًا؟</div>
          <div className="flex" style={{ gap: 7 }}>
            <button type="button" onClick={() => setRetry("yes")} className="m-press-sc" style={chip(retry === "yes")}>نعم — نحاول لاحقًا</button>
            <button type="button" onClick={() => setRetry("no")} className="m-press-sc" style={chip(retry === "no")}>لا — نهائي</button>
          </div>
        </div>
      )}

      {(needDate || (sel === "interested" && (step === "visit" || step === "call"))) && (
        <div style={{ marginTop: 11 }}>
          <div className="flex" style={{ gap: 8 }}>
            <label className="flex flex-col justify-center" style={{ ...insetBox, flex: 1, minHeight: 52, gap: 3, borderRadius: 12, padding: "7px 12px" }}>
              <span className="flex items-center" style={{ gap: 5, fontSize: "11.5px", color: SOP.tx2 }}><CalendarDays size={13} strokeWidth={2} aria-hidden /> التاريخ</span>
              <input type="date" value={dateOnly} onChange={(e) => setDateOnly(e.target.value)} style={{ background: "transparent", border: "none", outline: "none", width: "100%", fontSize: 13, color: SOP.tx }} />
            </label>
            <label className="flex flex-col justify-center" style={{ ...insetBox, flex: 1, minHeight: 52, gap: 3, borderRadius: 12, padding: "7px 12px" }}>
              <span className="flex items-center" style={{ gap: 5, fontSize: "11.5px", color: SOP.tx2 }}><Clock size={13} strokeWidth={2} aria-hidden /> الوقت</span>
              <input type="time" value={timeOnly} onChange={(e) => setTimeOnly(e.target.value)} style={{ background: "transparent", border: "none", outline: "none", width: "100%", fontSize: 13, color: SOP.tx }} />
            </label>
          </div>
        </div>
      )}

      {sel && (
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="ملاحظة اختيارية…"
          style={{ ...insetBox, width: "100%", marginTop: 11, borderRadius: 12, padding: "10px 12px", minHeight: 60, fontSize: 13, color: SOP.tx, resize: "vertical", outline: "none" }} />
      )}

      {error && (
        <p style={{ boxSizing: "border-box", marginTop: 10, borderRadius: 10, padding: "9px 12px", fontSize: "12.5px", textAlign: "center", background: MOBILE_COLORS.roseBg, color: SOP.red }}>{error}</p>
      )}

      {sel && (
        <>
          <button type="button" onClick={submit} disabled={pending || !!missing}
            className="m-press-sc m-sweep flex w-full items-center justify-center"
            style={{ ...goldBtn, marginTop: 11, height: 50, gap: 7, borderRadius: 13, fontSize: 14.5, fontWeight: 700, opacity: pending || missing ? 0.55 : 1 }}>
            <Check {...BTN_ICON} aria-hidden /> {pending ? "جارٍ الحفظ…" : saveLabel}
          </button>
          {missing && <div className="text-center" style={{ fontSize: 11.5, color: SOP.mut, marginTop: 7 }}>{missing}</div>}
        </>
      )}

      <div style={{ fontSize: 12, color: SOP.mut, marginTop: 13 }}>
        سجل المتابعات (٠) — يبدأ بأول نتيجة تسجّلها.
      </div>
    </div>
  );
}

export default LeadProfileV3;
