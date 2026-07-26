import "server-only";

/**
 * بركة التوزيع التلقائي — القاعدة القاطعة في مكان واحد.
 *
 *   العميل داخل البركة  ⟺  Lead.autoPoolAt != null
 *   manualAssignedAt != null  ⟹  خارج البركة دائمًا (الاثنان متنافيان)
 *
 * ثلاثة أبواب للدخول لا رابع لها:
 *   ١) إنشاء عميل من مصدر موسوم LeadSource.autoPool  →  resolveAutoPoolAt() أدناه
 *   ٢) admitToAutoPool(leadIds)     — من «غير الموزّعين» (lib/actions/distribution.ts)
 *   ٣) transferToAutoPool(leadIds)  — سحب من الموظف الحالي (lib/actions/distribution.ts)
 *
 * ومن هو خارج البركة لا يمسّه المحرك إطلاقًا — الشرط مفروض في استعلامات
 * lib/auto-distribute.ts عبر IN_AUTO_POOL، وفي حارس executeSweepPull.
 */

import { prisma } from "@/lib/prisma";

/**
 * الباب ١: هل يدخل العميل المُنشأ حديثًا البركة؟
 * يرجّع لحظة الدخول أو null.
 *
 * - اختيار بشري صريح للموظف (مدير عيّن، أو موظف أضاف لنفسه) = إسناد يدوي ⟹ خارج البركة
 *   مهما كان المصدر. القرار البشري يغلب وسم المصدر دائمًا.
 * - غير ذلك: يدخل البركة فقط إذا كان مصدره موسومًا autoPool.
 */
export async function resolveAutoPoolAt(
  sourceId: string | null | undefined,
  assignedToId: string | null,
  autoDistributed: boolean,
): Promise<Date | null> {
  if (assignedToId && !autoDistributed) return null; // قرار بشري = يدوي = خارج البركة
  if (!sourceId) return null;
  const src = await prisma.leadSource.findUnique({
    where: { id: sourceId },
    select: { autoPool: true },
  });
  return src?.autoPool ? new Date() : null;
}

/** هل المصدر موسوم «تلقائي»؟ (للمزامنة الدفعية — استعلام واحد لكل مصدر لا لكل صف). */
export async function isAutoPoolSource(sourceId: string | null | undefined): Promise<boolean> {
  if (!sourceId) return false;
  const src = await prisma.leadSource.findUnique({
    where: { id: sourceId },
    select: { autoPool: true },
  });
  return !!src?.autoPool;
}
