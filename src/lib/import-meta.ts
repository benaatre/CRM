// أنواع وثوابت الاستيراد — منفصلة عن ملف الـ"use server" (الذي يصدّر دوال فقط).

export type ImportRow = {
  name: string;
  phone: string;
  channel?: string;
  project?: string;
  unitType?: string;
  budget?: string;
  stage?: string;
  priority?: string;
  notes?: string;
  purchaseMethod?: string;
  purchaseGoal?: string;
  district?: string;
  status: "new" | "duplicate" | "exists" | "invalid";
};

export const IMPORT_TEMPLATE =
  "الاسم,الجوال,القناة,المشروع,الميزانية,طريقة الشراء,هدف الشراء,الحي";

// الحقول التي يمكن المطابقة إليها (المفتاح → الاسم العربي). الأساسي: name/phone.
export const MAPPABLE_FIELDS: { key: string; label: string }[] = [
  { key: "name", label: "الاسم" },
  { key: "firstName", label: "الاسم الأول" },
  { key: "lastName", label: "الاسم الأخير" },
  { key: "phone", label: "الجوال" },
  { key: "channel", label: "القناة" },
  { key: "project", label: "المشروع" },
  { key: "budget", label: "الميزانية" },
  { key: "purchaseMethod", label: "طريقة الشراء" },
  { key: "purchaseGoal", label: "هدف الشراء" },
  { key: "district", label: "الحي" },
  { key: "unitType", label: "نوع الوحدة" },
  { key: "stage", label: "المرحلة" },
  { key: "priority", label: "الأولوية" },
  { key: "notes", label: "ملاحظات" },
];
