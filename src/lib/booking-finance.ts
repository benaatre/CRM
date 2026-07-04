import type { BookingStage } from "@prisma/client";

// مراحل البيع المكتمل — عندها المحصّل يصير كامل المبلغ والمتبقّي صفر.
export const SOLD_STAGES: BookingStage[] = ["SOLD", "DELIVERED"];

/**
 * يحسب «المحصّل» و«المتبقّي» لحجز بشكل موحّد:
 * - بيع مكتمل (SOLD/DELIVERED): المحصّل = كامل السعر بعد الخصم، المتبقّي = صفر.
 * - غير ذلك (حجز/عربون/أوراق/تقييم/توقيع/إفراغ): المحصّل = المسجّل فعلياً، المتبقّي = بعد الخصم − المحصّل.
 *
 * ملاحظة: ضريبة التصرفات/VAT معلومة عرض فقط — لا تدخل المتبقّي (afterDiscount = السعر بعد الخصم بلا ضريبة).
 */
export function bookingCollection(
  stage: BookingStage,
  afterDiscount: number,
  collectedAmount: number,
): { collected: number; remaining: number } {
  if (SOLD_STAGES.includes(stage)) return { collected: afterDiscount, remaining: 0 };
  return { collected: collectedAmount, remaining: Math.max(0, afterDiscount - collectedAmount) };
}
