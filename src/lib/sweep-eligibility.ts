// منطق أهلية السحب — نقي تمامًا (بلا server-only / prisma / أي استيراد). مصدر الحقيقة الوحيد
// لقرار «هل يُسحب هذا الليد؟». يستخدمه الـsweep الفعلي (auto-distribute) والفحص الآلي معًا،
// فما يفترق السلوك عن الاختبار. كل قواعد الحماية الدائمة + الحاجز التاريخي + نموذج المهلتين هنا.

// سقف إعادة التوجيه التلقائي — بعده يبقى العميل مع آخر موظف ويُصعَّد للمالك (#22).
export const MAX_REASSIGNS = 3;

// شبكة أمان المهلة:
export const MIN_REASSIGN_TIMEOUT_MIN = 24 * 60;   // الحد الأدنى المطلق لمهلة السحب: ٢٤ ساعة (لا أقل مهما كان الإعداد)
export const ESTABLISHED_TIMEOUT_MIN = 48 * 60;    // مهلة الليد المُسند من زمان (الافتراضي الموصى): ٤٨ ساعة
export const NEW_LEAD_TIMEOUT_MIN = 60;            // مهلة الليد الجديد فعلًا: ٦٠ دقيقة
export const NEW_LEAD_MAX_AGE_MS = 6 * 60 * 60_000; // نافذة «جديد فعلًا»: دخل النظام وأُسند خلال آخر ٦ ساعات

export type TimeoutSettings = { distTimeoutMin: number };
export type CutoffSettings = { sweepCutoffAt: Date };

/**
 * مهلة السحب لعميل بعينه بالدقائق حسب نموذج المهلتين:
 *  - «جديد فعلًا» (٦٠ دقيقة) فقط لو الشروط الثلاثة معًا: reassignCount==0 + createdAt خلال ٦ ساعات
 *    + assignedAt خلال ٦ ساعات. (createdAt هو المؤشّر غير الملوّث بتصفير العدّاد في الاسترجاعات.)
 *  - غير ذلك → مهلة المُسند من زمان (٤٨ ساعة)، بحدّ أدنى مطلق ٢٤ ساعة على أي إعداد.
 */
export function leadTimeoutMin(
  lead: { reassignCount: number; createdAt: Date; assignedAt: Date | null },
  settings: TimeoutSettings,
  now: Date,
): number {
  const isTrulyNew =
    lead.reassignCount === 0 &&
    now.getTime() - lead.createdAt.getTime() <= NEW_LEAD_MAX_AGE_MS &&
    lead.assignedAt != null && now.getTime() - lead.assignedAt.getTime() <= NEW_LEAD_MAX_AGE_MS;
  if (isTrulyNew) return NEW_LEAD_TIMEOUT_MIN;
  return Math.max(settings.distTimeoutMin, MIN_REASSIGN_TIMEOUT_MIN);
}

export type SweepEligibilityInput = {
  assignedToId: string | null;
  assignedAt: Date | null;
  contactedAt: Date | null;
  isArchived: boolean;
  stage: string;
  reassignCount: number;
  createdAt: Date;
  manualAssignedAt: Date | null;
  hasFollowUp: boolean; // له متابعة واحدة على الأقل بأي وقت
};

/** سبب استبعاد الليد من السحب (أو null لو مؤهّل للترشيح). للفحص والّلوق. */
export function sweepIneligibleReason(
  lead: SweepEligibilityInput,
  settings: TimeoutSettings & CutoffSettings,
  now: Date,
): string | null {
  if (!lead.assignedToId || lead.assignedAt == null) return "غير مُسند";
  if (lead.isArchived) return "مؤرشف";
  // قاعدة ١: الحصانة الدائمة بلا مهلة — متابعة واحدة / تواصل مسجّل / مرحلة تقدّمت عن NEW.
  if (lead.hasFollowUp) return "له متابعة (حصانة دائمة)";
  if (lead.contactedAt != null) return "تواصل مسجّل (حصانة دائمة)";
  if (lead.stage !== "NEW") return "المرحلة ليست NEW (حصانة دائمة)";
  // قاعدة ٢: حصانة الإسناد اليدوي الدائمة.
  if (lead.manualAssignedAt != null) return "أُسند يدويًا (حصانة دائمة)";
  // قاعدة ٣: الحاجز التاريخي.
  if (lead.assignedAt < settings.sweepCutoffAt) return "قبل الحاجز التاريخي (sweepCutoffAt)";
  // #22: تجاوز سقف إعادة التوجيه — يبقى مع آخر موظف ويُصعَّد للمالك.
  if (lead.reassignCount >= MAX_REASSIGNS) return "تجاوز سقف إعادة التوجيه";
  // المهلة (نموذج المهلتين) لم تنقضِ بعد.
  const tmin = leadTimeoutMin(lead, settings, now);
  if (lead.assignedAt.getTime() > now.getTime() - tmin * 60_000) return `المهلة لم تنقضِ (${tmin}د)`;
  return null;
}

/** هل الليد مؤهّل للترشيح للسحب؟ (قاعدة الحقيقة النقية.) */
export function sweepEligible(lead: SweepEligibilityInput, settings: TimeoutSettings & CutoffSettings, now: Date): boolean {
  return sweepIneligibleReason(lead, settings, now) === null;
}

/** قاعدة ٤: التوزيع الأولي لا يمسّ إلا غير المُسند (assignedToId=null) + NEW + غير مؤرشف. */
export function initialDistributeEligible(lead: { assignedToId: string | null; stage: string; isArchived: boolean }): boolean {
  return lead.assignedToId === null && lead.stage === "NEW" && !lead.isArchived;
}
