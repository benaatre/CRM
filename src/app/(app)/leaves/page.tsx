import { Zain } from "next/font/google";
import { requireUser } from "@/lib/auth-guards";
import { listMyLeaves } from "@/lib/data/leaves";
import { MyLeavesDesktop, type LeaveRow } from "@/components/leaves/my-leaves-desktop";

export const dynamic = "force-dynamic";

// متغيّر خط Zain على غلاف الصفحة — تقرأه الأرقام عبر var(--font-zain) (نمط صفحة leads).
const zain = Zain({ subsets: ["arabic"], weight: ["700", "800"], variable: "--font-zain", display: "swap" });

/**
 * /leaves — «إجازاتي» لكل الأدوار (قرار سلطان): طلبات المستخدم نفسه فقط، بلا أي رصيد.
 * إدارة طلبات الفريق (اعتماد/رفض/رصيد) مكانها الوحيد ملف الموظف — ليست هنا.
 * المالك خارج نظام الإجازات (يفرضه POST /api/leaves بـ403) — نخفي زر الطلب له فقط.
 */
export default async function LeavesPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const user = await requireUser();
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

  return (
    <div className={zain.variable}>
      <MyLeavesDesktop initial={rows} openNew={sp.new === "1"} canRequest={user.role !== "OWNER"} />
    </div>
  );
}
