/**
 * فئات الإشعارات النيتف السبع + اشتقاق معرّف القناة.
 *
 * منطق نقي بلا استيرادات — يعمل على الخادم (بناء حمولة FCM) وعلى العميل
 * (إنشاء القنوات عبر بلجن Capacitor) من نفس المصدر، فلا ينحرف الطرفان.
 */

export type PushCategory =
  | "new_lead"      // عميل جديد
  | "pull_warn"     // إنذار سحب
  | "appointments"  // مواعيد ومتابعات
  | "achievement"   // إنجاز
  | "reassigned"    // إعادة توزيع
  | "stale"         // عميل راكد
  | "staff";        // حالة الموظفين

export const CATEGORIES: PushCategory[] = [
  "new_lead", "pull_warn", "appointments", "achievement", "reassigned", "stale", "staff",
];

/** بادئة قنواتنا — تُميّز ما نملك حذفه عند التنظيف عن قنوات أي بلجن آخر. */
export const CHANNEL_PREFIX = "sultan_";

/**
 * قناة احتياط دائمة لا تُحذف ولا يتغيّر صوتها.
 * مسجّلة في المانيفست كـdefault_notification_channel_id: لو وصل إشعار بمعرّف
 * قناة لم تُنشأ بعد على الجهاز (نافذة ما بين تغيير المالك للصوت وأول فتح
 * للتطبيق)، يعرضه أندرويد على هذه بدل أن يُسقطه بصمت.
 */
export const FALLBACK_CHANNEL = `${CHANNEL_PREFIX}fallback`;

export const CATEGORY_META: Record<PushCategory, {
  label: string;
  description: string;
  /** 5 = HIGH (منبثق + صوت)، 3 = DEFAULT (صوت بلا انبثاق) */
  importance: 5 | 4 | 3;
  vibration: boolean;
  /** النغمة الافتراضية لو ما اختار المالك شيئًا */
  defaultSound: string;
}> = {
  new_lead: {
    label: "عميل جديد",
    description: "توزّع عليك عميل، وعملاء الشيت الجدد",
    importance: 5,
    vibration: true,
    defaultSound: "/sounds/level_up.wav",
  },
  pull_warn: {
    label: "إنذار سحب",
    description: "إنذار قبل سحب عميل، ومتابعة فاتت موعدها",
    importance: 5,
    vibration: true,
    defaultSound: "/sounds/alert_strong.wav",
  },
  appointments: {
    label: "مواعيد ومتابعات",
    description: "متابعات اليوم ومواعيد الزيارات",
    importance: 5,
    vibration: true,
    defaultSound: "/sounds/doorbell.wav",
  },
  achievement: {
    label: "إنجاز",
    description: "حجز أو بيع وحدة",
    importance: 5,
    vibration: true,
    defaultSound: "/sounds/success.wav",
  },
  reassigned: {
    label: "إعادة توزيع",
    description: "انتقال العملاء وإعادة توزيعهم وسحوبات عدم الرد",
    importance: 5,
    vibration: true,
    defaultSound: "/sounds/error_tone.wav",
  },
  stale: {
    label: "عميل راكد",
    description: "عميل بلا تواصل من ٣ أيام",
    importance: 3,
    vibration: false,
    defaultSound: "/sounds/rising.wav",
  },
  staff: {
    label: "حالة الموظفين",
    description: "توقف الموظفين ورجوعهم وركودهم، وتنبيهات الإدارة",
    importance: 3,
    vibration: false,
    defaultSound: "/sounds/ui_pop.wav",
  },
};

/**
 * توزيع الأحداث كلها على الفئات — العشرون مفتاحًا صراحةً بالاسم: الأحد عشر
 * المسجّلة في NOTIFICATION_EVENTS والتسعة التي تستدعي notify() مباشرة.
 *
 * ملاحظة: followup_due يُطلق بمفتاح واحد لحالتين (مستحقة/فات موعدها) من
 * scheduled.ts — فالفاتّة تُمرَّر بتجاوز صريح (categoryOverride) إلى
 * pull_warn عند الإطلاق، وهذه الخريطة تعطي المستحقة «مواعيد ومتابعات».
 */
