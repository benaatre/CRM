import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { notify, ownerIds, managerIds, activeUserIds } from "@/lib/notify";
import { ensureNotificationDefaults } from "@/lib/data/notifications-config";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * آثار جانبية بعد الـcommit (إشعار/تدقيق): فشلها يُسجَّل ولا يُفشِل العملية الأساسية.
 * يمنع «خطأ ظاهر بعد نجاح الحفظ → إعادة محاولة → سجل مكرّر» (#29).
 */
export async function notifyBestEffort(context: string, fn: () => Promise<unknown>): Promise<void> {
  try { await fn(); } catch (e) { console.error(`[post-commit] ${context}`, e); }
}

type EmitArgs = {
  eventKey: string;          // مفتاح الحدث (واحد من السبعة)
  assignedUserId?: string | null; // الموظف المعني (لأحداث ASSIGNED)
  title: string;             // عنوان الإشعار (سعودي)
  body?: string;             // تفاصيل
  link?: string;             // رابط يفتح العنصر
};

/** يحدّد المستلمين حسب الجمهور المحفوظ للحدث. */
async function recipientsFor(db: Db, audience: string, assignedUserId?: string | null): Promise<string[]> {
  const assigned = assignedUserId ? [assignedUserId] : [];
  switch (audience) {
    case "OWNER": return ownerIds(db);
    case "MANAGERS": return managerIds(db);
    case "ASSIGNED": return assigned;
    case "MANAGERS_AND_ASSIGNED": return [...(await managerIds(db)), ...assigned];
    case "ALL": return activeUserIds(db);
    default: return managerIds(db);
  }
}

/**
 * الدالة المركزية لإطلاق إشعار حدث — تحدّد المستلمين على الخادم حسب جمهور الحدث،
 * وتنشئ سجل إشعار لكل مستلم (type = eventKey) عشان العميل يطابق إعداد الصوت/التوست.
 * التحقق من الجمهور كله على الخادم — لا اعتماد على الواجهة.
 */
export async function emitNotification(args: EmitArgs, db: Db = prisma): Promise<void> {
  const { eventKey, assignedUserId, title, body, link } = args;
  await ensureNotificationDefaults();
  const setting = await db.notificationSetting.findUnique({
    where: { eventKey },
    select: { audience: true },
  });
  const audience = setting?.audience ?? "MANAGERS";
  const recipients = await recipientsFor(db, audience, assignedUserId);
  if (recipients.length === 0) return;
  // نُنشئ السجل دائمًا (الجرس يعرضه)؛ العميل يقرّر التوست/الصوت حسب إعداد الحدث وقت الوصول.
  await notify(db, recipients, eventKey, title, body, link);
}

export type LeadAssignedBucket = { userId: string; count: number; sampleLeadId?: string; sampleName?: string };

/**
 * إطلاق «توزّع عليك عميل» مجمّعًا لكل موظف — إشعار واحد لو وصله عدة عملاء دفعة وحدة
 * (تفاديًا لإزعاج عدة أصوات متتالية في التوزيع الجماعي).
 */
export async function emitLeadAssignedBatch(buckets: LeadAssignedBucket[], db: Db = prisma): Promise<void> {
  for (const b of buckets) {
    if (!b.userId || b.count <= 0) continue;
    const single = b.count === 1;
    await emitNotification({
      eventKey: "lead_assigned",
      assignedUserId: b.userId,
      title: single ? "توزّع عليك عميل" : "وصلوك عملاء جدد",
      body: single ? (b.sampleName ? `العميل: ${b.sampleName}` : undefined) : `وصلك ${b.count} عملاء جدد`,
      link: single && b.sampleLeadId ? `/leads/${b.sampleLeadId}` : "/leads",
    }, db);
  }
}

// نوع التحويل يحدّد صياغة الإشعار: fresh = «كعملاء جدد» (ابدأ من جديد)، withHistory = «بمحتواهم» (راجع التاريخ).
export type TransferKind = "fresh" | "withHistory";

/**
 * إطلاق «وصلك عملاء محوّلون» مجمّعًا لكل موظف — لتوزيع عملاء «لم يتم الرد» (عملاء سبق سحبهم).
 * النص يتفرّق حسب نوع التحويل (fresh / withHistory). إشعار واحد لكل موظف.
 * kind الافتراضي withHistory (الأأمن — لا يوحي بأن التاريخ صُفّر إن لم يكن كذلك).
 */
export async function emitTransferredLeadsBatch(
  buckets: LeadAssignedBucket[],
  kind: TransferKind = "withHistory",
  db: Db = prisma,
): Promise<void> {
  for (const b of buckets) {
    if (!b.userId || b.count <= 0) continue;
    const single = b.count === 1;
    const text = transferNotifyText(kind, single, b.count, b.sampleName);
    await emitNotification({
      eventKey: "lead_assigned",
      assignedUserId: b.userId,
      title: text.title,
      body: text.body,
      link: single && b.sampleLeadId ? `/leads/${b.sampleLeadId}` : "/leads",
    }, db);
  }
}

/** نص إشعار التحويل حسب النوع/العدد (سعودي). */
function transferNotifyText(kind: TransferKind, single: boolean, count: number, sampleName?: string): { title: string; body: string } {
  if (kind === "fresh") {
    return single
      ? { title: "وصلك عميل جديد للمتابعة", body: sampleName ? `${sampleName} — وصلك عميل جديد للمتابعة، ابدأ معه من جديد` : "وصلك عميل جديد للمتابعة — ابدأ معه من جديد" }
      : { title: "وصلوك عملاء جدد للمتابعة", body: `وصلك ${count} عملاء جدد للمتابعة — ابدأ معهم من جديد` };
  }
  // withHistory
  return single
    ? { title: "وصلك عميل محوّل بتاريخه", body: sampleName ? `${sampleName} — عميل محوّل بتاريخه، راجع متابعاته السابقة` : "وصلك عميل محوّل بتاريخه — راجع متابعاته السابقة" }
    : { title: "وصلوك عملاء محوّلون بتاريخهم", body: `وصلك ${count} عملاء محوّلين بتاريخهم — راجع متابعاتهم السابقة` };
}
