import "server-only";

import type {
  Channel, LeadStage, PurchaseGoal,
  BookingStage, PaymentMethod, SaudiBank, Nationality, Floor, ProjectStatus,
} from "@prisma/client";
import { FollowUpType, PurchaseMethod } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { compareUnitNumbers } from "@/lib/format";
import { bookingCollection, SOLD_STAGES } from "@/lib/booking-finance";

const VISIT_TYPES = [FollowUpType.VISIT_PROJECT, FollowUpType.VISIT_OFFICE];

const num = (v: { toNumber(): number } | null) => (v ? v.toNumber() : 0);

export type FinanceRow = {
  projectId: string;
  projectName: string;
  basePrice: number;
  discounts: number;
  afterDiscount: number;
  collected: number;
  notCollected: number;
  reservedValue: number;
};

export type AnalyticsData = {
  finance: {
    basePrice: number;
    discounts: number;
    afterDiscount: number;
    collected: number;
    notCollected: number;
    reservedValue: number;
    financeFailedCount: number;
    financeFailedValue: number;
    perProject: FinanceRow[];
  };
  metrics: {
    winRate: number; // % مقفول-بيع من (بيع + خسارة)
    avgFirstResponseHours: number | null;
    within1hRate: number; // %
    responseRate: number; // %
    avgAttempts: number;
    avgSalesCycleDays: number | null;
  };
  funnel: { stage: LeadStage; count: number; convFromPrev: number | null }[];
  channels: { channel: Channel; count: number }[];
  purchaseMethods: { method: PurchaseMethod; count: number }[];
  purchaseGoals: { goal: PurchaseGoal; count: number }[];
  team: {
    id: string;
    name: string;
    assigned: number;   // العملاء المعيّنون
    followups: number;  // المتابعات
    visits: number;     // الزيارات
    bookings: number;   // الحجوزات
    closed: number;     // صفقات مقفولة
    conversion: number; // معدل التحويل % (مقفول/معيّن)
    target: number;     // الهدف الشهري
    progress: number | null; // % نحو الهدف
  }[];
};

const FUNNEL: LeadStage[] = [
  "NEW",
  "ATTEMPTED",
  "INTERESTED",
  "VIEWING",
  "NEGOTIATION",
  "RESERVED",
  "CLOSED_WON",
];