const CATEGORY_BY_EVENT: Record<string, PushCategory> = {
  // ===== عميل جديد =====
  lead_assigned: "new_lead",
  new_lead_from_sheet: "new_lead",
  // ===== إنذار سحب =====
  "sweep.warn": "pull_warn",
  "no_response.warn": "pull_warn",
  // ===== مواعيد ومتابعات =====
  followup_due: "appointments",
  visit_due: "appointments",
  // ===== إنجاز =====
  unit_booked_sold: "achievement",
  // ===== إعادة توزيع =====
  lead_reassigned: "reassigned",
  // كان ساقطًا من خريطة النسخة الثلاثية فينزلق لأهدأ فئة — وهو من أهم ما
  // يجب أن يوقظ الموظف. مسمّى هنا صراحةً كي لا يسقط ثانية.
  lead_lost: "reassigned",
  "no_response.pulled": "reassigned",
  "dist.auto_sweep": "reassigned",
  "dist.sweep_candidates": "reassigned",
  "dist.capped": "reassigned",
  "booking.cancelled": "reassigned",
  // ===== عميل راكد =====
  never_contacted: "stale",
  // ===== حالة الموظفين =====
  employee_idle: "staff",
  employee_paused: "staff",
  "availability.paused": "staff",
  "availability.resumed": "staff",
  "discount.exceeded": "staff",
  // ===== حوكمة الدوام (المرحلة ٢) — إشعارات المالك على أهدأ فئة =====
  "attendance.checked_in": "staff",
  "attendance.completed": "staff",
  "attendance.no_show": "staff",
  "attendance.verify_missed": "staff",
  "attendance.verify_out_of_zone": "staff",
  // الدفعة الثانية والثالثة — تغيير الموقع خارج النطاق، التوقف والرجوع.
  "attendance.out_of_zone": "staff",
  "attendance.paused": "staff",
  "attendance.resumed": "staff",
  // الدفعة الرابعة — أوضاع اليوم.
  "attendance.remote_day": "staff",
  "attendance.leave_declared": "staff",
  "attendance.leave_cancelled": "staff",
  // نداء التحقق نفسه للموظف — عاجل بمهلة قصيرة، فيأخذ أقوى قناة (منبثق + صوت).
  "attendance.verify": "pull_warn",
  // تذكير الموقوف «رجعت؟» — للموظف، فعل مطلوب لكنه ليس إنذارًا.
  "attendance.pause_reminder": "appointments",
  // تذكير البصم «دوامك بدأ» — للموظف، فعل مطلوب لكنه ليس إنذارًا.
  "attendance.punch_reminder": "appointments",
  // ===== الدوام الواقعي =====
  // «بصمنا لك ✓» للموظف — بشرى هادئة لا إنذار.
  "attendance.auto_punch": "appointments",
  // «افتح التطبيق وأكّد موقعك» أثناء الزيارة — عاجل للموظف.
  "attendance.confirm_location": "pull_warn",
  // إجابات شاشة الحسم — للمالك.
  "attendance.decision": "staff",
  // الإقفال الآلي القانوني — للمالك.
  "attendance.auto_closed": "staff",
  // تنبيه قرار النبض (فلسفة النبض الحاكم) — للمالك: خارج النطاق/منقطع.
  "attendance.pulse_alert": "staff",
  // تأخر عن ورديته («بصمة فقط» — الدفعة أ): للمسؤولين، مرة باليوم لكل موظف.
  "attendance.late": "staff",
  // ملخص النبض الإخباري (quietMode — الدفعة ب): للمالك كل نصف ساعة.
  "attendance.quiet_pulse": "staff",
  // طلب إجازة جديد — للمختصين حسب توزيع التنبيهات.
  "leave.requested": "staff",
  // ===== شفافية سلطة المالي (البند ٨) — إشعارات البائع عن عمليات غيره على حجوزاته =====
  "booking.on_behalf": "achievement",
  "booking.updated_by_other": "reassigned",
  "booking.cancelled_by_other": "reassigned",
  "booking.delivered_by_other": "achievement",
};

/**
 * فئة الحدث. الخريطة تسمّي كل المفاتيح العشرين صراحةً — الافتراضي هنا شبكة
 * أمان لمفتاح جديد يُنسى مستقبلًا، ويقع على أهدأ فئة عمدًا.
 */
export function categoryFor(eventKey: string, override?: PushCategory | null): PushCategory {
  if (override) return override;
  return CATEGORY_BY_EVENT[eventKey] ?? "staff";
}

