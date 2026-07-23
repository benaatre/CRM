import type {
  Role,
  LeadStage,
  Channel,
  Priority,
  UnitType,
  Floor,
  ActivityType,
  ProjectStatus,
  UnitStatus,
  BookingStage,
  PaymentMethod,
  SaudiBank,
  Nationality,
  DeliveryStatus,
  PurchaseMethod,
  PurchaseGoal,
  CashPaymentType,
  FollowUpType,
  FollowUpResult,
  FollowUpSection,
  FirstContactStage,
} from "@prisma/client";

// تسميات عربية — استيراد الأنواع فقط (type-only) عشان الوحدة آمنة للاستخدام
// في مكوّنات العميل بدون سحب @prisma/client للحزمة.

export const roleLabels: Record<Role, string> = {
  OWNER: "المالك",
  ADMIN: "مدير",
  EMPLOYEE: "موظف مبيعات",
};
export const roleLabel = (role: Role) => roleLabels[role] ?? role;

// ترتيب مراحل خط البيع (أعمدة الكانبان).
export const stageOrder: LeadStage[] = [
  "NEW",
  "ATTEMPTED",
  "INTERESTED",
  "FOLLOW_UP_LATER",
  "VIEWING",
  "NEGOTIATION",
  "RESERVED",
  "CLOSED_WON",
  "CLOSED_LOST",
];

export const stageLabels: Record<LeadStage, string> = {
  NEW: "جديد",
  ATTEMPTED: "محاولة/لم يرد",
  INTERESTED: "مهتم",
  FOLLOW_UP_LATER: "موعد لاحق",
  VIEWING: "زار المشروع",
  NEGOTIATION: "تفاوض",
  RESERVED: "محجوز/عربون",
  CLOSED_WON: "مقفول-بيع",
  CLOSED_LOST: "غير مهتم/خاسر",
};
export const stageLabel = (s: LeadStage) => stageLabels[s] ?? s;

// أصناف ألوان (نص + خلفية شفافة خفيفة + حدّ بنفس اللون) لكل مرحلة — لون مميّز لكل مرحلة بلا تكرار،
// بتباين واضح على خلفية أوبسيديان (#0A0A0B). المصدر الوحيد للجدول/الكانبان/الدرج/الملف/بطاقة الجوال.
export const stageColor: Record<LeadStage, string> = {
  NEW: "text-slate-300 bg-slate-400/10 border-slate-400/30",       // رمادي
  ATTEMPTED: "text-amber-400 bg-amber-400/10 border-amber-400/30", // كهرماني
  INTERESTED: "text-green-400 bg-green-400/10 border-green-400/30", // أخضر
  FOLLOW_UP_LATER: "text-cyan-400 bg-cyan-400/10 border-cyan-400/30", // سماوي
  VIEWING: "text-blue-400 bg-blue-400/10 border-blue-400/30",      // أزرق
  NEGOTIATION: "text-violet-400 bg-violet-400/10 border-violet-400/30", // بنفسجي
  RESERVED: "text-gold bg-gold/10 border-gold/30",                 // ذهبي #CBA45E
  CLOSED_WON: "text-emerald-500 bg-emerald-500/15 border-emerald-500/40", // زمردي غامق
  CLOSED_LOST: "text-red-400 bg-red-400/10 border-red-400/30",     // أحمر
};

export const channelLabels: Record<Channel, string> = {
  WHATSAPP: "واتساب",
  TIKTOK: "تيك توك",
  META: "ميتا",
  SNAPCHAT: "سناب",
  GOOGLE: "جوجل",
  AQAR: "عقار",
  REFERRAL: "إحالة",
  VISIT: "زيارة مباشرة",
  OTHER: "أخرى",
};
export const channelLabel = (c: Channel) => channelLabels[c] ?? c;
// ترتيب عرض القنوات (chips) عند إضافة عميل.
export const channelOrder: Channel[] = ["META", "SNAPCHAT", "TIKTOK", "GOOGLE", "WHATSAPP", "VISIT", "REFERRAL", "AQAR", "OTHER"];

// الدور (Floor) — عرض عربي.
export const floorLabels: Record<Floor, string> = {
  GROUND: "أرضي",
  FIRST: "أول",
  SECOND: "ثاني",
  TOP: "علوي",
};

export const priorityLabels: Record<Priority, string> = {
  HIGH: "عالية",
  MEDIUM: "متوسطة",
  LOW: "منخفضة",
};
export const priorityColor: Record<Priority, string> = {
  HIGH: "text-destructive",
  MEDIUM: "text-warning",
  LOW: "text-muted-foreground",
};
export const priorityLabel = (p: Priority) => priorityLabels[p] ?? p;

export const unitTypeLabels: Record<UnitType, string> = {
  APARTMENT: "شقة",
  FLOOR: "دور",
  GROUND_FLOOR_APARTMENT: "شقة دور أرضي",
  PENTHOUSE: "بنتهاوس",
  OTHER: "أخرى",
};
export const unitTypeLabel = (u: UnitType) => unitTypeLabels[u] ?? u;

