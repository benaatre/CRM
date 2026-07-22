import "server-only";

import type { ProjectStatus, UnitStatus, UnitType, Floor } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser, isManager } from "@/lib/auth-guards";
import { compareUnitNumbers } from "@/lib/format";

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
    /// إجماليات مالية على مستوى الشركة — للمدير/المالك فقط (null للموظف).
    salesValue: number | null;
    deposits: number | null;
  };
  cards: ProjectCard[];
};

export async function getProjectsOverview(): Promise<ProjectsOverview> {
  // الصلاحية تُفرض هنا على الخادم: الإجماليات المالية لا تُحسب ولا تُرسل للموظف.
  const user = await requireUser();
  const manager = isManager(user.role);

  const [projects, unitsByStatus, soldAgg, depositAgg] = await Promise.all([
    prisma.project.findMany({
      orderBy: { createdAt: "asc" },
      include: { units: { select: { status: true } } },
    }),
    prisma.unit.groupBy({ by: ["status"], _count: { _all: true } }),
    manager
      ? prisma.booking.aggregate({ where: { stage: "SOLD" }, _sum: { finalPrice: true } })
      : null,
    manager ? prisma.booking.aggregate({ _sum: { deposit: true } }) : null,
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
      salesValue: manager ? (dec(soldAgg?._sum.finalPrice ?? null) ?? 0) : null,
      deposits: manager ? (dec(depositAgg?._sum.deposit ?? null) ?? 0) : null,
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
  // اسم المشتري ومعرّف الحجز بيانات عملاء زملاء — للمدير/المالك فقط.
  const user = await requireUser();
  const manager = isManager(user.role);

  const p = await prisma.project.findUnique({
    where: { id },
    include: {
      units: {
        include: { booking: { include: { lead: { select: { name: true } } } } },
      },
    },
  });
  if (!p) return null;

  // ترتيب طبيعي لأرقام الوحدات (٢ قبل ١٠) — لا يكفي ترتيب قاعدة البيانات النصّي.
  p.units.sort((a, b) => compareUnitNumbers(a.number, b.number));

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
      buyerName: manager ? (u.booking?.lead.name ?? null) : null,
      bookingId: manager ? (u.booking?.id ?? null) : null,
    })),
  };
}
