// منطق التصعيد المتدرّج لـ«لم يتم الرد» — مصدر الحقيقة الوحيد (نقي: بلا server-only / prisma).
// كل قرارات المهلة/الإنذار/السحب/الحصانة حسب عدد المتابعات هنا. يستخدمه المحرّك واللوحات معًا،
// فما يفترق السلوك عن العرض.
//
// الجدول (مهلة بالأيام حسب عدد المتابعات؛ الإنذار يوم = المهلة، السحب يوم = المهلة + ١):
//   0 متابعة  → مهلة يومان  → إنذار يوم ٢ → سحب يوم ٣
//   1 متابعة  → مهلة يومان  → إنذار يوم ٢ → سحب يوم ٣
//   2 متابعة  → مهلة ٣ أيام → إنذار يوم ٣ → سحب يوم ٤
//   3 متابعات → مهلة ٤ أيام → إنذار يوم ٤ → سحب يوم ٥
//   4 متابعات → مهلة ٥ أيام → إنذار يوم ٥ → سحب يوم ٦
//   5+ متابعات → محصّن نهائيًا، لا يُسحب أبدًا

export type NoResponseConfig = {
  enabled: boolean;      // النظام مفعّل (سحب حقيقي) أم معاينة فقط (dry-run)
  timeoutDays: number[]; // فهرس = عدد المتابعات (٠..٤) → مهلة بالأيام
  immunityCap: number;   // عدد المتابعات الذي يصير بعده العميل محصّنًا نهائيًا
  activationDate: Date | null; // حاجز التفعيل الاختياري (max مع المرجع الزمني) — مستقلّ عن sweepCutoffAt
};

export const DEFAULT_TIMEOUT_DAYS = [2, 2, 3, 4, 5];
export const DEFAULT_IMMUNITY_CAP = 5;

export const DEFAULT_NO_RESPONSE_CONFIG: NoResponseConfig = {
  enabled: false,
  timeoutDays: [...DEFAULT_TIMEOUT_DAYS],
  immunityCap: DEFAULT_IMMUNITY_CAP,
  activationDate: null,
};

const DAY_MS = 24 * 60 * 60 * 1000;

// ===================== نتيجة المتابعة: «لم يرد» فقط تدخل النظام =====================
// النظام يعتمد متابعات «لم يرد» حصريًا. أي نتيجة أخرى = رد العميل → يخرج من النظام.
export const NO_ANSWER_RESULTS = ["NOT_ANSWERED_SCHEDULED", "NOT_ANSWERED_WHATSAPP"] as const;

export function isNoAnswer(result: string | null | undefined): boolean {
  return !!result && (NO_ANSWER_RESULTS as readonly string[]).includes(result);
}

export type NoAnswerStats = {
  included: boolean;           // مشمول في النظام؟ (لا متابعات، أو آخر متابعة «لم يرد»)
  noAnswerCount: number;       // عدد متابعات «لم يرد» (هو العدّاد المعتمد للتصعيد)
  lastNoAnswerAt: Date | null; // آخر متابعة «لم يرد» (المرجع الزمني)
  lastResult: string | null;   // نتيجة آخر متابعة (أيًا كانت) — لتحديد الاستبعاد
};

/**
 * إحصاء «لم يرد» لعميل من متابعاته (نتيجة + وقت، بأي ترتيب) — مصدر واحد للقاعدة الجديدة:
 *  - العدّاد = متابعات «لم يرد» فقط.
 *  - المرجع = آخر متابعة «لم يرد».
 *  - included = false لو آخر متابعة (أحدثها) نتيجتها ليست «لم يرد» (رد العميل → يخرج فورًا).
 *    بلا متابعات → included=true (يعتمد على وقت الإسناد).
 */
export function noAnswerStats(followups: { result: string; createdAt: Date }[]): NoAnswerStats {
  if (followups.length === 0) return { included: true, noAnswerCount: 0, lastNoAnswerAt: null, lastResult: null };
  let last = followups[0];
  let lastNoAnswerAt: Date | null = null;
  let noAnswerCount = 0;
  for (const f of followups) {
    if (f.createdAt > last.createdAt) last = f;
    if (isNoAnswer(f.result)) {
      noAnswerCount++;
      if (!lastNoAnswerAt || f.createdAt > lastNoAnswerAt) lastNoAnswerAt = f.createdAt;
    }
  }
  return { included: isNoAnswer(last.result), noAnswerCount, lastNoAnswerAt, lastResult: last.result };
}

