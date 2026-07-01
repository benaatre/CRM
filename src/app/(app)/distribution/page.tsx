import { requireManager } from "@/lib/auth-guards";
import { getDistributionConfig } from "@/lib/actions/distribution";
import { getDistributionBoard } from "@/lib/data/distribution";
import { getSourcesAndLinks } from "@/lib/data/sources";
import { DistributionView } from "@/components/distribution/distribution-view";
import { SourcesPanel } from "@/components/distribution/sources-panel";
import { AutoRefresh } from "@/components/auto-refresh";

export const dynamic = "force-dynamic";

export default async function DistributionPage() {
  await requireManager();
  const [{ config, employees }, board, { sources, links }] = await Promise.all([
    getDistributionConfig(),
    getDistributionBoard(),
    getSourcesAndLinks(),
  ]);
  return (
    <>
      <AutoRefresh seconds={30} />
      <DistributionView config={config} employees={employees} board={board} />
      <div className="mx-auto mt-6 max-w-5xl">
        <SourcesPanel sources={sources} links={links} />
      </div>
    </>
  );
}
