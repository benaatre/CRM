import { requireManager } from "@/lib/auth-guards";
import { getDistributionConfig } from "@/lib/actions/distribution";
import { initialDistributeOn, reassignSweepOn } from "@/lib/auto-distribute";
import { getDistributionBoard } from "@/lib/data/distribution";
import { getSourcesAndLinks } from "@/lib/data/sources";
import { getActivityReport } from "@/lib/data/activity-report";
import { DistributionView } from "@/components/distribution/distribution-view";
import { SourcesPanel } from "@/components/distribution/sources-panel";
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

  const [{ config, employees, lastCron }, board, { sources, links }, activity] = await Promise.all([
    getDistributionConfig(),
    getDistributionBoard(),
    getSourcesAndLinks(),
    isOwner ? getActivityReport({ day: sp.arday, all: sp.arp === "all" }) : Promise.resolve(null),
  ]);
  // حالة السويتشين من env (عرض فقط) — تُقرأ على الخادم.
  const switches = { initialOn: initialDistributeOn(), reassignOn: reassignSweepOn() };
  return (
    <>
      <AutoRefresh seconds={30} />
      <DistributionView config={config} employees={employees} board={board} switches={switches} lastCron={lastCron} isOwner={isOwner} />
      {/* تقرير النشاط — المالك فقط (الجلب والفرض على الخادم) */}
      {isOwner && activity && (
        <ActivityReportView data={activity} mode={mode} day={sp.arday ?? ""} />
      )}
      <div className="mx-auto mt-6 max-w-5xl">
        <SourcesPanel sources={sources} links={links} />
      </div>
    </>
  );
}
