import "server-only";

import { prisma } from "@/lib/prisma";

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
