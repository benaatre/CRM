import type { LeadStage } from "@prisma/client";

/**
 * نظام الألوان الموحّد — **مصدر الحقيقة الوحيد** لألوان المراحل والنتائج في كل النظام
 * (2026-07-29): الشارات، أزرار النموذج، أعمدة الكانبان، شرائح الفلاتر، القمع.
 * ممنوع أي لون مرحلة hardcoded خارج هذا الملف — كل الشاشات تقرأ منه.
 *
 * الأصناف مكتوبة حرفيًا (لا تركيب ديناميكي) — Tailwind JIT يلتقط الحرفي فقط.
 * الخريطة: جديد رمادي · محاولة أصفر · مهتم أخضر · موعد لاحق سماوي · الزيارة (المرحلتان)
 * أزرق سماوي · تفاوض بنفسجي · في الانتظار برتقالي · حسبة البنك ذهبي · محجوز ذهبي غامق ·
 * بيع أخضر غامق · خاسر أحمر خافت · طلب التواصل في وقت آخر تركوازي.
 *
 * درجات خافتة هادئة تناسب خلفية ‎#0A0A0B — القاعدة: تمييز المرحلة بلمحة بدون ما أي لون
 * يصرخ، والذهبي ‎#CBA45E يظل سيد الثيم (الألوان تكمله ما تنافسه). الوصفة الموحّدة:
 * شارة = خلفية بشفافية منخفضة (bg-{c}-500/15) + نص فاتح هادئ (text-{c}-300) + حد خفيف
 * (border-{c}-500/30)؛ التفعيل = نفس الروح بدرجة أوضح بلا إشباع عالٍ.
 */
export type StageTone = {
  /** شارة: نص + خلفية شفافة + حد — للشارات في القوائم/الدرج/الملف/رؤوس الكانبان. */
  chip: string;
  /** تعبئة صلبة — أشرطة القمع والرسوم المرتبطة بالمرحلة. */
  solid: string;
  /** نص ملوّن فقط. */
  text: string;
  /** شريحة فلتر مفعّلة (خلفية أقوى + حد كامل). */
  active: string;
  /** شريحة فلتر خاملة (حد ملوّن خافت يوحي بلون المرحلة). */
  idle: string;
};

const T = (chip: string, solid: string, text: string, active: string, idle: string): StageTone =>
  ({ chip, solid, text, active, idle });

export const STAGE_TONES: Record<LeadStage, StageTone> = {
  NEW: T(
    "text-slate-300 bg-slate-500/15 border-slate-500/30", "bg-slate-500/60", "text-slate-300",
    "border-slate-400 bg-slate-500/25 text-slate-200", "border-slate-500/20 text-slate-300/60 hover:bg-slate-500/10 hover:text-slate-300"),
  ATTEMPTED: T(
    "text-yellow-300 bg-yellow-500/15 border-yellow-500/30", "bg-yellow-500/60", "text-yellow-300",
    "border-yellow-400 bg-yellow-500/25 text-yellow-200", "border-yellow-500/20 text-yellow-300/60 hover:bg-yellow-500/10 hover:text-yellow-300"),
  INTERESTED: T(
    "text-green-300 bg-green-500/15 border-green-500/30", "bg-green-500/60", "text-green-300",
    "border-green-400 bg-green-500/25 text-green-200", "border-green-500/20 text-green-300/60 hover:bg-green-500/10 hover:text-green-300"),
  FOLLOW_UP_LATER: T(
    "text-cyan-300 bg-cyan-500/15 border-cyan-500/30", "bg-cyan-500/60", "text-cyan-300",
    "border-cyan-400 bg-cyan-500/25 text-cyan-200", "border-cyan-500/20 text-cyan-300/60 hover:bg-cyan-500/10 hover:text-cyan-300"),
  // «الزيارة زيارة»: المرحلتان بلون واحد مميز (الموعد + زار).
  VISIT_SCHEDULED: T(
    "text-sky-300 bg-sky-500/15 border-sky-500/30", "bg-sky-500/60", "text-sky-300",
    "border-sky-400 bg-sky-500/25 text-sky-200", "border-sky-500/20 text-sky-300/60 hover:bg-sky-500/10 hover:text-sky-300"),
  VIEWING: T(
    "text-sky-300 bg-sky-500/15 border-sky-500/30", "bg-sky-500/60", "text-sky-300",
    "border-sky-400 bg-sky-500/25 text-sky-200", "border-sky-500/20 text-sky-300/60 hover:bg-sky-500/10 hover:text-sky-300"),
  NEGOTIATION: T(
    "text-violet-300 bg-violet-500/15 border-violet-500/30", "bg-violet-500/60", "text-violet-300",
    "border-violet-400 bg-violet-500/25 text-violet-200", "border-violet-500/20 text-violet-300/60 hover:bg-violet-500/10 hover:text-violet-300"),
  RESERVED: T(
    "text-amber-300 bg-amber-500/15 border-amber-500/30", "bg-amber-500/60", "text-amber-300",
    "border-amber-400 bg-amber-500/25 text-amber-200", "border-amber-500/20 text-amber-300/60 hover:bg-amber-500/10 hover:text-amber-300"),
  CLOSED_WON: T(
    "text-emerald-300 bg-emerald-500/15 border-emerald-500/30", "bg-emerald-500/60", "text-emerald-300",
    "border-emerald-400 bg-emerald-500/25 text-emerald-200", "border-emerald-500/20 text-emerald-300/60 hover:bg-emerald-500/10 hover:text-emerald-300"),
  CLOSED_LOST: T(
    "text-red-300 bg-red-500/15 border-red-500/30", "bg-red-500/60", "text-red-300",
    "border-red-400 bg-red-500/25 text-red-200", "border-red-500/20 text-red-300/60 hover:bg-red-500/10 hover:text-red-300"),
};

