"use server";

import { revalidatePath } from "next/cache";
import { BookingStage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser, isManager } from "@/lib/auth-guards";

export type ActionResult = { ok: boolean; error?: string };

/** تحقق صلاحية الحجز: البائع أو مدير. */
async function assertBookingAccess(bookingId: string) {
  const user = await requireUser();
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, sellerId: true, unitId: true, leadId: true },
  });
  if (!booking) throw new Error("الحجز غير موجود");
  if (!isManager(user.role) && booking.sellerId !== user.id) {
    throw new Error("ما عندك صلاحية على هذا الحجز");
  }
  return { user, booking };
}

function revalidateBookings() {
  revalidatePath("/bookings");
  revalidatePath("/projects");
}

/** نقل مرحلة البيع. عند الوصول لـ«بيع» تُعلّم الوحدة مباعة والعميل مقفول-بيع. */
export async function updateBookingStage(
  bookingId: string,
  stage: BookingStage,
): Promise<ActionResult> {
  try {
    const { booking } = await assertBookingAccess(bookingId);

    await prisma.$transaction(async (tx) => {
      await tx.booking.update({ where: { id: bookingId }, data: { stage } });
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

/** تبديل حالة فشل التمويل / رفض البنك. */
export async function toggleFinanceRejected(
  bookingId: string,
  rejected: boolean,
): Promise<ActionResult> {
  try {
    await assertBookingAccess(bookingId);
    await prisma.booking.update({
      where: { id: bookingId },
      data: { financeRejected: rejected },
    });
    revalidateBookings();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
