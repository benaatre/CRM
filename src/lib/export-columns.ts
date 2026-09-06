import type { Channel, LeadStage } from "@prisma/client";

/**
 * سجل أعمدة «مركز التصدير» — مشترك بين الأكشن (البناء) والواجهة (التشيك-لست).
 * ملف عادي (لا "use server") لأن وحدات الأكشنات لا تصدّر إلا دوالًا async.
 */

export type ExportSlice =
  | "ad_exclusion" // غير مهتمين — استبعاد إعلاني (منطق buildAdExclusion القائم حرفيًا)
  | "interested"   // مظلة المهتم الخمسة
  | "visited"      // زيارات تمت (عملاء فريدون)
  | "bookings"     // حجوزات قيد التنفيذ (قبل البيع)
  | "sales"        // مبيعات/صفقات (SOLD/DELIVERED)
  | "all"          // كل العملاء
  | "custom";      // مخصص بفلاتره المركبة

export type ExportFilters = {
  /** مراحل متعددة — للمخصص فقط (بقية الشرائح نطاقها ثابت). */
  stages?: LeadStage[];
  /** المصدر الإعلاني — channel حصرًا (القرار المعتمد؛ جوجل يظهر تلقائيًا إن ظهرت قناته). */
  channels?: Channel[];
  /** الموظف: المسند لشرائح العملاء، والبائع لشرائح الحجوزات. */
  employeeId?: string;
  /** نافذة زمنية بالأشهر (0 = الكل): إقفال (updatedAt) لشريحة الاستبعاد، وإنشاء للبقية. */
  months?: 0 | 3 | 6 | 12;
  /** تضمين المؤرشفين (الافتراضي نعم) — شرائح العملاء فقط. */
  includeArchived?: boolean;
  /** استثناء أصحاب المواعيد المستقبلية — مقفول-مفعّل إجباريًا بشريحة الاستبعاد. */
  excludeFutureNext?: boolean;
};

export type ColumnFamily = "lead" | "booking";
export type ColumnGroup = "ads" | "basic" | "full" | "manual";

export type ExportColumnDef = {
  key: string;
  /** رأس CSV الإنجليزي البسيط (منصات الإعلان تقرأ phone مباشرة). */
  header: string;
  /** الاسم العربي للتشيك-لست والمعاينة. */
  label: string;
  family: ColumnFamily;
};

/** أعمدة شرائح العملاء — بترتيب العرض. */
export const LEAD_COLUMNS: ExportColumnDef[] = [
  { key: "phone", header: "phone", label: "الجوال (+966)", family: "lead" },
  { key: "name", header: "name", label: "الاسم", family: "lead" },
  { key: "channel", header: "ad_channel", label: "المصدر الإعلاني", family: "lead" },
  { key: "source", header: "source_detail", label: "المصدر التفصيلي", family: "lead" },
  { key: "stage", header: "stage", label: "المرحلة", family: "lead" },
  { key: "not_interested_reason", header: "not_interested_reason", label: "سبب عدم الاهتمام", family: "lead" },
  { key: "employee", header: "employee", label: "الموظف المسند", family: "lead" },
  { key: "created_at", header: "created_at", label: "تاريخ الدخول", family: "lead" },
  { key: "last_contact", header: "last_contact", label: "آخر تواصل", family: "lead" },
  { key: "closed_at", header: "closed_at", label: "تاريخ الإقفال", family: "lead" },
  { key: "next_followup", header: "next_followup", label: "الموعد القادم", family: "lead" },
  { key: "visit_date", header: "visit_date", label: "تاريخ الزيارة", family: "lead" },
  { key: "project", header: "project", label: "المشروع", family: "lead" },
  { key: "budget", header: "budget", label: "الميزانية", family: "lead" },
  { key: "purchase_method", header: "purchase_method", label: "طريقة الشراء", family: "lead" },
  { key: "purchase_goal", header: "purchase_goal", label: "هدف الشراء", family: "lead" },
  { key: "nationality", header: "nationality", label: "الجنسية", family: "lead" },
];

/** أعمدة شرائح الحجوزات/الصفقات — المالية كما بالجرد. */
export const BOOKING_COLUMNS: ExportColumnDef[] = [
  { key: "phone", header: "phone", label: "الجوال (+966)", family: "booking" },
  { key: "client_name", header: "name", label: "اسم العميل", family: "booking" },
  { key: "unit", header: "unit", label: "الوحدة", family: "booking" },
  { key: "project", header: "project", label: "المشروع", family: "booking" },
  { key: "payment_method", header: "payment_method", label: "طريقة الدفع", family: "booking" },
  { key: "bank", header: "bank", label: "البنك", family: "booking" },
  { key: "deposit", header: "deposit", label: "العربون", family: "booking" },
  { key: "price", header: "price", label: "السعر", family: "booking" },
  { key: "discount", header: "discount", label: "الخصم", family: "booking" },
  { key: "final_price", header: "final_price", label: "السعر النهائي", family: "booking" },
  { key: "collected", header: "collected", label: "المحصّل", family: "booking" },
  { key: "remaining", header: "remaining", label: "المتبقّي", family: "booking" },
  { key: "stage", header: "booking_stage", label: "مرحلة الحجز", family: "booking" },
  { key: "seller", header: "seller", label: "البائع", family: "booking" },
  { key: "created_at", header: "booked_at", label: "تاريخ الحجز", family: "booking" },
];

export const BOOKING_SLICES: ExportSlice[] = ["bookings", "sales"];
export const familyOf = (slice: ExportSlice): ColumnFamily => (BOOKING_SLICES.includes(slice) ? "booking" : "lead");
export const columnsOf = (family: ColumnFamily): ExportColumnDef[] => (family === "booking" ? BOOKING_COLUMNS : LEAD_COLUMNS);

/** مفاتيح المجموعات الجاهزة لكل عائلة. */
export function groupKeys(group: ColumnGroup, family: ColumnFamily): string[] {
  if (group === "ads") return ["phone"];
  if (group === "basic") return family === "booking" ? ["phone", "client_name"] : ["phone", "name"];
  return columnsOf(family).map((c) => c.key); // full (وmanual يُمرَّر صراحةً)
}

export const SLICE_META: Record<ExportSlice, { title: string; desc: string }> = {
  ad_exclusion: { title: "غير مهتمين — استبعاد إعلاني", desc: "مقفول-خسارة بكل أسبابه، بلا أصحاب المواعيد المستقبلية" },
  interested: { title: "مهتمون", desc: "مظلة المهتم الخمسة — لجمهور مشابه" },
  visited: { title: "زيارات تمّت", desc: "من زار فعليًا (أقوى جمهور مشابه)" },
  bookings: { title: "حجوزات", desc: "قيد التنفيذ — قبل البيع" },
  sales: { title: "مبيعات / صفقات", desc: "مباع أو مسلَّم" },
  all: { title: "كل العملاء", desc: "القاعدة كاملة" },
  custom: { title: "مخصص", desc: "فلاتر مركبة: مراحل ومصادر وموظف ومدة" },
};
