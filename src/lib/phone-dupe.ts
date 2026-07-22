import "server-only";

import type { Channel, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizePhone, phoneVariants } from "@/lib/value-normalize";

// نافذة استثناء «نفس الإعلان خلال ٤٨ ساعة» — ضجيج/إعادة إدخال آلي.
export const DUP_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * مفتاح التطبيع للمقارنة فقط (لا يُخزَّن، لا يمسّ normalizePhone العامة):
 * يزيل كل غير الأرقام ثم يأخذ آخر ٩ أرقام = الرقم الوطني السعودي المميّز.
 *  0500187933 · +966500187933 · 966500187933 · «0500 187 933» → 500187933.
 * حارس: أقصر من ٩ خانات بعد التنظيف → null (رقم ناقص/غير صالح، لا يُجمَّع).
 */
export function dedupeKey(raw: string | null | undefined): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length < 9) return null;
  return digits.slice(-9);
}

/**
 * مفتاح «الإعلان/المصدر»: المصدر المهيكل sourceId إن وُجد (الأدقّ لتمييز الحملة)،
 * وإلا القناة channel كـfallback (للاستيراد الذي لا يضبط sourceId).
 */
export function adKey(l: { sourceId: string | null; channel: Channel }): string {
  return l.sourceId ?? `ch:${l.channel}`;
}

/**
 * الاستثناء الوحيد لدخول المكرر:
 * true فقط إذا وُجد Lead بنفس آخر-٩ (dedupeKey) + نفس الإعلان (adKey) + createdAt خلال آخر ٤٨ ساعة.
 * أي حالة أخرى (إعلان مختلف، أو بعد ٤٨ ساعة، أو رقم غير صالح) → false ⟹ يُضاف كمكرر ويظهر في القائمة.
 *
 * الأداء: استعلام واحد على صيغ الجوال المحتملة خلال النافذة فقط (مجموعة صغيرة)، ثم تأكيد بالذاكرة.
 * ملاحظة N+1: للدُفعات (استيراد/مزامنة) استخدم recentSameAdKeys أدناه بدل استدعاء هذي لكل صف.
 */
export async function isRecentSameAdDuplicate(
  phone: string,
  ad: { sourceId: string | null; channel: Channel },
  now: Date = new Date(),
  db: PrismaClient = prisma,
): Promise<boolean> {
  const key = dedupeKey(phone);
  if (!key) return false;
  const cutoff = new Date(now.getTime() - DUP_WINDOW_MS);
  const cand = await db.lead.findMany({
    where: { phone: { in: phoneVariants(normalizePhone(phone)) }, createdAt: { gte: cutoff } },
    select: { phone: true, sourceId: true, channel: true },
  });
  const incoming = adKey(ad);
  return cand.some((c) => dedupeKey(c.phone) === key && adKey(c) === incoming);
}

/**
 * نسخة الدُفعات (بلا N+1): يبني مجموعة مفاتيح «آخر٩|الإعلان» لكل العملاء المُضافين خلال آخر ٤٨ ساعة.
 * الفحص لكل صف وارد: skip فقط إذا `${dedupeKey}|${adKey}` موجود في المجموعة.
 */
export async function recentSameAdKeys(now: Date = new Date(), db: PrismaClient = prisma): Promise<Set<string>> {
  const cutoff = new Date(now.getTime() - DUP_WINDOW_MS);
  const recent = await db.lead.findMany({
    where: { createdAt: { gte: cutoff } },
    select: { phone: true, sourceId: true, channel: true },
  });
  const set = new Set<string>();
  for (const r of recent) {
    const k = dedupeKey(r.phone);
    if (k) set.add(`${k}|${adKey(r)}`);
  }
  return set;
}

/** مفتاح الفحص لصف وارد — يطابق ما يبنيه recentSameAdKeys. */
export function dupeCheckKey(phone: string, ad: { sourceId: string | null; channel: Channel }): string | null {
  const k = dedupeKey(phone);
  return k ? `${k}|${adKey(ad)}` : null;
}

/**
 * هل يوجد Lead موجود يطابق هذا الجوال (آخر ٩)؟ — لتحديد أن الليد الجديد «مكرر» وقت الإنشاء
 * فلا يُسنَد آليًا (يبقى معلّقًا في «العملاء المكررون»).
 */
export async function phoneHasExistingLead(phone: string, db: PrismaClient = prisma): Promise<boolean> {
  const key = dedupeKey(phone);
  if (!key) return false;
  const cand = await db.lead.findMany({
    where: { phone: { in: phoneVariants(normalizePhone(phone)) } },
    select: { phone: true },
  });
  return cand.some((c) => dedupeKey(c.phone) === key);
}

// م-٥: كاش ٦٠ ثانية بالذاكرة — هذه الدالة تمسح جدول Lead كاملًا وتُستدعى من layout
// المالك (كل تنقّل) وصفحة العملاء والداشبورد والكرون. الكاش لكل عملية تشغيل؛
// تأخُّر دقيقة في التقاط مكرر جديد مقبول (القوائم تتحدث بالدورة التالية).
const DUP_CACHE_MS = 60_000;
let dupIdsCache: { at: number; ids: Set<string> } | null = null;

/**
 * معرّفات كل الليدات التي جوالها (آخر ٩) مكرر (يظهر في أكثر من سجل) — لاستثناء المكررين المعلّقين
 * من عدّاد الداشبورد. استعلام واحد (id, phone) + تجميع بالذاكرة (بلا N+1) + كاش ٦٠ث.
 */
export async function duplicateLeadIds(db: PrismaClient = prisma): Promise<Set<string>> {
  if (dupIdsCache && Date.now() - dupIdsCache.at < DUP_CACHE_MS) return dupIdsCache.ids;
  const leads = await db.lead.findMany({ select: { id: true, phone: true } });
  const byKey = new Map<string, string[]>();
  for (const l of leads) {
    const k = dedupeKey(l.phone);
    if (!k) continue;
    const arr = byKey.get(k);
    if (arr) arr.push(l.id);
    else byKey.set(k, [l.id]);
  }
  const dupIds = new Set<string>();
  for (const ids of byKey.values()) if (ids.length > 1) for (const id of ids) dupIds.add(id);
  dupIdsCache = { at: Date.now(), ids: dupIds };
  return dupIds;
}