/** شارات المراحل (الاسم التاريخي stageColor في labels يعاد تصديره من هنا). */
export const stageChipClass = Object.fromEntries(
  (Object.keys(STAGE_TONES) as LeadStage[]).map((s) => [s, STAGE_TONES[s].chip]),
) as Record<LeadStage, string>;

// ===== نغمات الحالات/النتائج خارج المراحل =====

/** «في الانتظار» (ON_HOLD / لم يستجب) — برتقالي. */
export const WAITING_TONE = T(
  "text-orange-300 bg-orange-500/15 border-orange-500/30", "bg-orange-500/60", "text-orange-300",
  "border-orange-400 bg-orange-500/25 text-orange-200", "border-orange-500/20 text-orange-300/60 hover:bg-orange-500/10 hover:text-orange-300");

/** «حسبة البنك» — ذهبي (هوية النظام — يبقى كما هو، سيد الثيم). */
export const BANK_TONE = T(
  "text-gold bg-gold/10 border-gold/30", "bg-gold/80", "text-gold",
  "border-gold bg-gold/20 text-gold", "border-gold/30 text-gold/60 hover:bg-gold/10 hover:text-gold/80");

/** «طلب التواصل في وقت آخر» — تركوازي. */
export const CALL_LATER_TONE = T(
  "text-teal-300 bg-teal-500/15 border-teal-500/30", "bg-teal-500/60", "text-teal-300",
  "border-teal-400 bg-teal-500/25 text-teal-200", "border-teal-500/20 text-teal-300/60 hover:bg-teal-500/10 hover:text-teal-300");

/** «غير مهتم» (أسباب الرفض) — أحمر خافت (نفس CLOSED_LOST). */
export const NOT_INTERESTED_TONE = STAGE_TONES.CLOSED_LOST;

/**
 * قيم hex للأنماط المباشرة (inline styles: أشرطة القمع، بطاقات KPI، الرسوم) —
 * درجات متوسطة الإشباع (مو نيون) مضبوطة يدويًا لتريح العين على الخلفية الداكنة
 * وتكمل ذهبي الهوية. أي رسم مرتبط بمرحلة يقرأ من هنا.
 */
export const STAGE_HEX: Record<LeadStage, string> = {
  NEW: "#8E99AB",             // رمادي هادئ
  ATTEMPTED: "#D6B85A",       // أصفر مطفأ
  INTERESTED: "#6FBF8B",      // أخضر هادئ
  FOLLOW_UP_LATER: "#55B7C9", // سماوي مطفأ
  VISIT_SCHEDULED: "#6AA9DC", // أزرق سماوي هادئ
  VIEWING: "#6AA9DC",         // («الزيارة زيارة»)
  NEGOTIATION: "#A493DE",     // بنفسجي هادئ
  RESERVED: "#D2A250",        // عنبري مطفأ (قريب من الذهبي بلا منافسة)
  CLOSED_WON: "#4DAE93",      // زمردي هادئ
  CLOSED_LOST: "#D98080",     // أحمر خافت
};
export const WAITING_HEX = "#DA9A6B";    // برتقالي مطفأ
export const BANK_HEX = "#CBA45E";       // ذهبي الهوية
export const CALL_LATER_HEX = "#5FB8AD"; // تركوازي هادئ

/** شريحة فلتر مرحلة (مفعّلة/خاملة) — بلون مرحلتها. */
export function stageFilterChip(stage: LeadStage, active: boolean): string {
  const t = STAGE_TONES[stage];
  return `rounded-full border px-3 py-1.5 text-xs transition-colors ${active ? t.active : t.idle}`;
}

/** شريحة فلتر بنغمة مخصّصة (زيارة/في الانتظار/حسبة البنك…). */
export function toneFilterChip(t: StageTone, active: boolean): string {
  return `rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${active ? t.active : t.idle}`;
}

/**
 * أزرار نموذج المتابعات — كل زر بلون نتيجته (مفاتيح followups-form + أول التواصل).
 * غير المُدرج يسقط على نغمة «مهتم» (السلوك القديم كان أخضر موحّدًا).
 */
export const FORM_BUTTON_TONES: Record<string, StageTone> = {
  interested: STAGE_TONES.INTERESTED,
  noanswer: STAGE_TONES.ATTEMPTED,
  appointment: STAGE_TONES.FOLLOW_UP_LATER,
  visit: STAGE_TONES.VISIT_SCHEDULED,
  negotiation: STAGE_TONES.NEGOTIATION,
  booked: STAGE_TONES.RESERVED,
  bankcheck: BANK_TONE,
  onhold: WAITING_TONE,
  notInterested: NOT_INTERESTED_TONE,
  noShow: STAGE_TONES.ATTEMPTED,
  calllater: CALL_LATER_TONE,
};

/** صنف زر النموذج حسب المفتاح والتفعيل. */
export function formButtonClass(key: string, active: boolean): string {
  const t = FORM_BUTTON_TONES[key] ?? STAGE_TONES.INTERESTED;
  return `rounded-lg border px-4 py-2 text-sm transition-colors ${active ? t.active : "border-border text-muted-foreground hover:text-foreground"}`;
}
