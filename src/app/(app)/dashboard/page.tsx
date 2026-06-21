import { requireUser } from "@/lib/auth-guards";
import { getDashboard, normalizePeriod } from "@/lib/data/dashboard";
import { PeriodFilter } from "@/components/dashboard/period-filter";
import { DashboardView } from "@/components/dashboard/dashboard-view";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const user = await requireUser();
  const period = normalizePeriod((await searchParams).period);
  const data = await getDashboard(period);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">هلا {user.name} 👋</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.manager ? "نظرة عامة على كل النشاط." : "نظرة على عملائك ومتابعاتك."}
          </p>
        </div>
        <PeriodFilter current={period} />
      </header>

      <DashboardView data={data} />
    </div>
  );
}
