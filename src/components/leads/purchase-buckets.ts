import type { PurchaseMethod } from "@prisma/client";

/**
 * دلاء «طريقة الشراء» لفلتر اللوح الجانبي — ثلاث خانات كما في التصميم المعتمد:
 * كاش · تمويل · كاش + تمويل.
 *
 * الفلترة **في المتصفح** على الصفوف المحمَّلة أصلًا (الصفحة تجلب النتائج كاملة
 * وتقطّعها محليًا) — فلا بارامتر جديد في الرابط ولا شرط جديد على الخادم.
 * دلو «تمويل» يضم القيمة القديمة BANK_FINANCE مع المدعوم/غير المدعوم — نفس ما
 * يفعله purchaseMethodLabels حين يعرض القديم للقراءة فقط.
 */
export type PurchaseBucket = "cash" | "finance" | "both";

export const PURCHASE_BUCKETS: { key: PurchaseBucket; label: string; methods: PurchaseMethod[] }[] = [
  { key: "cash", label: "كاش", methods: ["CASH"] },
  { key: "finance", label: "تمويل", methods: ["BANK_FINANCE_SUPPORTED", "BANK_FINANCE_UNSUPPORTED", "BANK_FINANCE"] },
  { key: "both", label: "كاش + تمويل", methods: ["CASH_AND_FINANCE"] },
];

/** دلو طريقة الشراء لعميل — null لمن لا طريقة له (يسقط خارج كل الدلاء). */
export function purchaseBucketOf(method: PurchaseMethod | null): PurchaseBucket | null {
  if (!method) return null;
  return PURCHASE_BUCKETS.find((b) => b.methods.includes(method))?.key ?? null;
}