/** خريطة العرض للمالك: فئة ← مفاتيح أحداثها (مرتّبة كترتيب التعريف). */
export function eventsByCategory(): Record<PushCategory, string[]> {
  const out = {} as Record<PushCategory, string[]>;
  for (const c of CATEGORIES) out[c] = [];
  for (const [key, cat] of Object.entries(CATEGORY_BY_EVENT)) out[cat].push(key);
  return out;
}

/**
 * أسماء الأحداث التسعة التي تستدعي notify() مباشرة — ليست في
 * NOTIFICATION_EVENTS (لا صفوف إعدادات لها) فليس لها اسم هناك، وبدون هذه
 * الخريطة تظهر شاراتها في شاشة النغمات بمفاتيحها الإنجليزية الخام.
 */
export const DIRECT_EVENT_LABELS: Record<string, string> = {
  lead_lost: "انتقل عميل من عندك",
  "no_response.pulled": "سحب تلقائي لعدم الرد",
  "dist.sweep_candidates": "مرشّحون للسحب",
  "dist.auto_sweep": "سحب تلقائي: متأخر",
  "dist.capped": "عميل تجاوز حد إعادة التوجيه",
  "availability.paused": "إيقاف استقبال موظف",
  "availability.resumed": "رجوع موظف للاستقبال",
  "booking.cancelled": "إلغاء حجز",
  "booking.on_behalf": "بيعة سُجّلت باسمك",
  "booking.updated_by_other": "تعديل حجز من حجوزاتك",
  "booking.cancelled_by_other": "إلغاء حجز من حجوزاتك",
  "booking.delivered_by_other": "تأكيد استلام من بيعاتك",
  "discount.exceeded": "تجاوز خصم",
  "attendance.checked_in": "داوم موظف",
  "attendance.completed": "موظف أكمل دوامه",
  "attendance.no_show": "موظف ما داوم",
  "attendance.verify_missed": "نداء تحقق فائت",
  "attendance.verify_out_of_zone": "رد تحقق خارج النطاق",
  "attendance.out_of_zone": "تغيير موقع خارج النطاق",
  "attendance.paused": "استئذان/مغادرة موظف",
  "attendance.resumed": "رجوع موظف لدوامه",
  "attendance.remote_day": "يوم عن بُعد",
  "attendance.leave_declared": "إجازة ذاتية",
  "attendance.leave_cancelled": "إلغاء إجازة (للموظف)",
  "attendance.verify": "نداء تحقق (للموظف)",
  "attendance.pause_reminder": "تذكير الموقوف (للموظف)",
  "attendance.punch_reminder": "تذكير الحضور (للموظف)",
  "attendance.pulse_alert": "تنبيه قرار النبض (للمالك)",
  "attendance.late": "تأخر عن ورديته",
  "attendance.quiet_pulse": "ملخص النبض الإخباري (للمالك)",
  "leave.requested": "طلب إجازة جديد (للمختصين)",
};

/**
 * اسم مورد res/raw من مسار النغمة على الويب: /sounds/level_up.wav ← notif_level_up.wav
 * (قيود res/raw: حروف صغيرة وأرقام وشرطة سفلية، ولا يبدأ برقم).
 * يرجّع null لنغمة مرفوعة من المالك — تلك ما لها مقابل داخل الـAPK.
 */
export function rawNameFor(fileUrl: string | null | undefined): string | null {
  if (!fileUrl) return null;
  const m = fileUrl.match(/^\/sounds\/([a-z][a-z0-9_]*)\.wav$/);
  return m ? `notif_${m[1]}.wav` : null;
}

/**
 * معرّف القناة = الفئة + اسم النغمة.
 *
 * لماذا اشتقاق من النغمة لا عدّاد نسخ: أندرويد يجمّد صوت القناة لحظة إنشائها
 * ولا يقبل تعديله، فتغيير الصوت يستلزم معرّفًا جديدًا. ربط المعرّف بالنغمة
 * يجعل العلاقة (فئة+نغمة) ⟺ معرّف ثابتة: الرجوع لنغمة سابقة يعيد استخدام
 * قناتها الصحيحة بدل توليد v3 بنفس صوت v1، والعملية idempotent تمامًا.
 */
export function channelIdFor(category: PushCategory, rawName: string): string {
  return `${CHANNEL_PREFIX}${category}__${rawName.replace(/\.wav$/, "")}`;
}
