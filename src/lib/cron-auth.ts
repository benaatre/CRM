import { timingSafeEqual } from "crypto";

/**
 * يتحقق من سرّ الكرون عبر هيدر `Authorization: Bearer <secret>` حصرًا —
 * تمرير السرّ في الـURL يتسرّب للوقات الخادم/الوكيل/خدمة الكرون، لذلك أُزيل الـfallback.
 * مقارنة ثابتة الزمن (timingSafeEqual). يرفض دائمًا لو السرّ غير مضبوط في البيئة.
 */
export function isCronAuthorized(req: Request, envSecret: string | undefined): boolean {
  if (!envSecret) return false;
  const provided = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(envSecret);
  return a.length === b.length && timingSafeEqual(a, b);
}
