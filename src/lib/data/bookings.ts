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
import { compareUnitNumbers } from "@/lib/format";
import { bookingCollection } from "@/lib/booking-finance";

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
  paymentMethod: PaymentMethod | null;
  bankName: SaudiBank | null;
  deposit: number | null;
  price: number;
  discount: number | null;
  finalPrice: number | null;
  stage: BookingStage;
  deliveryStatus: DeliveryStatus;
  financeRejected: boolean;
  financeRejectedReason: string | null;
  discountExceeded: boolean;
  discountOverage: number;
  discountPercentAtBooking: number | null;
  maxDiscountPercentAtBooking: number | null;
  collected: number | null;
  remaining: number | null;
  sellerName: string | null;
  // حقول الدفع المرنة
  expectedCheckDate: Date | null;
  expectedTransferDate: Date | null;
  cashPaymentType: CashPaymentType | null;
  installmentsCount: number | null;
  installmentAmount: number | null;
  installments: { amount: number; date: string }[] | null;
  cashAmount: number | null;
  subjectToTax: boolean;
  taxAmount: number | null;
  includesVAT: boolean;
  vatAmount: number | null;
  secondaryPhone: string | null;
  stageIndex: number;
  events: BookingEventDTO[];
};

export type BookingsData = {
  manager: boolean;
  isOwner: boolean;
  currentUserId: string;
  kpis: { total: number; inProgress: number; sold: number; deposits: number; salesValue: number };
  cards: BookingCard[];
};

/**
 * خط مبيعات مشترك (قراءة للكل): الجميع يشوف كل الحجوزات — حتى المباعة.
 * البيانات الحساسة (جوال/هوية/مبالغ/طريقة الدفع) محجوبة عن غير صاحب الحجز والمدير.
 */
export async function getBookings(): Promise<BookingsData> {
  const user = await requireUser();
  const manager = user.role === "OWNER" || user.role === "ADMIN";

  const rows = await prisma.booking.findMany({
    where: {}, // الجميع يشوف كل الحجوزات — الحجب يتم في تكوين البطاقات أدناه
    orderBy: { createdAt: "desc" },
    take: 500, // سقف مؤقت لحين الترقيم (#14)
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

  const cards: BookingCard[] = rows.map((b) => {
    // «حجزي» = المدير أو صاحب الحجز — يشوف كل التفاصيل؛ غيره تُحجب عنه الحقول الحساسة.
    const mine = manager || b.sellerId === user.id;
    return {
      id: b.id,
      sellerId: b.sellerId,
      leadName: b.lead.name,
      phone: mine ? b.phone : null,
      nationality: b.nationality,
      nationalId: mine ? b.nationalId : null,
      projectName: b.unit.project?.name ?? null,
      unitNumber: b.unit.number,
      paymentMethod: mine ? b.paymentMethod : null,
      bankName: mine ? b.bankName : null,
      deposit: mine ? dec(b.deposit) : null,
      price: b.price.toNumber(),
      discount: mine ? b.discount.toNumber() : null,
      finalPrice: mine ? b.finalPrice.toNumber() : null,
      stage: b.stage,
      deliveryStatus: b.deliveryStatus,
      financeRejected: b.financeRejected,
      financeRejectedReason: b.financeRejectedReason,
      discountExceeded: b.discountExceeded,
      discountOverage: dec(b.discountOverage) ?? 0,
      discountPercentAtBooking: dec(b.discountPercentAtBooking),
      maxDiscountPercentAtBooking: dec(b.maxDiscountPercentAtBooking),
      // المحصّل والمتبقّي موحّدان من bookingCollection المحسوبة (لا العمود المخزّن remainingAmount):
      // «تم البيع والاستلام» (DELIVERED) = كامل السعر ومتبقّي صفر، غيره = المسجّل فعلياً تراكميًا.
      collected: mine ? bookingCollection(b.stage, b.finalPrice.toNumber(), b.collectedAmount.toNumber()).collected : null,
      remaining: mine ? bookingCollection(b.stage, b.finalPrice.toNumber(), b.collectedAmount.toNumber()).remaining : null,
      sellerName: b.seller?.name ?? null,
      expectedCheckDate: b.expectedCheckDate,
      expectedTransferDate: b.expectedTransferDate,
      cashPaymentType: mine ? b.cashPaymentType : null,
      installmentsCount: b.installmentsCount,
      installmentAmount: mine ? dec(b.installmentAmount) : null,
      installments: mine ? ((b.installments as { amount: number; date: string }[] | null) ?? null) : null,
      cashAmount: mine ? dec(b.cashAmount) : null,
      subjectToTax: b.subjectToTax,
      taxAmount: mine ? dec(b.taxAmount) : null,
      includesVAT: b.includesVAT,
      vatAmount: mine ? dec(b.vatAmount) : null,
      secondaryPhone: mine ? b.secondaryPhone : null,
      stageIndex: b.stageIndex,
      events: b.events.map((e) => ({
        toStage: e.toStage,
        userName: e.user?.name ?? null,
        createdAt: e.createdAt,
      })),
    };
  });

  // «تم البيع والاستلام» = SOLD أو DELIVERED (مدموجان).
  const sold = cards.filter((c) => c.stage === "SOLD" || c.stage === "DELIVERED");
  return {
    manager,
    isOwner: user.role === "OWNER",
    currentUserId: user.id,
    kpis: {
      total: cards.length,
      inProgress: cards.filter((c) => c.stage !== "SOLD" && c.stage !== "DELIVERED").length,
      sold: sold.length,
      deposits: cards.reduce((s, c) => s + (c.deposit ?? 0), 0),
      salesValue: sold.reduce((s, c) => s + (c.finalPrice ?? 0), 0),
    },
    cards,
  };
}

export type ProjectWithUnits = {
  id: string;
  name: string;
  maxDiscountPercent: number | null;
  maxDiscountAmount: number | null;
  units: { id: string; number: string; price: number | null; discountedPrice: number | null; discountPercent: number | null }[];
};

/** المشاريع مع وحداتها المتاحة — لنموذج الحجز. */
export async function getProjectsWithAvailableUnits(): Promise<ProjectWithUnits[]> {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      units: {
        where: { status: "AVAILABLE", booking: null },
        orderBy: { number: "asc" },
        select: { id: true, number: true, price: true, discountedPrice: true, discountPercent: true },
      },
    },
  });
  return projects.map((p) => ({
    id: p.id,
    name: p.name,
    maxDiscountPercent: dec(p.maxDiscountPercent),
    maxDiscountAmount: dec(p.maxDiscountAmount),
    units: p.units
      .slice()
      .sort((a, b) => compareUnitNumbers(a.number, b.number))
      .map((u) => ({ id: u.id, number: u.number, price: dec(u.price), discountedPrice: dec(u.discountedPrice), discountPercent: dec(u.discountPercent) })),
  }));
}
