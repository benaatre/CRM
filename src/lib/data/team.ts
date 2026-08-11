import "server-only";

import type { Role } from "@prisma/client";
import { FollowUpType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ONLINE_THRESHOLD_MS } from "@/lib/format";
import { dayStartKSA } from "@/lib/ksa-time";

const VISIT_TYPES: FollowUpType[] = [FollowUpType.VISIT_PROJECT, FollowUpType.VISIT_OFFICE];

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

/** صف «آخر ظهور» — نسخة خفيفة لرئيسية المالك (بلا تجميعات getTeam الست). */
export type PresenceRow = {
  id: string;
  name: string;
  lastSeenAt: Date | null;
  online: boolean;
  /** توسعة معلنة (شريط «الفريق الآن» v3): إنتاج اليوم بيوم الرياض. */
  fuToday: number;
  visitsToday: number;
  bookingsToday: number;
};

/**
 * الموظفون النشطون بحالة اتصالهم — نفس حقول getTeam وعتبتها (ONLINE_THRESHOLD_MS).
 * توسعة معلنة (v3): groupBy اثنان لإنتاج اليوم (متابعات حسب النوع + حجوزات) بيوم الرياض
 * — لصندوق الإنتاج في بلاطات «الفريق الآن». الزيارات ضمن المتابعات (type=VISIT_*).
 */
export async function getTeamPresence(): Promise<PresenceRow[]> {
  const dayStart = dayStartKSA(new Date());
  const [users, fuGrp, bookGrp] = await Promise.all([
    prisma.user.findMany({
      where: { role: "EMPLOYEE", active: true },
      select: { id: true, name: true, lastSeenAt: true },
      orderBy: { name: "asc" },
    }),
    prisma.followUp.groupBy({
      by: ["createdBy", "type"],
      where: { createdAt: { gte: dayStart } },
      _count: { _all: true },
    }),
    prisma.booking.groupBy({
      by: ["sellerId"],
      where: { createdAt: { gte: dayStart } },
      _count: { _all: true },
    }),
  ]);
  const fuBy = new Map<string, { fu: number; visits: number }>();
  for (const g of fuGrp) {
    const r = fuBy.get(g.createdBy) ?? { fu: 0, visits: 0 };
    r.fu += g._count._all;
    if (VISIT_TYPES.includes(g.type)) r.visits += g._count._all;
    fuBy.set(g.createdBy, r);
  }
  const bookBy = new Map(bookGrp.map((b) => [b.sellerId, b._count._all]));

  const now = Date.now();
  return users
    .map((u) => ({
      ...u,
      online: !!u.lastSeenAt && now - u.lastSeenAt.getTime() < ONLINE_THRESHOLD_MS,
      fuToday: fuBy.get(u.id)?.fu ?? 0,
      visitsToday: fuBy.get(u.id)?.visits ?? 0,
      bookingsToday: bookBy.get(u.id) ?? 0,
    }))
    // المتصل الآن أولًا، ثم الأحدث ظهورًا.
    .sort((a, b) => Number(b.online) - Number(a.online) || (b.lastSeenAt?.getTime() ?? 0) - (a.lastSeenAt?.getTime() ?? 0));
}

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
