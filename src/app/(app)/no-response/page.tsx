import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth-guards";
import {
  getPendingPullByEmployee, getPoolBySourceEmployee, getActiveEmployeeLoads,
  getExhaustedPoolLeads, getUndoablePullBatches, type NoResponseSort,
} from "@/lib/data/no-response";
import { getNoResponseConfig } from "@/lib/no-response-escalation";
import { NoResponseView } from "@/components/no-response/no-response-view";

export const dynamic = "force-dynamic";

const SORTS: NoResponseSort[] = ["recent", "oldest", "rounds"];

export default async function NoResponsePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole(Role.OWNER); // المالك فقط
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

  const q = one(sp.q).trim();
  const prevEmp = one(sp.emp);
  const roundsRaw = Number(one(sp.rounds));
  const rounds = roundsRaw === 1 || roundsRaw === 2 || roundsRaw === 3 ? (roundsRaw as 1 | 2 | 3) : undefined;
  const sortRaw = one(sp.sort) as NoResponseSort;
  const sort = SORTS.includes(sortRaw) ? sortRaw : "recent";

  const [summary, pool, employeeLoads, exhausted, undoBatches] = await Promise.all([
    getPendingPullByEmployee(),
    getPoolBySourceEmployee(),
    getActiveEmployeeLoads(),
    getExhaustedPoolLeads(),
    getUndoablePullBatches(),
  ]);

  return (
    <NoResponseView
      summary={summary}
      pool={pool}
      employeeLoads={employeeLoads}
      exhausted={exhausted}
      undoBatches={undoBatches}
      filters={{ q, emp: prevEmp, rounds: rounds ?? 0, sort }}
      config={getNoResponseConfig()}
    />
  );
}
