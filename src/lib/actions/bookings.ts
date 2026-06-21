"use server";

import { revalidatePath } from "next/cache";
import {
  BookingStage,
  PaymentMethod,
  SaudiBank,
  Nationality,
  CashPaymentType,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guards";
import { getProjectsWithAvailableUnits, type ProjectWithUnits } from "@/lib/data/bookings";

export type ActionResult = { ok: boolean; error?: string };

/** المشاريع مع وحداتها المتاحة — لنموذج الحجز (يُستدعى من العميل). */
export async function fetchProjectsWithUnits(): Promise<ProjectWithUnits[]> {
  await requireUser();
  return getProjectsWithAvailableUnits();
}

function revalidateBookings() {
  revalidatePath("/bookings");
  revalidatePath("/projects");
  revalidatePath("/leads");
  revalidatePath("/pipeline");
}

const numOf = (fd: FormData, key: string): number | null => {
  const v = String(fd.get(key) ?? "").replace(/[^\d.]/g, "");
  return v ? Number(v) : null;
};

/** إنشاء حجز جديد لعميل — يحجز الوحدة وينقل العميل لمرحلة «محجوز». */
export async function createBooking(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const leadId = String(formData.get("leadId") ?? "");
    const unitId = String(formData.get("unitId") ?? "");
    if (!leadId || !unitId) return { ok: false, error: "اختر المشروع والوحدة" };

    const price = numOf(formData, "price");
    if (!price || price <= 0) return { ok: false, error: "اكتب سعر الشقة" };
    const discount = numOf(formData, "discount") ?? 0;
    const deposit = numOf(formData, "deposit");
    const finalPrice = price - discount;

    const paymentMethod = (String(formData.get("paymentMethod") ?? "CASH") as PaymentMethod);

    // حقول الدفع المرنة
    const bankRaw = String(formData.get("bankName") ?? "");
    const bankName = bankRaw ? (bankRaw as SaudiBank) : null;
    const financePercent = numOf(formData, "financePercent");
    const financeRequestNo = String(formData.get("financeRequestNo") ?? "").trim() || null;
    const cashAmount = numOf(formData, "cashAmount");
    const checkDateRaw = String(formData.get("expectedCheckDate") ?? "");
    const expectedCheckDate = checkDateRaw ? new Date(checkDateRaw) : null;
    const cashTypeRaw = String(formData.get("cashPaymentType") ?? "");
    const cashPaymentType = cashTypeRaw ? (cashTypeRaw as CashPaymentType) : null;
    const installmentsCount = formData.get("installmentsCount") ? Number(numOf(formData, "installmentsCount")) : null;
    const installmentAmount = numOf(formData, "installmentAmount");

    if (paymentMethod === "BANK_FINANCE" && !bankName)
      return { ok: false, error: "اختر البنك" };
    if (paymentMethod === "CASH_AND_FINANCE" && !bankName)
      return { ok: false, error: "اختر البنك للجزء المموّل" };

    // تحقق توفّر الوحدة
    const unit = await prisma.unit.findUnique({
      where: { id: unitId },
      select: { status: true, booking: { select: { id: true } } },
    });
    if (!unit) return { ok: false, error: "الوحدة غير موجودة" };
    if (unit.booking) return { ok: false, error: "الوحدة محجوزة مسبقًا" };

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { phone: true, nationality: true, nationalId: true, booking: { select: { id: true } } },
    });
    if (lead?.booking) return { ok: false, error: "العميل عنده حجز مسبق" };

    const nationalityRaw = String(formData.get("nationality") ?? "");
    const nationality = nationalityRaw ? (nationalityRaw as Nationality) : lead?.nationality ?? null;

    await prisma.$transaction(async (tx) => {
      const booking = await tx.booking.create({
        data: {
          leadId, unitId, sellerId: user.id,
          nationality,
          nationalId: String(formData.get("nationalId") ?? "").trim() || lead?.nationalId || null,
          phone: lead?.phone ?? null,
          paymentMethod, bankName,
          deposit, price, discount, finalPrice,
          stage: BookingStage.RESERVATION,
          financePercent, financeRequestNo, cashAmount,
          expectedCheckDate, cashPaymentType, installmentsCount, installmentAmount,
        },
      });
      await tx.unit.update({ where: { id: unitId }, data: { status: "RESERVED" } });
      await tx.lead.update({ where: { id: leadId }, data: { stage: "RESERVED" } });
      await tx.bookingEvent.create({
        data: { bookingId: booking.id, userId: user.id, toStage: BookingStage.RESERVATION, note: "تم إنشاء الحجز" },
      });
    });

    revalidateBookings();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** نقل مرحلة البيع — يسجّل الحدث (من غيّره + الوقت). متاح لكل المستخدمين (خط مبيعات مشترك). */
export async function updateBookingStage(bookingId: string, stage: BookingStage): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { stage: true, unitId: true, leadId: true },
    });
    if (!booking) return { ok: false, error: "الحجز غير موجود" };
    if (booking.stage === stage) return { ok: true };

    await prisma.$transaction(async (tx) => {
      await tx.booking.update({ where: { id: bookingId }, data: { stage } });
      await tx.bookingEvent.create({
        data: { bookingId, userId: user.id, fromStage: booking.stage, toStage: stage },
      });
      if (stage === BookingStage.SOLD) {
        await tx.unit.update({ where: { id: booking.unitId }, data: { status: "SOLD" } });
        await tx.lead.update({ where: { id: booking.leadId }, data: { stage: "CLOSED_WON" } });
      } else {
        await tx.unit.update({ where: { id: booking.unitId }, data: { status: "RESERVED" } });
      }
    });

    revalidateBookings();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** فشل التمويل / إلغاؤه — مع حفظ السبب وتسجيل الحدث. */
export async function setFinanceRejected(
  bookingId: string,
  rejected: boolean,
  reason?: string,
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { stage: true } });
    if (!booking) return { ok: false, error: "الحجز غير موجود" };

    await prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: bookingId },
        data: { financeRejected: rejected, financeRejectedReason: rejected ? (reason?.trim() || null) : null },
      });
      await tx.bookingEvent.create({
        data: {
          bookingId, userId: user.id, toStage: booking.stage,
          note: rejected ? `فشل التمويل${reason ? `: ${reason}` : ""}` : "أُلغي وسم فشل التمويل",
        },
      });
    });

    revalidateBookings();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
