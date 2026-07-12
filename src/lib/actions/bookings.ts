"use server";

import { revalidatePath } from "next/cache";
import {
  BookingStage,
  PaymentMethod,
  SaudiBank,
  Nationality,
  CashPaymentType,
  FollowUpType,
  FollowUpResult,
  FollowUpSection,
  ActivityType,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toUserError } from "@/lib/action-error";
import { parseEnum } from "@/lib/parse-enum";
import { requireUser, isManager } from "@/lib/auth-guards";
import { logAudit } from "@/lib/audit";
import { notify, activeUserIds, ownerIds } from "@/lib/notify";
import { emitNotification, notifyBestEffort } from "@/lib/notifications/emit";
import { getProjectsWithAvailableUnits, type ProjectWithUnits } from "@/lib/data/bookings";
import { bookingStageOrder } from "@/lib/labels";

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
  revalidatePath("/dashboard");
  revalidatePath("/analytics");
}

const numOf = (fd: FormData, key: string): number | null => {
  const v = String(fd.get(key) ?? "").replace(/[^\d.]/g, "");
  if (!v) return null;
  const n = Number(v);
  // #17: مدخل مثل "1.2.3" يعطي NaN — نمنعه من الوصول للحسابات/القاعدة.
  if (!Number.isFinite(n)) throw new Error("قيمة رقمية غير صحيحة");
  return n;
};

/** تاريخ آمن من مدخل حر: null لو فارغ؛ يرمي رسالة عربية لو غير صالح (#17). */
const dateOf = (raw: string): Date | null => {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new Error("تاريخ غير صحيح");
  return d;
};

/**
 * يتحقق أن الحجز ضمن صلاحية المستخدم (بائعه أو مدير) — الصلاحية على الخادم لا إخفاء الواجهة.
 * يرجّع المستخدم والحجز (بالحقول التي تحتاجها إجراءات الحجز) أو يرمي خطأً يلتقطه try/catch.
 */
