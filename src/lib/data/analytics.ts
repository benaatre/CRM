import "server-only";

import type { Channel, LeadStage } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const num = (v: { toNumber(): number } | null) => (v ? v.toNumber() : 0);

export type FinanceRow = {
  projectId: string;
  projectName: string;
  basePrice: number;
  discounts: number;
  afterDiscount: number;
  collected: number;
  notCollected: number;
  reservedValue: number;
};

export type AnalyticsData = {
  finance: {
    basePrice: number;
    discounts: number;
    afterDiscount: number;
    collected: number;
    notCollected: number;
    reservedValue: number;
    financeFailedCount: number;
    financeFailedValue: number;
    perProject: FinanceRow[];
  };
  metrics: {
    avgFirstResponseHours: number | null;
    within1hRate: number; // %
    responseRate: number; // %
    avgAttempts: number;
    avgSalesCycleDays: number | null;
  };
  funnel: { stage: LeadStage; count: number; convFromPrev: number | null }[];
  channels: { channel: Channel; count: number }[];
  team: { name: string; closed: number; bookings: number }[];
};

const FUNNEL: LeadStage[] = [
  "NEW",
  "ATTEMPTED",
  "INTERESTED",
  "VIEWING",
  "NEGOTIATION",
  "RESERVED",
  "CLOSED_WON",
];

export async function getAnalytics(): Promise<AnalyticsData> {
  const [bookings, leads, channelGroups, stageGroups, employees, closedByEmp, bookingsByEmp] =
    await Promise.all([
      prisma.booking.findMany({
        include: { unit: { select: { project: { select: { id: true, name: true } } } } },
      }),
      prisma.lead.findMany({
        select: { createdAt: true, firstContactAt: true, updatedAt: true, attempts: true, stage: true },
      }),
      prisma.lead.groupBy({ by: ["channel"], _count: { _all: true } }),
      prisma.lead.groupBy({ by: ["stage"], _count: { _all: true } }),
      prisma.user.findMany({ where: { role: "EMPLOYEE", active: true }, select: { id: true, name: true } }),
      prisma.lead.groupBy({ by: ["assignedToId"], where: { stage: "CLOSED_WON" }, _count: { _all: true } }),
      prisma.booking.groupBy({ by: ["sellerId"], _count: { _all: true } }),
    ]);

  // ===== المالية =====
  const perProjectMap = new Map<string, FinanceRow>();
  let basePrice = 0, discounts = 0, afterDiscount = 0, collected = 0, reservedValue = 0;
  let financeFailedCount = 0, financeFailedValue = 0;

  for (const b of bookings) {
    const price = num(b.price);
    const disc = num(b.discount);
    const final = num(b.finalPrice);
    const coll = num(b.collected);
    basePrice += price;
    discounts += disc;
    afterDiscount += final;
    collected += coll;
    if (b.stage !== "SOLD") reservedValue += final;
    if (b.financeRejected) {
      financeFailedCount++;
      financeFailedValue += final;
    }
    const proj = b.unit.project;
    if (proj) {
      const row = perProjectMap.get(proj.id) ?? {
        projectId: proj.id, projectName: proj.name,
        basePrice: 0, discounts: 0, afterDiscount: 0, collected: 0, notCollected: 0, reservedValue: 0,
      };
      row.basePrice += price;
      row.discounts += disc;
      row.afterDiscount += final;
      row.collected += coll;
      row.notCollected += final - coll;
      if (b.stage !== "SOLD") row.reservedValue += final;
      perProjectMap.set(proj.id, row);
    }
  }
  const notCollected = afterDiscount - collected;

  // ===== المؤشرات الاحترافية =====
  const total = leads.length;
  const responded = leads.filter((l) => l.firstContactAt);
  const respDiffsMs = responded.map((l) => l.firstContactAt!.getTime() - l.createdAt.getTime());
  const within1h = respDiffsMs.filter((d) => d <= 3_600_000).length;
  const avgFirstResponseHours =
    respDiffsMs.length > 0
      ? Math.round((respDiffsMs.reduce((a, b) => a + b, 0) / respDiffsMs.length / 3_600_000) * 10) / 10
      : null;
  const closedLeads = leads.filter((l) => l.stage === "CLOSED_WON");
  const cycleMs = closedLeads.map((l) => l.updatedAt.getTime() - l.createdAt.getTime());
  const avgSalesCycleDays =
    cycleMs.length > 0
      ? Math.round((cycleMs.reduce((a, b) => a + b, 0) / cycleMs.length / 86_400_000) * 10) / 10
      : null;
  const avgAttempts =
    total > 0 ? Math.round((leads.reduce((a, l) => a + l.attempts, 0) / total) * 10) / 10 : 0;

  // ===== القمع + نسب التحويل =====
  const stageCount = new Map(stageGroups.map((g) => [g.stage, g._count._all]));
  const funnel = FUNNEL.map((stage, i) => {
    const count = stageCount.get(stage) ?? 0;
    const prev = i > 0 ? stageCount.get(FUNNEL[i - 1]) ?? 0 : null;
    const convFromPrev = prev && prev > 0 ? Math.round((count / prev) * 100) : null;
    return { stage, count, convFromPrev };
  });

  // ===== القنوات =====
  const channels = channelGroups
    .map((g) => ({ channel: g.channel, count: g._count._all }))
    .sort((a, b) => b.count - a.count);

  // ===== الفريق =====
  const closedMap = new Map(closedByEmp.map((r) => [r.assignedToId, r._count._all]));
  const bookMap = new Map(bookingsByEmp.map((r) => [r.sellerId, r._count._all]));
  const team = employees.map((e) => ({
    name: e.name,
    closed: closedMap.get(e.id) ?? 0,
    bookings: bookMap.get(e.id) ?? 0,
  }));

  return {
    finance: {
      basePrice, discounts, afterDiscount, collected, notCollected, reservedValue,
      financeFailedCount, financeFailedValue,
      perProject: [...perProjectMap.values()],
    },
    metrics: {
      avgFirstResponseHours,
      within1hRate: responded.length > 0 ? Math.round((within1h / responded.length) * 100) : 0,
      responseRate: total > 0 ? Math.round((responded.length / total) * 100) : 0,
      avgAttempts,
      avgSalesCycleDays,
    },
    funnel,
    channels,
    team,
  };
}
