/**
 * فئات الإشعارات النيتف الثلاث + اشتقاق معرّف القناة.
 *
 * منطق نقي بلا استيرادات — يعمل على الخادم (بناء حمولة FCM) وعلى العميل
 * (إنشاء القنوات عبر بلجن Capacitor) من نفس المصدر، فلا ينحرف الطرفان.
 */

export type PushCategory = "urgent" | "normal" | "info";

export const CATEGORIES: PushCategory[] = ["urgent", "normal", "info"];

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
  urgent: {
    label: "عاجل",
    description: "إنذار قبل سحب عميل، عميل وصلك، متابعة فاتت موعدها",
    importance: 5,
    vibration: true,
    defaultSound: "/sounds/urgent.wav",
  },
  normal: {
    label: "عادي",
    description: "متابعات اليوم، مواعيد الزيارات، الحجوزات، إعادة التوزيع",
    importance: 5,
    vibration: true,
    defaultSound: "/sounds/soft.wav",
  },
  info: {
    label: "معلومات",
    description: "عملاء من الشيت، حالة الموظفين، وبقية التنبيهات",
    importance: 3,
    vibration: false,
    defaultSound: "/sounds/click.wav",
  },
};

/**
 * توزيع الأحداث على الفئات.
 *
 * ملاحظة: followup_due يُطلق بمفتاح واحد لحالتين (مستحقة/فات موعدها) من
 * scheduled.ts — فالفاتّة تُمرَّر بتجاوز صريح (categoryOverride) عند الإطلاق،
 * وهذه الخريطة تعطي المستحقة «عادي».
 */
const CATEGORY_BY_EVENT: Record<string, PushCategory> = {
  // ===== عاجل =====
  "sweep.warn": "urgent",
  "no_response.warn": "urgent",
  lead_assigned: "urgent",
  // ===== عادي =====
  followup_due: "normal",
  visit_due: "normal",
  unit_booked_sold: "normal",
  lead_reassigned: "normal",
  // ===== معلومات =====
  employee_idle: "info",
  employee_paused: "info",
  new_lead_from_sheet: "info",
  never_contacted: "info",
};

/**
 * فئة الحدث. الأنواع التي تستدعي notify() مباشرة (خارج الأحداث الأحد عشر)
 * تقع على «معلومات» افتراضيًا — عدا المذكورَين أعلاه صراحةً.
 */
export function categoryFor(eventKey: string, override?: PushCategory | null): PushCategory {
  if (override) return override;
  return CATEGORY_BY_EVENT[eventKey] ?? "info";
}

/** خريطة العرض للمالك: فئة ← مفاتيح أحداثها (مرتّبة كترتيب التعريف). */
export function eventsByCategory(): Record<PushCategory, string[]> {
  const out: Record<PushCategory, string[]> = { urgent: [], normal: [], info: [] };
  for (const [key, cat] of Object.entries(CATEGORY_BY_EVENT)) out[cat].push(key);
  return out;
}

/**
 * اسم مورد res/raw من مسار النغمة على الويب: /sounds/bell.wav ← notif_bell.wav
 * (قيود res/raw: حروف صغيرة وشرطة سفلية فقط، ولا يبدأ برقم).
 * يرجّع null لنغمة مرفوعة من المالك — تلك ما لها مقابل داخل الـAPK.
 */
export function rawNameFor(fileUrl: string | null | undefined): string | null {
  if (!fileUrl) return null;
  const m = fileUrl.match(/^\/sounds\/([a-z]+)\.wav$/);
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