async function assertBookingAccess(bookingId: string) {
  const user = await requireUser();
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      sellerId: true, stage: true, unitId: true, leadId: true,
      unit: { select: { number: true, project: { select: { name: true } } } },
      lead: { select: { name: true } },
    },
  });
  if (!booking) throw new Error("الحجز غير موجود");
  if (!isManager(user.role) && booking.sellerId !== user.id) {
    throw new Error("ما عندك صلاحية على هذا الحجز");
  }
  return { user, booking };
}

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

    const paymentMethod = parseEnum(PaymentMethod, formData.get("paymentMethod"), PaymentMethod.CASH)!;

    // حقول الدفع المرنة
    const bankRaw = String(formData.get("bankName") ?? "");
    const bankName = parseEnum(SaudiBank, bankRaw);
    const cashAmount = numOf(formData, "cashAmount");
    const expectedCheckDate = dateOf(String(formData.get("expectedCheckDate") ?? ""));
    const cashTypeRaw = String(formData.get("cashPaymentType") ?? "");
    const cashPaymentType = parseEnum(CashPaymentType, cashTypeRaw);
    const installmentsCount = formData.get("installmentsCount") ? Number(numOf(formData, "installmentsCount")) : null;
    const installmentAmount = numOf(formData, "installmentAmount");
    const expectedTransferDate = dateOf(String(formData.get("expectedTransferDate") ?? ""));

    // ضريبة ٥٪ على السعر بعد الخصم — يتحكم بها زر الفورم (كان includesVAT/VAT ١٥٪). لا VAT بعد الآن.
    const subjectToTax = String(formData.get("includesVAT") ?? "") === "yes";
    const taxAmount = subjectToTax ? Math.round(finalPrice * 0.05) : null;
    const secondaryPhone = String(formData.get("secondaryPhone") ?? "").replace(/[^\d]/g, "") || null;

    // «تم الشراء» الفوري (كاش): يُسجَّل مباعًا مباشرة بدل حجز — مدفوع كامل.
    const immediateSale = String(formData.get("immediateSale") ?? "") === "yes";

    // المحصّل: شراء فوري = كامل السعر بعد الخصم؛ حجز عادي = العربون (يتراكم لاحقًا عبر «تسجيل دفعة»).
    const totalAfterDiscount = finalPrice + (taxAmount ?? 0);
    const collectedAmount = immediateSale ? finalPrice : (deposit ?? 0);
    const remainingAmount = totalAfterDiscount - collectedAmount;

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
      select: {
        status: true, number: true, price: true, discountedPrice: true,
        project: { select: { name: true, maxDiscountPercent: true, maxDiscountAmount: true } },
        booking: { select: { id: true } },
      },
    });
    if (!unit) return { ok: false, error: "الوحدة غير موجودة" };
    if (unit.booking) return { ok: false, error: "الوحدة محجوزة مسبقًا" };

    // النسبة وقت الحجز (تُخزَّن لعرض التفاصيل).
    const discountPct = price > 0 ? (discount / price) * 100 : 0;
    const maxPct = unit.project?.maxDiscountPercent != null ? Number(unit.project.maxDiscountPercent) : null;

    // ===== منطق تجاوز الخصم المقرر بالمبلغ (المهمة ٢) — الحجز يتم، لكن يُوسم =====
    // (١) لو للوحدة «سعر بعد الخصم»: البيع تحته تجاوز = discountedPrice − السعر المباع.
    // (٢) غير ذلك: «مبلغ الخصم المسموح» للمشروع → التجاوز = الخصم − المسموح.
    const unitDiscountedPrice = unit.discountedPrice != null ? Number(unit.discountedPrice) : null;
    const projMaxDiscountAmount = unit.project?.maxDiscountAmount != null ? Number(unit.project.maxDiscountAmount) : null;
    let discountOverage = 0;
    if (unitDiscountedPrice != null) {
      if (finalPrice < unitDiscountedPrice) discountOverage = Math.round(unitDiscountedPrice - finalPrice);
    } else if (projMaxDiscountAmount != null) {
      if (discount > projMaxDiscountAmount) discountOverage = Math.round(discount - projMaxDiscountAmount);
    }
    const discountExceeded = discountOverage > 0;

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { name: true, phone: true, nationality: true, nationalId: true, assignedToId: true },
    });
    if (!lead) return { ok: false, error: "العميل غير موجود" };
    // الموظف يحجز/يبيع لعملائه فقط (الصلاحية على الخادم — لا نعتمد على إخفاء الواجهة).
    if (!isManager(user.role) && lead.assignedToId !== user.id) {
      return { ok: false, error: "ما عندك صلاحية على هذا العميل" };
    }

    const nationalityRaw = String(formData.get("nationality") ?? "");
    const nationality = parseEnum(Nationality, nationalityRaw) ?? lead?.nationality ?? null;

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
          discountExceeded,
          discountOverage: discountOverage > 0 ? discountOverage : null,
          discountPercentAtBooking: Math.round(discountPct * 100) / 100,
          maxDiscountPercentAtBooking: maxPct,
          cashAmount,
          expectedCheckDate, expectedTransferDate, cashPaymentType,
          installmentsCount, installmentAmount,
          installments: installments ?? undefined,
          subjectToTax, taxAmount,
          includesVAT: false, vatAmount: null,
          secondaryPhone,
          collectedAmount, remainingAmount,
        },
      });
      await tx.unit.update({ where: { id: unitId }, data: { status: immediateSale ? "SOLD" : "RESERVED" } });
      await tx.lead.update({ where: { id: leadId }, data: { stage: immediateSale ? "CLOSED_WON" : "RESERVED", isArchived: true } });
      // آخر خطوة في تايملاين متابعات العميل: «تم الحجز» — وبها تتوقّف المتابعات.
      await tx.followUp.create({
        data: {
          leadId, createdBy: user.id, type: FollowUpType.OTHER, result: FollowUpResult.BOOKED,
          section: FollowUpSection.INTERESTED, stageAfter: immediateSale ? "CLOSED_WON" : "RESERVED",
          note: immediateSale ? "تم الشراء (كاش فوري)" : "تم الحجز",
        },
      });
      await tx.bookingEvent.create({
        data: { bookingId: booking.id, userId: user.id, toStage: immediateSale ? BookingStage.SOLD : BookingStage.RESERVATION, note: immediateSale ? "تم الشراء (كاش فوري)" : "تم إنشاء الحجز" },
      });
      // سجل في تايملاين العميل (Activity) — مع اسم الموظف والوقت تلقائيًا.
      await tx.activity.create({
        data: {
          leadId, userId: user.id, type: ActivityType.NOTE,
          note: immediateSale
            ? `تم تسجيل شراء فوري — الوحدة ${unit.number} — المشروع ${unit.project?.name ?? "—"} — المبلغ ${(finalPrice + (taxAmount ?? 0)).toLocaleString("en-US")} ر.س`
            : `تم تسجيل حجز — الوحدة ${unit.number} — المشروع ${unit.project?.name ?? "—"}`,
        },
      });
      await logAudit(tx, {
        userId: user.id, action: "booking.created", entity: "booking", entityId: booking.id,
        summary: `حجز وحدة ${unit.number} في ${unit.project?.name ?? "—"}${lead?.name ? ` للعميل ${lead.name}` : ""}`,
      });
    });

    // آثار جانبية بعد الـcommit — فشلها ما يُفشِل الحجز (#29).
    await notifyBestEffort("booking.created.notify", async () => {
      // حدث: تم حجز / بيع وحدة (الجمهور حسب الإعداد — افتراضيًا الكل).
      await emitNotification({
        eventKey: "unit_booked_sold",
        title: immediateSale ? "تم بيع وحدة" : "وحدة اتحجزت",
        body: `وحدة ${unit.number} في ${unit.project?.name ?? "—"}${lead?.name ? ` — ${lead.name}` : ""}`,
        link: `/leads/${leadId}`,
      });
      // تجاوز الخصم المقرر: إشعار للمالك (OWNER) — يظهر في جرس الهيدر.
      if (discountOverage > 0) {
        await notify(
          prisma,
          await ownerIds(prisma),
          "discount.exceeded",
          "إشعار خصم",
          `تجاوز خصم: ${user.name ?? "موظف"} باع وحدة ${unit.number} في ${unit.project?.name ?? "—"} بتجاوز ${discountOverage.toLocaleString("en-US")} ر.س عن الخصم المقرر`,
        );
      }
    });

    revalidateBookings();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

