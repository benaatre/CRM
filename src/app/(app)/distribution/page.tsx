import { requireManager } from "@/lib/auth-guards";
import { getDistributionConfig, getSweepCandidates } from "@/lib/actions/distribution";
import { getDistributionBoard } from "@/lib/data/distribution";
import { getSourcesAndLinks, getSheetSourcesPanel } from "@/lib/data/sources";
import { getActivityReport } from "@/lib/data/activity-report";
import { DistributionView } from "@/components/distribution/distribution-view";
import { SourcesPanel } from "@/components/distribution/sources-panel";
import { SheetSourcesPanel } from "@/components/distribution/sheet-sources-panel";
import { ActivityReportView } from "@/components/distribution/activity-report";
import { AutoRefresh } from "@/components/auto-refresh";

export const dynamic = "force-dynamic";

export default async function DistributionPage({
  searchParams,
}: {
  searchParams: Promise<{ arp?: string; arday?: string }>;
}) {
  const user = await requireManager();
  const isOwner = user.role === "OWNER";
  const sp = await searchParams;
  const mode: "today" | "all" | "day" = sp.arday ? "day" : sp.arp === "all" ? "all" : "today";

  const [{ config, employees, lastCron, sweepCutoffAt }, board, { sources }, activity, candidates, sheetSources] = await Promise.all([
    getDistributionConfig(),
    getDistributionBoard(),
    getSourcesAndLinks(),
    isOwner ? getActivityReport({ day: sp.arday, all: sp.arp === "all" }) : Promise.resolve(null),
    isOwner ? getSweepCandidates() : Promise.resolve([]),
    // «مصادر العملاء» (شيتات المزامنة) — للمالك فقط، انتقلت هنا من الإعدادات.
    isOwner ? getSheetSourcesPanel() : Promise.resolve(null),
  ]);
  return (
    <>
      <AutoRefresh seconds={30} />
      <DistributionView
        config={config} employees={employees} board={board}
        lastCron={lastCron} isOwner={isOwner} sweepCutoffAt={sweepCutoffAt} candidates={candidates}
      />
      {/* تقرير النشاط — المالك فقط (الجلب والفرض على الخادم) */}
      {isOwner && activity && (
        <ActivityReportView data={activity} mode={mode} day={sp.arday ?? ""} />
      )}
      <div className="mx-auto mt-6 max-w-5xl space-y-6">
        {/* مصادر العملاء (شيتات المزامنة) — الواجهة الوحيدة الظاهرة؛ روابط الشيت القديمة أُخفيت بلا حذف */}
        {sheetSources && <SheetSourcesPanel rows={sheetSources} />}
        <SourcesPanel sources={sources} />
      </div>
    </>
  );
}
