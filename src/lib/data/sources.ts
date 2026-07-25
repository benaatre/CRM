import "server-only";

import type { Channel } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { channelForSourceName } from "@/lib/source-channel";

// المصادر الافتراضية (تُزرع مرة واحدة إذا الجدول فاضي).
export const DEFAULT_SOURCES = [
  "ميتا",
  "سناب شات",
  "تيك توك",
  "عقار",
  "موقع الشركة",
  "تويتر / X",
  "لينكدإن",
  "دايركت من إعلانات",
  "جوجل",
  "يوتيوب",
  "أخرى",
];

/** يزرع المصادر الافتراضية إذا ما فيه ولا مصدر (idempotent). */
export async function ensureDefaultSources(): Promise<void> {
  const count = await prisma.leadSource.count();
  if (count > 0) return;
  await prisma.leadSource.createMany({
    data: DEFAULT_SOURCES.map((name) => ({ name, isDefault: true })),
    skipDuplicates: true,
  });
}

export type SourceListItem = { id: string; name: string };

/** قائمة المصادر (للـ dropdown في شاشة العميل) — يضمن وجود الافتراضية. */
export async function getSourcesList(): Promise<SourceListItem[]> {
  await ensureDefaultSources();
  return prisma.leadSource.findMany({
    select: { id: true, name: true },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
}

export type SourceRow = { id: string; name: string; isDefault: boolean; leadCount: number; linkCount: number };
export type SheetLinkRow = {
  id: string;
  sheetUrl: string;
  sheetId: string;
  sourceId: string;
  sourceName: string;
  lastSyncAt: Date | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  isActive: boolean;
};

// ===================== شاشة «مصادر العملاء» (الإعدادات — مالك فقط) =====================

export type SheetSourcePanelRow = {
  id: string;            // معرّف رابط الشيت
  sourceId: string;
  sourceName: string;
  channel: Channel;      // قناة المصدر (مشتقة من اسمه — تُكتب على عملائه)
  sheetUrl: string;
  isActive: boolean;
  lastRowSynced: number; // مؤشر آخر صف مُعالج (القراءة منه فقط — ممنوع المسح الكامل)
  lastSyncAt: Date | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  todayCount: number;    // عملاء اليوم من هذا المصدر (بتوقيت الرياض)
  /** عدّادات التحليل (من وسم تحليل= في سجل التدقيق): حُلّل بالقواعد · بالـAI · يحتاج مراجعة. */
  ruleCount: number;
  aiCount: number;
  reviewCount: number;
};

/** بيانات شاشة «مصادر العملاء»: كل روابط الشيت + قناة كل مصدر + عملاء اليوم + آخر مزامنة/خطأ. */
export async function getSheetSourcesPanel(): Promise<SheetSourcePanelRow[]> {
  // بداية اليوم بتوقيت الرياض (+٣ ثابت).
  const KSA_MS = 3 * 3_600_000;
  const k = new Date(Date.now() + KSA_MS);
  const dayStart = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - KSA_MS);

  const [links, todayGrp] = await Promise.all([
    prisma.sheetLink.findMany({
      orderBy: { createdAt: "desc" },
      include: { source: { select: { name: true } } },
    }),
    prisma.lead.groupBy({
      by: ["sourceId"],
      where: { sourceId: { not: null }, createdAt: { gte: dayStart } },
      _count: { _all: true },
    }),
  ]);
  const todayBySource = new Map(todayGrp.map((g) => [g.sourceId, g._count._all]));

  // عدّادات التحليل لكل مصدر — من وسم «تحليل=» في سجلات lead.arrivedFromSheet (الروابط قليلة).
  const analysisCounts = await Promise.all(
    links.map(async (l) => {
      const name = l.source?.name;
      if (!name) return { ruleCount: 0, aiCount: 0, reviewCount: 0 };
      const forSource = { action: "lead.arrivedFromSheet", summary: { contains: `من «${name}»` } };
      const [ruleCount, aiCount, reviewCount] = await Promise.all([
        prisma.auditLog.count({ where: { AND: [forSource, { summary: { contains: "تحليل=rules" } }] } }),
        prisma.auditLog.count({ where: { AND: [forSource, { summary: { contains: "تحليل=ai" } }] } }),
        prisma.auditLog.count({ where: { AND: [forSource, { summary: { contains: "تحليل=review" } }] } }),
      ]);
      return { ruleCount, aiCount, reviewCount };
    }),
  );

  return links.map((l, i) => ({
    id: l.id,
    sourceId: l.sourceId,
    sourceName: l.source?.name ?? "—",
    channel: channelForSourceName(l.source?.name),
    sheetUrl: l.sheetUrl,
    isActive: l.isActive,
    lastRowSynced: l.lastRowSynced,
    lastSyncAt: l.lastSyncAt,
    lastSyncStatus: l.lastSyncStatus,
    lastSyncError: l.lastSyncError,
    todayCount: todayBySource.get(l.sourceId) ?? 0,
    ...analysisCounts[i],
  }));
}

/** بيانات قسم «المصادر وروابط جوجل شيت» — المصادر مع عدد العملاء/الروابط + كل الروابط. */
export async function getSourcesAndLinks(): Promise<{ sources: SourceRow[]; links: SheetLinkRow[] }> {
  await ensureDefaultSources();
  const [sources, links] = await Promise.all([
    prisma.leadSource.findMany({
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      select: {
        id: true, name: true, isDefault: true,
        _count: { select: { leads: true, sheetLinks: true } },
      },
    }),
    prisma.sheetLink.findMany({
      orderBy: { createdAt: "desc" },
      include: { source: { select: { name: true } } },
    }),
  ]);
  return {
    sources: sources.map((s) => ({
      id: s.id, name: s.name, isDefault: s.isDefault,
      leadCount: s._count.leads, linkCount: s._count.sheetLinks,
    })),
    links: links.map((l) => ({
      id: l.id, sheetUrl: l.sheetUrl, sheetId: l.sheetId, sourceId: l.sourceId,
      sourceName: l.source?.name ?? "—",
      lastSyncAt: l.lastSyncAt, lastSyncStatus: l.lastSyncStatus, lastSyncError: l.lastSyncError,
      isActive: l.isActive,
    })),
  };
}
