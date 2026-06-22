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
import { requireUser, isManager } from "@/lib/auth-guards";
import { logAudit } from "@/lib/audit";
import { notify, activeUserIds } from "@/lib/notify";
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
    const transferDateRaw = String(formData.get("expectedTransferDate") ?? "");
    const expectedTransferDate = transferDateRaw ? new Date(transferDateRaw) : null;

    // ضريبة التصرفات العقارية (5% على السعر بعد الخصم)
    const subjectToTax = String(formData.get("subjectToTax") ?? "") === "yes";
    const taxAmount = subjectToTax ? Math.round(finalPrice * 0.05) : null;

    // «تم الشراء» الفوري (كاش): يُسجَّل مباعًا مباشرة بدل حجز
    const immediateSale = String(formData.get("immediateSale") ?? "") === "yes";

    // تفاصيل الدفعات [{amount, date}]
    let installments: { amount: number; date: string }[] | null = null;
    const installmentsRaw = String(formData.get("installments") ?? "");
    if (installmentsRaw) {
      try {
        const parsed = JSON.parse(installmentsRaw);
        if (Array.isArray(parsed) && parsed.length) installments = parsed;
      } catch {}
    }

    if (paymentMethod === "BANK_FINANCE" && !bankName)
      return { ok: false, error: "اختر البنك" };
    if (paymentMethod === "CASH_AND_FINANCE" && !bankName)
      return { ok: false, error: "اختر البنك للجزء المموّل" };

    // تحقق توفّر الوحدة
    const unit = await prisma.unit.findUnique({
      where: { id: unitId },
      select: { status: true, number: true, project: { select: { name: true } }, booking: { select: { id: true } } },
    });
    if (!unit) return { ok: false, error: "الوحدة غير موجودة" };
    if (unit.booking) return { ok: false, error: "الوحدة محجوزة مسبقًا" };

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { name: true, phone: true, nationality: true, nationalId: true, booking: { select: { id: true } } },
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
          stage: immediateSale ? BookingStage.SOLD : BookingStage.RESERVATION,
          stageIndex: immediateSale ? 5 : 0,
          financePercent, financeRequestNo, cashAmount,
          expectedCheckDate, expectedTransferDate, cashPaymentType,
          installmentsCount, installmentAmount,
          installments: installments ?? undefined,
          subjectToTax, taxAmount,
        },
      });
      await tx.unit.update({ where: { id: unitId }, data: { status: immediateSale ? "SOLD" : "RESERVED" } });
      await tx.lead.update({ where: { id: leadId }, data: { stage: immediateSale ? "CLOSED_WON" : "RESERVED", isArchived: true } });
      await tx.bookingEvent.create({
        data: { bookingId: booking.id, userId: user.id, toStage: immediateSale ? BookingStage.SOLD : BookingStage.RESERVATION, note: immediateSale ? "تم الشراء (كاش فوري)" : "تم إنشاء الحجز" },
      });
      await logAudit(tx, {
        userId: user.id, action: "booking.created", entity: "booking", entityId: booking.id,
        summary: `حجز وحدة ${unit.number} في ${unit.project?.name ?? "—"}${lead?.name ? ` للعميل ${lead.name}` : ""}`,
      });
    });

    await notify(prisma, await activeUserIds(prisma), "booking.created", "وحدة اتحجزت", `وحدة ${unit.number} في ${unit.project?.name ?? "—"}`);
    revalidateBookings();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** إلغاء الحجز — يحرّر الوحدة، يرجّع العميل لـ«تفاوض»، يحذف الحجز، ويسجّل في التدقيق. */
export async function cancelBooking(bookingId: string, reason?: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        sellerId: true, unitId: true, leadId: true,
        unit: { select: { number: true, project: { select: { name: true } } } },
        lead: { select: { name: true } },
      },
    });
    if (!booking) return { ok: false, error: "الحجز غير موجود" };
    if (!isManager(user.role) && booking.sellerId !== user.id) {
      return { ok: false, error: "ما عندك صلاحية على هذا الحجز" };
    }

    await prisma.$transaction(async (tx) => {
      await tx.unit.update({ where: { id: booking.unitId }, data: { status: "AVAILABLE" } });
      await tx.lead.update({ where: { id: booking.leadId }, data: { stage: "NEGOTIATION", isArchived: false } });
      await logAudit(tx, {
        userId: user.id, action: "booking.cancelled", entity: "unit", entityId: booking.unitId,
        summary: `ألغى حجز وحدة ${booking.unit.number} في ${booking.unit.project?.name ?? "—"}${booking.lead?.name ? ` (${booking.lead.name})` : ""}${reason ? ` — السبب: ${reason}` : ""}`,
      });
      await tx.booking.delete({ where: { id: bookingId } }); // يحذف أحداث الحجز تلقائيًا (cascade)
    });

    await notify(prisma, await activeUserIds(prisma), "booking.cancelled", "تم إلغاء حجز", `وحدة ${booking.unit.number} في ${booking.unit.project?.name ?? "—"}`);
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
      select: { stage: true, unitId: true, leadId: true, unit: { select: { number: true } } },
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
      await logAudit(tx, {
        userId: user.id, action: "booking.stage", entity: "booking", entityId: bookingId,
        summary: `نقل حجز وحدة ${booking.unit.number} إلى مرحلة جديدة${stage === BookingStage.SOLD ? " (تم البيع)" : ""}`,
      });
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
      await logAudit(tx, {
        userId: user.id, action: "booking.finance", entity: "booking", entityId: bookingId,
        summary: rejected ? `وسم فشل تمويل${reason ? ` — ${reason}` : ""}` : "ألغى وسم فشل التمويل",
      });
    });

    revalidateBookings();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