/**
 * المرجع الزمني للعميل في التصعيد = الأحدث بين آخر إسناد (assignedAt) وآخر متابعة «لم يرد» —
 * max(assignedAt, lastFollowUpAt). فأي توزيع جديد (assignedAt يتجدّد عند الاستلام) يمنح الموظف
 * مهلته كاملة من لحظة الاستلام، حتى لو للعميل متابعات «لم يرد» قديمة.
 * ⚠️ عدد المتابعات لا يتصفّر (يبقى في noAnswerStats) — فقط المرجع الزمني يتجدّد.
 * مصدر واحد يشاركه المحرّك واللوحات. (لا يدمج lastContact — المتابعة/الإسناد هما مؤشّرا التحرّك.)
 *
 * حاجز التفعيل الاختياري (NO_RESPONSE_ACTIVATION_DATE): لو مضبوط → baseline = max(المرجع, التفعيل)
 * فيبدأ عدّاد المتراكم القديم من لحظة التفعيل (لا يُسحب فورًا). لو غير مضبوط → بلا حاجز.
 * ملاحظة: هذا مستقلّ تمامًا عن sweepCutoffAt الخاص بمسار السحب بالمهلة.
 */
export function noResponseBaseline(assignedAt: Date | null, lastFollowUpAt: Date | null, activation: Date | null = null): Date | null {
  // الأحدث بين الإسناد وآخر متابعة «لم يرد» — لا «آخر متابعة إن وُجدت وإلا الإسناد».
  const ref = Math.max(assignedAt?.getTime() ?? 0, lastFollowUpAt?.getTime() ?? 0);
  const t = Math.max(ref, activation?.getTime() ?? 0);
  return t > 0 ? new Date(t) : null;
}

export type EscalationTier = {
  followUps: number;
  immune: boolean;
  warnDays: number; // يوم الإنذار (بالأيام)
  pullDays: number; // يوم السحب = warnDays + ١
};

/** طبقة التصعيد لعدد متابعات معيّن حسب الإعداد. */
export function escalationTier(followUpCount: number, config: NoResponseConfig = DEFAULT_NO_RESPONSE_CONFIG): EscalationTier {
  const days = config.timeoutDays.length ? config.timeoutDays : DEFAULT_TIMEOUT_DAYS;
  if (followUpCount >= config.immunityCap) {
    return { followUps: followUpCount, immune: true, warnDays: Infinity, pullDays: Infinity };
  }
  const warnDays = days[Math.min(followUpCount, days.length - 1)];
  return { followUps: followUpCount, immune: false, warnDays, pullDays: warnDays + 1 };
}

export type NoResponseState = "safe" | "pending" | "overdue" | "immune";

/**
 * حالة العميل حسب عدد متابعاته وآخر «لمسة» (آخر متابعة، أو الإسناد لو صفر متابعات):
 *  immune (محصّن ٥+) · overdue (بلغ يوم السحب) · pending (بلغ يوم الإنذار) · safe (لسه).
 */
export function noResponseState(
  followUpCount: number,
  baseline: Date | null,
  now: Date,
  config: NoResponseConfig = DEFAULT_NO_RESPONSE_CONFIG,
): { state: NoResponseState; tier: EscalationTier; daysSince: number } {
  const tier = escalationTier(followUpCount, config);
  if (tier.immune) return { state: "immune", tier, daysSince: 0 };
  if (!baseline) return { state: "safe", tier, daysSince: 0 };
  const daysSince = (now.getTime() - baseline.getTime()) / DAY_MS;
  const state: NoResponseState = daysSince >= tier.pullDays ? "overdue" : daysSince >= tier.warnDays ? "pending" : "safe";
  return { state, tier, daysSince };
}

// ===================== فئات العرض (البانر + لوحة الأرقام) =====================
// خمس فئات تطابق أعمدة لوحة الأرقام: بلا رد · تابع مرة · تابع مرتين · تابع ٣+ · محصّن.

export type EscalationCategory = "none" | "one" | "two" | "threePlus" | "immune";

export const CATEGORY_ORDER: EscalationCategory[] = ["none", "one", "two", "threePlus", "immune"];

export const CATEGORY_LABEL: Record<EscalationCategory, string> = {
  none: "بلا رد إطلاقًا",
  one: "تابع مرة",
  two: "تابع مرتين",
  threePlus: "تابع ٣+",
  immune: "محصّن (٥+)",
};

export function escalationCategory(followUpCount: number, config: NoResponseConfig = DEFAULT_NO_RESPONSE_CONFIG): EscalationCategory {
  if (followUpCount >= config.immunityCap) return "immune";
  if (followUpCount <= 0) return "none";
  if (followUpCount === 1) return "one";
  if (followUpCount === 2) return "two";
  return "threePlus"; // ٣ أو ٤ (دون الحصانة)
}