export const activityTypeLabels: Record<ActivityType, string> = {
  CALL: "اتصال",
  WHATSAPP: "واتساب",
  VISIT: "زيارة",
  APPOINTMENT: "موعد",
  NOTE: "ملاحظة",
  STAGE_CHANGE: "تغيير مرحلة",
  ASSIGNMENT: "توزيع",
};
export const activityTypeLabel = (t: ActivityType) => activityTypeLabels[t] ?? t;

// ===== المشاريع والوحدات والحجوزات =====

export const projectStatusLabels: Record<ProjectStatus, string> = {
  AVAILABLE: "متاح",
  UNDER_CONSTRUCTION: "تحت الإنشاء",
  FINISHING: "تشطيبات",
  COMPLETED: "مكتمل",
};
export const projectStatusColor: Record<ProjectStatus, string> = {
  AVAILABLE: "text-success bg-success/10 border-success/30",
  UNDER_CONSTRUCTION: "text-warning bg-warning/10 border-warning/30",
  FINISHING: "text-info bg-info/10 border-info/30",
  COMPLETED: "text-gold bg-gold/10 border-gold/30",
};

export const unitStatusLabels: Record<UnitStatus, string> = {
  AVAILABLE: "متاحة",
  RESERVED: "محجوزة",
  SOLD: "مباعة",
};
export const unitStatusColor: Record<UnitStatus, string> = {
  AVAILABLE: "text-success",
  RESERVED: "text-warning",
  SOLD: "text-muted-foreground",
};

// مراحل تقدّم البيع (بالترتيب) — للشريط في بطاقة الحجز.
export const bookingStageOrder: BookingStage[] = [
  "RESERVATION",
  "PAPERWORK",
  "VALUATION",
  "SIGNING",
  "TRANSFER",
  "SOLD",
  "DELIVERED",
];
export const bookingStageLabels: Record<BookingStage, string> = {
  RESERVATION: "حجز",
  PAPERWORK: "أوراق",
  VALUATION: "تقييم",
  SIGNING: "توقيع",
  TRANSFER: "إفراغ",
  SOLD: "بيع",
  DELIVERED: "تم البيع والاستلام",
};

export const paymentMethodLabels: Record<PaymentMethod, string> = {
  CASH: "كاش",
  BANK_FINANCE: "تمويل بنكي",
  CASH_AND_FINANCE: "كاش + تمويل بنكي",
};

export const purchaseMethodLabels: Record<PurchaseMethod, string> = {
  CASH: "كاش",
  BANK_FINANCE: "تمويل بنكي", // قديم — للعرض فقط
  CASH_AND_FINANCE: "كاش + تمويل بنكي",
  BANK_FINANCE_SUPPORTED: "تمويل بنكي مدعوم",
  BANK_FINANCE_UNSUPPORTED: "تمويل بنكي غير مدعوم",
};

/** الخيارات المعروضة في القوائم — القيم الأربع المعتمدة (بدون القديم BANK_FINANCE). */
export const purchaseMethodOptions: PurchaseMethod[] = [
  "BANK_FINANCE_SUPPORTED",
  "BANK_FINANCE_UNSUPPORTED",
  "CASH",
  "CASH_AND_FINANCE",
];

export const purchaseGoalLabels: Record<PurchaseGoal, string> = {
  RESIDENCE: "سكن",
  INVESTMENT: "استثمار",
  BOTH: "سكن + استثمار",
};

// المرحلة الأولى (تُحدَّد مرة واحدة)
export const firstContactStageLabels: Record<FirstContactStage, string> = {
  INTERESTED: "مهتم",
  NO_ANSWER: "لا يرد",
  NOT_INTERESTED: "غير مهتم",
};
export const firstContactStageColor: Record<FirstContactStage, string> = {
  INTERESTED: "text-success bg-success/10 border-success/30",
  NO_ANSWER: "text-warning bg-warning/10 border-warning/30",
  NOT_INTERESTED: "text-destructive bg-destructive/10 border-destructive/30",
};

export const cashPaymentTypeLabels: Record<CashPaymentType, string> = {
  CHECK: "شيك",
  TRANSFER: "تحويل",
  INSTALLMENTS: "دفعات",
};

/// أحياء شائعة (قابلة للتوسعة) — مع «أخرى».
export const districtOptions = ["المهدية", "ظهرة لبن", "لبن الشرقي", "أخرى"];

export const bankLabels: Record<SaudiBank, string> = {
  RAJHI: "الراجحي",
  SNB: "الأهلي SNB",
  RIYAD: "الرياض",
  ALBILAD: "البلاد",
  ALINMA: "الإنماء",
  SAB: "ساب",
  SAMBA: "سامبا",
  ANB: "العربي ANB",
  ALJAZIRA: "الجزيرة",
  OTHER: "أخرى",
};

export const nationalityLabels: Record<Nationality, string> = {
  SAUDI: "سعودي",
  RESIDENT: "مقيم",
};

// ===== المتابعات (FollowUp) =====

