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

/**
 * ===== التوزيع من حوض «غير الموزّعين» =====
 * عائلة منفصلة عن `manual_transfer_*` عمدًا: التوزيع ليس نقلًا بين موظفين، فيبقى وسم ⇄
 * «محوَّل» حكرًا على النقل (المقارنة عليه حرفية بـ MANUAL_TRANSFER_FULL).
 * اللاحقة `_fresh` وحدها هي ما يقرأه visibility.ts لإخفاء السجل.
 *
 * الحاجة (فحص 2026-07-27): الحوض يخلط عملاء جددًا فعلًا بمستردّين يحملون متابعات قديمة
 * (recoverLeads / unarchiveLeads يعيدونهم «جديدًا» بلا سجل تحويل)، وكان التوزيع يكتب
 * `manual_distribute` مجردًا فيصل المسترد لموظفٍ جديد وتاريخه كله مكشوف.
 */
export const MANUAL_DISTRIBUTE_FULL = "manual_distribute_full";
export const MANUAL_DISTRIBUTE_FRESH = "manual_distribute_fresh";

/** سبب سجل Reassignment لتوزيع يدوي من الحوض حسب الوضع. */
export function distributeReason(mode: TransferMode): string {
  return mode === "fresh" ? MANUAL_DISTRIBUTE_FRESH : MANUAL_DISTRIBUTE_FULL;
}

/**
 * ===== التوزيع التلقائي (المحرك) =====
 * لا إنسان يُسأل، فالقرار مشتق: من يحمل متابعات سابقة يُوزَّع «كجديد» (سجله يُخفى عن
 * الموظف المستلم ويبقى كاملًا للمالك)، ومن لا تاريخ له يبقى `initial` كما كان.
 * ملاحظة للقراءات: أي منطق يميّز «الإسناد الأولي» يجب أن يستعمل startsWith("initial")
 * لا المطابقة الحرفية — وإلا عُدّ initial_fresh تحويلًا.
 */
export const INITIAL = "initial";
export const INITIAL_FRESH = "initial_fresh";

/** سبب الإسناد الأولي التلقائي — يُخفي السجل لمن له تاريخ سابق. */
export function initialReason(hasPriorHistory: boolean): string {
  return hasPriorHistory ? INITIAL_FRESH : INITIAL;
}

/** هل السبب من عائلة الإسناد الأولي؟ (initial أو initial_fresh) */
export function isInitialReason(reason: string | null | undefined): boolean {
  return !!reason && reason.startsWith(INITIAL);
}
