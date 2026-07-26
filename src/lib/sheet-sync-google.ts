import "server-only";

import { prisma } from "@/lib/prisma";
import { readSheetValues, resolveTabByGid } from "@/lib/google-sheets";
import { extractGid } from "@/lib/utils/sheet";
import { parseRowsByContent, isStubbornRow, type ParsedLead } from "@/lib/utils/sheet-parse";
import { analyzeStubbornRows, type AiRowResult } from "@/lib/sheet-ai";
import { recentSameAdKeys, dupeCheckKey } from "@/lib/phone-dupe";
import { emitNotification, notifyBestEffort } from "@/lib/notifications/emit";
import { channelForSourceName } from "@/lib/source-channel";
import { isAutoPoolSource } from "@/lib/auto-pool";

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

    // طبقة الـAI للصفوف العصية (fallback لا أساس): تُجمع وتُرسل دفعة واحدة — لا طلب لكل صف.
    // فشل الدفعة آمن: كل صف عصي يدخل بما التقطته القواعد + ملاحظة «يحتاج مراجعة».
    const stubborn = leads.filter((l) => l.valid && isStubbornRow(l));
    const aiByLead = new Map<ParsedLead, AiRowResult>();
    if (stubborn.length > 0) {
      const aiRes = await analyzeStubbornRows(stubborn.map((s) => s.rawCells));
      if (aiRes) stubborn.forEach((s, i) => aiByLead.set(s, aiRes[i]));
    }
    const stubbornSet = new Set(stubborn);

    // المكرر يُسمح به ليظهر في القائمة، إلا استثناء «نفس الرقم + نفس الإعلان (المصدر) خلال ٤٨ ساعة».
    // آمن هنا: المزامنة تقرأ الصفوف الجديدة فقط (lastRowSynced)، فلا تُعاد قراءة القديمة ولا تُضاف من جديد.
    const now = new Date();
    const recentSet = await recentSameAdKeys(now);
    const sourceName = link.source?.name ?? null;
    // قناة المصدر (سناب/تيك توك/ميتا/جوجل…) تُكتب على كل عملائه — sourceId + channel معًا.
    const channel = channelForSourceName(sourceName);
    const ad = { sourceId: link.sourceId, channel };
    // وسم «مصدر تلقائي» يُقرأ مرة واحدة للرابط كله (لا استعلام لكل صف).
    const autoPoolSource = await isAutoPoolSource(link.sourceId);
    const seen = new Set<string>(); // منع تكرار نفس الرقم داخل نفس الدفعة

    let created = 0, duplicates = 0, skipped = 0;
    const createdLeads: { id: string; name: string; analysis: "rules" | "ai" | "review" }[] = [];
    for (const l of leads) {
      if (!l.valid) { skipped++; continue; }

      // دمج نتيجة الـAI للصف العصي: الحقول المطبّعة (جوال/هدف/طريقة/حي/سعر) قيم القواعد أولًا
      // (regex صارم دقيق)، أما **الاسم فمن الـAI أولًا** — القواعد في الصف العصي قد تلتقط
      // جملة حرة اسمًا («ميزانيته ما تطلع…») بينما الـAI شاف الصف كاملًا وميّز الاسم الفعلي.
      const ai = aiByLead.get(l) ?? null;
      const analysis: "rules" | "ai" | "review" = !stubbornSet.has(l) ? "rules" : ai ? "ai" : "review";
      const name = ai?.name || l.name || "بدون اسم";
      const phone = l.phone || ai?.phone || "";
      const purchaseGoal = l.purchaseGoal ?? ai?.purchaseGoal ?? null;
      const purchaseMethod = l.purchaseMethod ?? ai?.purchaseMethod ?? null;
      const areas = l.areas.length ? l.areas : (ai?.areas ?? []);
      const priceMin = l.priceMin ?? ai?.priceMin ?? null;
      const priceMax = l.priceMax ?? ai?.priceMax ?? null;
      const notes = [
        l.extraNote,
        !l.areas.length ? ai?.areaNote : null,
        analysis === "review" ? "يحتاج مراجعة — الصف ما فُهم كاملًا (راجع بيانات العميل من الشيت)" : null,
      ].filter(Boolean).join(" · ") || null;

      // حارس المكررات على الجوال الصالح فقط — جوال فارغ لا يدخل المقارنة (وإلا تُحسب الفوارغ مكررات).
      const ck = phone ? dupeCheckKey(phone, ad) : null;
      if (ck && (recentSet.has(ck) || seen.has(ck))) { duplicates++; continue; }
      if (ck) { seen.add(ck); recentSet.add(ck); }
      const row = await prisma.lead.create({
        data: {
          name,
          phone,
          channel,
          stage: "NEW",
          assignedToId: null,               // غير موزّع — التوزيع التلقائي القائم يلتقطه طبيعيًا
          // باب البركة ١: مصدر موسوم autoPool → الصف الوارد من الشيت يدخل البركة فورًا.
          // (autoPoolSource يُحسب مرة واحدة للرابط كله — لا استعلام لكل صف.)
          ...(autoPoolSource ? { autoPoolAt: new Date() } : {}),
          sourceId: link.sourceId,
          source: sourceName,               // نص المصدر (للعرض)
          purchaseMethod: purchaseMethod ?? undefined,
          purchaseGoal: purchaseGoal ?? undefined,
          preferredDistrict: l.district,
          // الحي المطبّع (قاموس الأحياء الثلاثة) — نفس حقل «الأحياء المناسبة» اليدوي، والموظف يعدّله.
          ...(areas.length ? { preferredAreas: areas } : {}),
          // السعر من–إلى بالريال الكامل (من عمود الميزانية إن وُجد).
          ...(priceMin != null ? { priceMin } : {}),
          ...(priceMax != null ? { priceMax } : {}),
          // نص خام غير مفهوم (حي/ميزانية/جوال) — يُحفظ ملاحظة بلا تخمين.
          ...(notes ? { notes } : {}),
        },
        select: { id: true, name: true },
      });
      createdLeads.push({ ...row, analysis });
      created++;
    }

    // سجل تدقيق لكل وصول (دفعة واحدة) + إشعار مجمّع للحدث القائم new_lead_from_sheet.
    if (createdLeads.length > 0) {
      await prisma.auditLog.createMany({
        data: createdLeads.map((c) => ({
          action: "lead.arrivedFromSheet",
          entity: "lead",
          entityId: c.id,
          // وسم التحليل (rules/ai/review) — تُبنى منه عدّادات شاشة المصادر.
          summary: `وصل عميل جديد من «${sourceName ?? "شيت"}» · العميل=${c.id} · تحليل=${c.analysis}`,
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