export async function getAnalytics(): Promise<AnalyticsData> {
  const [bookings, leads, channelGroups, stageGroups, employees, closedByEmp, bookingsByEmp, methodGroups, goalGroups, assignedByEmp, followUpsByEmp, visitsByEmp] =
    await Promise.all([
      prisma.booking.findMany({
        include: { unit: { select: { project: { select: { id: true, name: true } } } } },
      }),
      prisma.lead.findMany({
        select: { createdAt: true, firstContactAt: true, updatedAt: true, attempts: true, stage: true },
      }),
      prisma.lead.groupBy({ by: ["channel"], _count: { _all: true } }),
      prisma.lead.groupBy({ by: ["stage"], _count: { _all: true } }),
      prisma.user.findMany({ where: { role: "EMPLOYEE", active: true }, select: { id: true, name: true, targetDeals: true } }),
      prisma.lead.groupBy({ by: ["assignedToId"], where: { stage: "CLOSED_WON" }, _count: { _all: true } }),
      prisma.booking.groupBy({ by: ["sellerId"], _count: { _all: true } }),
      prisma.lead.groupBy({ by: ["purchaseMethod"], where: { purchaseMethod: { not: null } }, _count: { _all: true } }),
      prisma.lead.groupBy({ by: ["purchaseGoal"], where: { purchaseGoal: { not: null } }, _count: { _all: true } }),
      prisma.lead.groupBy({ by: ["assignedToId"], _count: { _all: true } }),
      prisma.followUp.groupBy({ by: ["createdBy"], _count: { _all: true } }),
      prisma.followUp.groupBy({ by: ["createdBy"], where: { type: { in: VISIT_TYPES } }, _count: { _all: true } }),
    ]);

  // ===== المالية =====
  const perProjectMap = new Map<string, FinanceRow>();
  let basePrice = 0, discounts = 0, afterDiscount = 0, collected = 0, notCollected = 0, reservedValue = 0;
  let financeFailedCount = 0, financeFailedValue = 0;

  for (const b of bookings) {
    const price = num(b.price);
    const disc = num(b.discount);
    const final = num(b.finalPrice);
    // المحصّل/المتبقّي موحّدان: بيع مكتمل = محصّل كامل ومتبقّي صفر (booking-finance).
    const { collected: coll, remaining: notColl } = bookingCollection(b.stage, final, num(b.collectedAmount));
    basePrice += price;
    discounts += disc;
    afterDiscount += final;
    collected += coll;
    notCollected += notColl;
    // #24: DELIVERED بيع مكتمل مثل SOLD — ما يُحسب ضمن «المحجوز».
    if (!SOLD_STAGES.includes(b.stage)) reservedValue += final;
    if (b.financeRejected) {
      financeFailedCount++;
      financeFailedValue += final;
    }
    const proj = b.unit.project;
    if (proj) {
      const row = perProjectMap.get(proj.id) ?? {
        projectId: proj.id, projectName: proj.name,
        basePrice: 0, discounts: 0, afterDiscount: 0, collected: 0, notCollected: 0, reservedValue: 0,
      };
      row.basePrice += price;
      row.discounts += disc;
      row.afterDiscount += final;
      row.collected += coll;
      row.notCollected += notColl;
      if (!SOLD_STAGES.includes(b.stage)) row.reservedValue += final;
      perProjectMap.set(proj.id, row);
    }
  }

  // ===== المؤشرات الاحترافية =====
  const total = leads.length;
  const responded = leads.filter((l) => l.firstContactAt);
  const respDiffsMs = responded.map((l) => l.firstContactAt!.getTime() - l.createdAt.getTime());
  const within1h = respDiffsMs.filter((d) => d <= 3_600_000).length;
  const avgFirstResponseHours =
    respDiffsMs.length > 0
      ? Math.round((respDiffsMs.reduce((a, b) => a + b, 0) / respDiffsMs.length / 3_600_000) * 10) / 10
      : null;
  const closedLeads = leads.filter((l) => l.stage === "CLOSED_WON");
  const cycleMs = closedLeads.map((l) => l.updatedAt.getTime() - l.createdAt.getTime());
  const avgSalesCycleDays =
    cycleMs.length > 0
      ? Math.round((cycleMs.reduce((a, b) => a + b, 0) / cycleMs.length / 86_400_000) * 10) / 10
      : null;
  const avgAttempts =
    total > 0 ? Math.round((leads.reduce((a, l) => a + l.attempts, 0) / total) * 10) / 10 : 0;

  // ===== القمع + نسب التحويل =====
  const stageCount = new Map(stageGroups.map((g) => [g.stage, g._count._all]));
  const won = stageCount.get("CLOSED_WON") ?? 0;
  const lost = stageCount.get("CLOSED_LOST") ?? 0;
  const winRate = won + lost > 0 ? Math.round((won / (won + lost)) * 100) : 0;
  const funnel = FUNNEL.map((stage, i) => {
    const count = stageCount.get(stage) ?? 0;
    const prev = i > 0 ? stageCount.get(FUNNEL[i - 1]) ?? 0 : null;
    const convFromPrev = prev && prev > 0 ? Math.round((count / prev) * 100) : null;
    return { stage, count, convFromPrev };
  });

  // ===== القنوات =====
  const channels = channelGroups
    .map((g) => ({ channel: g.channel, count: g._count._all }))
    .sort((a, b) => b.count - a.count);

  // ===== طريقة وهدف الشراء =====
  const purchaseMethods = methodGroups
    .filter((g) => g.purchaseMethod)
    .map((g) => ({ method: g.purchaseMethod as PurchaseMethod, count: g._count._all }))
    .sort((a, b) => b.count - a.count);
  const purchaseGoals = goalGroups
    .filter((g) => g.purchaseGoal)
    .map((g) => ({ goal: g.purchaseGoal as PurchaseGoal, count: g._count._all }))
    .sort((a, b) => b.count - a.count);

  // ===== الفريق =====
  const closedMap = new Map(closedByEmp.map((r) => [r.assignedToId, r._count._all]));
  const bookMap = new Map(bookingsByEmp.map((r) => [r.sellerId, r._count._all]));
  const assignedMap = new Map(assignedByEmp.map((r) => [r.assignedToId, r._count._all]));
  const followUpsMap = new Map(followUpsByEmp.map((r) => [r.createdBy, r._count._all]));
  const visitsMap = new Map(visitsByEmp.map((r) => [r.createdBy, r._count._all]));
  const team = employees.map((e) => {
    const assigned = assignedMap.get(e.id) ?? 0;
    const closed = closedMap.get(e.id) ?? 0;
    return {
      id: e.id,
      name: e.name,
      assigned,
      followups: followUpsMap.get(e.id) ?? 0,
      visits: visitsMap.get(e.id) ?? 0,
      bookings: bookMap.get(e.id) ?? 0,
      closed,
      conversion: assigned > 0 ? Math.round((closed / assigned) * 100) : 0,
      target: e.targetDeals,
      progress: e.targetDeals > 0 ? Math.round((closed / e.targetDeals) * 100) : null,
    };
  });

  return {
    finance: {
      basePrice, discounts, afterDiscount, collected, notCollected, reservedValue,
      financeFailedCount, financeFailedValue,
      perProject: [...perProjectMap.values()],
    },
    metrics: {
      winRate,
      avgFirstResponseHours,
      within1hRate: responded.length > 0 ? Math.round((within1h / responded.length) * 100) : 0,
      responseRate: total > 0 ? Math.round((responded.length / total) * 100) : 0,
      avgAttempts,
      avgSalesCycleDays,
    },
    funnel,
    channels,
    purchaseMethods,
    purchaseGoals,
    team,
  };
}

