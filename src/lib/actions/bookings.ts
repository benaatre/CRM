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
import { leadStageForBookings } from "@/lib/booking-finance";
import type { Prisma } from "@prisma/client";

/**
 * الحارس الموحّد لمرحلة العميل (سد الفجوة ١): يعيد حسابها من حجوزاته الحية
 * الفعلية في القاعدة — يُستدعى بعد أي كتابة تغيّر حالة حجز (إنشاء/إلغاء/نقل
 * مرحلة) داخل نفس الـtransaction، فلا موضع يعيّن المرحلة مباشرة بعد الآن.
 * أي حجز مباع (SOLD/DELIVERED — المنطق القائم) ⇒ CLOSED_WON · أي حجز قائم ⇒
 * RESERVED · صفر حجوزات ⇒ الإرجاع القائم (تفاوض + فك الأرشفة).
 */
async function recomputeClientStage(
  tx: Prisma.TransactionClient,
  leadId: string,
): Promise<{ stage: "CLOSED_WON" | "RESERVED" | null; count: number }> {
  const stages = (await tx.booking.findMany({ where: { leadId }, select: { stage: true } })).map((b) => b.stage);
  const stage = leadStageForBookings(stages);
  if (stage) await tx.lead.update({ where: { id: leadId }, data: { stage, isArchived: true } });
  else await tx.lead.update({ where: { id: leadId }, data: { stage: "NEGOTIATION", isArchived: false } });
  return { stage, count: stages.length };
}

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
 * تاريخ حجز يدوي اختياري (لإدخال بيعات قديمة بأثر رجعي): null لو فارغ →
 * تترك القاعدة now(). يرمي لو غير صالح أو مستقبلي (يمنع أخطاء الإدخال).
 */
const bookingDateOf = (raw: string): Date | null => {
  const d = dateOf(raw);
  if (d && d.getTime() > Date.now()) throw new Error("تاريخ الحجز ما يكون بالمستقبل");
  return d;
};

/**
 * يتحقق أن الحجز ضمن صلاحية المستخدم (بائعه أو مدير) — الصلاحية على الخادم لا إخفاء الواجهة.
 * يرجّع المستخدم والحجز (بالحقول التي تحتاجها إجراءات الحجز) أو يرمي خطأً يلتقطه try/catch.
 */
/**
 * إشعار الشفافية الموحّد (سد الفجوة ٣): يُعلم الموظف صاحب البيعة بأي عملية على
 * حجوزاته نفّذها غيره (المالي/المالك) — تسجيل باسمه، تعديل، إلغاء، تأكيد استلام.
 * يصمت تلقائيًا حين الفاعل هو البائع نفسه، وفشله لا يُفشِل العملية.
 */
async function notifyBookingChange(opts: {
  sellerId: string | null;
  actor: { id: string; name?: string | null };
  type: string;
  title: string;
  body: string;
}): Promise<void> {
  const { sellerId } = opts;
  if (!sellerId || sellerId === opts.actor.id) return;
  await notifyBestEffort(`booking.change.${opts.type}`, () =>
    notify(prisma, [sellerId], opts.type, opts.title, opts.body, "/bookings"));
}

/**
 * البائع الفعلي للحجز (سلطة المالي — البند ٧): المالي يمتلك الإنشاء لكن البيعة
 * تُنسب إلزاميًا لموظف مختار (sellerId من الفورم، نشط)؛ غير المالي: نفسه —
 * بعد حارس الملكية القائم (موظف = عملاؤه فقط، مدير/مالك = الكل).
 */
