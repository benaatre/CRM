import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { Zain } from "next/font/google";
import { requireUser, SELLER_ROLES } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { buildExport } from "@/lib/actions/exports";
import { channelLabel } from "@/lib/labels";
import type { ExportSlice } from "@/lib/export-columns";
import { ExportsCenter } from "@/components/exports/exports-center";

const zain = Zain({ subsets: ["arabic"], weight: ["700", "800"], display: "swap" });

export const dynamic = "force-dynamic";

const PREPARED: ExportSlice[] = ["ad_exclusion", "interested", "visited", "bookings", "sales", "all"];

/**
 * «مركز التصدير» — للمالك حصرًا (حارس مزدوج: هنا وفي buildExport نفسه).
 * عدادات البطاقات تُحسب هنا مرة عند الفتح بنفس الأكشن (count)، وخيارات
 * المصدر الإعلاني من قنوات البيانات الفعلية (جوجل يظهر تلقائيًا إن ظهرت قناته).
 */
export default async function ExportsPage({ searchParams }: { searchParams: Promise<{ slice?: string }> }) {
  const user = await requireUser();
  if (user.role !== Role.OWNER) redirect("/dashboard");
  const sp = await searchParams;
  const initialSlice: ExportSlice = (PREPARED as string[]).includes(sp.slice ?? "") || sp.slice === "custom"
    ? (sp.slice as ExportSlice)
    : "ad_exclusion";

  const [channelGrp, employees, ...counts] = await Promise.all([
    prisma.lead.groupBy({ by: ["channel"], _count: { _all: true } }),
    prisma.user.findMany({
      where: { role: { in: SELLER_ROLES }, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    ...PREPARED.map((s) => buildExport(s, {}, { group: "ads" }, "count")),
  ]);

  const initialCounts = Object.fromEntries(
    PREPARED.map((s, i) => [s, counts[i].ok ? (counts[i] as { count: number }).count : 0]),
  ) as Record<ExportSlice, number>;
  const channels = channelGrp
    .sort((a, b) => b._count._all - a._count._all)
    .map((g) => ({ value: g.channel, label: channelLabel(g.channel), count: g._count._all }));

  return (
    <ExportsCenter
      zainClass={zain.className}
      initialSlice={initialSlice}
      initialCounts={initialCounts}
      channels={channels}
      employees={employees}
    />
  );
}
