import "server-only";

import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guards";
import { bookingCollection } from "@/lib/booking-finance";
import { getOwnerKpis, type OwnerKpis } from "@/lib/data/owner-dashboard";
import { getLeaderboard } from "@/lib/data/leaderboard";
import { getTeamPresence } from "@/lib/data/team";
import { getEmployeeFile } from "@/lib/data/attendance";
import { currentMonthKSA } from "@/lib/attendance-logic";
import { bookingStageLabels } from "@/lib/labels";
import { formatDateTime } from "@/lib/format";
import { listLeaves } from "@/lib/data/leaves";

/**
 * داشبورد المدير المالي (قرار 2026-08-20) — قراءة فقط من الدوال القائمة:
 * الأرقام من getOwnerKpis (بلا عرض «غير الموزّعين»)، والتحصيل عبر
 * bookingCollection المحسوبة حصريًا، والدفعات من سجل التدقيق القائم
 * (action=booking.payment)، والنجم/المتصلين من الليدربورد والحضور القائمين.
 */

export type FinanceDashboardData = {
  kpis: OwnerKpis;
  collection: { collected: number; remaining: number; total: number; pct: number };
  recentPayments: { summary: string; byName: string; whenText: string }[];
  attention: {
    id: string;
    leadName: string;
    unitLabel: string;
    stageLabel: string;
    collected: number;
    remaining: number;
  }[];
  stageCounts: { stage: string; label: string; count: number }[];
  weekStar: { name: string; isCurrentWeek: boolean } | null;
  online: { id: string; name: string }[];
};

export async function getFinanceDashboard(): Promise<FinanceDashboardData> {
  const user = await requireUser();
  if (user.role !== Role.FINANCE && user.role !== Role.OWNER) {
    throw new Error("داشبورد المدير المالي للمدير المالي فقط");
  }

  const [kpis, bookings, payLogs, board, presence, stageGroups] = await Promise.all([
    getOwnerKpis("all"),
    prisma.booking.findMany({
      select: {
        id: true,
        stage: true,
        finalPrice: true,
        collectedAmount: true,
        lead: { select: { name: true } },
        unit: { select: { number: true, project: { select: { name: true } } } },
      },
    }),
    prisma.auditLog.findMany({
      where: { action: "booking.payment" },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { summary: true, createdAt: true, userId: true },
    }),
    getLeaderboard(),
    getTeamPresence(),
    prisma.booking.groupBy({ by: ["stage"], _count: { _all: true } }),
  ]);

  // ملخص التحصيل — bookingCollection المحسوبة (DELIVERED = مكتمل) لا العمود المخزّن.
  let collected = 0;
  let remaining = 0;
  for (const b of bookings) {
    const c = bookingCollection(b.stage, b.finalPrice.toNumber(), b.collectedAmount.toNumber());
    collected += c.collected;
    remaining += c.remaining;
  }
  const total = collected + remaining;

  // «تحتاج انتباهه»: بيعت (SOLD — آخر مرحلة قبل الاستلام) وتحصيلها غير مكتمل.
  const attention = bookings
    .filter((b) => b.stage === "SOLD")
    .map((b) => {
      const c = bookingCollection(b.stage, b.finalPrice.toNumber(), b.collectedAmount.toNumber());
      return {
        id: b.id,
        leadName: b.lead?.name ?? "—",
        unitLabel: `${b.unit?.project?.name ?? "—"} · وحدة ${b.unit?.number ?? "—"}`,
        stageLabel: bookingStageLabels[b.stage] ?? b.stage,
        collected: c.collected,
        remaining: c.remaining,
      };
    })
    .filter((x) => x.remaining > 0)
    .sort((a, b) => b.remaining - a.remaining)
    .slice(0, 6);

  const payerNames = new Map(
    (
      await prisma.user.findMany({
        where: { id: { in: [...new Set(payLogs.map((l) => l.userId).filter((x): x is string => !!x))] } },
        select: { id: true, name: true },
      })
    ).map((u) => [u.id, u.name]),
  );

  const STAGE_ORDER = ["RESERVATION", "PAPERWORK", "VALUATION", "SIGNING", "TRANSFER", "SOLD", "DELIVERED"];
  const stageCounts = STAGE_ORDER.map((stage) => ({
    stage,
    label: bookingStageLabels[stage as keyof typeof bookingStageLabels] ?? stage,
    count: stageGroups.find((g) => g.stage === stage)?._count._all ?? 0,
  }));

  return {
    kpis,
    collection: { collected, remaining, total, pct: total > 0 ? Math.round((collected / total) * 100) : 0 },
    recentPayments: payLogs.map((l) => ({
      summary: l.summary,
      byName: (l.userId && payerNames.get(l.userId)) || "—",
      whenText: formatDateTime(l.createdAt),
    })),
    attention,
    stageCounts,
    weekStar: board.rows[0] ? { name: board.rows[0].name, isCurrentWeek: board.isCurrentWeek } : null,
    online: presence.filter((p) => p.online).map((p) => ({ id: p.id, name: p.name })),
  };
}

/** إضافات داشبورد HR — طلبات الإجازة المعلقة (قراره نهائي) بروابط الملفات. */
export type HrExtrasData = {
  pendingLeaves: { id: string; userId: string; userName: string; typeKey: string; fromKey: string; toKey: string }[];
  /** دوام الفريق اليوم يُعرض عبر مكوّن الحوكمة القرائي (client يجلب /api/attendance/live). */
};

export async function getHrExtras(): Promise<HrExtrasData> {
  const user = await requireUser();
  if (user.role !== Role.HR && user.role !== Role.OWNER && user.role !== Role.FINANCE) {
    throw new Error("قسم الموارد البشرية لمن يملك قرار الإجازات فقط");
  }
  const rows = await listLeaves({ status: "PENDING" });
  return {
    pendingLeaves: rows.slice(0, 6).map((r) => ({
      id: r.id,
      userId: r.userId,
      userName: r.user?.name ?? "—",
      typeKey: r.type,
      fromKey: r.dateFrom.toISOString().slice(0, 10),
      toKey: r.dateTo.toISOString().slice(0, 10),
    })),
  };
}

/** بطاقة دوامه الشخصي تُعرض بمكوّن AttendanceCard القائم — لا بيانات إضافية هنا. */
export async function getMyMonthFileLite(userId: string) {
  return getEmployeeFile(userId, currentMonthKSA());
}
