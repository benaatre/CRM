import type { PurchaseMethod, PurchaseGoal } from "@prisma/client";

/**
 * تطبيع القيم العربية القادمة من Excel / لصق / Google Sheet إلى enum القاعدة.
 * يتعامل مع المرادفات والصيغ المختلفة (نقداً، تمويل بنكي مدعوم، الاثنين…) عبر
 * مطابقة بالكلمات المفتاحية بعد إزالة التشكيل وتوحيد الألف والياء.
 */

// إزالة التطويل والتشكيل + توحيد الهمزات/الياء/التاء المربوطة + تنظيف المسافات.
function norm(s: string): string {
  return s
    .replace(/[ـً-ْ]/g, "") // تطويل + تشكيل
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * طريقة الشراء:
 *  «كاش» / «نقداً» → CASH
 *  «تمويل بنكي» / «تمويل بنكي مدعوم» / «تمويل بنكي غير مدعوم» → BANK_FINANCE
 *  «كاش + تمويل» / «الاثنين» → CASH_AND_FINANCE
 */
export function normalizePurchaseMethod(raw: string | null | undefined): PurchaseMethod | null {
  if (!raw) return null;
  const s = norm(raw);
  if (!s) return null;
  if (s === "cash") return "CASH";
  if (s === "bank_finance") return "BANK_FINANCE";
  if (s === "cash_and_finance") return "CASH_AND_FINANCE";

  const hasCash = /كاش|نقد/.test(s);
  const hasFinance = /تمويل|بنك/.test(s);
  if (hasCash && hasFinance) return "CASH_AND_FINANCE";
  if (s.includes("الاثنين") || s === "both") return "CASH_AND_FINANCE";
  if (hasCash) return "CASH";
  if (hasFinance) return "BANK_FINANCE";
  return null;
}

/**
 * هدف الشراء:
 *  «للسكن» / «سكن» / «سكني» → RESIDENCE
 *  «للاستثمار» / «استثمار» → INVESTMENT
 *  «الاثنين معاً» / «سكن + استثمار» / «الاثنين» → BOTH
 */
export function normalizePurchaseGoal(raw: string | null | undefined): PurchaseGoal | null {
  if (!raw) return null;
  const s = norm(raw);
  if (!s) return null;
  if (s === "residence") return "RESIDENCE";
  if (s === "investment") return "INVESTMENT";
  if (s === "both") return "BOTH";

  const hasRes = s.includes("سكن"); // سكن / سكني / للسكن
  const hasInv = s.includes("استثمار"); // استثمار / للاستثمار / استثماري
  if (hasRes && hasInv) return "BOTH";
  if (s.includes("الاثنين")) return "BOTH";
  if (hasRes) return "RESIDENCE";
  if (hasInv) return "INVESTMENT";
  return null;
}