export const followUpSectionLabels: Record<FollowUpSection, string> = {
  INTERESTED: "مهتم",
  NO_ANSWER: "لم يرد",
  NOT_INTERESTED: "غير مهتم",
};
export const followUpSectionColor: Record<FollowUpSection, string> = {
  INTERESTED: "text-gold bg-gold/10 border-gold/30",
  NO_ANSWER: "text-warning bg-warning/10 border-warning/30",
  NOT_INTERESTED: "text-destructive bg-destructive/10 border-destructive/30",
};

export const followUpTypeLabels: Record<FollowUpType, string> = {
  CALL: "اتصال",
  WHATSAPP: "واتساب",
  VISIT_PROJECT: "زيارة المشروع",
  VISIT_OFFICE: "زيارة الشركة",
  OTHER: "أخرى",
};

export const followUpResultLabels: Record<FollowUpResult, string> = {
  INTERESTED_SCHEDULED: "مهتم — جدول موعد",
  INTERESTED_SENT_INFO: "مهتم — أرسلت معلومات",
  INTERESTED_VISITED: "مهتم — زار",
  NEGOTIATING: "تفاوض",
  NOT_ANSWERED_SCHEDULED: "لم يرد — جُدولت محاولة",
  NOT_ANSWERED_WHATSAPP: "لم يرد — أُرسل واتساب",
  NOT_INTERESTED_LOCATION: "غير مهتم — الموقع",
  NOT_INTERESTED_SPACE: "غير مهتم — المساحة",
  NOT_INTERESTED_PRICE: "غير مهتم — السعر",
  NOT_INTERESTED_FINAL: "غير مهتم بالعقارات نهائيًا",
  FOLLOW_UP_SCHEDULED: "موعد لاحق — جُدولت متابعة",
  BOOKED: "تم الحجز",
  NO_ANSWER_INTERESTED: "لم يستجب",
  BANK_CHECK: "حسبة البنك",
  ON_HOLD: "في الانتظار",
  NOT_INTERESTED_VISITED: "غير مهتم — زار المشروع وما ناسبه",
  NOT_INTERESTED_BANK: "غير مهتم — حسبة البنك ضعيفة",
  NOT_INTERESTED_MARKETER: "مسوّق — مو عميل",
  NOT_INTERESTED_OTHER: "غير مهتم — سبب آخر",
};

/**
 * نتائج «بلا تغيير مرحلة» (لعميل المظلة المهتمة): المتابعة تُسجَّل والعميل يبقى بمرحلته.
 * POST /followups يثبّت المرحلة الحالية لهذه النتائج — قيمها في resultToStage لا تُستخدم.
 */
export const KEEP_STAGE_RESULTS: FollowUpResult[] = ["NO_ANSWER_INTERESTED", "BANK_CHECK", "ON_HOLD"];

/// تعيين نتيجة المتابعة → مرحلة العميل (تُحدَّث تلقائيًا).
export const resultToStage: Record<FollowUpResult, LeadStage> = {
  INTERESTED_SCHEDULED: "INTERESTED",
  INTERESTED_SENT_INFO: "INTERESTED",
  INTERESTED_VISITED: "VIEWING",
  NEGOTIATING: "NEGOTIATION",
  NOT_ANSWERED_SCHEDULED: "ATTEMPTED",
  NOT_ANSWERED_WHATSAPP: "ATTEMPTED",
  // م-٣ (تدقيق 2026-07): «غير مهتم — موقع/مساحة/سعر» = خسارة بسبب مسجّل، لا «تفاوض».
  // الربط القديم بـ NEGOTIATION كان يمنع وصول هؤلاء لـ CLOSED_LOST نهائيًا،
  // فتفصيل أسباب الرفض في الداشبورد يطلع شبه صفري دائمًا. (للمستقبل فقط — بلا تصحيح بيانات قديمة)
  NOT_INTERESTED_LOCATION: "CLOSED_LOST",
  NOT_INTERESTED_SPACE: "CLOSED_LOST",
  NOT_INTERESTED_PRICE: "CLOSED_LOST",
  NOT_INTERESTED_FINAL: "CLOSED_LOST",
  FOLLOW_UP_SCHEDULED: "FOLLOW_UP_LATER",
  BOOKED: "RESERVED",
  // نتائج «بلا تغيير مرحلة» — المسار يثبّت المرحلة الحالية (KEEP_STAGE_RESULTS)؛ القيم هنا احتياط نوعي فقط.
  NO_ANSWER_INTERESTED: "INTERESTED",
  BANK_CHECK: "INTERESTED",
  ON_HOLD: "INTERESTED",
  // أسباب «غير مهتم» الجديدة — كلها توصل CLOSED_LOST عبر المسار الموحّد.
  NOT_INTERESTED_VISITED: "CLOSED_LOST",
  NOT_INTERESTED_BANK: "CLOSED_LOST",
  NOT_INTERESTED_MARKETER: "CLOSED_LOST",
  NOT_INTERESTED_OTHER: "CLOSED_LOST",
};

export const deliveryStatusLabels: Record<DeliveryStatus, string> = {
  PENDING: "لم يُسلّم",
  SCHEDULED: "مجدول",
  DELIVERED: "تم التسليم",
};
