import type { LeadStage } from "@prisma/client";

/**
 * نظام الألوان الموحّد — **مصدر الحقيقة الوحيد** لألوان المراحل والنتائج في كل النظام
 * (2026-07-29): الشارات، أزرار النموذج، أعمدة الكانبان، شرائح الفلاتر، القمع، الأجندة.
 * ممنوع أي لون مرحلة hardcoded خارج هذا الملف — كل الشاشات تقرأ منه.
 *
 * الأصناف مكتوبة حرفيًا (لا تركيب ديناميكي) — Tailwind JIT يلتقط الحرفي فقط.
 * الخريطة: جديد رمادي · محاولة أصفر · مهتم أخضر · موعد لاحق سماوي · الزيارة (المرحلتان)
 * أزرق سماوي · تفاوض بنفسجي · في الانتظار برتقالي · حسبة البنك ذهبي · محجوز ذهبي غامق ·
 * بيع أخضر غامق · خاسر أحمر خافت · طلب التواصل في وقت آخر تركوازي.
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
    "text-slate-300 bg-slate-400/10 border-slate-400/30", "bg-slate-400/70", "text-slate-300",
    "border-slate-300 bg-slate-400/20 text-slate-200", "border-slate-400/40 text-slate-300/80 hover:bg-slate-400/10"),
  ATTEMPTED: T(
    "text-yellow-400 bg-yellow-400/10 border-yellow-400/30", "bg-yellow-400/80", "text-yellow-400",
    "border-yellow-400 bg-yellow-400/20 text-yellow-300", "border-yellow-400/40 text-yellow-400/80 hover:bg-yellow-400/10"),
  INTERESTED: T(
    "text-green-400 bg-green-400/10 border-green-400/30", "bg-green-400/80", "text-green-400",
    "border-green-400 bg-green-400/20 text-green-300", "border-green-400/40 text-green-400/80 hover:bg-green-400/10"),
  FOLLOW_UP_LATER: T(
    "text-cyan-400 bg-cyan-400/10 border-cyan-400/30", "bg-cyan-400/80", "text-cyan-400",
    "border-cyan-400 bg-cyan-400/20 text-cyan-300", "border-cyan-400/40 text-cyan-400/80 hover:bg-cyan-400/10"),
  // «الزيارة زيارة»: المرحلتان بلون واحد مميز (الموعد + زار).
  VISIT_SCHEDULED: T(
    "text-sky-400 bg-sky-400/10 border-sky-400/30", "bg-sky-400/80", "text-sky-400",
    "border-sky-400 bg-sky-400/20 text-sky-300", "border-sky-400/40 text-sky-400/80 hover:bg-sky-400/10"),
  VIEWING: T(
    "text-sky-400 bg-sky-400/10 border-sky-400/30", "bg-sky-400/80", "text-sky-400",
    "border-sky-400 bg-sky-400/20 text-sky-300", "border-sky-400/40 text-sky-400/80 hover:bg-sky-400/10"),
  NEGOTIATION: T(
    "text-violet-400 bg-violet-400/10 border-violet-400/30", "bg-violet-400/80", "text-violet-400",
    "border-violet-400 bg-violet-400/20 text-violet-300", "border-violet-400/40 text-violet-400/80 hover:bg-violet-400/10"),
  RESERVED: T(
    "text-amber-500 bg-amber-500/10 border-amber-500/30", "bg-amber-500/80", "text-amber-500",
    "border-amber-500 bg-amber-500/20 text-amber-400", "border-amber-500/40 text-amber-500/80 hover:bg-amber-500/10"),
  CLOSED_WON: T(
    "text-emerald-500 bg-emerald-500/15 border-emerald-500/40", "bg-emerald-500/80", "text-emerald-500",
    "border-emerald-500 bg-emerald-500/20 text-emerald-400", "border-emerald-500/40 text-emerald-500/80 hover:bg-emerald-500/10"),
  CLOSED_LOST: T(
    "text-red-400 bg-red-400/10 border-red-400/30", "bg-red-400/70", "text-red-400",
    "border-red-400 bg-red-400/20 text-red-300", "border-red-400/40 text-red-400/80 hover:bg-red-400/10"),
};

/** شارات المراحل (الاسم التاريخي stageColor في labels يعاد تصديره من هنا). */
export const stageChipClass = Object.fromEntries(
  (Object.keys(STAGE_TONES) as LeadStage[]).map((s) => [s, STAGE_TONES[s].chip]),
) as Record<LeadStage, string>;

// ===== نغمات الحالات/النتائج خارج المراحل =====

/** «في الانتظار» (ON_HOLD / لم يستجب) — برتقالي. */
export const WAITING_TONE = T(
  "text-orange-400 bg-orange-400/10 border-orange-400/30", "bg-orange-400/80", "text-orange-400",
  "border-orange-400 bg-orange-400/20 text-orange-300", "border-orange-400/40 text-orange-400/80 hover:bg-orange-400/10");

/** «حسبة البنك» — ذهبي (هوية النظام). */
export const BANK_TONE = T(
  "text-gold bg-gold/10 border-gold/30", "bg-gold/80", "text-gold",
  "border-gold bg-gold/20 text-gold", "border-gold/40 text-gold/80 hover:bg-gold/10");

/** «طلب التواصل في وقت آخر» — تركوازي. */
export const CALL_LATER_TONE = T(
  "text-teal-400 bg-teal-400/10 border-teal-400/30", "bg-teal-400/80", "text-teal-400",
  "border-teal-400 bg-teal-400/20 text-teal-300", "border-teal-400/40 text-teal-400/80 hover:bg-teal-400/10");

/** «غير مهتم» (أسباب الرفض) — أحمر خافت (نفس CLOSED_LOST). */
export const NOT_INTERESTED_TONE = STAGE_TONES.CLOSED_LOST;

/**
 * قيم hex للأنماط المباشرة (inline styles: أشرطة القمع، بطاقات KPI، الرسوم) —
 * نفس درجات Tailwind أعلاه حرفيًا. أي رسم مرتبط بمرحلة يقرأ من هنا.
 */
export const STAGE_HEX: Record<LeadStage, string> = {
  NEW: "#94A3B8",            // slate-400
  ATTEMPTED: "#FACC15",      // yellow-400
  INTERESTED: "#4ADE80",     // green-400
  FOLLOW_UP_LATER: "#22D3EE", // cyan-400
  VISIT_SCHEDULED: "#38BDF8", // sky-400
  VIEWING: "#38BDF8",        // sky-400 («الزيارة زيارة»)
  NEGOTIATION: "#A78BFA",    // violet-400
  RESERVED: "#F59E0B",       // amber-500
  CLOSED_WON: "#10B981",     // emerald-500
  CLOSED_LOST: "#F87171",    // red-400
};
export const WAITING_HEX = "#FB923C";    // orange-400
export const BANK_HEX = "#CBA45E";       // ذهبي الهوية
export const CALL_LATER_HEX = "#2DD4BF"; // teal-400

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