// ===== أداء الموظف نفسه (نطاقه فقط) — للمهمة ٤ =====
export type EmployeePerformance = {
  name: string;
  assigned: number;   // عملاؤه
  followups: number;  // متابعاته
  visits: number;     // زياراته
  bookings: number;   // حجوزاته
  closed: number;     // صفقاته المقفولة
  conversion: number; // معدل تحويله %
  target: number;     // هدفه الشهري
  progress: number | null; // % نحو الهدف
};

/** تحليلات موظف واحد محصورة في بياناته فقط — لا يرى بقية الموظفين. */
export async function getEmployeePerformance(userId: string): Promise<EmployeePerformance> {
  const [me, assigned, closed, bookings, followups, visits] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, targetDeals: true } }),
    prisma.lead.count({ where: { assignedToId: userId } }),
    prisma.lead.count({ where: { assignedToId: userId, stage: "CLOSED_WON" } }),
    prisma.booking.count({ where: { sellerId: userId } }),
    prisma.followUp.count({ where: { createdBy: userId } }),
    prisma.followUp.count({ where: { createdBy: userId, type: { in: VISIT_TYPES } } }),
  ]);
  const target = me?.targetDeals ?? 0;
  return {
    name: me?.name ?? "أنا",
    assigned, followups, visits, bookings, closed,
    conversion: assigned > 0 ? Math.round((closed / assigned) * 100) : 0,
    target,
    progress: target > 0 ? Math.round((closed / target) * 100) : null,
  };
}

// ===== تحليل مالي لكل مشروع (للمالك/المدير فقط) — المهمة ٣ =====
const dnum = (v: { toNumber(): number } | null) => (v ? v.toNumber() : 0);
const pct1 = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

export type ProjectFinanceRow = {
  unitNumber: string;
  floor: string | null;
  floorLevel: Floor | null;
  leadName: string | null;
  leadPhone: string | null;
  nationality: Nationality | null;
  nationalId: string | null;
  originalPrice: number; // السعر الأصلي (قبل الخصم)
  soldPrice: number;     // باع بكم (بعد الخصم)
  discount: number;
  discountPct: number;   // نسبة الخصم %
  paymentMethod: PaymentMethod;
  bankName: SaudiBank | null;
  sellerName: string | null;
  stage: BookingStage;   // محجوز / مباع / مستلم
};

