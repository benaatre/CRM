import type { LeadStage } from "@prisma/client";

/**
 * حدود ميزة «العملاء الراكدين» — المكان الواحد القابل للتعديل
 * (docs/STALE-LEADS-SPEC.md · التعريف المعتمد 2026-09-16).
 * المنطق نفسه في src/lib/stale-leads.ts — هذه الأرقام والقوائم فقط.
 */

/** [أ] بلا موعد: آخر حركة أقدم من هذي الأيام ⇒ راكد. */
export const STALE_DAYS = 7;

/** [ب] موعد فايت: فات بأكثر من هذي الساعات بلا متابعة بعده ⇒ راكد. */
export const MISSED_APPOINTMENT_HOURS = 48;

/** درجة «متروك» تبدأ من هذا اليوم. */
export const ABANDONED_DAYS = 15;

/** درجة «مهجور» بعد هذا اليوم. */
export const DORMANT_DAYS = 30;

/** المراحل المقفولة — خارج «النشط» أصلًا (مقام النِّسب). */
export const STALE_CLOSED_STAGES: LeadStage[] = [
  "RESERVED",
  "CLOSED_WON",
  "CLOSED_LOST",
];

/**
 * المستثنى من الركود = المقفولة + «محاولة/لم يرد»: لها نظام No-Response
 * المستقل، وحسابها هنا يعني محاسبة الموظف مرتين على نفس العميل.
 */
export const STALE_EXCLUDED_STAGES: LeadStage[] = [
  ...STALE_CLOSED_STAGES,
  "ATTEMPTED",
];

/** «الحارّ» = المراحل القريبة من البيع — محور مستقل عن درجة العمر. */
export const HOT_STAGES: LeadStage[] = [
  "VIEWING",
  "VISIT_SCHEDULED",
  "NEGOTIATION",
  "INTERESTED",
];