/**
 * تعديل حجز موجود (بيانات الوحدة/المبالغ/الدفع/العميل) — لا يلمس stage/stageIndex.
 * الحارس المزدوج: بلا محصّل → البائع أو المدير/المالك؛ فيه محصّل → المالك فقط.
 * حماية المحصّل: collectedAmount لا يُمسّ؛ نعيد حساب المتبقّي فقط.
 * تبديل الوحدة (إن تغيّر unitId): يتحقّق أنها متاحة، يحرّر القديمة ويحجز الجديدة داخل transaction ذرّية.
 */
export async function updateBooking(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const bookingId = String(formData.get("bookingId") ?? "");
    if (!bookingId) return { ok: false, error: "معرّف الحجز مفقود" };

    const existing = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { sellerId: true, unitId: true, collectedAmount: true },
    });
    if (!existing) return { ok: false, error: "الحجز غير موجود" };

    // الحارس المزدوج على الخادم (لا نعتمد على إخفاء الواجهة).
    const collected = existing.collectedAmount.toNumber();
    if (collected > 0) {
      if (user.role !== "OWNER") return { ok: false, error: "ما يمكن تعديل حجز فيه دفعات محصّلة إلا من المالك" };
    } else if (!isManager(user.role) && existing.sellerId !== user.id) {
      return { ok: false, error: "ما عندك صلاحية على هذا الحجز" };
    }

    const unitId = String(formData.get("unitId") ?? "");
    if (!unitId) return { ok: false, error: "اختر الوحدة" };

    const price = numOf(formData, "price");
    if (!price || price <= 0) return { ok: false, error: "اكتب سعر الشقة" };
    const discount = numOf(formData, "discount") ?? 0;
    const finalPrice = price - discount;
    const deposit = numOf(formData, "deposit");

    const paymentMethod = parseEnum(PaymentMethod, formData.get("paymentMethod"), PaymentMethod.CASH)!;
    const bankName = parseEnum(SaudiBank, String(formData.get("bankName") ?? ""));
    if ((paymentMethod === "BANK_FINANCE" || paymentMethod === "CASH_AND_FINANCE") && !bankName)
      return { ok: false, error: "اختر البنك" };
    const cashAmount = numOf(formData, "cashAmount");
    const cashPaymentType = parseEnum(CashPaymentType, String(formData.get("cashPaymentType") ?? ""));
    const expectedCheckDate = dateOf(String(formData.get("expectedCheckDate") ?? ""));
    const expectedTransferDate = dateOf(String(formData.get("expectedTransferDate") ?? ""));
    const installmentsCount = formData.get("installmentsCount") ? Number(numOf(formData, "installmentsCount")) : null;
    const installmentAmount = numOf(formData, "installmentAmount");

    // ضريبة ٥٪ فقط (لا VAT ١٥٪).
    const subjectToTax = String(formData.get("includesVAT") ?? "") === "yes";
    const taxAmount = subjectToTax ? Math.round(finalPrice * 0.05) : null;

    let installments: { amount: number; date: string }[] | null = null;
    const installmentsRaw = String(formData.get("installments") ?? "");
    if (installmentsRaw) {
      try { const parsed = JSON.parse(installmentsRaw); if (Array.isArray(parsed) && parsed.length) installments = parsed; } catch {}
    }

    const nationality = parseEnum(Nationality, String(formData.get("nationality") ?? ""));
    const nationalId = String(formData.get("nationalId") ?? "").trim() || null;
    const secondaryPhone = String(formData.get("secondaryPhone") ?? "").replace(/[^\d]/g, "") || null;

    // حماية المحصّل: لا نمسّ collectedAmount؛ نعيد حساب المتبقّي فقط (finalPrice − المحصّل).
    const remainingAmount = Math.max(0, finalPrice - collected);
    const unitChanged = unitId !== existing.unitId;

    await prisma.$transaction(async (tx) => {
      // تبديل الوحدة الذرّي: تحقّق التوفّر، حرّر القديمة، احجز الجديدة.
      if (unitChanged) {
        const newUnit = await tx.unit.findUnique({ where: { id: unitId }, select: { status: true } });
        if (!newUnit || newUnit.status !== "AVAILABLE") {
          throw new Error("الوحدة صارت محجوزة، اختر وحدة ثانية");
        }
        await tx.unit.update({ where: { id: existing.unitId }, data: { status: "AVAILABLE" } });
        await tx.unit.update({ where: { id: unitId }, data: { status: "RESERVED" } });
      }
      await tx.booking.update({
        where: { id: bookingId },
        data: {
          unitId,
          price, discount, finalPrice,
          paymentMethod, bankName,
          deposit,
          cashPaymentType, cashAmount,
          expectedCheckDate, expectedTransferDate,
          installmentsCount, installmentAmount,
          installments: installments ?? undefined,
          subjectToTax, taxAmount,
          includesVAT: false, vatAmount: null,
          nationality, nationalId, secondaryPhone,
          remainingAmount, // المتبقّي فقط — collectedAmount يبقى كما هو
        },
      });
    });

    await notifyBestEffort("booking.update", () =>
      logAudit(prisma, {
        userId: user.id, action: "booking.update", entity: "booking", entityId: bookingId,
        summary: `عدّل بيانات الحجز${unitChanged ? " (تبديل وحدة)" : ""}`,
      }));

    revalidateBookings();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