export type ProjectFinance = {
  projectId: string;
  projectName: string;
  constructionStatus: ProjectStatus;
  // قسم أ — نظرة المشروع (من الوحدات)
  unitsTotal: number;
  listValue: number;        // أصل المبلغ الإجمالي عند الطرح = Σ Unit.price
  plannedDiscount: number;  // Σ(price − discountedPrice)
  plannedDiscountPct: number;
  netAfterDiscount: number; // Σ discountedPrice (أو price إن لا خصم)
  // قسم ب — الإنجاز
  soldCount: number;
  reservedCount: number;
  availableCount: number;
  completionPct: number;    // (مباع + محجوز) / الكل
  // قسم ج — المبيعات الفعلية (من الحجوزات)
  count: number;            // عدد الوحدات المباعة/المحجوزة
  bookedOriginal: number;   // قيمة طرح الوحدات المباعة/المحجوزة (Σ booking.price)
  totalSales: number;       // Σ booking.finalPrice
  totalDiscount: number;    // Σ booking.discount
  actualDiscountPct: number;
  avgDiscount: number;      // متوسط الخصم لكل شقة
  totalCollected: number;
  totalRemaining: number;
  remainingBankFinance: number;
  remainingInstallments: number;
  remainingOther: number;
  // قسم د — الجدول
  rows: ProjectFinanceRow[];
};

/** صف مقارنة لكل المشاريع — قسم هـ. */
export type AllProjectsFinanceRow = {
  projectId: string;
  projectName: string;
  listValue: number;     // قيمة الطرح
  unitsTotal: number;
  sold: number;          // مباع (وحدات)
  completionPct: number;
  totalSales: number;
  totalDiscount: number;
  discountPct: number;
  collected: number;
  remaining: number;
};

/** قائمة المشاريع المختصرة لاختيارها في التحليل المالي. */
export async function getProjectsForFinance(): Promise<{ id: string; name: string }[]> {
  return prisma.project.findMany({ select: { id: true, name: true }, orderBy: { createdAt: "asc" } });
}

