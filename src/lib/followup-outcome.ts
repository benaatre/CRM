import type { FollowUpResult, LeadStage } from "@prisma/client";
import { resultToStage, KEEP_STAGE_RESULTS, VISIT_APPOINTMENT_RESULTS } from "./labels";

/**
 * مصدر الحقيقة الواحد لعواقب نتيجة المتابعة (المرحلة/الأرشفة/الإلزامات).
 * POST وPATCH في /api/leads/[id]/followups يقرآن من هنا — أي قاعدة جديدة تُضاف
 * هنا فقط، حتى لا يتفرّق المساران كما حصل قبل هذا التوحيد.
 */

export { KEEP_STAGE_RESULTS, VISIT_APPOINTMENT_RESULTS };

/** نتائج مرفوضة عند التسجيل: «مهتم» الخام بلا خطوة تالية (محرّك الزيارات). */
export const REJECTED_RESULTS: FollowUpResult[] = ["INTERESTED_SENT_INFO"];
export const REJECTED_RESULT_ERROR = "نتيجة «مهتم» تحتاج خطوة تالية: موعد زيارة أو موعد اتصال أو غير مناسب.";

/** نتائج نصّها إلزامي: ما قاله العميل يُكتب، لا تُقبل بلا ملاحظة. */
export const NOTE_REQUIRED_RESULTS: FollowUpResult[] = ["NOT_INTERESTED_FINAL", "NOT_INTERESTED_OTHER", "ON_HOLD"];

/** نتائج الأرشفة التلقائية مع الإغلاق (الانتساب يبقى — نحتاج نعرف عملاء مين في الأرشيف). */
export const AUTO_ARCHIVE_RESULTS: FollowUpResult[] = ["NOT_INTERESTED_FINAL", "NOT_INTERESTED_MARKETER"];

/** المواعيد بلا تاريخ ما تنحفظ: موعد الزيارة/إعادة الجدولة + موعد الاتصال. */
export const APPOINTMENT_DATE_REQUIRED_RESULTS: FollowUpResult[] = [...VISIT_APPOINTMENT_RESULTS, "INTERESTED_SCHEDULED"];

export type FollowUpOutcome = {
  /** المرحلة الناتجة — "keep" = نتيجة «بلا تغيير مرحلة»، العميل يبقى بمرحلته. */
  stage: LeadStage | "keep";
  /** أرشفة تلقائية (نهائيًا/مسوّق مع إغلاق CLOSED_LOST). */
  archive: boolean;
  requiresNote: boolean;
  /** نتيجة «موعد زيارة»: التاريخ يذهب إلى visitAt لا nextFollowup. */
  requiresVisitDate: boolean;
};

/**
 * عاقبة النتيجة: المرحلة المرسلة صراحةً (requestedStage) تُقدَّم على الجدول —
 * إلا لنتائج «بلا تغيير مرحلة» فالمرحلة تثبت مهما أُرسل (نفس عقد POST القائم).
 */
export function deriveOutcome(result: FollowUpResult, requestedStage?: LeadStage): FollowUpOutcome {
  const stage: LeadStage | "keep" = KEEP_STAGE_RESULTS.includes(result)
    ? "keep"
    : requestedStage ?? resultToStage[result];
  return {
    stage,
    archive: stage === "CLOSED_LOST" && AUTO_ARCHIVE_RESULTS.includes(result),
    requiresNote: NOTE_REQUIRED_RESULTS.includes(result),
    requiresVisitDate: VISIT_APPOINTMENT_RESULTS.includes(result),
  };
}
