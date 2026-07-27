/**
 * وضعا التحويل اليدوي — **مصدر الحقيقة الوحيد** للاحقة سبب الإسناد.
 *
 * كل مسار ينقل عميلًا يدويًا من موظف لآخر يكتب سببه من هنا حصرًا، فلا ينحرف مسار
 * ويكتب `manual_transfer` مجردًا (حادثة 2026-07-27: مسار درج العميل كان يكتبه مجردًا
 * فلا يظهر الوسم ولا يُخفى السجل).
 *
 * - `full`  → `manual_transfer_full`  : الموظف الجديد يرى كل السجل + وسم ⇄ «محوَّل».
 * - `fresh` → `manual_transfer_fresh` : اللاحقة `_fresh` تفعّل إخفاء السجل عن الموظف
 *   في visibility.ts (والسجل محفوظ كاملًا للمالك/الأدمن)، وبلا وسم.
 */
export type TransferMode = "full" | "fresh";

/** سبب «محوَّل بالبيانات» — الوسم يقارن به حرفيًا. */
export const MANUAL_TRANSFER_FULL = "manual_transfer_full";
/** سبب «محوَّل كجديد» — اللاحقة _fresh تفعّل الإخفاء. */
export const MANUAL_TRANSFER_FRESH = "manual_transfer_fresh";

/** سبب سجل Reassignment لتحويل يدوي حسب الوضع. */
export function manualTransferReason(mode: TransferMode): string {
  return mode === "fresh" ? MANUAL_TRANSFER_FRESH : MANUAL_TRANSFER_FULL;
}
