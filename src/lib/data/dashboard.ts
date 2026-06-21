import "server-only";

import type { LeadStage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { scopeForUser } from "@/lib/data/leads";

export type Period = "24h" | "48h" | "72h" | "week" | "all";

export const periodLabels: Record<Period, string> = {
  "24h": "آخر ٢٤ ساعة",
  "48h": "آخر ٤٨ ساعة",
  "72h": "آخر ٧٢ ساعة",
  week: "آخر أسبوع",
  all: "الكل",
};

export function normalizePeriod(p: string | undefined): Period {
  return p && p in periodLabels ? (p as Period) : "all";
}

function sinceFor(period: Period): Date | null {
  const hours: Record<Period, number | null> = {
    "24h": 24,
    "48h": 48,
    "72h": 72,
    week: 168,
    all: null,
  };
  const h = hours[period];
  return h ? new Date(Date.now() - h * 3_600_000) : null;
}

export type MiniLead = {
  id: string;
  name: string;
  phone: string;
  stage: LeadStage;
  budget: number | null;
  createdAt: Date;
  nextFollowup: Date | null;
  assignedToName: string | null;
};

export type TeamRow = {
  id: string;
  name: string;
  total: number;
  notContacted: number;
  attempts: number;
  visits: number;
  bookings: number;
  closed: number;
  target: number;
  activityRate: number; // % العملاء الذين جرى التواصل معهم
  progress: number | null; // % نحو الهدف
};

export type RecentSale = {
  id: string;
  leadName: string;
  phone: string | null;
  projectName: string | null;
  unitNumber: string;
  sellerName: string | null;
  finalPrice: number;
};

export type DashboardData = {
  manager: boolean;
  kpis: {
    totalClients: number;
    newInPeriod: number;
    unassigned: number;
    bookings: number;
    visits: number;
    closedWon: number;
    conversion: number;
  };
  followupsToday: MiniLead[];
  waitingFirstContact: MiniLead[];
  recentSales: RecentSale[];
  funnel: { stage: LeadStage; count: number }[];
  team: TeamRow[];
};

const CLOSED: LeadStage[] = ["CLOSED_WON", "CLOSED_LOST"];

export async function getDashboard(period: Period): Promise<DashboardData> {
  const { user, where, manager } = await scopeForUser();
  const since = sinceFor(period);
  const inPeriod = since ? { gte: since } : undefined;

  const bookingScope = manager ? {} : { sellerId: user.id };
  const visitScope = manager ? {} : { userId: user.id };

  const [
    totalClients,
    unassigned,
    bookings,
    visits,
    closedWon,
    totalAll,
    closedAll,
  ] = await Promise.all([
    prisma.lead.count({ where }),
    manager ? prisma.lead.count({ where: { assignedToId: null } }) : Promise.resolve(0),
    prisma.booking.count({ where: { ...bookingScope, ...(inPeriod ? { createdAt: inPeriod } : {}) } }),
    prisma.activity.count({ where: { type: "VISIT", ...visitScope, ...(inPeriod ? { createdAt: inPeriod } : {}) } }),
    prisma.lead.count({ where: { ...where, stage: "CLOSED_WON", ...(inPeriod ? { updatedAt: inPeriod } : {}) } }),
    prisma.lead.count({ where }),
    prisma.lead.count({ where: { ...where, stage: "CLOSED_WON" } }),
  ]);

  const conversion = totalAll > 0 ? Math.round((closedAll / totalAll) * 100) : 0;

  const newInPeriod = since
    ? await prisma.lead.count({ where: { ...where, createdAt: inPeriod } })
    : totalClients;

  // آخر الصفقات المقفولة (تم البيع)
  const salesRaw = await prisma.booking.findMany({
    where: { ...bookingScope, stage: "SOLD" },
    orderBy: { updatedAt: "desc" },
    take: 4,
    include: {
      lead: { select: { name: true } },
      unit: { select: { number: true, project: { select: { name: true } } } },
      seller: { select: { name: true } },
    },
  });
  const recentSales = salesRaw.map((b) => ({
    id: b.id,
    leadName: b.lead.name,
    phone: b.phone,
    projectName: b.unit.project?.name ?? null,
    unitNumber: b.unit.number,
    sellerName: b.seller?.name ?? null,
    finalPrice: b.finalPrice.toNumber(),
  }));

  // متابعات اليوم
  const followupsRaw = await prisma.lead.findMany({
    where: { ...where, stage: { notIn: CLOSED }, nextFollowup: { lte: new Date() } },
    orderBy: [{ priority: "asc" }, { nextFollowup: "asc" }],
    take: 8,
    include: { assignedTo: { select: { name: true } } },
  });

  // ليدات تنتظر أول تواصل
  const waitingRaw = await prisma.lead.findMany({
    where: { ...where, stage: "NEW" },
    orderBy: { createdAt: "asc" },
    take: 8,
    include: { assignedTo: { select: { name: true } } },
  });

  const toMini = (l: (typeof followupsRaw)[number]): MiniLead => ({
    id: l.id,
    name: l.name,
    phone: l.phone,
    stage: l.stage,
    budget: l.budget ? l.budget.toNumber() : null,
    createdAt: l.createdAt,
    nextFollowup: l.nextFollowup,
    assignedToName: l.assignedTo?.name ?? null,
  });

  // قمع المبيعات
  const grouped = await prisma.lead.groupBy({
    by: ["stage"],
    where,
    _count: { _all: true },
  });
  const countByStage = new Map(grouped.map((g) => [g.stage, g._count._all]));
  const funnelStages: LeadStage[] = [
    "NEW",
    "ATTEMPTED",
    "INTERESTED",
    "VIEWING",
    "NEGOTIATION",
    "RESERVED",
    "CLOSED_WON",
  ];
  const funnel = funnelStages.map((stage) => ({
    stage,
    count: countByStage.get(stage) ?? 0,
  }));

  // أداء الموظفين (للمدير فقط)
  let team: TeamRow[] = [];
  if (manager) {
    const [emps, byTotal, byClosed, byNotContacted, byAttempts, byVisits, byBookings] =
      await Promise.all([
        prisma.user.findMany({
          where: { role: "EMPLOYEE", active: true },
          select: { id: true, name: true, targetDeals: true },
          orderBy: { name: "asc" },
        }),
        prisma.lead.groupBy({ by: ["assignedToId"], _count: { _all: true } }),
        prisma.lead.groupBy({ by: ["assignedToId"], where: { stage: "CLOSED_WON" }, _count: { _all: true } }),
        prisma.lead.groupBy({ by: ["assignedToId"], where: { attempts: 0 }, _count: { _all: true } }),
        prisma.lead.groupBy({ by: ["assignedToId"], _sum: { attempts: true } }),
        prisma.activity.groupBy({ by: ["userId"], where: { type: "VISIT" }, _count: { _all: true } }),
        prisma.booking.groupBy({ by: ["sellerId"], _count: { _all: true } }),
      ]);

    const m = <T extends { _count?: { _all: number } }>(
      arr: (T & { assignedToId?: string | null; userId?: string | null; sellerId?: string | null })[],
      key: "assignedToId" | "userId" | "sellerId",
    ) => new Map(arr.map((r) => [r[key] as string | null, r._count?._all ?? 0]));

    const totalMap = m(byTotal, "assignedToId");
    const closedMap = m(byClosed, "assignedToId");
    const notContactedMap = m(byNotContacted, "assignedToId");
    const visitsMap = m(byVisits, "userId");
    const bookingsMap = m(byBookings, "sellerId");
    const attemptsMap = new Map(byAttempts.map((r) => [r.assignedToId, r._sum.attempts ?? 0]));

    team = emps.map((e) => {
      const total = totalMap.get(e.id) ?? 0;
      const notContacted = notContactedMap.get(e.id) ?? 0;
      const closed = closedMap.get(e.id) ?? 0;
      return {
        id: e.id,
        name: e.name,
        total,
        notContacted,
        attempts: attemptsMap.get(e.id) ?? 0,
        visits: visitsMap.get(e.id) ?? 0,
        bookings: bookingsMap.get(e.id) ?? 0,
        closed,
        target: e.targetDeals,
        activityRate: total > 0 ? Math.round(((total - notContacted) / total) * 100) : 0,
        progress: e.targetDeals > 0 ? Math.round((closed / e.targetDeals) * 100) : null,
      };
    });
  }

  return {
    manager,
    kpis: { totalClients, newInPeriod, unassigned, bookings, visits, closedWon, conversion },
    followupsToday: followupsRaw.map(toMini),
    waitingFirstContact: waitingRaw.map(toMini),
    recentSales,
    funnel,
    team,
  };
}
