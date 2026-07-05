import type { BookingStage } from "@prisma/client";

// مراحل «مباع» (مقابل «محجوز») — للتحليلات: القيمة المحجوزة تستثني هذي المراحل.
export const SOLD_STAGES: BookingStage[] = ["SOLD", "DELIVERED"];

/**
 * يحسب «المحصّل» و«المتبقّي» لحجز:
 * - «تم البيع والاستلام» (DELIVERED فقط): استلمنا كامل المبلغ → المحصّل = السعر بعد الخصم، المتبقّي = صفر.
 * - غير ذلك (حجز/عربون/أوراق/تقييم/توقيع/إفراغ/**بيع SOLD**): المحصّل = المسجّل فعلياً (تراكمي)،
 *   والمتبقّي = بعد الخصم − المحصّل (لا يقل عن صفر).
 *
 * ملاحظة: ضريبة التصرفات/VAT معلومة عرض فقط — لا تدخل المتبقّي (afterDiscount = السعر بعد الخصم بلا ضريبة).
 */
export function bookingCollection(
  stage: BookingStage,
  afterDiscount: number,
  collectedAmount: number,
): { collected: number; remaining: number } {
  if (stage === "DELIVERED") return { collected: afterDiscount, remaining: 0 };
  return { collected: collectedAmount, remaining: Math.max(0, afterDiscount - collectedAmount) };
}