/** قائمة الموظفين المفعّلين لاختيارهم في تحليل الأداء. */
export async function getEmployeesList(): Promise<{ id: string; name: string }[]> {
  return prisma.user.findMany({ where: { role: "EMPLOYEE", active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
}

/** تحليل مالي مفصّل لمشروع — وحدات (الطرح/الإنجاز) + حجوزات (مبيعات فعلية). */
export async function getProjectFinance(projectId: string): Promise<ProjectFinance | null> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true, status: true } });
  if (!project) return null;

  const [units, bookings] = await Promise.all([
    prisma.unit.findMany({ where: { projectId }, select: { price: true, discountedPrice: true, status: true } }),
    prisma.booking.findMany({
      where: { unit: { projectId } },
      select: {
        price: true, finalPrice: true, discount: true, collectedAmount: true,
        paymentMethod: true, bankName: true, cashPaymentType: true, stage: true,
        nationality: true, nationalId: true, phone: true,
        unit: { select: { number: true, floor: true, floorLevel: true } },
        lead: { select: { name: true, phone: true } },
        seller: { select: { name: true } },
      },
    }),
  ]);

  // قسم أ + ب — من الوحدات
  let listValue = 0, plannedDiscount = 0, netAfterDiscount = 0;
  let soldCount = 0, reservedCount = 0, availableCount = 0;
  for (const u of units) {
    const price = dnum(u.price);
    const disc = dnum(u.discountedPrice);
    listValue += price;
    netAfterDiscount += disc > 0 ? disc : price;
    if (disc > 0 && price > disc) plannedDiscount += price - disc;
    if (u.status === "SOLD") soldCount++;
    else if (u.status === "RESERVED") reservedCount++;
    else availableCount++;
  }
  const unitsTotal = units.length;

  // قسم ج + د — من الحجوزات
  let bookedOriginal = 0, totalDiscount = 0, totalSales = 0, totalCollected = 0, totalRemaining = 0;
  let remainingBankFinance = 0, remainingInstallments = 0, remainingOther = 0;
  const rows: ProjectFinanceRow[] = bookings.map((b) => {
    const originalPrice = dnum(b.price);
    const soldPrice = dnum(b.finalPrice);
    const discount = dnum(b.discount);
    // موحّد: بيع مكتمل = محصّل كامل ومتبقّي صفر.
    const { collected, remaining } = bookingCollection(b.stage, soldPrice, dnum(b.collectedAmount));
    bookedOriginal += originalPrice;
    totalDiscount += discount;
    totalSales += soldPrice;
    totalCollected += collected;
    totalRemaining += remaining;
    if (b.paymentMethod === "BANK_FINANCE" || b.paymentMethod === "CASH_AND_FINANCE") remainingBankFinance += remaining;
    else if (b.cashPaymentType === "INSTALLMENTS") remainingInstallments += remaining;
    else remainingOther += remaining;
    return {
      unitNumber: b.unit.number,
      floor: b.unit.floor,
      floorLevel: b.unit.floorLevel,
      leadName: b.lead?.name ?? null,
      leadPhone: b.lead?.phone ?? b.phone ?? null,
      nationality: b.nationality,
      nationalId: b.nationalId,
      originalPrice, soldPrice, discount,
      discountPct: pct1(discount, originalPrice),
      paymentMethod: b.paymentMethod,
      bankName: b.bankName,
      sellerName: b.seller?.name ?? null,
      stage: b.stage,
    };
  }).sort((a, b) => compareUnitNumbers(a.unitNumber, b.unitNumber));

  return {
    projectId: project.id,
    projectName: project.name,
    constructionStatus: project.status,
    unitsTotal, listValue, plannedDiscount,
    plannedDiscountPct: pct1(plannedDiscount, listValue),
    netAfterDiscount,
    soldCount, reservedCount, availableCount,
    completionPct: unitsTotal > 0 ? Math.round(((soldCount + reservedCount) / unitsTotal) * 100) : 0,
    count: rows.length,
    bookedOriginal, totalSales, totalDiscount,
    actualDiscountPct: pct1(totalDiscount, bookedOriginal),
    avgDiscount: rows.length > 0 ? Math.round(totalDiscount / rows.length) : 0,
    totalCollected, totalRemaining,
    remainingBankFinance, remainingInstallments, remainingOther,
    rows,
  };
}

// ===== أداء الموظف العميق — المهمة ٤ =====
const HOUR = 3_600_000;
const DAY = 86_400_000;

export type DistItem = { key: string; count: number; pct: number };
export type StuckLead = { name: string; phone: string; reason: string };

export type EmployeeDeepAnalysis = {
  id: string;
  name: string;
  // حجم الشغل
  total: number;
  active: number;
  archived: number;
  byGoal: DistItem[];   // purchaseGoal: RESIDENCE/INVESTMENT/BOTH/NONE
  byMethod: DistItem[]; // purchaseMethod: CASH/BANK_FINANCE/CASH_AND_FINANCE/NONE
  // النشاط والاستجابة
  followups: number;
  visits: number;
  calls: number;
  avgResponseHours: number | null;     // متوسط تأخر أول تواصل
  fastestResponseHours: number | null;
  slowestResponseHours: number | null;
  // النتائج
  bookings: number;
  sales: number;       // SOLD/DELIVERED
  closed: number;      // مقفول-بيع
  conversion: number;  // %
  target: number;
  targetPct: number | null;
  // التشخيص
  lost: number;        // مهمل/خاسر
  lostPct: number;
  stuck: StuckLead[];  // محتاجين متابعة
  // مقارنة الفريق
  teamAvgConversion: number;
  teamAvgResponseHours: number | null;
};

function distFrom(items: { key: string }[], keys: string[]): DistItem[] {
  const total = items.length || 1;
  const map = new Map<string, number>();
  for (const it of items) map.set(it.key, (map.get(it.key) ?? 0) + 1);
  return keys.map((k) => {
    const count = map.get(k) ?? 0;
    return { key: k, count, pct: Math.round((count / total) * 100) };
  });
}

