import "server-only";

import { prisma } from "@/lib/prisma";
import { readSheetValues, resolveTabByGid } from "@/lib/google-sheets";
import { extractGid } from "@/lib/utils/sheet";
import { parseRowsByContent } from "@/lib/utils/sheet-parse";
import { recentSameAdKeys, dupeCheckKey } from "@/lib/phone-dupe";
import { emitNotification, notifyBestEffort } from "@/lib/notifications/emit";
import { channelForSourceName } from "@/lib/source-channel";

export type SheetSyncResult = {
  linkId: string;
  ok: boolean;
  created: number;
  duplicates: number;
  skipped: number;
  processed: number;      // صفوف عولجت هذه الجولة
  totalDataRows: number;  // إجمالي صفوف البيانات في الشيت
  remaining: number;      // متبقٍّ بعد هذه الجولة
  /** مصدر جديد بشيت مليان — بانتظار قرار المالك (زامن الكل / ابدأ من الآن) قبل أي إدخال. */
  pendingChoice?: boolean;
  error?: string;
};

// حد أمان أول مزامنة: مصدر جديد (مؤشر = 0) بأكثر من هذا العدد لا يُدخل شيئًا حتى يقرر المالك.
// (حادثة 2026-07-25: 465 عميلًا غلط دفعة واحدة من قراءة المستند كله.)
export const SAFE_FIRST_SYNC_ROWS = 50;

/** قيمة مؤشر خاصة: المالك وافق صراحةً على «زامن الكل» — تتجاوز حد الأمان لمرة البداية. */
export const FULL_SYNC_APPROVED = -1;

type LinkWithSource = {
  id: string;
  sheetUrl: string;
  sheetId: string;
  sourceId: string;
  lastRowSynced: number;
  source: { name: string } | null;
};

/**
 * يزامن رابط شيت واحد: يقرأ الصفوف الجديدة (من lastRowSynced) وينشئ عملاء
 * غير موزّعين بمصدر الرابط. لا يوزّعهم — يبقون في «غير الموزّعين».
 * opts.limit يحدّ عدد الصفوف المعالجة هذه الجولة (للسحب على دفعات).
 */
