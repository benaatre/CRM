"use client";

import Link from "next/link";
import type { Channel, LeadStage } from "@prisma/client";
import { Phone, MessageCircle, UserRound } from "lucide-react";
import { STAGE_HEX, stageChipClass } from "@/lib/stage-colors";
import { channelLabel, stageLabel } from "@/lib/labels";
import { waPhone } from "@/lib/value-normalize";
import { SOP } from "@/lib/mobile-tokens";
import { actionBtn, BTN_ICON, ACTION_BTN_CLASS } from "@/components/mobile/action-buttons";
import { waitingLabel, type WaitingBasis } from "@/lib/mobile-format";
import { markCall } from "@/lib/mobile-call-tracker";

/**
 * الحد الأدنى الذي تحتاجه البطاقة — `LeadRow` يحققه بنيويًا، فتُمرَّر صفوف
 * `getLeads` كما هي في /m و/m/new و/m/today و/m/leads بلا تحويل.
 */
export type MobileLeadCardLead = {
  id: string;
  name: string;
  phone: string;
  stage: LeadStage;
  channel: Channel;
  /** أيام الانتظار — محسوبة على الخادم. ⚠️ لا نستخدم createdAt: محجوب عن الموظف (null). */
  daysWaiting: number;
};

export function MobileLeadCard({
  lead,
  late = false,
  reason,
  waitingBasis = "assign",
  trailing,
  delayMs = 0,
}: {
  lead: MobileLeadCardLead;
  /** متأخر (فات موعده) — يصبغ زر الاتصال ذهبيًا مملوءًا. */
  late?: boolean;
  /** سطر سبب اختياري («زيارة اليوم ٤:٣٠» مثلًا) يظهر بدل السطر الثانوي. */
  reason?: string;
  /** أساس عدّاد الانتظار — تحسبه الصفحة من lastContact/assignedAt ولا يُخمَّن هنا. */
  waitingBasis?: WaitingBasis;
  /** تأخير الدخول المتدرّج — النموذج: stagger افتراضي ٧٠ms. */
  delayMs?: number;
  /**
   * نص يحل محل شارة المرحلة أعلى اليسار (نمط بطاقات «متابعات اليوم» في النموذج:
   * الوقت مكان الشارة، بلونه). غيابه = شارة المرحلة كالمعتاد.
   */
  trailing?: { text: string; color: string };
}) {
  const wa = waPhone(lead.phone);
  // الكرت نفسه ليس رابطًا — التنقّل والأفعال عبر صف الأزرار الثلاثة الموحّد (action-buttons):
  // اتصال (الأعرض، ذهبي) · واتساب (أخضر) · الملف (سطح مرفوع بحد ذهبي) — مطابق لبطاقة العميل العادية.

  return (
    <article
      className="m-raise m-leadcard m-rise relative overflow-hidden"
      style={{
        boxSizing: "border-box",
        borderRadius: 16,
        padding: "13px 14px 12px 12px",
        // الخط الجانبي بلون المرحلة — border-inline-start (لا عنصر مطلق).
        borderInlineStart: `3px solid ${STAGE_HEX[lead.stage]}`,
        animationDelay: `${delayMs}ms`,
      }}
    >
      {/* جسم الكرت — عرض فقط */}
      <div className="flex items-center" style={{ gap: 10 }}>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 truncate" style={{ fontSize: 15, fontWeight: 700, color: SOP.tx }}>{lead.name}</div>
            {trailing ? (
              <span
                className="shrink-0 whitespace-nowrap font-semibold"
                style={{ fontSize: 12, color: trailing.color }}
              >
                {trailing.text}
              </span>
            ) : (
              <span
                className={`shrink-0 whitespace-nowrap border font-semibold ${stageChipClass[lead.stage]}`}
                style={{ fontSize: "10.5px", padding: "4px 9px", borderRadius: 7 }}
              >
                {stageLabel(lead.stage)}
              </span>
            )}
          </div>
          <div dir="ltr" className="truncate" style={{ fontFamily: "var(--font-zain), var(--font-sans)", fontVariantNumeric: "tabular-nums", fontSize: 12, color: SOP.mut, marginTop: 3, textAlign: "end" }}>
            {lead.phone}
          </div>
          <div
            className="truncate"
            style={{ fontSize: "11.5px", color: SOP.tx2, marginTop: 4 }}
          >
            {reason ?? `${waitingLabel(lead.daysWaiting, waitingBasis)} · ${channelLabel(lead.channel)}`}
          </div>
        </div>
      </div>

      {/* الفاصل الأفقي */}
      <div style={{ height: 1, backgroundColor: SOP.edge, margin: "11px 0 10px" }} aria-hidden />

      {/* صف الأزرار الثلاثة الموحّد — مطابق لبطاقة العميل العادية (actionBtn، ٤٦px، أيقونات ١٧px) */}
      <div className="flex" style={{ gap: 8 }}>
        <a href={`tel:${lead.phone}`} onClick={() => markCall(lead.id)} className={ACTION_BTN_CLASS} style={{ ...actionBtn("gold"), flex: 1.3 }}>
          <Phone {...BTN_ICON} aria-hidden /> {late ? "اتصل الآن" : "اتصال"}
        </a>
        <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" className={ACTION_BTN_CLASS} style={{ ...actionBtn("wa"), flex: 1 }}>
          <MessageCircle {...BTN_ICON} aria-hidden /> واتساب
        </a>
        <Link href={`/m/leads/${lead.id}`} aria-label={`ملف العميل ${lead.name}`} className={ACTION_BTN_CLASS} style={{ ...actionBtn("file"), flex: 1 }}>
          <UserRound {...BTN_ICON} aria-hidden /> الملف
        </Link>
      </div>
    </article>
  );
}

export default MobileLeadCard;
