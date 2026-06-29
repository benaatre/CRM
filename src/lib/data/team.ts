import "server-only";

import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ONLINE_THRESHOLD_MS } from "@/lib/format";

export type TeamMember = {
  id: string;
  name: string;
  phone: string | null;
  role: Role;
  target: number;
  active: boolean;
  total: number;
  closed: number;
  bookings: number;
  activityRate: number;
  lastSeenAt: Date | null;
  online: boolean;
  paused: boolean;
  pauseReason: string | null;
  pauseUntil: Date | null;
};

export type TeamData = {
  members: TeamMember[];
  employeeCount: number;
  unassigned: number;
};

export async function getTeam(): Promise<TeamData> {
  const [users, byTotal, byClosed, byNotContacted, byBookings, unassigned] = await Promise.all([
    prisma.user.findMany({
      select: { id: true, name: true, phone: true, role: true, targetDeals: true, active: true, lastSeenAt: true, availabilityPaused: true, pauseReason: true, pauseUntil: true },
      orderBy: [{ role: "asc" }, { active: "desc" }, { name: "asc" }],
    }),
    prisma.lead.groupBy({ by: ["assignedToId"], _count: { _all: true } }),
    prisma.lead.groupBy({ by: ["assignedToId"], where: { stage: "CLOSED_WON" }, _count: { _all: true } }),
    prisma.lead.groupBy({ by: ["assignedToId"], where: { attempts: 0 }, _count: { _all: true } }),
    prisma.booking.groupBy({ by: ["sellerId"], _count: { _all: true } }),
    prisma.lead.count({ where: { assignedToId: null } }),
  ]);

  const totalMap = new Map(byTotal.map((r) => [r.assignedToId, r._count._all]));
  const closedMap = new Map(byClosed.map((r) => [r.assignedToId, r._count._all]));
  const notContactedMap = new Map(byNotContacted.map((r) => [r.assignedToId, r._count._all]));
  const bookMap = new Map(byBookings.map((r) => [r.sellerId, r._count._all]));

  const now = Date.now();
  const members = users.map((u) => {
    const total = totalMap.get(u.id) ?? 0;
    const notContacted = notContactedMap.get(u.id) ?? 0;
    return {
      id: u.id,
      name: u.name,
      phone: u.phone,
      role: u.role,
      target: u.targetDeals,
      active: u.active,
      total,
      closed: closedMap.get(u.id) ?? 0,
      bookings: bookMap.get(u.id) ?? 0,
      activityRate: total > 0 ? Math.round(((total - notContacted) / total) * 100) : 0,
      lastSeenAt: u.lastSeenAt,
      online: !!u.lastSeenAt && now - u.lastSeenAt.getTime() < ONLINE_THRESHOLD_MS,
      paused: u.availabilityPaused,
      pauseReason: u.pauseReason,
      pauseUntil: u.pauseUntil,
    };
  });

  return {
    members,
    employeeCount: members.filter((m) => m.role === "EMPLOYEE").length,
    unassigned,
  };
}
