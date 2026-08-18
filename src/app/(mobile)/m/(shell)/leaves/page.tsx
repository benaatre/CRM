import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth-guards";
import { listMyLeaves } from "@/lib/data/leaves";
import { MyLeaves, type LeaveRow } from "@/components/mobile/my-leaves";

export const dynamic = "force-dynamic";

/**
 * «إجازاتي» — شاشة الموظف: طلباته وحالتها فقط (بلا أي رصيد). المالك يعتمد من
 * ملف الموظف (م٤) لا من هنا، فيُحوَّل للرئيسية.
 */
export default async function LeavesPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const user = await requireUser();
  if (user.role === "OWNER") redirect("/m");

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
