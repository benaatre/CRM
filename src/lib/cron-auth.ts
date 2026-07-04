import { timingSafeEqual } from "crypto";

/**
 * يتحقق من سرّ الكرون: يقبل هيدر `Authorization: Bearer <secret>` (المفضّل)
 * مع دعم مؤقت لـ `?secret=` (fallback لحين تحديث كرونات Hostinger/cron-job.org على الهيدر).
 * مقارنة ثابتة الزمن (timingSafeEqual). يرفض دائمًا لو السرّ غير مضبوط في البيئة.
 */
export function isCronAuthorized(req: Request, envSecret: string | undefined): boolean {
  if (!envSecret) return false;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const query = new URL(req.url).searchParams.get("secret"); // fallback مؤقت — يُشال بعد الانتقال للهيدر
  const provided = bearer ?? query;
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(envSecret);
  return a.length === b.length && timingSafeEqual(a, b);
}
