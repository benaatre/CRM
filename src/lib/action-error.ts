import { Prisma } from "@prisma/client";

// رسائل عربية لأكواد Prisma المعروفة — الباقي fallback عام.
const P_MESSAGES: Record<string, string> = {
  P2002: "فيه سجل بنفس البيانات موجود مسبقًا",
  P2025: "السجل ما هو موجود — يمكن انحذف قبل شوي، حدّث الصفحة",
  P2003: "ما نقدر ننفّذ العملية — فيه بيانات مرتبطة بهذا السجل",
  P1001: "تعذّر الاتصال بقاعدة البيانات — حاول بعد شوي",
  P1002: "الاتصال بقاعدة البيانات تأخّر — حاول بعد شوي",
};

/**
 * يحوّل أي خطأ لرسالة سعودية آمنة للواجهة، ويسجّل التفاصيل الكاملة في السيرفر.
 * رسائلنا العربية المكتوبة يدويًا («ما عندك صلاحية…») تمرّ كما هي.
 */
export function toUserError(e: unknown, context?: string): string {
  console.error(`[action]${context ? ` ${context}` : ""}`, e);
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    return P_MESSAGES[e.code] ?? "صار خطأ في قاعدة البيانات — حاول مرة ثانية";
  }
  const msg = e instanceof Error ? e.message : "";
  if (/[؀-ۿ]/.test(msg)) return msg; // نص عربي = رسالتنا المقصودة
  return "صار خطأ غير متوقّع — حاول مرة ثانية";
}