/**
 * شراء كاش فوري لعدة وحدات لنفس العميل — يُنشئ حجزًا «مباع» لكل وحدة.
 * يدعم وحدة واحدة أو أكثر. كل الوحدات لازم تكون متاحة وعليها سعر.
 */
export async function createCashSales(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const leadId = String(formData.get("leadId") ?? "");
    const unitIds = String(formData.get("unitIds") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!leadId) return { ok: false, error: "العميل غير محدّد" };
    if (unitIds.length === 0) return { ok: false, error: "اختر وحدة واحدة على الأقل" };

    const subjectToTax = String(formData.get("subjectToTax") ?? "") === "yes";
    const nationalityRaw = String(formData.get("nationality") ?? "");
    const formNationalId = String(formData.get("nationalId") ?? "").trim() || null;

    const units = await prisma.unit.findMany({
      where: { id: { in: unitIds } },
      select: { id: true, number: true, price: true, booking: { select: { id: true } }, project: { select: { name: true } } },
    });
    if (units.length !== unitIds.length) return { ok: false, error: "بعض الوحدات غير موجودة" };
    const booked = units.filter((u) => u.booking);
    if (booked.length) return { ok: false, error: `وحدات محجوزة مسبقًا: ${booked.map((u) => u.number).join("، ")}` };
    const noPrice = units.filter((u) => !u.price);
    if (noPrice.length) return { ok: false, error: `وحدات بدون سعر محدّد: ${noPrice.map((u) => u.number).join("، ")}` };

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { name: true, phone: true, nationality: true, nationalId: true, assignedToId: true },
    });
    if (!lead) return { ok: false, error: "العميل غير موجود" };
    // الموظف يبيع لعملائه فقط (نفس تحقق الحجز — الصلاحية على الخادم).
    if (!isManager(user.role) && lead.assignedToId !== user.id) {
      return { ok: false, error: "ما عندك صلاحية على هذا العميل" };
    }
    const nationality = parseEnum(Nationality, nationalityRaw) ?? lead?.nationality ?? null;
    const nationalId = formNationalId || lead?.nationalId || null;

    await prisma.$transaction(async (tx) => {
      for (const u of units) {
        const price = Number(u.price);
        const taxAmount = subjectToTax ? Math.round(price * 0.05) : null;
        const booking = await tx.booking.create({
          data: {
            leadId, unitId: u.id, sellerId: user.id,
            nationality, nationalId, phone: lead?.phone ?? null,
            paymentMethod: PaymentMethod.CASH,
            price, discount: 0, finalPrice: price,
            stage: BookingStage.SOLD, stageIndex: 5,
            subjectToTax, taxAmount,
            collectedAmount: price, remainingAmount: 0,
          },
        });
        await tx.unit.update({ where: { id: u.id }, data: { status: "SOLD" } });
        await tx.bookingEvent.create({
          data: { bookingId: booking.id, userId: user.id, toStage: BookingStage.SOLD, note: "تم الشراء (كاش فوري)" },
        });
      }
      await tx.lead.update({ where: { id: leadId }, data: { stage: "CLOSED_WON", isArchived: true } });
      await tx.followUp.create({
        data: {
          leadId, createdBy: user.id, type: FollowUpType.OTHER, result: FollowUpResult.BOOKED,
          section: FollowUpSection.INTERESTED, stageAfter: "CLOSED_WON",
          note: `تم الشراء (كاش فوري) — ${units.length} وحدة: ${units.map((u) => u.number).join("، ")}`,
        },
      });
      await logAudit(tx, {
        userId: user.id, action: "booking.created", entity: "lead", entityId: leadId,
        summary: `شراء ${units.length} وحدة${lead?.name ? ` للعميل ${lead.name}` : ""} (${units.map((u) => u.number).join("، ")})`,
      });
    });

    await emitNotification({
      eventKey: "unit_booked_sold",
      title: "تم تسجيل شراء",
      body: `${units.length} وحدة${lead?.name ? ` للعميل ${lead.name}` : ""}`,
      link: `/leads/${leadId}`,
    });
    revalidateBookings();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