async function resolveBookingSeller(
  user: { id: string; role: string },
  leadAssignedToId: string | null,
  formData: FormData,
): Promise<string | ActionResult> {
  if (user.role === "FINANCE") {
    const chosen = String(formData.get("sellerId") ?? "");
    if (!chosen) return { ok: false, error: "اختر الموظف البائع — البيعة تنسب لموظف" };
    const seller = await prisma.user.findFirst({ where: { id: chosen, active: true }, select: { id: true } });
    if (!seller) return { ok: false, error: "الموظف البائع غير صالح" };
    return chosen;
  }
  if (!isManager(user.role as Parameters<typeof isManager>[0]) && leadAssignedToId !== user.id) {
    return { ok: false, error: "ما عندك صلاحية على هذا العميل" };
  }
  return user.id;
}

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
  if (!isManager(user.role) && user.role !== "FINANCE" && booking.sellerId !== user.id) {
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

    // تاريخ حجز يدوي اختياري (بيعات قديمة) — فارغ = تاريخ اليوم من القاعدة.
    const createdAt = bookingDateOf(String(formData.get("bookingDate") ?? ""));

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
    // سلطة المالي (البند ٧): FINANCE يُنشئ الحجز وينسب البيعة لموظف مختار إلزاميًا.
    const sellerId = await resolveBookingSeller(user, lead.assignedToId, formData);
    if (typeof sellerId !== "string") return sellerId;

    const nationalityRaw = String(formData.get("nationality") ?? "");
    const nationality = parseEnum(Nationality, nationalityRaw) ?? lead?.nationality ?? null;

    await prisma.$transaction(async (tx) => {
      const booking = await tx.booking.create({
        data: {
          leadId, unitId, sellerId,
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
          ...(createdAt ? { createdAt } : {}), // تاريخ يدوي إن مُرِّر، وإلا now() من القاعدة
        },
      });
      await tx.unit.update({ where: { id: unitId }, data: { status: immediateSale ? "SOLD" : "RESERVED" } });
      // الحارس الموحّد (سد الفجوة ١): المرحلة من الحجوزات الحية بعد الإنشاء — لا تعيين مباشر.
      const leadStage = (await recomputeClientStage(tx, leadId)).stage!;
      // آخر خطوة في تايملاين متابعات العميل: «تم الحجز» — وبها تتوقّف المتابعات.
      await tx.followUp.create({
        data: {
          leadId, createdBy: user.id, type: FollowUpType.OTHER, result: FollowUpResult.BOOKED,
          section: FollowUpSection.INTERESTED, stageAfter: leadStage,
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
        summary: `حجز وحدة ${unit.number} في ${unit.project?.name ?? "—"} · العميل=${leadId}`,
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
      // الشفافية (البند ٨ + الفجوة ٣): بيعة سُجّلت باسم موظف بواسطة غيره — يُشعر فورًا.
      await notifyBookingChange({
        sellerId, actor: user, type: "booking.on_behalf",
        title: "سُجّلت بيعة باسمك",
        body: `وحدة ${unit.number} في ${unit.project?.name ?? "—"} للعميل ${lead?.name ?? "—"} — سجّلها ${user.name ?? "المدير المالي"}`,
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

/** عنصر سلة الحجز المتزامن — بطاقة مالية مستقلة لكل وحدة (تعدد الحجوزات 2026-09-05). */
type BasketItem = {
  unitId: string;
  price: number;
  discount: number;
  deposit: number | null;
  paymentMethod: PaymentMethod;
  bankName: SaudiBank | null;
  cashAmount: number | null;
  cashPaymentType: CashPaymentType | null;
  expectedCheckDate: string | null;
  expectedTransferDate: string | null;
  installments: { amount: number; date: string }[] | null;
  includesVAT: boolean;
};

/** يفكّ عناصر السلة من JSON بتحقق شكلي صارم — يرمي رسالة عربية عند أي خلل. */
function parseBasketItems(raw: string): BasketItem[] {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("بيانات السلة غير صالحة"); }
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("السلة فاضية");
  if (parsed.length > 20) throw new Error("السلة كبيرة جدًا — ٢٠ وحدة كحد أقصى");
  return parsed.map((x) => {
    const o = x as Record<string, unknown>;
    const unitId = String(o.unitId ?? "");
    const price = Number(o.price);
    const discount = Number(o.discount ?? 0);
    if (!unitId) throw new Error("وحدة بلا معرّف في السلة");
    if (!Number.isFinite(price) || price <= 0) throw new Error("سعر غير صحيح في السلة");
    if (!Number.isFinite(discount) || discount < 0) throw new Error("خصم غير صحيح في السلة");
    const paymentMethod = parseEnum(PaymentMethod, o.paymentMethod, PaymentMethod.CASH)!;
    const bankName = parseEnum(SaudiBank, o.bankName);
    if ((paymentMethod === "BANK_FINANCE" || paymentMethod === "CASH_AND_FINANCE") && !bankName) {
      throw new Error("اختر البنك لكل وحدة تمويلها بنكي");
    }
    const deposit = o.deposit != null && Number.isFinite(Number(o.deposit)) ? Number(o.deposit) : null;
    const cashAmount = o.cashAmount != null && Number.isFinite(Number(o.cashAmount)) ? Number(o.cashAmount) : null;
    const installments = Array.isArray(o.installments) && o.installments.length
      ? (o.installments as { amount: number; date: string }[]).map((r) => ({ amount: Number(r.amount) || 0, date: String(r.date ?? "") }))
      : null;
    return {
      unitId, price: Math.round(price), discount: Math.round(discount), deposit,
      paymentMethod, bankName,
      cashAmount, cashPaymentType: parseEnum(CashPaymentType, o.cashPaymentType),
      expectedCheckDate: o.expectedCheckDate ? String(o.expectedCheckDate) : null,
      expectedTransferDate: o.expectedTransferDate ? String(o.expectedTransferDate) : null,
      installments,
      includesVAT: o.includesVAT === true,
    };
  });
}

/**
 * سلة الحجز المتزامن (تعدد الحجوزات — البند ٢): عدة وحدات لعميل واحد بجلسة واحدة،
 * كل وحدة ببطاقتها المالية المستقلة، والإنشاء transaction واحدة — كل الحجوزات أو لا شيء،
 * مع إعادة فحص توفر كل وحدة داخلها. مرحلة العميل = أعلى حجوزاته (شراء فوري أو حجز
 * قائم مباع سابقًا ⇒ CLOSED_WON، وإلا RESERVED) — لا تنزل مرحلة عميل مقفول-بيع.
 */
export async function createBookings(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const leadId = String(formData.get("leadId") ?? "");
    if (!leadId) return { ok: false, error: "العميل غير محدّد" };
    const items = parseBasketItems(String(formData.get("items") ?? ""));
    const unitIds = items.map((i) => i.unitId);
    if (new Set(unitIds).size !== unitIds.length) return { ok: false, error: "وحدة مكررة في السلة" };

    const immediateSale = String(formData.get("immediateSale") ?? "") === "yes";
    const createdAt = bookingDateOf(String(formData.get("bookingDate") ?? ""));
    const secondaryPhone = String(formData.get("secondaryPhone") ?? "").replace(/[^\d]/g, "") || null;

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { name: true, phone: true, nationality: true, nationalId: true, assignedToId: true },
    });
    if (!lead) return { ok: false, error: "العميل غير موجود" };
    // نفس حارس createBooking حرفيًا — والمالي ينسب البيعة لموظف مختار (البند ٧).
    const sellerId = await resolveBookingSeller(user, lead.assignedToId, formData);
    if (typeof sellerId !== "string") return sellerId;
    const nationality = parseEnum(Nationality, String(formData.get("nationality") ?? "")) ?? lead.nationality ?? null;
    const nationalId = String(formData.get("nationalId") ?? "").trim() || lead.nationalId || null;

    // بيانات الوحدات (السعر المخفّض وحدود خصم المشروع) — للتحقق ووسم التجاوز لكل وحدة.
    const units = await prisma.unit.findMany({
      where: { id: { in: unitIds } },
      select: {
        id: true, number: true, discountedPrice: true,
        project: { select: { name: true, maxDiscountPercent: true, maxDiscountAmount: true } },
      },
    });
    if (units.length !== unitIds.length) return { ok: false, error: "بعض الوحدات غير موجودة" };
    const unitById = new Map(units.map((u) => [u.id, u]));

    const stage = immediateSale ? BookingStage.SOLD : BookingStage.RESERVATION;
    const overages: { number: string; projectName: string | null; overage: number }[] = [];
    const createdUnits: string[] = [];

    await prisma.$transaction(async (tx) => {
      for (const item of items) {
        const u = unitById.get(item.unitId)!;
        // إعادة فحص التوفر داخل الـtransaction — وقيد unitId الفريد شبكة الأمان النهائية.
        const fresh = await tx.unit.findUnique({
          where: { id: item.unitId },
          select: { status: true, booking: { select: { id: true } } },
        });
        if (!fresh || fresh.booking || fresh.status !== "AVAILABLE") {
          throw new Error(`الوحدة ${u.number} صارت محجوزة — احذفها من السلة وحاول من جديد`);
        }

        const finalPrice = item.price - item.discount;
        const taxAmount = item.includesVAT ? Math.round(finalPrice * 0.05) : null;
        const totalAfterDiscount = finalPrice + (taxAmount ?? 0);
        const collectedAmount = immediateSale ? finalPrice : (item.deposit ?? 0);
        const remainingAmount = totalAfterDiscount - collectedAmount;

        // منطق تجاوز الخصم المقرر — نفس createBooking حرفيًا لكل وحدة على حدة.
        const unitDiscounted = u.discountedPrice != null ? Number(u.discountedPrice) : null;
        const projMaxAmount = u.project?.maxDiscountAmount != null ? Number(u.project.maxDiscountAmount) : null;
        let discountOverage = 0;
        if (unitDiscounted != null) {
          if (finalPrice < unitDiscounted) discountOverage = Math.round(unitDiscounted - finalPrice);
        } else if (projMaxAmount != null) {
          if (item.discount > projMaxAmount) discountOverage = Math.round(item.discount - projMaxAmount);
        }
        if (discountOverage > 0) overages.push({ number: u.number, projectName: u.project?.name ?? null, overage: discountOverage });
        const discountPct = item.price > 0 ? (item.discount / item.price) * 100 : 0;

        const booking = await tx.booking.create({
          data: {
            leadId, unitId: item.unitId, sellerId,
            nationality, nationalId, phone: lead.phone ?? null,
            paymentMethod: item.paymentMethod, bankName: item.bankName,
            deposit: item.deposit, price: item.price, discount: item.discount, finalPrice,
            stage, stageIndex: immediateSale ? 5 : 0,
            discountExceeded: discountOverage > 0,
            discountOverage: discountOverage > 0 ? discountOverage : null,
            discountPercentAtBooking: Math.round(discountPct * 100) / 100,
            maxDiscountPercentAtBooking: u.project?.maxDiscountPercent != null ? Number(u.project.maxDiscountPercent) : null,
            cashAmount: item.cashAmount,
            expectedCheckDate: dateOf(item.expectedCheckDate ?? ""),
            expectedTransferDate: dateOf(item.expectedTransferDate ?? ""),
            cashPaymentType: item.cashPaymentType,
            installmentsCount: item.installments?.length ?? null,
            installments: item.installments ?? undefined,
            subjectToTax: item.includesVAT, taxAmount,
            includesVAT: false, vatAmount: null,
            secondaryPhone,
            collectedAmount, remainingAmount,
            ...(createdAt ? { createdAt } : {}),
          },
        });
        await tx.unit.update({ where: { id: item.unitId }, data: { status: immediateSale ? "SOLD" : "RESERVED" } });
        await tx.bookingEvent.create({
          data: { bookingId: booking.id, userId: user.id, toStage: stage, note: immediateSale ? "تم الشراء (كاش فوري)" : "تم إنشاء الحجز (سلة متزامنة)" },
        });
        createdUnits.push(u.number);
      }

      // الحارس الموحّد (سد الفجوة ١): المرحلة من الحجوزات الحية بعد السلة كلها.
      const newLeadStage = (await recomputeClientStage(tx, leadId)).stage!;
      await tx.followUp.create({
        data: {
          leadId, createdBy: user.id, type: FollowUpType.OTHER, result: FollowUpResult.BOOKED,
          section: FollowUpSection.INTERESTED, stageAfter: newLeadStage,
          note: `${immediateSale ? "تم الشراء (كاش فوري)" : "تم الحجز"} — ${items.length > 1 ? `${items.length} وحدات: ` : "وحدة "}${createdUnits.join("، ")}`,
        },
      });
      await tx.activity.create({
        data: {
          leadId, userId: user.id, type: ActivityType.NOTE,
          note: `${immediateSale ? "تم تسجيل شراء" : "تم تسجيل حجز"} ${items.length > 1 ? `${items.length} وحدات` : "وحدة"} — ${createdUnits.join("، ")}`,
        },
      });
      await logAudit(tx, {
        userId: user.id, action: "booking.created", entity: "lead", entityId: leadId,
        summary: `${immediateSale ? "شراء" : "حجز"} ${items.length} وحدة (${createdUnits.join("، ")}) · العميل=${leadId}`,
      });
    });

    // آثار جانبية بعد الـcommit — فشلها ما يُفشِل الحجوزات (#29).
    await notifyBestEffort("bookings.created.notify", async () => {
      await emitNotification({
        eventKey: "unit_booked_sold",
        title: immediateSale ? "تم بيع وحدات" : "وحدات اتحجزت",
        body: `${createdUnits.length > 1 ? `${createdUnits.length} وحدات (${createdUnits.join("، ")})` : `وحدة ${createdUnits[0]}`}${lead.name ? ` — ${lead.name}` : ""}`,
        link: `/leads/${leadId}`,
      });
      if (overages.length) {
        await notify(
          prisma,
          await ownerIds(prisma),
          "discount.exceeded",
          "إشعار خصم",
          `تجاوز خصم: ${user.name ?? "موظف"} — ${overages.map((o) => `وحدة ${o.number}${o.projectName ? ` (${o.projectName})` : ""} بتجاوز ${o.overage.toLocaleString("en-US")} ر.س`).join(" · ")}`,
        );
      }
      // الشفافية (البند ٨ + الفجوة ٣): سلة سُجّلت باسم موظف بواسطة غيره — يُشعر فورًا.
      await notifyBookingChange({
        sellerId, actor: user, type: "booking.on_behalf",
        title: "سُجّلت بيعة باسمك",
        body: `${createdUnits.length > 1 ? `${createdUnits.length} وحدات (${createdUnits.join("، ")})` : `وحدة ${createdUnits[0]}`} للعميل ${lead.name ?? "—"} — سجّلها ${user.name ?? "المدير المالي"}`,
      });
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
      select: {
        sellerId: true, unitId: true, collectedAmount: true, leadId: true,
        // الشفافية (البند ٨): القيم قبل التعديل — لسطر التدقيق قبل/بعد ولإشعار البائع.
        price: true, discount: true, finalPrice: true, deposit: true, paymentMethod: true,
        unit: { select: { number: true } }, lead: { select: { name: true } },
      },
    });
    if (!existing) return { ok: false, error: "الحجز غير موجود" };

    // الحارس المزدوج على الخادم (لا نعتمد على إخفاء الواجهة).
    // سلطة المالي (البند ٧): FINANCE يعدّل شروط أي حجز — حتى ذي المحصّل (مع المالك).
    const collected = existing.collectedAmount.toNumber();
    if (collected > 0) {
      if (user.role !== "OWNER" && user.role !== "FINANCE") {
        return { ok: false, error: "ما يمكن تعديل حجز فيه دفعات محصّلة إلا من المالك أو المدير المالي" };
      }
    } else if (!isManager(user.role) && user.role !== "FINANCE" && existing.sellerId !== user.id) {
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
    // تاريخ حجز يدوي (بيعات قديمة) — فارغ = لا يُغيَّر createdAt.
    const createdAt = bookingDateOf(String(formData.get("bookingDate") ?? ""));

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
          ...(createdAt ? { createdAt } : {}), // تاريخ يدوي إن مُرِّر، وإلا يبقى كما هو
        },
      });
    });

    // الشفافية (البند ٨): سطر تدقيق بالمتغيّر فقط قبل/بعد (من، ماذا) + إشعار البائع لو عدّله غيره.
    const fmtN = (v: number) => v.toLocaleString("en-US");
    const changes: string[] = [];
    if (existing.price.toNumber() !== price) changes.push(`السعر ${fmtN(existing.price.toNumber())}→${fmtN(price)}`);
    if (existing.discount.toNumber() !== discount) changes.push(`الخصم ${fmtN(existing.discount.toNumber())}→${fmtN(discount)}`);
    if ((existing.deposit?.toNumber() ?? 0) !== (deposit ?? 0)) changes.push(`العربون ${fmtN(existing.deposit?.toNumber() ?? 0)}→${fmtN(deposit ?? 0)}`);
    if (existing.paymentMethod !== paymentMethod) changes.push(`طريقة الدفع ${existing.paymentMethod}→${paymentMethod}`);
    if (unitChanged) changes.push(`تبديل وحدة`);
    await notifyBestEffort("booking.update", () =>
      logAudit(prisma, {
        userId: user.id, action: "booking.update", entity: "booking", entityId: bookingId,
        summary: `عدّل حجز وحدة ${existing.unit?.number ?? "—"}${changes.length ? ` — ${changes.join(" · ")}` : ""} · العميل=${existing.leadId}`,
      }));
    await notifyBookingChange({
      sellerId: existing.sellerId, actor: user, type: "booking.updated_by_other",
      title: "عُدّل حجز من حجوزاتك",
      body: `وحدة ${existing.unit?.number ?? "—"} للعميل ${existing.lead?.name ?? "—"} — عدّله ${user.name ?? "الإدارة"}${changes.length ? `: ${changes.join(" · ")}` : ""}`,
    });

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
      // الحارس الموحّد (سد الفجوة ١) — النتيجة هنا CLOSED_WON دائمًا (كلها مباعة).
      await recomputeClientStage(tx, leadId);
      await tx.followUp.create({
        data: {
          leadId, createdBy: user.id, type: FollowUpType.OTHER, result: FollowUpResult.BOOKED,
          section: FollowUpSection.INTERESTED, stageAfter: "CLOSED_WON",
          note: `تم الشراء (كاش فوري) — ${units.length} وحدة: ${units.map((u) => u.number).join("، ")}`,
        },
      });
      await logAudit(tx, {
        userId: user.id, action: "booking.created", entity: "lead", entityId: leadId,
        summary: `شراء ${units.length} وحدة (${units.map((u) => u.number).join("، ")}) · العميل=${leadId}`,
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
      await tx.booking.delete({ where: { id: bookingId } }); // يحذف أحداث الحجز تلقائيًا (cascade)
      // الحارس الموحّد (سد الفجوة ١): المرحلة من الحجوزات المتبقية بعد الحذف — إلغاء
      // حجز واحد لا يُخرج العميل من «تم الحجز/الشراء» ما دام غيره قائمًا، وآخر حجز
      // يُلغى يعيده لتفاوض بالمنطق القائم.
      const { stage: remainingStage, count: remainingCount } = await recomputeClientStage(tx, booking.leadId);
      // سطر في تايملاين متابعات العميل: «تم إلغاء الحجز + السبب».
      await tx.followUp.create({
        data: {
          leadId: booking.leadId, createdBy: user.id,
          type: FollowUpType.OTHER, result: FollowUpResult.NEGOTIATING,
          section: FollowUpSection.INTERESTED, stageAfter: remainingStage ?? "NEGOTIATION",
          note: `تم إلغاء الحجز — وحدة ${booking.unit.number}${booking.unit.project?.name ? ` (${booking.unit.project.name})` : ""}${reason ? ` — السبب: ${reason}` : ""}${remainingStage ? ` — وبقي له ${remainingCount > 1 ? `${remainingCount} حجوزات قائمة` : "حجز قائم"}` : ""}`,
        },
      });
      await logAudit(tx, {
        userId: user.id, action: "booking.cancelled", entity: "unit", entityId: booking.unitId,
        summary: `ألغى حجز وحدة ${booking.unit.number} في ${booking.unit.project?.name ?? "—"}${reason ? ` — السبب: ${reason}` : ""} · العميل=${booking.leadId}`,
      });
    });

    await notify(prisma, await activeUserIds(prisma), "booking.cancelled", "تم إلغاء حجز", `وحدة ${booking.unit.number} في ${booking.unit.project?.name ?? "—"}`);
    // الشفافية (البند ٨ + الفجوة ٣): إلغاءٌ من غير البائع — إشعار موجّه للبائع بمن ألغى.
    await notifyBookingChange({
      sellerId: booking.sellerId, actor: user, type: "booking.cancelled_by_other",
      title: "أُلغي حجز من حجوزاتك",
      body: `وحدة ${booking.unit.number} للعميل ${booking.lead?.name ?? "—"} — ألغاه ${user.name ?? "الإدارة"}${reason ? ` — السبب: ${reason}` : ""}`,
    });
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
        await tx.unit.update({ where: { id: booking.unitId }, data: { status: "SOLD" } });
      } else {
        await tx.unit.update({ where: { id: booking.unitId }, data: { status: "RESERVED" } });
      }
      // الحارس الموحّد (سد الفجوة ١): المرحلة من الحجوزات الحية بعد التغيير — بيع/تسليم
      // يقفل، ورجوع المالك من مباع لا يُبقيه مقفولًا إلا إن بقي له حجز مباع آخر.
      await recomputeClientStage(tx, booking.leadId);
      // تم الاستلام: سجل في تايملاين العميل (Activity) — مع اسم الموظف والوقت تلقائيًا.
      if (stage === BookingStage.DELIVERED) {
        await tx.activity.create({
          data: { leadId: booking.leadId, userId: user.id, type: ActivityType.NOTE, note: "تم تسليم الوحدة للعميل" },
        });
      }
      await logAudit(tx, {
        userId: user.id, action: "booking.stage", entity: "booking", entityId: bookingId,
        summary: stage === BookingStage.DELIVERED
          ? `تم تسليم وحدة ${booking.unit.number} · العميل=${booking.leadId}`
          : `نقل حجز وحدة ${booking.unit.number} إلى مرحلة جديدة${stage === BookingStage.SOLD ? " (تم البيع)" : ""} · العميل=${booking.leadId}`,
      });
    });

    // الشفافية (البند ٨ + الفجوة ٣): تأكيد استلام من غير البائع — البائع يُشعر فورًا.
    if (stage === BookingStage.DELIVERED) {
      await notifyBookingChange({
        sellerId: booking.sellerId, actor: user, type: "booking.delivered_by_other",
        title: "تم تأكيد استلام وحدة من بيعاتك",
        body: `وحدة ${booking.unit.number} للعميل ${booking.lead?.name ?? "—"} — أكّده ${user.name ?? "الإدارة"}`,
      });
    }
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
        summary: `${rejected ? `وسم فشل تمويل${reason ? ` — ${reason}` : ""}` : "ألغى وسم فشل التمويل"} · العميل=${booking.leadId}`,
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
      select: { finalPrice: true, collectedAmount: true, leadId: true },
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
        summary: `سجّل دفعة ${amount.toLocaleString("en-US")} ر.س (المحصّل ${next.toLocaleString("en-US")} من ${finalPrice.toLocaleString("en-US")}) · العميل=${b.leadId}`,
      }));
    revalidateBookings();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toUserError(e, "booking.payment") };
  }
}
