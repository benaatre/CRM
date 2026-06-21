import type {
  Role,
  LeadStage,
  Channel,
  Priority,
  UnitType,
  ActivityType,
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
  VIEWING: "زيارة/معاينة",
  NEGOTIATION: "تفاوض",
  RESERVED: "محجوز/عربون",
  CLOSED_WON: "مقفول-بيع",
  CLOSED_LOST: "غير مهتم/خاسر",
};
export const stageLabel = (s: LeadStage) => stageLabels[s] ?? s;

// أصناف ألوان (نص + خلفية + حدود) لكل مرحلة — للوسوم وأعمدة الكانبان.
export const stageColor: Record<LeadStage, string> = {
  NEW: "text-info bg-info/10 border-info/30",
  ATTEMPTED: "text-warning bg-warning/10 border-warning/30",
  INTERESTED: "text-gold bg-gold/10 border-gold/30",
  FOLLOW_UP_LATER: "text-muted-foreground bg-muted border-border",
  VIEWING: "text-info bg-info/10 border-info/30",
  NEGOTIATION: "text-gold-light bg-gold/10 border-gold/40",
  RESERVED: "text-success bg-success/10 border-success/30",
  CLOSED_WON: "text-success bg-success/15 border-success/40",
  CLOSED_LOST: "text-destructive bg-destructive/10 border-destructive/30",
};

export const channelLabels: Record<Channel, string> = {
  WHATSAPP: "واتساب",
  TIKTOK: "تيك توك",
  META: "ميتا",
  AQAR: "عقار",
  REFERRAL: "إحالة",
  VISIT: "زيارة",
  OTHER: "أخرى",
};
export const channelLabel = (c: Channel) => channelLabels[c] ?? c;

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
