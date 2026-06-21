import "server-only";

import { prisma } from "@/lib/prisma";

export type TeamMember = {
  id: string;
  name: string;
  phone: string | null;
  target: number;
  active: boolean;
  total: number;
  closed: number;
  bookings: number;
};

export type TeamData = {
  members: TeamMember[];
  unassigned: number;
};

export async function getTeam(): Promise<TeamData> {
  const [emps, byTotal, byClosed, byBookings, unassigned] = await Promise.all([
    prisma.user.findMany({
      where: { role: "EMPLOYEE" },
      select: { id: true, name: true, phone: true, targetDeals: true, active: true },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    }),
    prisma.lead.groupBy({ by: ["assignedToId"], _count: { _all: true } }),
    prisma.lead.groupBy({ by: ["assignedToId"], where: { stage: "CLOSED_WON" }, _count: { _all: true } }),
    prisma.booking.groupBy({ by: ["sellerId"], _count: { _all: true } }),
    prisma.lead.count({ where: { assignedToId: null } }),
  ]);

  const totalMap = new Map(byTotal.map((r) => [r.assignedToId, r._count._all]));
  const closedMap = new Map(byClosed.map((r) => [r.assignedToId, r._count._all]));
  const bookMap = new Map(byBookings.map((r) => [r.sellerId, r._count._all]));

  return {
    members: emps.map((e) => ({
      id: e.id,
      name: e.name,
      phone: e.phone,
      target: e.targetDeals,
      active: e.active,
      total: totalMap.get(e.id) ?? 0,
      closed: closedMap.get(e.id) ?? 0,
      bookings: bookMap.get(e.id) ?? 0,
    })),
    unassigned,
  };
}
