import "server-only";

import type {
  BookingStage,
  CashPaymentType,
  DeliveryStatus,
  Nationality,
  PaymentMethod,
  SaudiBank,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guards";

const dec = (v: { toNumber(): number } | null) => (v ? v.toNumber() : null);

export type BookingEventDTO = {
  toStage: BookingStage;
  userName: string | null;
  createdAt: Date;
};

export type BookingCard = {
  id: string;
  sellerId: string | null;
  leadName: string;
  phone: string | null;
  nationality: Nationality | null;
  nationalId: string | null;
  projectName: string | null;
  unitNumber: string;
  paymentMethod: PaymentMethod;
  bankName: SaudiBank | null;
  deposit: number | null;
  price: number;
  discount: number;
  finalPrice: number;
  stage: BookingStage;
  deliveryStatus: DeliveryStatus;
  financeRejected: boolean;
  financeRejectedReason: string | null;
  collected: number;
  sellerName: string | null;
  // حقول الدفع المرنة
  expectedCheckDate: Date | null;
  expectedTransferDate: Date | null;
  cashPaymentType: CashPaymentType | null;
  installmentsCount: number | null;
  installmentAmount: number | null;
  installments: { amount: number; date: string }[] | null;
  cashAmount: number | null;
  financePercent: number | null;
  financeRequestNo: string | null;
  subjectToTax: boolean;
  taxAmount: number | null;
  stageIndex: number;
  events: BookingEventDTO[];
};

export type BookingsData = {
  manager: boolean;
  currentUserId: string;
  kpis: { total: number; inProgress: number; sold: number; deposits: number; salesValue: number };
  cards: BookingCard[];
};

/** كل الحجوزات مرئية للجميع (الفلترة «حجوزاتي/الكل» على العميل). */
export async function getBookings(): Promise<BookingsData> {
  const user = await requireUser();
  const manager = user.role === "OWNER" || user.role === "ADMIN";

  const rows = await prisma.booking.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      lead: { select: { name: true } },
      unit: { select: { number: true, project: { select: { name: true } } } },
      seller: { select: { name: true } },
      events: {
        orderBy: { createdAt: "desc" },
        take: 10,
        include: { user: { select: { name: true } } },
      },
    },
  });

  const cards: BookingCard[] = rows.map((b) => ({
    id: b.id,
    sellerId: b.sellerId,
    leadName: b.lead.name,
    phone: b.phone,
    nationality: b.nationality,
    nationalId: b.nationalId,
    projectName: b.unit.project?.name ?? null,
    unitNumber: b.unit.number,
    paymentMethod: b.paymentMethod,
    bankName: b.bankName,
    deposit: dec(b.deposit),
    price: b.price.toNumber(),
    discount: b.discount.toNumber(),
    finalPrice: b.finalPrice.toNumber(),
    stage: b.stage,
    deliveryStatus: b.deliveryStatus,
    financeRejected: b.financeRejected,
    financeRejectedReason: b.financeRejectedReason,
    collected: b.collected.toNumber(),
    sellerName: b.seller?.name ?? null,
    expectedCheckDate: b.expectedCheckDate,
    expectedTransferDate: b.expectedTransferDate,
    cashPaymentType: b.cashPaymentType,
    installmentsCount: b.installmentsCount,
    installmentAmount: dec(b.installmentAmount),
    installments: (b.installments as { amount: number; date: string }[] | null) ?? null,
    cashAmount: dec(b.cashAmount),
    financePercent: dec(b.financePercent),
    financeRequestNo: b.financeRequestNo,
    subjectToTax: b.subjectToTax,
    taxAmount: dec(b.taxAmount),
    stageIndex: b.stageIndex,
    events: b.events.map((e) => ({
      toStage: e.toStage,
      userName: e.user?.name ?? null,
      createdAt: e.createdAt,
    })),
  }));

  const sold = cards.filter((c) => c.stage === "SOLD");
  return {
    manager,
    currentUserId: user.id,
    kpis: {
      total: cards.length,
      inProgress: cards.filter((c) => c.stage !== "SOLD").length,
      sold: sold.length,
      deposits: cards.reduce((s, c) => s + (c.deposit ?? 0), 0),
      salesValue: sold.reduce((s, c) => s + c.finalPrice, 0),
    },
    cards,
  };
}

export type ProjectWithUnits = {
  id: string;
  name: string;
  units: { id: string; number: string; price: number | null }[];
};

/** المشاريع مع وحداتها المتاحة — لنموذج الحجز. */
export async function getProjectsWithAvailableUnits(): Promise<ProjectWithUnits[]> {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      units: {
        where: { status: "AVAILABLE", booking: null },
        orderBy: { number: "asc" },
        select: { id: true, number: true, price: true },
      },
    },
  });
  return projects.map((p) => ({
    id: p.id,
    name: p.name,
    units: p.units.map((u) => ({ id: u.id, number: u.number, price: dec(u.price) })),
  }));
}
