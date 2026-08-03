"use client";

import Link from "next/link";
import type { Channel, LeadStage } from "@prisma/client";
import { Phone, MessageCircle } from "lucide-react";
import { STAGE_HEX, stageChipClass } from "@/lib/stage-colors";
import { channelLabel, stageLabel } from "@/lib/labels";
import { waPhone } from "@/lib/value-normalize";
import { MOBILE_COLORS } from "@/lib/mobile-tokens";
import { waitingLabel, type WaitingBasis } from "@/lib/mobile-format";

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

/**
 * أهداف اللمس: الشكل المرئي ٣٦px كما في النموذج، ومساحة اللمس ٤٤px
 * (٣٦ + ٤ أعلى + ٤ أسفل) عبر حشوة شفافة على الرابط نفسه — فالخلفية
 * على الطبقة الداخلية وحدها. هكذا نطابق التصميم بلا كسر حدّ الإتاحة.
 *
 * ⚠️ box-sizing صريح: الثيم هنا content-box (لا border-box)، فبدونه يصير
 * الزر ذو الحد ٣٨px بينما الذهبي بلا حد ٣٦px — تفاوت ٢px في الصف نفسه.
 */
const TAP_PAD_Y = 4;

export function MobileLeadCard({
  lead,
  late = false,
  reason,
  waitingBasis = "assign",
}: {
  lead: MobileLeadCardLead;
  /** متأخر (فات موعده) — يصبغ زر الاتصال ذهبيًا مملوءًا. */
  late?: boolean;
  /** سطر سبب اختياري («زيارة اليوم ٤:٣٠» مثلًا) يظهر بدل السطر الثانوي. */
  reason?: string;
  /** أساس عدّاد الانتظار — تحسبه الصفحة من lastContact/assignedAt ولا يُخمَّن هنا. */
  waitingBasis?: WaitingBasis;
}) {
  const wa = waPhone(lead.phone);
  // الأزرار روابط حقيقية (tel:/wa.me) — فلا نضع البطاقة كـ<a> حولها (تعشيق روابط
  // غير صالح). بدلها رابط بمساحة البطاقة خلف المحتوى، والأزرار فوقه.
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const callVisual = late
    ? { backgroundColor: MOBILE_COLORS.gold, color: MOBILE_COLORS.bg, border: "none" }
    : {
        backgroundColor: MOBILE_COLORS.sheet,
        color: MOBILE_COLORS.textSecondary,
        border: `1px solid ${MOBILE_COLORS.border}`,
      };
  const waVisual = {
    backgroundColor: MOBILE_COLORS.sheet,
    color: MOBILE_COLORS.textSecondary,
    border: `1px solid ${MOBILE_COLORS.border}`,
  };

  return (
    <article
      className="relative overflow-hidden rounded-2xl"
      style={{
        backgroundColor: MOBILE_COLORS.card,
        border: `1px solid ${MOBILE_COLORS.border}`,
        padding: "13px 16px 12px 13px",
      }}
    >
      {/* الشريط اللوني — لون المرحلة من مصدرها الوحيد. */}
      <div
        className="absolute bottom-0 right-0 top-0"
        style={{ width: 3, backgroundColor: STAGE_HEX[lead.stage] }}
        aria-hidden
      />

      {/* مساحة اللمس المؤدية لملف العميل — خلف المحتوى، فلا تبتلع الأزرار. */}
      <Link
        href={`/m/leads/${lead.id}`}
        aria-label={`ملف العميل ${lead.name}`}
        className="absolute inset-0 z-0"
      />

      <div className="pointer-events-none relative z-10">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 truncate text-[15px] font-semibold text-white">{lead.name}</div>
          <span
            className={`shrink-0 whitespace-nowrap border font-semibold ${stageChipClass[lead.stage]}`}
            style={{ fontSize: "10.5px", padding: "4px 9px", borderRadius: 7 }}
          >
            {stageLabel(lead.stage)}
          </span>
        </div>
        <div
          className="truncate"
          style={{ fontSize: "11.5px", color: MOBILE_COLORS.textMuted, marginTop: 5 }}
        >
          {reason ?? `${waitingLabel(lead.daysWaiting, waitingBasis)} · ${channelLabel(lead.channel)}`}
        </div>
      </div>

      {/* الفاصل الأفقي */}
      <div
        className="relative z-10"
        style={{ height: 1, backgroundColor: MOBILE_COLORS.border, margin: "11px 0 10px" }}
        aria-hidden
      />

      <div className="relative z-10 flex" style={{ gap: 8 }}>
        <a
          href={`tel:${lead.phone}`}
          onClick={stop}
          className="flex flex-1 items-center"
          style={{ paddingBlock: TAP_PAD_Y }}
        >
          <span
            className="flex w-full items-center justify-center font-semibold"
            style={{ boxSizing: "border-box", height: 36, borderRadius: 10, fontSize: 13, gap: 6, ...callVisual }}
          >
            <Phone width={15} height={15} aria-hidden />
            اتصال
          </span>
        </a>
        <a
          href={`https://wa.me/${wa}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={stop}
          className="flex flex-1 items-center"
          style={{ paddingBlock: TAP_PAD_Y }}
        >
          <span
            className="flex w-full items-center justify-center font-semibold"
            style={{ boxSizing: "border-box", height: 36, borderRadius: 10, fontSize: 13, gap: 6, ...waVisual }}
          >
            <MessageCircle width={15} height={15} aria-hidden />
            واتساب
          </span>
        </a>
      </div>
    </article>
  );
}

export default MobileLeadCard;