/** تحليل أداء موظف واحد بعمق — محصور في بياناته، مع مقارنة بمتوسط الفريق. */
export async function getEmployeeDeepAnalysis(userId: string, nowMs: number): Promise<EmployeeDeepAnalysis | null> {
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, targetDeals: true } });
  if (!me) return null;

  // م-٥: كان يجلب جدول Lead كاملًا (بأسماء وجوالات كل العملاء) لكل موظف يفتح «أدائي».
  // الآن: عملاء الموظف فقط، ومتوسطات الفريق عبر groupBy + جلب حقلَي وقتٍ للمُتواصَل معهم فقط.
  const [myLeads, fuByType, employees, myBookings] = await Promise.all([
    prisma.lead.findMany({
      where: { assignedToId: userId },
      select: { stage: true, isArchived: true, purchaseGoal: true, purchaseMethod: true, createdAt: true, firstContactAt: true, nextFollowup: true, lastContact: true, name: true, phone: true },
    }),
    prisma.followUp.groupBy({ by: ["createdBy", "type"], _count: { _all: true } }),
    prisma.user.findMany({ where: { role: "EMPLOYEE", active: true }, select: { id: true } }),
    prisma.booking.findMany({ where: { sellerId: userId }, select: { stage: true } }),
  ]);
  const total = myLeads.length;
  const archived = myLeads.filter((l) => l.isArchived).length;

  // التوزيعات
  const byGoal = distFrom(myLeads.map((l) => ({ key: l.purchaseGoal ?? "NONE" })), ["RESIDENCE", "INVESTMENT", "BOTH", "NONE"]);
  // #10: اشتقاق المفاتيح من الـenum نفسه — يشمل مدعوم/غير مدعوم تلقائياً ولا يسقط أي قيمة.
  const byMethod = distFrom(myLeads.map((l) => ({ key: l.purchaseMethod ?? "NONE" })), [...Object.keys(PurchaseMethod), "NONE"]);

  // النشاط
  const myFu = fuByType.filter((f) => f.createdBy === userId);
  const sumFu = (pred: (t: string) => boolean) => myFu.filter((f) => pred(f.type)).reduce((s, f) => s + f._count._all, 0);
  const followups = myFu.reduce((s, f) => s + f._count._all, 0);
  const visits = sumFu((t) => t === "VISIT_PROJECT" || t === "VISIT_OFFICE");
  const calls = sumFu((t) => t === "CALL");

  // سرعة الاستجابة (ساعات)
  const respHours = myLeads.filter((l) => l.firstContactAt).map((l) => (l.firstContactAt!.getTime() - l.createdAt.getTime()) / HOUR).filter((h) => h >= 0);
  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
  const avgResponseHours = avg(respHours);
  const fastestResponseHours = respHours.length ? Math.round(Math.min(...respHours) * 10) / 10 : null;
  const slowestResponseHours = respHours.length ? Math.round(Math.max(...respHours) * 10) / 10 : null;

  // النتائج
  const closed = myLeads.filter((l) => l.stage === "CLOSED_WON").length;
  const sales = myBookings.filter((b) => b.stage === "SOLD" || b.stage === "DELIVERED").length;
  const conversion = total > 0 ? Math.round((closed / total) * 100) : 0;
  const target = me.targetDeals;
  const targetPct = target > 0 ? Math.round((closed / target) * 100) : null;

  // التشخيص
  const lost = myLeads.filter((l) => l.stage === "CLOSED_LOST").length;
  const lostPct = total > 0 ? Math.round((lost / total) * 100) : 0;
  const stuck: StuckLead[] = myLeads
    .filter((l) => !l.isArchived && l.stage !== "CLOSED_WON" && l.stage !== "CLOSED_LOST")
    .map((l) => {
      if (l.nextFollowup && l.nextFollowup.getTime() < nowMs) return { name: l.name, phone: l.phone, reason: "فات موعد المتابعة" };
      if (l.lastContact && nowMs - l.lastContact.getTime() > 7 * DAY) return { name: l.name, phone: l.phone, reason: "ما فيه تواصل من أكثر من أسبوع" };
      if (!l.firstContactAt && nowMs - l.createdAt.getTime() > 3 * DAY) return { name: l.name, phone: l.phone, reason: "لم يُتواصل معه إطلاقًا" };
      return null;
    })
    .filter((x): x is StuckLead => x !== null)
    .slice(0, 50);

  // متوسطات الفريق — بلا جلب الجدول كاملًا: groupBy للمراحل + حقلا وقت للمُتواصَل معهم فقط.
  const empIdList = employees.map((e) => e.id);
  const [teamStageCounts, teamContacted] = await Promise.all([
    prisma.lead.groupBy({
      by: ["assignedToId", "stage"],
      where: { assignedToId: { in: empIdList } },
      _count: { _all: true },
    }),
    prisma.lead.findMany({
      where: { assignedToId: { in: empIdList }, firstContactAt: { not: null } },
      select: { createdAt: true, firstContactAt: true },
    }),
  ]);
  const teamTotals = new Map<string, { total: number; closed: number }>();
  for (const g of teamStageCounts) {
    const id = g.assignedToId as string;
    const t = teamTotals.get(id) ?? { total: 0, closed: 0 };
    t.total += g._count._all;
    if (g.stage === "CLOSED_WON") t.closed += g._count._all;
    teamTotals.set(id, t);
  }
  const convs = [...teamTotals.values()].filter((t) => t.total > 0).map((t) => (t.closed / t.total) * 100);
  const teamAvgConversion = convs.length ? Math.round(convs.reduce((a, b) => a + b, 0) / convs.length) : 0;
  const teamResp = teamContacted.map((l) => (l.firstContactAt!.getTime() - l.createdAt.getTime()) / HOUR).filter((h) => h >= 0);
  const teamAvgResponseHours = avg(teamResp);

  return {
    id: userId, name: me.name,
    total, active: total - archived, archived,
    byGoal, byMethod,
    followups, visits, calls,
    avgResponseHours, fastestResponseHours, slowestResponseHours,
    bookings: myBookings.length, sales, closed, conversion,
    target, targetPct,
    lost, lostPct, stuck,
    teamAvgConversion, teamAvgResponseHours,
  };
}

