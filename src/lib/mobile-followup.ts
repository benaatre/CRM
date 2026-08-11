import type { FollowUpType, FollowUpResult, FollowUpSection, LeadStage } from "@prisma/client";

/**
 * شجرة قرار المتابعة للجوال — **منقولة حرفيًا** من نموذج الويب
 * `src/components/leads/followups-form.tsx` (resultsFor + submit).
 *
 * ⚠️ لماذا نُسخت ولم تُستورد: الدوال هناك خاصة بالوحدة (غير مصدَّرة)، وتعديل ملف
 * ويب قائم ممنوع في هذي المهمة. أي تغيير في شجرة الويب لازم ينعكس هنا —
 * والقيم (result/section/stage) مطابقة حرفًا بحرف حتى لا يتفرّع سلوك الخادم.
 * إلزامات النص/التاريخ تبقى على الخادم (lib/followup-outcome) كما هي.
 */
export type SaveBody = {
  type: FollowUpType;
  result: FollowUpResult;
  section?: FollowUpSection;
  stage: LeadStage;
  note?: string;
  nextDate?: string;
};

/** مفاتيح النتائج المتاحة حسب المرحلة — نسخة طبق الأصل من resultsFor. */
export function resultsFor(stage: LeadStage): string[] {
  switch (stage) {
    case "NEW":
    case "ATTEMPTED":
      return ["interested", "noanswer", "appointment", "notInterested"];
    case "INTERESTED":
      return ["visit", "appointment", "negotiation", "bankcheck", "onhold", "notInterested"];
    case "FOLLOW_UP_LATER":
      return ["interested", "visit", "bankcheck", "onhold", "notInterested"];
    case "VISIT_SCHEDULED":
      return ["visit", "noShow", "bankcheck", "onhold", "notInterested"];
    case "VIEWING":
      return ["visit", "negotiation", "bankcheck", "onhold", "notInterested"];
    case "NEGOTIATION":
      return ["booked", "bankcheck", "onhold", "notInterested"];
    default:
      return [];
  }
}

export const RESULT_LABEL: Record<string, string> = {
  interested: "مهتم",
  noanswer: "لم يرد",
  appointment: "موعد لاحق",
  visit: "زيارة",
  negotiation: "تفاوض",
  notInterested: "غير مهتم",
  booked: "تم الحجز",
  bankcheck: "حسبة البنك",
  onhold: "في الانتظار",
  noShow: "ما حضر",
};

/** خطوات «مهتم» الاختيارية. */
export type InterestedStep = "visit" | "call" | "notsuitable";
export const STEP_LABEL: Record<InterestedStep, string> = {
  visit: "زيارة",
  call: "موعد اتصال",
  notsuitable: "غير مناسب",
};

/** أول تواصل — أربعة خيارات. */
export const FC_LABEL = {
  interested: "مهتم",
  noanswer: "لا يرد",
  calllater: "طلب التواصل في وقت آخر",
  notInterested: "غير مهتم",
} as const;
export type FcKey = keyof typeof FC_LABEL;

/** يدمج النص الأساسي مع ملاحظة الموظف — نفس compose في الويب. */
export function compose(base: string, extra: string): string {
  const parts = [base];
  if (extra.trim()) parts.push(extra.trim());
  return parts.join(" — ");
}

/** هل النتيجة تحتاج تاريخ موعد؟ (يطابق APPOINTMENT_DATE_REQUIRED_RESULTS على الخادم) */
export function needsDate(key: string, step: InterestedStep | null): boolean {
  if (key === "appointment" || key === "visit") return true;
  if (key === "interested") return step === "visit" || step === "call";
  if (key === "noShow") return true;
  return false;
}

/** هل النتيجة تحتاج نصًا إلزاميًا؟ («في الانتظار» تحتاج سبب الانتظار) */
export function needsNote(key: string): boolean {
  return key === "onhold";
}

/**
 * هل الاختيار الحالي كاملًا (النتيجة + تفرّعاتها) يفرض تاريخ موعد إلزاميًا؟
 * مطابق لإلزامات الخادم (lib/followup-outcome — APPOINTMENT_DATE_REQUIRED_RESULTS):
 *   موعد لاحق · جدولة زيارة (لا «تمت الزيارة») · مهتم بخطوة زيارة/اتصال ·
 *   «ما حضر — إعادة جدولة» · «غير مهتم — نحاول لاحقًا».
 * الباقي اختياري — الخادم يبقى خط الدفاع الأخير.
 */
export function requiresDate(args: {
  key: string | null;
  step: InterestedStep | null;
  visitAction: "schedule" | "done" | null;
  noShowChoice: "resched" | "reject" | null;
  niRetry: "yes" | "no";
  firstContact: boolean;
}): boolean {
  const { key, step, visitAction, noShowChoice, niRetry, firstContact } = args;
  if (!key) return false;
  const isNi = key === "notInterested" || (key === "noShow" && noShowChoice === "reject");
  if (isNi) return niRetry === "yes";
  if (firstContact) return false; // أول تواصل: الموعد اختياري بكل خياراته (السلوك القائم)
  if (key === "appointment") return true;
  if (key === "visit") return visitAction !== "done";
  if (key === "interested") return step === "visit" || step === "call";
  if (key === "noShow") return noShowChoice === "resched";
  return false;
}

