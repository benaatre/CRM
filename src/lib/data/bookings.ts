import "server-only";

import type {
  BookingStage,
  DeliveryStatus,
  Nationality,
  PaymentMethod,
  SaudiBank,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser, isManager } from "@/lib/auth-guards";

const dec = (v: { toNumber(): number } | null) => (v ? v.toNumber() : null);

export type BookingCard = {
  id: string;
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
  collected: number;
  sellerName: string | null;
};

export type BookingsData = {
  manager: boolean;
  kpis: {
    total: number;
    inProgress: number;
    sold: number;
    deposits: number;
    salesValue: number;
  };
  cards: BookingCard[];
};

export async function getBookings(): Promise<BookingsData> {
  const user = await requireUser();
  const manager = isManager(user.role);
  const where = manager ? {} : { sellerId: user.id };

  const rows = await prisma.booking.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      lead: { select: { name: true } },
      unit: { select: { number: true, project: { select: { name: true } } } },
      seller: { select: { name: true } },
    },
  });

  const cards: BookingCard[] = rows.map((b) => ({
    id: b.id,
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
    collected: b.collected.toNumber(),
    sellerName: b.seller?.name ?? null,
  }));

  const sold = cards.filter((c) => c.stage === "SOLD");
  return {
    manager,
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
