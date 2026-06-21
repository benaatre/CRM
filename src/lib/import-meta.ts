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
  status: "new" | "duplicate" | "exists" | "invalid";
};

export const IMPORT_TEMPLATE =
  "الاسم,الجوال,القناة,المشروع,نوع الوحدة,الميزانية,المرحلة,الأولوية,ملاحظات";