/** مقارنة شاملة لكل المشاريع — قسم هـ. */
export async function getAllProjectsFinance(): Promise<AllProjectsFinanceRow[]> {
  const [projects, units, bookings] = await Promise.all([
    prisma.project.findMany({ select: { id: true, name: true }, orderBy: { createdAt: "asc" } }),
    prisma.unit.findMany({ select: { projectId: true, price: true, status: true } }),
    prisma.booking.findMany({
      select: { price: true, finalPrice: true, discount: true, collectedAmount: true, stage: true, unit: { select: { projectId: true } } },
    }),
  ]);
  return projects.map((p) => {
    const pu = units.filter((u) => u.projectId === p.id);
    const pb = bookings.filter((b) => b.unit.projectId === p.id);
    const unitsTotal = pu.length;
    const sold = pu.filter((u) => u.status === "SOLD").length;
    const reserved = pu.filter((u) => u.status === "RESERVED").length;
    const bookedOriginal = pb.reduce((s, b) => s + dnum(b.price), 0);
    const totalDiscount = pb.reduce((s, b) => s + dnum(b.discount), 0);
    return {
      projectId: p.id,
      projectName: p.name,
      listValue: pu.reduce((s, u) => s + dnum(u.price), 0),
      unitsTotal, sold,
      completionPct: unitsTotal > 0 ? Math.round(((sold + reserved) / unitsTotal) * 100) : 0,
      totalSales: pb.reduce((s, b) => s + dnum(b.finalPrice), 0),
      totalDiscount,
      discountPct: pct1(totalDiscount, bookedOriginal),
      collected: pb.reduce((s, b) => s + bookingCollection(b.stage, dnum(b.finalPrice), dnum(b.collectedAmount)).collected, 0),
      remaining: pb.reduce((s, b) => s + bookingCollection(b.stage, dnum(b.finalPrice), dnum(b.collectedAmount)).remaining, 0),
    };
  });
}