/** يبني جسم الطلب لنتيجة متابعة عادية — القيم كما في submit بالويب. */
export function buildBody(args: {
  key: string;
  stage: LeadStage;
  step: InterestedStep | null;
  visitAction: "schedule" | "done" | null;
  noShowChoice: "resched" | null;
  note: string;
  date: string;
  /** مكان الزيارة — نفس تركيب الويب: مكتب · جميع المشاريع · أسماء مختارة. */
  visitKind?: "project" | "office";
  visitMode?: "all" | "select";
  selProjects?: string[];
}): SaveBody | null {
  const { key, stage, step, visitAction, noShowChoice, note, date } = args;
  const visitKind = args.visitKind ?? "project";
  const place =
    visitKind === "office"
      ? "زيارة للمكتب"
      : (args.visitMode ?? "all") === "all"
        ? "جميع المشاريع"
        : (args.selProjects ?? []).join("، ");
  switch (key) {
    case "interested":
      if (step === "visit")
        return { type: "CALL", result: "INTERESTED_VISIT_SCHEDULED", section: "INTERESTED", stage: "VISIT_SCHEDULED", note: compose("مهتم — موعد زيارة", note), nextDate: date };
      if (step === "call")
        return { type: "CALL", result: "INTERESTED_SCHEDULED", section: "INTERESTED", stage: "FOLLOW_UP_LATER", note: compose("مهتم — موعد اتصال", note), nextDate: date };
      return { type: "CALL", result: "INTERESTED_SCHEDULED", section: "INTERESTED", stage: "INTERESTED", note: compose("مهتم", note), ...(date ? { nextDate: date } : {}) };
    case "noanswer":
      return { type: "CALL", result: "NOT_ANSWERED_SCHEDULED", section: "NO_ANSWER", stage: "ATTEMPTED", note: compose("لم يرد", note) };
    case "appointment":
      return { type: "CALL", result: "INTERESTED_SCHEDULED", section: "INTERESTED", stage: "FOLLOW_UP_LATER", note: compose("موعد لاحق", note), nextDate: date };
    case "visit":
      // «تمت الزيارة» متاحة فقط لمن عنده موعد زيارة قائم.
      if (stage === "VISIT_SCHEDULED" && visitAction === "done")
        return { type: visitKind === "office" ? "VISIT_OFFICE" : "VISIT_PROJECT", result: "INTERESTED_VISITED", section: "INTERESTED", stage: "VIEWING", note: compose(`تمت الزيارة — ${place}`, note) };
      return { type: "CALL", result: "INTERESTED_VISIT_SCHEDULED", section: "INTERESTED", stage: "VISIT_SCHEDULED", note: compose(`موعد زيارة — ${place}`, note), nextDate: date };
    case "noShow":
      if (noShowChoice === "resched")
        return { type: "CALL", result: "INTERESTED_VISIT_SCHEDULED", section: "INTERESTED", stage: "VISIT_SCHEDULED", note: compose("ما حضر — أُعيدت جدولة الزيارة", note), nextDate: date };
      return null; // الرفض يمرّ عبر مسار «غير مهتم» المشترك
    case "negotiation":
      return { type: "CALL", result: "NEGOTIATING", section: "INTERESTED", stage: "NEGOTIATION", note: compose("تفاوض", note) };
    case "bankcheck":
      return { type: "CALL", result: "BANK_CHECK", section: "INTERESTED", stage, note: compose("حسبة البنك", note) };
    case "onhold":
      return { type: "CALL", result: "ON_HOLD", section: "INTERESTED", stage, note: compose("في الانتظار", note), ...(date ? { nextDate: date } : {}) };
    default:
      return null;
  }
}

/** أول تواصل — نفس submitFirstContact بالويب. */
export function buildFirstContactBody(key: FcKey, note: string, date: string): SaveBody | null {
  if (key === "interested")
    return { type: "CALL", result: "INTERESTED_SCHEDULED", section: "INTERESTED", stage: "INTERESTED", note: compose("تم تسجيل أول تواصل: مهتم", note), ...(date ? { nextDate: date } : {}) };
  if (key === "calllater")
    return { type: "CALL", result: "CALL_LATER", stage: "ATTEMPTED", note: compose("تم تسجيل أول تواصل: طلب التواصل في وقت آخر", note), ...(date ? { nextDate: date } : {}) };
  if (key === "noanswer")
    return { type: "CALL", result: "NOT_ANSWERED_SCHEDULED", section: "NO_ANSWER", stage: "ATTEMPTED", note: compose("تم تسجيل أول تواصل: لا يرد", note) };
  return null; // notInterested يمرّ عبر buildNotInterestedBody
}
