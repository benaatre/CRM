import { requireManager } from "@/lib/auth-guards";
import { getDistributionConfig } from "@/lib/actions/distribution";
import { getDistributionBoard } from "@/lib/data/distribution";
import { DistributionView } from "@/components/distribution/distribution-view";
import { AutoRefresh } from "@/components/auto-refresh";

export const dynamic = "force-dynamic";

export default async function DistributionPage() {
  await requireManager();
  const [{ config, employees }, board] = await Promise.all([
    getDistributionConfig(),
    getDistributionBoard(),
  ]);
  return (
    <>
      <AutoRefresh seconds={30} />
      <DistributionView config={config} employees={employees} board={board} />
    </>
  );
}
