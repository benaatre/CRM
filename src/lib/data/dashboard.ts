import "server-only";

import type { LeadStage } from "@prisma/client";
import { FollowUpType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { scopeForUser, getOwnerIds } from "@/lib/data/leads";

const VISIT_TYPES = [FollowUpType.VISIT_PROJECT, FollowUpType.VISIT_OFFICE];
// المتوقّع من اللمسات (متابعات) لكل عميل عند حساب نسبة النشاط.
const TOUCH_TARGET = 2;

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
  attempts: number;
  visits: number;
  bookings: number;
  closed: number;
  target: number;
  activityRate: number; // نسبة النشاط (لمسات نحو الهدف)
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
  waitingCount: number; // إجمالي «لم يتم التواصل» (NEW + مُسند)
  recentSales: RecentSale[];
  funnel: { stage: LeadStage; count: number }[];
  team: TeamRow[];
};

const CLOSED: LeadStage[] = ["CLOSED_WON", "CLOSED_LOST"];

export async function getDashboard(period: Period): Promise<DashboardData> {
  const { user, where, manager } = await scopeForUser();
  const ownerIds = await getOwnerIds();
  const since = sinceFor(period);
  const inPeriod = since ? { gte: since } : undefined;
  // «لم يتم التواصل»: جديد + مُسند لموظف فعلي (المُسند لمالك = غير موزّع).
  const waitingWhere = { ...where, stage: "NEW" as const, assignedToId: { not: null, ...(ownerIds.length ? { notIn: ownerIds } : {}) } };

  const bookingScope = manager ? {} : { sellerId: user.id };
  // الزيارات تُحسب من جدول FollowUp (نوع زيارة) — للموظف: ما أنشأه هو.
  const fuVisitScope = manager ? {} : { createdBy: user.id };

  const [
    totalClients,
    unassigned,
    bookings,
    visits,
    closedWon,
    totalAll,
    bookedAll,
  ] = await Promise.all([
    prisma.lead.count({ where }),
    manager ? prisma.lead.count({ where: { assignedToId: null } }) : Promise.resolve(0),
    prisma.booking.count({ where: { ...bookingScope, ...(inPeriod ? { createdAt: inPeriod } : {}) } }),
    prisma.followUp.count({ where: { type: { in: VISIT_TYPES }, ...fuVisitScope, ...(inPeriod ? { createdAt: inPeriod } : {}) } }),
    prisma.lead.count({ where: { ...where, stage: "CLOSED_WON", ...(inPeriod ? { updatedAt: inPeriod } : {}) } }),
    prisma.lead.count({ where }),
    prisma.lead.count({ where: { ...where, isArchived: true } }),
  ]);

  // معدل التحويل = المحجوزون (المؤرشفون: محجوز/مباع) ÷ إجمالي العملاء.
  const conversion = totalAll > 0 ? Math.round((bookedAll / totalAll) * 100) : 0;

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
    include: { assignedTo: { select: { name: true, role: true } } },
  });

  // ليدات تنتظر أول تواصل (NEW + مُسند) + العدد الكلي
  const [waitingRaw, waitingCount] = await Promise.all([
    prisma.lead.findMany({
      where: waitingWhere,
      orderBy: { createdAt: "asc" },
      take: 8,
      include: { assignedTo: { select: { name: true, role: true } } },
    }),
    prisma.lead.count({ where: waitingWhere }),
  ]);

  const toMini = (l: (typeof followupsRaw)[number]): MiniLead => ({
    id: l.id,
    name: l.name,
    phone: l.phone,
    stage: l.stage,
    budget: l.budget ? l.budget.toNumber() : null,
    createdAt: l.createdAt,
    nextFollowup: l.nextFollowup,
    assignedToName: l.assignedTo && l.assignedTo.role !== "OWNER" ? l.assignedTo.name : null,
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
    const [emps, byTotal, byClosed, byFollowUps, byVisits, byBookings] =
      await Promise.all([
        prisma.user.findMany({
          where: { role: "EMPLOYEE", active: true },
          select: { id: true, name: true, targetDeals: true },
          orderBy: { name: "asc" },
        }),
        prisma.lead.groupBy({ by: ["assignedToId"], _count: { _all: true } }),
        prisma.lead.groupBy({ by: ["assignedToId"], where: { stage: "CLOSED_WON" }, _count: { _all: true } }),
        prisma.followUp.groupBy({ by: ["createdBy"], _count: { _all: true } }),
        prisma.followUp.groupBy({ by: ["createdBy"], where: { type: { in: VISIT_TYPES } }, _count: { _all: true } }),
        prisma.booking.groupBy({ by: ["sellerId"], _count: { _all: true } }),
      ]);

    const leadMap = (arr: { assignedToId: string | null; _count: { _all: number } }[]) =>
      new Map(arr.map((r) => [r.assignedToId, r._count._all]));
    const fuMap = (arr: { createdBy: string; _count: { _all: number } }[]) =>
      new Map(arr.map((r) => [r.createdBy, r._count._all]));

    const totalMap = leadMap(byTotal);
    const closedMap = leadMap(byClosed);
    const followUpsMap = fuMap(byFollowUps);
    const visitsMap = fuMap(byVisits);
    const bookingsMap = new Map(byBookings.map((r) => [r.sellerId, r._count._all]));

    team = emps.map((e) => {
      const total = totalMap.get(e.id) ?? 0;
      const totalFu = followUpsMap.get(e.id) ?? 0;
      const visits = visitsMap.get(e.id) ?? 0;
      const attempts = Math.max(0, totalFu - visits); // المحاولات = متابعات غير الزيارات
      const closed = closedMap.get(e.id) ?? 0;
      return {
        id: e.id,
        name: e.name,
        total,
        attempts,
        visits,
        bookings: bookingsMap.get(e.id) ?? 0,
        closed,
        target: e.targetDeals,
        // نسبة النشاط = (محاولات + زيارات) ÷ (عدد العملاء × الهدف لكل عميل).
        activityRate: total > 0 ? Math.min(100, Math.round((totalFu / (total * TOUCH_TARGET)) * 100)) : 0,
        progress: e.targetDeals > 0 ? Math.round((closed / e.targetDeals) * 100) : null,
      };
    });
  }

  return {
    manager,
    kpis: { totalClients, newInPeriod, unassigned, bookings, visits, closedWon, conversion },
    followupsToday: followupsRaw.map(toMini),
    waitingFirstContact: waitingRaw.map(toMini),
    waitingCount,
    recentSales,
    funnel,
    team,
  };
}
