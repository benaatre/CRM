import { Role } from "@prisma/client";
import { requireUser } from "@/lib/auth-guards";
import { getDashboard, normalizePeriod } from "@/lib/data/dashboard";
import { getMyNoResponseAlert } from "@/lib/data/no-response";
import { PeriodFilter } from "@/components/dashboard/period-filter";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { NoResponseBanner } from "@/components/dashboard/no-response-banner";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const user = await requireUser();
  const period = normalizePeriod((await searchParams).period);
  // بانر الإنذار للموظف فقط (المالك/المدير يشوفون لوحة «لم يتم الرد» الكاملة).
  const [data, alert] = await Promise.all([
    getDashboard(period),
    user.role === Role.EMPLOYEE ? getMyNoResponseAlert(user.id) : Promise.resolve({ lines: [], late: 0, pulled: 0 }),
  ]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <NoResponseBanner lines={alert.lines} pulled={alert.pulled} />
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">هلا {user.name}</h1>
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
