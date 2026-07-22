import "server-only";

import { prisma } from "@/lib/prisma";
import { readSheetValues, listSheetTabs } from "@/lib/google-sheets";
import { parseRowsByContent } from "@/lib/utils/sheet-parse";
import { recentSameAdKeys, dupeCheckKey } from "@/lib/phone-dupe";
import type { Channel } from "@prisma/client";

export type SheetSyncResult = {
  linkId: string;
  ok: boolean;
  created: number;
  duplicates: number;
  skipped: number;
  processed: number;      // صفوف عولجت هذه الجولة
  totalDataRows: number;  // إجمالي صفوف البيانات في الشيت
  remaining: number;      // متبقٍّ بعد هذه الجولة
  error?: string;
};

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
    // gid التبويب من الرابط (#gid=...) — null = التبويب الأول.
    const gidMatch = link.sheetUrl.match(/[#&]gid=(\d+)/);
    const gid = gidMatch ? Number(gidMatch[1]) : undefined;
    // نحلّ التبويب مرة واحدة (عنوان + إجمالي الصفوف الحقيقي) ونقرأ نطاقًا محدودًا فقط
    // (أسرع بكثير + أقل عرضة لانقطاع اتصال القاعدة أثناء الطلب الطويل).
    let tabTitle: string | undefined;
    let realTotal: number | undefined;
    if (gid != null) {
      const t = (await listSheetTabs(link.sheetId)).find((x) => x.gid === gid);
      tabTitle = t?.title;
      realTotal = t ? Math.max(0, t.rowCount - 1) : undefined;
    }
    const endRow = opts?.limit != null ? link.lastRowSynced + opts.limit + 1 : undefined;
    const values = await readSheetValues(link.sheetId, { tab: tabTitle, endRow });
    // تصنيف محتوائي (كل خلية بمحتواها) — يحل مشكلة الأعمدة المتبعثرة.
    const parsed = parseRowsByContent(values, { startDataIndex: link.lastRowSynced, limit: opts?.limit });
    const leads = parsed.leads;
    const totalDataRows = realTotal ?? parsed.totalDataRows;
    base.totalDataRows = totalDataRows;
    base.processed = leads.length;

    // المكرر يُسمح به ليظهر في القائمة، إلا استثناء «نفس الرقم + نفس الإعلان (المصدر) خلال ٤٨ ساعة».
    // آمن هنا: المزامنة تقرأ الصفوف الجديدة فقط (lastRowSynced)، فلا تُعاد قراءة القديمة ولا تُضاف من جديد.
    const now = new Date();
    const recentSet = await recentSameAdKeys(now);
    const ad = { sourceId: link.sourceId, channel: "OTHER" as Channel };
    const seen = new Set<string>(); // منع تكرار نفس الرقم داخل نفس الدفعة
    const sourceName = link.source?.name ?? null;

    let created = 0, duplicates = 0, skipped = 0;
    for (const l of leads) {
      if (!l.valid) { skipped++; continue; }
      const ck = dupeCheckKey(l.phone, ad);
      if (ck && (recentSet.has(ck) || seen.has(ck))) { duplicates++; continue; }
      if (ck) { seen.add(ck); recentSet.add(ck); }
      await prisma.lead.create({
        data: {
          name: l.name,
          phone: l.phone,
          channel: "OTHER",
          stage: "NEW",
          assignedToId: null,               // غير موزّع — يدخل دورة التوزيع لاحقًا
          sourceId: link.sourceId,
          source: sourceName,               // نص المصدر (للعرض)
          purchaseMethod: l.purchaseMethod ?? undefined,
          purchaseGoal: l.purchaseGoal ?? undefined,
          preferredDistrict: l.district,
        },
      });
      created++;
    }

    // حدّث المؤشّر بعدد ما عولج (صالح أو لا — ما نعيد قراءته).
    const newLastRow = link.lastRowSynced + leads.length;
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
