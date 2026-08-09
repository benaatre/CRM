// قناة العميل من اسم مصدره — وحدة نقية (type-only على Prisma) آمنة لأي طبقة.
// «المصدر» هو الحقل الظاهر الموحّد؛ القناة عمود مشتق يُكتب معه تلقائيًا
// (التحليلات ورسم القنوات يعتمدان عليه، فلا يُحذف — انظر مذكرة baseline).
import type { Channel } from "@prisma/client";

/**
 * يشتق القناة من اسم المصدر بمطابقة الكلمات:
 * «سناب شات» → SNAPCHAT، «تيك توك» → TIKTOK، «ميتا/فيس/انستقرام» → META …
 * من لا يُطابق شيئًا → OTHER.
 */
export function channelForSourceName(name: string | null | undefined): Channel {
  const n = (name ?? "").toLowerCase();
  if (/سناب|snap/.test(n)) return "SNAPCHAT";
  if (/تيك|tik/.test(n)) return "TIKTOK";
  if (/ميتا|فيس|انستق|إنستق|meta|insta|face/.test(n)) return "META";
  if (/جوجل|قوقل|يوتيوب|google|youtube/.test(n)) return "GOOGLE";
  if (/عقار|aqar/.test(n)) return "AQAR";
  if (/واتساب|whats/.test(n)) return "WHATSAPP";
  if (/إحالة|احالة|referr/.test(n)) return "REFERRAL";
  if (/زيارة|visit/.test(n)) return "VISIT";
  return "OTHER";
}