// ===================== فئات عمر التأخير («يُسحب الآن») =====================
// تفصيل المتأخرين حسب daysSince إلى فترات واضحة (مطلقة، مستقلة عن عدد المتابعات).
// مصدر واحد يشاركه العرض (getPendingPullByEmployee) والسحب (pullGroup) — فما يفترق التصنيف.

export type OverdueAgeBucket = "age_3_7" | "age_8_14" | "age_15_30" | "age_30plus";

export const OVERDUE_AGE_ORDER: OverdueAgeBucket[] = ["age_3_7", "age_8_14", "age_15_30", "age_30plus"];

export const OVERDUE_AGE_LABEL: Record<OverdueAgeBucket, string> = {
  age_3_7: "٣–٧ أيام",
  age_8_14: "٨–١٤ يوم",
  age_15_30: "١٥–٣٠ يوم",
  age_30plus: "أكثر من شهر",
};

/**
 * فئة عمر التأخير حسب daysSince (أيام منذ المرجع الزمني noResponseBaseline). تُستدعى فقط لمن حالته
 * overdue. حدود شاملة بالأرضية (floor): ٣–٧ · ٨–١٤ · ١٥–٣٠ · ٣١+ — بلا فجوات (أي overdue يقع في واحدة).
 */
export function overdueAgeBucket(daysSince: number): OverdueAgeBucket {
  const d = Math.floor(daysSince);
  if (d < 8) return "age_3_7";      // ٣–٧ (وأي حدّ أدنى للسحب)
  if (d < 15) return "age_8_14";    // ٨–١٤
  if (d < 31) return "age_15_30";   // ١٥–٣٠
  return "age_30plus";              // أكثر من شهر
}

// ===================== نص الإنذار (سعودي — صياغة حرفية) =====================
// الترتيب: عدد المتابعات السابقة → «للمرة [الثانية/الثالثة/الرابعة/الخامسة]».
//   متابعة وحدة (١) ← الثانية · متابعتين (٢) ← الثالثة · ٣ ← الرابعة · ٤ ← الخامسة.

const ORDINALS: Record<number, string> = { 1: "الثانية", 2: "الثالثة", 3: "الرابعة", 4: "الخامسة" };

export function nextFollowUpOrdinal(followUpCount: number): string {
  return ORDINALS[followUpCount] ?? "القادمة";
}

/**
 * نص الإنذار المجمّع لموظف حسب عدد المتابعات (صياغة حرفية):
 *  - صفر متابعات: «عندك N عملاء جدد ما تواصلت معهم، المطلوب التواصل معهم قبل سحبهم.»
 *  - متابعة فأكثر: «عندك N عملاء ما تم الرد عليهم، المطلوب متابعتهم للمرة [الترتيب] قبل سحبهم.»
 */
export function warnMessage(followUpCount: number, count: number): string {
  if (followUpCount <= 0) {
    return `عندك ${count} عملاء جدد ما تواصلت معهم، المطلوب التواصل معهم قبل سحبهم.`;
  }
  return `عندك ${count} عملاء ما تم الرد عليهم، المطلوب متابعتهم للمرة ${nextFollowUpOrdinal(followUpCount)} قبل سحبهم.`;
}

// ===================== قارئ الإعداد من env (المرحلة الأولى — بلا حقل قاعدة) =====================
// لا يوجد حقل JSON مخصّص في Settings (notifyConfig محجوز للإشعارات)، فنقرأ من env مؤقتًا.
//   NO_RESPONSE_PULL=on            → النظام مفعّل (سحب حقيقي)، وإلا معاينة (dry-run).
//   NO_RESPONSE_DAYS=2,2,3,4,5     → جدول المهل بالأيام (اختياري).
//   NO_RESPONSE_IMMUNITY_CAP=5     → سقف الحصانة (اختياري).

function parseDays(raw: string | undefined): number[] {
  if (!raw) return [...DEFAULT_TIMEOUT_DAYS];
  const parts = raw.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
  return parts.length ? parts : [...DEFAULT_TIMEOUT_DAYS];
}

function parseActivation(raw: string | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** يقرأ إعداد النظام من env (يُستدعى على الخادم فقط). */
export function getNoResponseConfig(): NoResponseConfig {
  const capRaw = Number(process.env.NO_RESPONSE_IMMUNITY_CAP);
  return {
    enabled: process.env.NO_RESPONSE_PULL === "on",
    timeoutDays: parseDays(process.env.NO_RESPONSE_DAYS),
    immunityCap: Number.isFinite(capRaw) && capRaw > 0 ? capRaw : DEFAULT_IMMUNITY_CAP,
    activationDate: parseActivation(process.env.NO_RESPONSE_ACTIVATION_DATE),
  };
}