/** إلغاء الحجز — يحرّر الوحدة، يرجّع العميل لـ«تفاوض»، يحذف الحجز، ويسجّل في التدقيق. */
export async function cancelBooking(bookingId: string, reason?: string): Promise<ActionResult> {
  try {
    const { user, booking } = await assertBookingAccess(bookingId);
    // بيع مكتمل ما يُلغى إلا من المالك — إلغاؤه يمحي السجل المالي نهائيًا (cascade على BookingEvent).
    if ((["SOLD", "DELIVERED"] as BookingStage[]).includes(booking.stage) && user.role !== "OWNER") {
      return { ok: false, error: "هذا بيع مكتمل — إلغاؤه للمالك فقط" };
    }

    await prisma.$transaction(async (tx) => {
      await tx.unit.update({ where: { id: booking.unitId }, data: { status: "AVAILABLE" } });
      await tx.lead.update({ where: { id: booking.leadId }, data: { stage: "NEGOTIATION", isArchived: false } });
      // سطر في تايملاين متابعات العميل: «تم إلغاء الحجز + السبب».
      await tx.followUp.create({
        data: {
          leadId: booking.leadId, createdBy: user.id,
          type: FollowUpType.OTHER, result: FollowUpResult.NEGOTIATING,
          section: FollowUpSection.INTERESTED, stageAfter: "NEGOTIATION",
          note: `تم إلغاء الحجز — وحدة ${booking.unit.number}${booking.unit.project?.name ? ` (${booking.unit.project.name})` : ""}${reason ? ` — السبب: ${reason}` : ""}`,
        },
      });
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
    return { ok: false, error: toUserError(e) };
  }
}

// محصورة بالبائع صاحب الحجز أو المدير/المالك (عبر assertBookingAccess).
// الرجوع من مرحلة البيع (SOLD/DELIVERED) لمرحلة أدنى للمالك فقط.
/** نقل مرحلة البيع — يسجّل الحدث (من غيّره + الوقت) ويزامن stageIndex مع المرحلة. */
export async function updateBookingStage(bookingId: string, stage: BookingStage): Promise<ActionResult> {
  try {
    const { user, booking } = await assertBookingAccess(bookingId);
    if (booking.stage === stage) return { ok: true };
    // بيع مكتمل ما يرجع لمرحلة أدنى إلا المالك — التراجع الصحيح عبر «إلغاء الحجز».
    const SOLD_STAGES: BookingStage[] = [BookingStage.SOLD, BookingStage.DELIVERED];
    if (SOLD_STAGES.includes(booking.stage) && !SOLD_STAGES.includes(stage) && user.role !== "OWNER") {
      return { ok: false, error: "الحجز مباع — الرجوع لمرحلة سابقة للمالك فقط" };
    }

    await prisma.$transaction(async (tx) => {
      await tx.booking.update({ where: { id: bookingId }, data: { stage, stageIndex: bookingStageOrder.indexOf(stage) } });
      await tx.bookingEvent.create({
        data: { bookingId, userId: user.id, fromStage: booking.stage, toStage: stage },
      });
      if (stage === BookingStage.SOLD || stage === BookingStage.DELIVERED) {
        // بيع/تسليم: الوحدة مباعة والعميل مقفول-بيع.
        await tx.unit.update({ where: { id: booking.unitId }, data: { status: "SOLD" } });
        await tx.lead.update({ where: { id: booking.leadId }, data: { stage: "CLOSED_WON" } });
      } else {
        await tx.unit.update({ where: { id: booking.unitId }, data: { status: "RESERVED" } });
      }
      // تم الاستلام: سجل في تايملاين العميل (Activity) — مع اسم الموظف والوقت تلقائيًا.
      if (stage === BookingStage.DELIVERED) {
        await tx.activity.create({
          data: { leadId: booking.leadId, userId: user.id, type: ActivityType.NOTE, note: "تم تسليم الوحدة للعميل" },
        });
      }
      await logAudit(tx, {
        userId: user.id, action: "booking.stage", entity: "booking", entityId: bookingId,
        summary: stage === BookingStage.DELIVERED
          ? `تم تسليم وحدة ${booking.unit.number} للعميل`
          : `نقل حجز وحدة ${booking.unit.number} إلى مرحلة جديدة${stage === BookingStage.SOLD ? " (تم البيع)" : ""}`,
      });
    });

    revalidateBookings();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

/** فشل التمويل / إلغاؤه — مع حفظ السبب وتسجيل الحدث. */
export async function setFinanceRejected(
  bookingId: string,
  rejected: boolean,
  reason?: string,
): Promise<ActionResult> {
  try {
    const { user, booking } = await assertBookingAccess(bookingId);

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
    return { ok: false, error: toUserError(e) };
  }
}

/**
 * تسجيل دفعة محصّلة على حجز — تراكمية (تُضاف للمحصّل الحالي لا تستبدله).
 * الصلاحية: المالك/المدير أو صاحب الحجز فقط (نفس نمط الإلغاء/التعديل — على الخادم).
 * حارسان: المبلغ موجب (> صفر)، والمحصّل التراكمي ما يتجاوز السعر بعد الخصم.
 */
export async function addBookingPayment(bookingId: string, amount: number): Promise<ActionResult> {
  try {
    const { user } = await assertBookingAccess(bookingId); // بائع الحجز أو مدير/مالك فقط
    // حارس ١: المبلغ موجب — لا سالب ولا صفر.
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, error: "اكتب مبلغ دفعة صحيح أكبر من صفر" };
    }
    const b = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { finalPrice: true, collectedAmount: true },
    });
    if (!b) return { ok: false, error: "الحجز غير موجود" };
    const finalPrice = b.finalPrice.toNumber();
    const current = b.collectedAmount.toNumber();
    const next = current + amount;
    // حارس ٢: المحصّل التراكمي ما يتجاوز السعر بعد الخصم.
    if (next > finalPrice) {
      const room = Math.max(0, finalPrice - current);
      return {
        ok: false,
        error: room > 0
          ? `المبلغ أكبر من المتبقّي — أقصى دفعة ${room.toLocaleString("en-US")} ر.س`
          : "الحجز محصّل بالكامل — ما فيه متبقّي",
      };
    }
    await prisma.booking.update({
      where: { id: bookingId },
      // remainingAmount المخزّن يُواءم مع المحسوب (بلا VAT) للاتساق.
      data: { collectedAmount: next, remainingAmount: Math.max(0, finalPrice - next) },
    });
    // سجل تدقيق — فشله ما يُفشِل تسجيل الدفعة.
    await notifyBestEffort("booking.payment", () =>
      logAudit(prisma, {
        userId: user.id, action: "booking.payment", entity: "booking", entityId: bookingId,
        summary: `سجّل دفعة ${amount.toLocaleString("en-US")} ر.س (المحصّل ${next.toLocaleString("en-US")} من ${finalPrice.toLocaleString("en-US")})`,
      }));
    revalidateBookings();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toUserError(e, "booking.payment") };
  }
}
