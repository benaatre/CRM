// منطق «لم يتم الرد» — مصدر الحقيقة الوحيد (نقي: بلا server-only / prisma). يستخدمه المحرّك واللوحات معًا،
// فما يفترق السلوك عن العرض. كل الأرقام تُشتق من دالتين: baseline (المرجع الزمني) + noAnswerCount.
//
// §١ الجدول الجديد (noAnswerCount = متابعات «لم يرد» بعد آخر إسناد فقط — يتصفّر عند النقل):
//   count = 0  → خارج نظام «لم يتم الرد» إطلاقًا
//   count = 1  → مهلة ٣ أيام  ثم «يُسحب الآن»
//   count = 2  → مهلة يومان   ثم «يُسحب الآن»
//   count ≥ ٣  → «يُسحب الآن» فورًا (بلا مهلة)

export type NoResponseConfig = {
  enabled: boolean;      // النظام مفعّل (سحب حقيقي) أم معاينة فقط (dry-run)
  timeoutDays: number[]; // فهرس = عدد المتابعات (٠..٤) → مهلة بالأيام
  immunityCap: number;   // عدد المتابعات الذي يصير بعده العميل محصّنًا نهائيًا
  activationDate: Date | null; // حاجز التفعيل الاختياري (max مع المرجع الزمني) — مستقلّ عن sweepCutoffAt
};

// §١ب: خريطة صريحة بعدد متابعات «لم يرد» (لا فهرسة count): [0]→count=1 (٣ أيام) · [1]→count=2 (يومان).
export const DEFAULT_TIMEOUT_DAYS = [3, 2];
// §١ج: صار «حد السحب الفوري» لا حد الحصانة — count >= هذا الرقم ⟵ overdue فورًا (بلا مهلة).
export const DEFAULT_IMMUNITY_CAP = 3;

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
export function noAnswerStats(followups: { result: string; createdAt: Date }[], assignedAt: Date | null): NoAnswerStats {
  // §١أ: نعتمد فقط متابعات «لم يرد» بعد آخر إسناد (createdAt > assignedAt) — فالعدّاد يتصفّر عند النقل.
  // §١ (إصلاح التسريب): assignedAt=null → لا نعرف متى أُسند → count=0 → out (يذهب لقسم «بحاجة لمراجعة»
  //   عند المالك، لا يُحتسب في السحب). سابقًا كان يعدّ كل المتابعات التاريخية فيتسرّب كـ overdue.
  if (assignedAt === null) return { included: true, noAnswerCount: 0, lastNoAnswerAt: null, lastResult: null };
  const scoped = followups.filter((f) => f.createdAt > assignedAt);
  if (scoped.length === 0) return { included: true, noAnswerCount: 0, lastNoAnswerAt: null, lastResult: null };
  let last = scoped[0];
  let lastNoAnswerAt: Date | null = null;
  let noAnswerCount = 0;
  for (const f of scoped) {
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

/**
 * §١ب: عتبة السحب بالأيام حسب عدد متابعات «لم يرد» — خريطة صريحة بالعدد (لا فهرسة count، تفاديًا للـoff-by-one):
 *   count = 0             → null  (خارج نظام «لم يتم الرد» إطلاقًا)
 *   count = 1             → timeoutDays[0] (٣ أيام افتراضيًا)
 *   count = 2             → timeoutDays[1] (يومان افتراضيًا)
 *   count >= immunityCap  → 0     (سحب فوري — immunityCap صار «حد السحب» لا الحصانة، افتراضي ٣)
 */
export function noResponsePullDay(noAnswerCount: number, config: NoResponseConfig = DEFAULT_NO_RESPONSE_CONFIG): number | null {
  const days = config.timeoutDays.length ? config.timeoutDays : DEFAULT_TIMEOUT_DAYS;
  if (noAnswerCount <= 0) return null;                 // خارج النظام
  if (noAnswerCount >= config.immunityCap) return 0;   // سحب فوري
  if (noAnswerCount === 1) return days[0] ?? 3;
  return days[1] ?? 2;                                 // count === 2 (وأي عدد دون حد السحب)
}

// حالات العرض الأربع:
//   out     → count=0 (خارج نظام «لم يتم الرد» إطلاقًا)
//   grace   → ضمن المهلة، قبل يوم التحذير (daysSince < warnDay)
//   warning → آخر ٢٤ ساعة قبل السحب (warnDay ≤ daysSince < pullDay) — مصدر بانر الموظف (§٥)
//   overdue → تجاوز المهلة (daysSince ≥ pullDay) — «يُسحب الآن»
export type NoResponseState = "out" | "grace" | "warning" | "overdue";

/**
 * حالة العميل حسب عدد متابعات «لم يرد» و daysSince منذ baseline. warnDay = pullDay − ١:
 *  count=1 → pull يوم ٣ · warn يوم ٢ · count=2 → pull يوم ٢ · warn يوم ١ · count≥٣ → overdue فورًا (بلا warning).
 */
export function noResponseState(
  noAnswerCount: number,
  baseline: Date | null,
  now: Date,
  config: NoResponseConfig = DEFAULT_NO_RESPONSE_CONFIG,
): { state: NoResponseState; daysSince: number; pullDay: number | null; warnDay: number | null } {
  const pullDay = noResponsePullDay(noAnswerCount, config);
  if (pullDay === null) return { state: "out", daysSince: 0, pullDay: null, warnDay: null };
  const warnDay = Math.max(0, pullDay - 1); // آخر ٢٤ ساعة قبل السحب (count≥٣: pullDay=warnDay=0 → overdue فورًا)
  const daysSince = baseline ? (now.getTime() - baseline.getTime()) / DAY_MS : 0;
  const state: NoResponseState = daysSince >= pullDay ? "overdue" : daysSince >= warnDay ? "warning" : "grace";
  return { state, daysSince, pullDay, warnDay };
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
  immune: "استنفاد (٣+)", // §٣: كان «محصّن (٥+)» — count≥حد السحب صار استنفاد محاولات لا حصانة
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
    // §١ج: NO_RESPONSE_IMMUNITY_CAP احتفظ باسمه لكن دلالته تبدّلت: صار «حد السحب الفوري» لا حد الحصانة —
    //      أي عميل noAnswerCount >= هذا الرقم يصير overdue فورًا (بلا مهلة). الافتراضي ٣.
    immunityCap: Number.isFinite(capRaw) && capRaw > 0 ? capRaw : DEFAULT_IMMUNITY_CAP,
    activationDate: parseActivation(process.env.NO_RESPONSE_ACTIVATION_DATE),
  };
}
