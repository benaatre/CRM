"use server";

import { getLeadDetail } from "@/lib/data/leads";
import { stageLabels, channelLabels, followUpResultLabels } from "@/lib/labels";
import { STAGE_HEX } from "@/lib/stage-colors";
import { formatDateTime } from "@/lib/format";

/**
 * معاينة العميل السريعة لورقة سجل التدقيق (رئيسية المالك §٤) — غلاف عرض فقط
 * فوق getLeadDetail القائمة: التحجيم بالدور داخلها (scopeForUser) وحجب المبالغ
 * كما هو، وكل النصوص تُصاغ هنا على الخادم فلا حساب تواريخ بالعميل.
 */

export type LeadPreview = {
  id: string;
  name: string;
  phone: string;
  stageLabel: string;
  stageHex: string;
  sourceText: string;
  employeeName: string | null;
  lastContactText: string | null;
  lastFu: { when: string; result: string; note: string | null } | null;
};

export async function fetchLeadPreview(leadId: string): Promise<LeadPreview | null> {
  const d = await getLeadDetail(leadId);
  if (!d) return null;
  const fu = d.followUps[0] ?? null;
  return {
    id: d.id,
    name: d.name,
    phone: d.phone,
    stageLabel: stageLabels[d.stage],
    stageHex: STAGE_HEX[d.stage],
    sourceText: d.sourceName ?? channelLabels[d.channel],
    employeeName: d.assignedTo?.name ?? null,
    lastContactText: d.lastContact ? formatDateTime(d.lastContact) : null,
    lastFu: fu
      ? { when: formatDateTime(fu.createdAt), result: followUpResultLabels[fu.result], note: fu.note }
      : null,
  };
}
