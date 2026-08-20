import { requireUser } from "@/lib/auth-guards";
import { listMyLeaves, listLeaves, getLeaveBalance } from "@/lib/data/leaves";
import { MyLeaves, type LeaveRow } from "@/components/mobile/my-leaves";
import { OwnerLeaves, type OwnerLeaveRow, type Balance } from "@/components/mobile/owner-leaves";

export const dynamic = "force-dynamic";

/**
 * /m/leaves — نفس المسار حسب الدور:
 * • المالك: كل طلبات الفريق (المعلّق أولًا) مع الرصيد المشتق واعتماد/رفض.
 * • الموظف: طلباته وحالتها فقط (بلا أي رصيد).
 */
export default async function LeavesPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const user = await requireUser();

  if (user.role === "OWNER" || user.role === "HR" || user.role === "FINANCE") {
    const requests = await listLeaves();
    const userIds = [...new Set(requests.map((r) => r.userId))];
    const balEntries = await Promise.all(userIds.map(async (id) => [id, await getLeaveBalance(id)] as const));
    const balances: Record<string, Balance> = Object.fromEntries(balEntries);
    const rows: OwnerLeaveRow[] = requests.map((r) => {
      const from = r.dateFrom.toISOString().slice(0, 10);
      const to = r.dateTo.toISOString().slice(0, 10);
      return {
        id: r.id,
        userId: r.userId,
        userName: r.user?.name ?? "—",
        type: r.type,
        from,
        to,
        days: Math.round((r.dateTo.getTime() - r.dateFrom.getTime()) / 86_400_000) + 1,
        reason: r.reason,
        status: r.status,
        decisionNote: r.decisionNote,
        createdAt: r.createdAt.toISOString(),
      };
    });
    return <OwnerLeaves initial={rows} balances={balances} />;
  }

  const sp = await searchParams;
  const requests = await listMyLeaves(user.id);
  const rows: LeaveRow[] = requests.map((r) => {
    const from = r.dateFrom.toISOString().slice(0, 10);
    const to = r.dateTo.toISOString().slice(0, 10);
    return {
      id: r.id,
      type: r.type,
      from,
      to,
      days: Math.round((r.dateTo.getTime() - r.dateFrom.getTime()) / 86_400_000) + 1,
      reason: r.reason,
      status: r.status,
      decisionNote: r.decisionNote,
      createdAt: r.createdAt.toISOString(),
    };
  });

  return <MyLeaves initial={rows} openNew={sp.new === "1"} />;
}