async function syncSheetLink(link: LinkWithSource, opts?: { limit?: number }): Promise<SheetSyncResult> {
  const base: Omit<SheetSyncResult, "ok"> = {
    linkId: link.id, created: 0, duplicates: 0, skipped: 0, processed: 0, totalDataRows: 0, remaining: 0,
  };
  try {
    // ⛔ إصلاح حادثة 2026-07-25: الورقة تُحدَّد بالـgid إلزاميًا — رابط بلا gid كان يسقط
    // بصمت على الورقة الأولى/المستند كله. الآن: بلا gid = خطأ صريح يظهر في شاشة المصادر.
    const gid = extractGid(link.sheetUrl);
    if (gid == null) {
      throw new Error("الرابط لا يحدد الورقة — افتح الورقة المطلوبة وانسخ الرقم بعد gid= من شريط العنوان ثم حدّث المصدر");
    }
    // حلّ صارم: الورقة غير الموجودة ترمي خطأً واضحًا (لا سقوط على الأولى).
    const tab = await resolveTabByGid(link.sheetId, gid);

    // مؤشر فعلي: FULL_SYNC_APPROVED (موافقة «زامن الكل») تُعامل كصفر مع تجاوز حد الأمان.
    const fullApproved = link.lastRowSynced === FULL_SYNC_APPROVED;
    const pointer = Math.max(0, link.lastRowSynced);

    // حد أمان أول مزامنة: مصدر جديد وقدّامه شيت مليان → لا إدخال، بانتظار قرار المالك.
    // نقرأ الورقة كاملة (لعدّ صفوف البيانات الفعلية لا حجم الشبكة) قبل أي كتابة.
    const fullValues = await readSheetValues(link.sheetId, { tab: tab.title });
    const fullParsed = parseRowsByContent(fullValues, { startDataIndex: pointer });
    const totalDataRows = fullParsed.totalDataRows;
    base.totalDataRows = totalDataRows;

    if (!fullApproved && link.lastRowSynced === 0 && totalDataRows > SAFE_FIRST_SYNC_ROWS) {
      await prisma.sheetLink.update({
        where: { id: link.id },
        data: {
          lastSyncAt: new Date(),
          lastSyncStatus: "pending_choice",
          lastSyncError: `الشيت فيه ${totalDataRows} صف — ابدأ المزامنة من آخر صف بدل البداية؟`,
        },
      });
      return { ...base, ok: true, created: 0, duplicates: 0, skipped: 0, remaining: totalDataRows, pendingChoice: true };
    }

    // تصنيف محتوائي (كل خلية بمحتواها) — يحل مشكلة الأعمدة المتبعثرة. نافذة الدورة فقط.
    const leads = opts?.limit != null ? fullParsed.leads.slice(0, opts.limit) : fullParsed.leads;
    base.processed = leads.length;

    // المكرر يُسمح به ليظهر في القائمة، إلا استثناء «نفس الرقم + نفس الإعلان (المصدر) خلال ٤٨ ساعة».
    // آمن هنا: المزامنة تقرأ الصفوف الجديدة فقط (lastRowSynced)، فلا تُعاد قراءة القديمة ولا تُضاف من جديد.
    const now = new Date();
    const recentSet = await recentSameAdKeys(now);
    const sourceName = link.source?.name ?? null;
    // قناة المصدر (سناب/تيك توك/ميتا/جوجل…) تُكتب على كل عملائه — sourceId + channel معًا.
    const channel = channelForSourceName(sourceName);
    const ad = { sourceId: link.sourceId, channel };
    const seen = new Set<string>(); // منع تكرار نفس الرقم داخل نفس الدفعة

    let created = 0, duplicates = 0, skipped = 0;
    const createdLeads: { id: string; name: string }[] = [];
    for (const l of leads) {
      if (!l.valid) { skipped++; continue; }
      const ck = dupeCheckKey(l.phone, ad);
      if (ck && (recentSet.has(ck) || seen.has(ck))) { duplicates++; continue; }
      if (ck) { seen.add(ck); recentSet.add(ck); }
      const row = await prisma.lead.create({
        data: {
          name: l.name,
          phone: l.phone,
          channel,
          stage: "NEW",
          assignedToId: null,               // غير موزّع — التوزيع التلقائي القائم يلتقطه طبيعيًا
          sourceId: link.sourceId,
          source: sourceName,               // نص المصدر (للعرض)
          purchaseMethod: l.purchaseMethod ?? undefined,
          purchaseGoal: l.purchaseGoal ?? undefined,
          preferredDistrict: l.district,
          // الحي المطبّع (قاموس الأحياء الثلاثة) — نفس حقل «الأحياء المناسبة» اليدوي، والموظف يعدّله.
          ...(l.areas.length ? { preferredAreas: l.areas } : {}),
          // السعر من–إلى بالريال الكامل (من عمود الميزانية إن وُجد).
          ...(l.priceMin != null ? { priceMin: l.priceMin } : {}),
          ...(l.priceMax != null ? { priceMax: l.priceMax } : {}),
          // نص خام غير مفهوم (حي/ميزانية) — يُحفظ ملاحظة بلا تخمين.
          ...(l.extraNote ? { notes: l.extraNote } : {}),
        },
        select: { id: true, name: true },
      });
      createdLeads.push(row);
      created++;
    }

    // سجل تدقيق لكل وصول (دفعة واحدة) + إشعار مجمّع للحدث القائم new_lead_from_sheet.
    if (createdLeads.length > 0) {
      await prisma.auditLog.createMany({
        data: createdLeads.map((c) => ({
          action: "lead.arrivedFromSheet",
          entity: "lead",
          entityId: c.id,
          summary: `وصل عميل جديد من «${sourceName ?? "شيت"}» · العميل=${c.id}`,
        })),
      });
      await notifyBestEffort("sheet-sync notify", () =>
        emitNotification({
          eventKey: "new_lead_from_sheet",
          title: createdLeads.length === 1 ? "عميل جديد من الشيت" : "عملاء جدد من الشيت",
          body: createdLeads.length === 1
            ? `${createdLeads[0].name} — من «${sourceName ?? "شيت"}»`
            : `وصل ${createdLeads.length} عملاء من «${sourceName ?? "شيت"}»`,
          link: "/leads?tab=unassigned",
        }),
      );
    }

    // حدّث المؤشّر بعدد ما عولج (صالح أو لا — ما نعيد قراءته). pointer يطبّع سالب الموافقة لصفر.
    const newLastRow = pointer + leads.length;
    await prisma.sheetLink.update({
      where: { id: link.id },
      data: { lastRowSynced: newLastRow, lastSyncAt: new Date(), lastSyncStatus: "success", lastSyncError: null },
    });

    return {
      ...base, ok: true, created, duplicates, skipped,
      remaining: Math.max(0, totalDataRows - newLastRow),
    };
  } catch (e) {
    const error = (e as Error).message;
    // خطأ في رابط واحد لا يوقف الباقي — سجّله فقط.
    await prisma.sheetLink.update({
      where: { id: link.id },
      data: { lastSyncAt: new Date(), lastSyncStatus: "error", lastSyncError: error },
    }).catch(() => {});
    return { ...base, ok: false, error };
  }
}

/** يزامن كل روابط الشيت النشطة (كل رابط مستقل — خطأ في واحد لا يوقف الباقي). */
export async function syncAllSheetLinks(opts?: { limit?: number }): Promise<{ ok: boolean; totalCreated: number; results: SheetSyncResult[] }> {
  const links = await prisma.sheetLink.findMany({
    where: { isActive: true },
    select: { id: true, sheetUrl: true, sheetId: true, sourceId: true, lastRowSynced: true, source: { select: { name: true } } },
  });
  const results: SheetSyncResult[] = [];
  for (const link of links) {
    results.push(await syncSheetLink(link, opts));
  }
  const totalCreated = results.reduce((s, r) => s + r.created, 0);
  return { ok: true, totalCreated, results };
}
