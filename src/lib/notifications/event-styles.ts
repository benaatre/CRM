// لون مميز لكل حدث — آمن للعميل والخادم (بدون "server-only").
// يُستخدم لتمييز نوع الإشعار بصريًا في التوست والجرس (شريط جانبي + أيقونة ملوّنة).

export const EVENT_COLOR: Record<string, string> = {
  new_lead_from_sheet: "#3B82F6", // أزرق — معلومة (عميل دخل)
  lead_assigned: "#2FBF8F",       // أخضر — إيجابي (شغل جديد)
  lead_reassigned: "#F59E0B",     // برتقالي — تنبيه (تحرّك)
  employee_idle: "#F0685F",       // أحمر — عاجل (مشكلة)
  followup_due: "#CBA45E",        // ذهبي — تذكير محايد
  employee_paused: "#8B5CF6",     // بنفسجي — معلومة إدارية
  unit_booked_sold: "#10B981",    // أخضر لامع — نجاح احتفالي
};

/** لون الحدث — يرجّع الذهبي كافتراضي للأنواع غير المعروفة. */
export const eventColor = (type: string): string => EVENT_COLOR[type] ?? "#CBA45E";
