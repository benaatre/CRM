import "server-only";

import type { ProjectStatus, UnitStatus, UnitType, Floor } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const dec = (v: { toNumber(): number } | null) => (v ? v.toNumber() : null);

export type ProjectCard = {
  id: string;
  name: string;
  district: string | null;
  description: string | null;
  status: ProjectStatus;
  deliveryDate: Date | null;
  priceMin: number | null;
  priceMax: number | null;
  maxDiscountPercent: number | null;
  maxDiscountAmount: number | null;
  falLicense: string | null;
  units: { available: number; reserved: number; sold: number; total: number };
};

export type ProjectsOverview = {
  kpis: {
    projects: number;
    available: number;
    reserved: number;
    sold: number;
    salesValue: number;
    deposits: number;
  };
  cards: ProjectCard[];
};

export async function getProjectsOverview(): Promise<ProjectsOverview> {
  const [projects, unitsByStatus, soldAgg, depositAgg] = await Promise.all([
    prisma.project.findMany({
      orderBy: { createdAt: "asc" },
      include: { units: { select: { status: true } } },
    }),
    prisma.unit.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.booking.aggregate({ where: { stage: "SOLD" }, _sum: { finalPrice: true } }),
    prisma.booking.aggregate({ _sum: { deposit: true } }),
  ]);

  const statusCount = new Map(unitsByStatus.map((u) => [u.status, u._count._all]));

  const cards: ProjectCard[] = projects.map((p) => {
    const counts = { available: 0, reserved: 0, sold: 0, total: p.units.length };
    for (const u of p.units) {
      if (u.status === "AVAILABLE") counts.available++;
      else if (u.status === "RESERVED") counts.reserved++;
      else if (u.status === "SOLD") counts.sold++;
    }
    return {
      id: p.id,
      name: p.name,
      district: p.district,
      description: p.description,
      status: p.status,
      deliveryDate: p.deliveryDate,
      priceMin: dec(p.priceMin),
      priceMax: dec(p.priceMax),
      maxDiscountPercent: dec(p.maxDiscountPercent),
      maxDiscountAmount: dec(p.maxDiscountAmount),
      falLicense: p.falLicense,
      units: counts,
    };
  });

  return {
    kpis: {
      projects: projects.length,
      available: statusCount.get("AVAILABLE") ?? 0,
      reserved: statusCount.get("RESERVED") ?? 0,
      sold: statusCount.get("SOLD") ?? 0,
      salesValue: dec(soldAgg._sum.finalPrice) ?? 0,
      deposits: dec(depositAgg._sum.deposit) ?? 0,
    },
    cards,
  };
}

export type UnitRow = {
  id: string;
  number: string;
  type: UnitType;
  floor: string | null;
  floorLevel: Floor | null;
  area: number | null;
  totalArea: number | null;
  price: number | null;
  discountPercent: number | null;
  discountedPrice: number | null;
  finalPrice: number | null;
  status: UnitStatus;
  notes: string | null;
  buyerName: string | null;
  bookingId: string | null;
};

export type ProjectDetail = ProjectCard & { unitRows: UnitRow[] };

export async function getProject(id: string): Promise<ProjectDetail | null> {
  const p = await prisma.project.findUnique({
    where: { id },
    include: {
      units: {
        orderBy: { number: "asc" },
        include: { booking: { include: { lead: { select: { name: true } } } } },
      },
    },
  });
  if (!p) return null;

  const counts = { available: 0, reserved: 0, sold: 0, total: p.units.length };
  for (const u of p.units) {
    if (u.status === "AVAILABLE") counts.available++;
    else if (u.status === "RESERVED") counts.reserved++;
    else if (u.status === "SOLD") counts.sold++;
  }

  return {
    id: p.id,
    name: p.name,
    district: p.district,
    description: p.description,
    status: p.status,
    deliveryDate: p.deliveryDate,
    priceMin: dec(p.priceMin),
    priceMax: dec(p.priceMax),
    maxDiscountPercent: dec(p.maxDiscountPercent),
    maxDiscountAmount: dec(p.maxDiscountAmount),
    falLicense: p.falLicense,
    units: counts,
    unitRows: p.units.map((u) => ({
      id: u.id,
      number: u.number,
      type: u.type,
      floor: u.floor,
      floorLevel: u.floorLevel,
      area: dec(u.area),
      totalArea: dec(u.totalArea),
      price: dec(u.price),
      discountPercent: dec(u.discountPercent),
      discountedPrice: dec(u.discountedPrice),
      finalPrice: (() => {
        const pr = dec(u.price);
        const explicit = dec(u.discountedPrice);
        if (explicit != null) return explicit;
        const dp = dec(u.discountPercent);
        return pr != null && dp ? Math.round(pr * (1 - dp / 100)) : pr;
      })(),
      status: u.status,
      notes: u.notes,
      buyerName: u.booking?.lead.name ?? null,
      bookingId: u.booking?.id ?? null,
    })),
  };
}
