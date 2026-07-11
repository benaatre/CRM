import "server-only";

import type {
  Channel,
  LeadStage,
  Priority,
  UnitType,
  ActivityType,
  PurchaseMethod,
  PurchaseGoal,
  FirstContactStage,
  Role,
  Nationality,
  PaymentMethod,
  SaudiBank,
  CashPaymentType,
  BookingStage,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser, isManager } from "@/lib/auth-guards";
import { bookingCollection } from "@/lib/booking-finance";
import { floorLabels } from "@/lib/labels";
import { duplicateLeadIds } from "@/lib/phone-dupe";
import type { LeadSort } from "@/lib/lead-filters";
import type { Prisma } from "@prisma/client";

// ===== أنواع DTO (بيانات عادية قابلة للتمرير لمكوّنات العميل) =====
export type LeadRow = {
  id: string;
  name: string;
  phone: string;
  channel: Channel;
  stage: LeadStage;
  priority: Priority;
  attempts: number;
  budget: number | null;
  unitType: UnitType | null;
  createdAt: Date;
  lastContact: Date | null;
  nextFollowup: Date | null;
  assignedTo: { id: string; name: string } | null;
  projectName: string | null;
  activitiesCount: number;
  followUpsCount: number;
  purchaseMethod: PurchaseMethod | null;
  purchaseGoal: PurchaseGoal | null;
  firstContactStage: FirstContactStage | null;
  firstContactDate: Date | null;
  isArchived: boolean;
  // الحجز النشط (لعرض المحصّل/المتبقي في بطاقة الكانبان)
  booking: { collected: number; remaining: number } | null;
};

export type LeadActivity = {
  id: string;
  type: ActivityType;
  note: string | null;
  createdAt: Date;
  userName: string | null;
};

export type LeadDetail = LeadRow & {
  nationalId: string | null;
  notes: string | null;
  firstContactAt: Date | null;
  preferredDistrict: string | null;
  priceMin: number | null;
  priceMax: number | null;
  preferredAreas: string[];
  preferredProjects: string[];
  projectId: string | null;
  sourceId: string | null;
  sourceName: string | null;
  source: string | null; // نص المصدر الحرّ (للمستوردين بلا sourceId مهيكل)
  bookingId: string | null;
  bookings: BookingSummary[];
  activities: LeadActivity[];
};

export type BookingSummary = {
  id: string;
  createdAt: Date;
  unitNumber: string;
  floor: string | null;
  projectName: string | null;
  nationality: Nationality | null;
  nationalId: string | null;
  secondaryPhone: string | null;
  price: number;
  discount: number;
  finalPrice: number;
  deposit: number | null;
  paymentMethod: PaymentMethod;
  bankName: SaudiBank | null;
  cashPaymentType: CashPaymentType | null;
  installments: { amount: number; date: string }[] | null;
  installmentsCount: number | null;
  includesVAT: boolean;
  vatAmount: number | null;
  subjectToTax: boolean;
  taxAmount: number | null;
  discountExceeded: boolean;
  sellerName: string | null;
};

// ===== التحجيم حسب الدور (الصلاحية على الخادم) =====
/** الموظف يشوف عملاءه فقط؛ المدير/المالك يشوفون الكل. */
export async function scopeForUser() {
  const user = await requireUser();
  const where = isManager(user.role) ? {} : { assignedToId: user.id };
  return { user, where, manager: isManager(user.role) };
}

type LeadWithRels = {
  id: string;
  name: string;
  phone: string;
  channel: Channel;
  stage: LeadStage;
  priority: Priority;
  attempts: number;
  budget: { toNumber(): number } | null;
  unitType: UnitType | null;
  createdAt: Date;
  lastContact: Date | null;
  nextFollowup: Date | null;
  assignedTo: { id: string; name: string; role: Role } | null;
  project: { name: string } | null;
  _count: { activities: number; followUps: number };
  purchaseMethod: PurchaseMethod | null;
  purchaseGoal: PurchaseGoal | null;
  firstContactStage: FirstContactStage | null;
  firstContactDate: Date | null;
  isArchived: boolean;
  bookings?: { stage: BookingStage; finalPrice: { toNumber(): number }; collectedAmount: { toNumber(): number } }[];
};

function toRow(l: LeadWithRels): LeadRow {
  return {
    id: l.id,
    name: l.name,
    phone: l.phone,
    channel: l.channel,
    stage: l.stage,
    priority: l.priority,
    attempts: l.attempts,
    budget: l.budget ? l.budget.toNumber() : null,
    unitType: l.unitType,
    createdAt: l.createdAt,
    lastContact: l.lastContact,
    nextFollowup: l.nextFollowup,
    // المُسند لمالك يُعرض «غير موزّع» (المالك ليس موظف مبيعات).
    assignedTo: l.assignedTo && l.assignedTo.role !== "OWNER" ? { id: l.assignedTo.id, name: l.assignedTo.name } : null,
    projectName: l.project?.name ?? null,
    activitiesCount: l._count.activities,
    followUpsCount: l._count.followUps,
    purchaseMethod: l.purchaseMethod,
    purchaseGoal: l.purchaseGoal,
    firstContactStage: l.firstContactStage,
    firstContactDate: l.firstContactDate,
    isArchived: l.isArchived,
    booking: l.bookings && l.bookings[0]
      ? bookingCollection(l.bookings[0].stage, l.bookings[0].finalPrice.toNumber(), l.bookings[0].collectedAmount.toNumber())
      : null,
  };
}

const rowInclude = {
  assignedTo: { select: { id: true, name: true, role: true } },
  project: { select: { name: true } },
  _count: { select: { activities: true, followUps: true } },
  bookings: { select: { stage: true, finalPrice: true, collectedAmount: true }, orderBy: { createdAt: "desc" }, take: 1 },
} as const;

export type LeadTab = "working" | "archived" | "hidden" | "unassigned" | "all";

export type LeadFilters = {
  tab?: LeadTab;
  stages?: LeadStage[];
  assigneeIds?: string[];
  includeUnassigned?: boolean;
  q?: string;
  sort?: LeadSort;
};

// خريطة الترتيب → orderBy. «الأحدث نشاطًا» = lastContact (nulls آخرًا) مع createdAt كسر تعادل.
const LEAD_ORDER_BY: Record<LeadSort, Prisma.LeadOrderByWithRelationInput[]> = {
  activity: [{ lastContact: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
  newest: [{ createdAt: "desc" }],
  oldest: [{ createdAt: "asc" }],
  name: [{ name: "asc" }],
};

// مراحل تُستثنى من «جاري العمل» (محجوز/مقفول-بيع/خاسر).
const NON_WORKING_STAGES: LeadStage[] = ["RESERVED", "CLOSED_WON", "CLOSED_LOST"];
// مراحل تبويب «تم الحجز / الشراء».
const BOOKED_STAGES: LeadStage[] = ["RESERVED", "CLOSED_WON"];

/** معرّفات المالكين — العميل المُسند لمالك يُعامَل كـ«غير موزّع». */
export async function getOwnerIds(): Promise<string[]> {
  const owners = await prisma.user.findMany({ where: { role: "OWNER" }, select: { id: true } });
  return owners.map((o) => o.id);
}

/**
 * شرط التبويب الأساسي (قبل فلاتر المستخدم).
 * ownerIds: العملاء المُسندون لمالك يُحتسبون «غير موزّعين» (لا في «جاري العمل»).
 */
function tabWhere(tab: LeadTab, ownerIds: string[]): Record<string, unknown> | null {
  switch (tab) {
    case "unassigned": // غير موزّعين: بلا موظف (أو مُسند لمالك) + مرحلة «جديد» فقط + غير مؤرشف
      return {
        OR: [{ assignedToId: null }, ...(ownerIds.length ? [{ assignedToId: { in: ownerIds } }] : [])],
        stage: "NEW",
        isArchived: false,
      };
    case "archived": // تم الحجز/الشراء: المرحلة فقط (محجوز أو مقفول-بيع) — لا يعتمد isArchived.
      return { stage: { in: BOOKED_STAGES } };
    case "hidden": // مؤرشف: مخفيّ يدويًا وغير محجوز/مقفول-بيع (يُصلَح فرديًا بـ«إلغاء الأرشفة»).
      return { isArchived: true, stage: { notIn: BOOKED_STAGES } };
    case "working": // جاري العمل: موزّع على موظف (ليس مالكًا) + غير مؤرشف + ليس محجوزًا/مقفولًا
      return {
        assignedToId: { not: null, ...(ownerIds.length ? { notIn: ownerIds } : {}) },
        isArchived: false,
        stage: { notIn: NON_WORKING_STAGES },
      };
    default: // all (الكانبان): بلا قيد تبويب
      return null;
  }
}

/**
 * العملاء (مُحجّمين) — مصدر بيانات موحّد للجدول والكانبان مع فلترة server-side.
 * الموظف يُقصر دائمًا على عملائه؛ فلتر الموظفين يُطبَّق للمدير فقط.
 * tab: working = جاري العمل · archived = تم الحجز/الشراء · unassigned = غير موزّعين · all = الكل (للكانبان).
 */
export async function getLeads(filters: LeadFilters = {}): Promise<LeadRow[]> {
  const { where, manager } = await scopeForUser();
  const { tab = "working", stages, assigneeIds, includeUnassigned, q, sort = "activity" } = filters;

  const ownerIds = await getOwnerIds();
  const and: Record<string, unknown>[] = [];
  const base = tabWhere(tab, ownerIds);
  if (base) and.push(base);

  if (stages && stages.length) and.push({ stage: { in: stages } });
  // فلتر الموظفين للمدير: خيار «غير موزّع» يُحترم في الكانبان فقط.
  if (manager) {
    if (tab === "all" && ((assigneeIds && assigneeIds.length) || includeUnassigned)) {
      const or: Record<string, unknown>[] = [];
      if (assigneeIds && assigneeIds.length) or.push({ assignedToId: { in: assigneeIds } });
      if (includeUnassigned) or.push({ assignedToId: null });
      and.push({ OR: or });
    } else if (tab !== "all" && assigneeIds && assigneeIds.length) {
      and.push({ assignedToId: { in: assigneeIds } });
    }
  }
  if (q && q.trim()) {
    const term = q.trim();
    and.push({ OR: [{ name: { contains: term } }, { phone: { contains: term } }] });
  }
  // «غير موزّعين» يستثني المكررين — يُوزّعون حصريًا من «العملاء المكررون».
  if (tab === "unassigned") {
    const dupIds = await duplicateLeadIds();
    if (dupIds.size) and.push({ id: { notIn: [...dupIds] } });
  }

  const leads = await prisma.lead.findMany({
    where: { ...where, ...(and.length ? { AND: and } : {}) },
    orderBy: LEAD_ORDER_BY[sort],
    include: rowInclude,
    take: 500, // سقف مؤقت لحين الترقيم server-side (#14)
  });
  return leads.map(toRow);
}

/** أعداد التبويبات (جاري العمل / تم الحجز / مؤرشف / غير موزّع) ضمن صلاحية المستخدم — لشارات التبويبات. */
export async function getLeadCounts(): Promise<{ working: number; archived: number; hidden: number; unassigned: number }> {
  const { where } = await scopeForUser();
  const ownerIds = await getOwnerIds();
  const dupIds = await duplicateLeadIds(); // لاستثناء المكررين من عدّاد «غير موزّعين» فقط
  const unassignedWhere = {
    ...where,
    ...tabWhere("unassigned", ownerIds),
    ...(dupIds.size ? { id: { notIn: [...dupIds] } } : {}),
  };
  const [working, archived, hidden, unassigned] = await Promise.all([
    prisma.lead.count({ where: { ...where, ...tabWhere("working", ownerIds) } }),
    prisma.lead.count({ where: { ...where, ...tabWhere("archived", ownerIds) } }),
    prisma.lead.count({ where: { ...where, ...tabWhere("hidden", ownerIds) } }),
    prisma.lead.count({ where: unassignedWhere }),
  ]);
  return { working, archived, hidden, unassigned };
}

/** العملاء مجمّعين حسب المرحلة — للكانبان. */
export async function getPipeline(): Promise<LeadRow[]> {
  const { where } = await scopeForUser();
  const leads = await prisma.lead.findMany({
    where,
    orderBy: [{ priority: "asc" }, { updatedAt: "desc" }],
    include: rowInclude,
    take: 500, // سقف مؤقت لحين ترقيم الكانبان لكل عمود (#14)
  });
  return leads.map(toRow);
}

/** تفاصيل عميل واحد + سجل المتابعات — مع تحقق الصلاحية. يرجّع null إن لم يُسمح. */
export async function getLeadDetail(id: string): Promise<LeadDetail | null> {
  const { where } = await scopeForUser();
  const lead = await prisma.lead.findFirst({
    where: { id, ...where },
    include: {
      ...rowInclude,
      leadSource: { select: { name: true } },
      bookings: {
        orderBy: { createdAt: "desc" },
        include: {
          unit: { select: { number: true, floor: true, floorLevel: true, project: { select: { name: true } } } },
          seller: { select: { name: true } },
        },
      },
      activities: {
        orderBy: { createdAt: "desc" },
        include: { user: { select: { name: true } } },
      },
    },
  });
  if (!lead) return null;
  return {
    ...toRow(lead),
    nationalId: lead.nationalId,
    notes: lead.notes,
    firstContactAt: lead.firstContactAt,
    preferredDistrict: lead.preferredDistrict,
    priceMin: lead.priceMin,
    priceMax: lead.priceMax,
    preferredAreas: lead.preferredAreas,
    preferredProjects: lead.preferredProjects,
    projectId: lead.projectId,
    sourceId: lead.sourceId,
    sourceName: lead.leadSource?.name ?? null,
    source: lead.source,
    bookingId: lead.bookings[0]?.id ?? null,
    bookings: lead.bookings.map((b) => ({
      id: b.id,
      createdAt: b.createdAt,
      unitNumber: b.unit?.number ?? "—",
      floor: b.unit?.floorLevel ? floorLabels[b.unit.floorLevel] : (b.unit?.floor ?? null),
      projectName: b.unit?.project?.name ?? null,
      nationality: b.nationality,
      nationalId: b.nationalId,
      secondaryPhone: b.secondaryPhone,
      price: b.price.toNumber(),
      discount: b.discount.toNumber(),
      finalPrice: b.finalPrice.toNumber(),
      deposit: b.deposit ? b.deposit.toNumber() : null,
      paymentMethod: b.paymentMethod,
      bankName: b.bankName,
      cashPaymentType: b.cashPaymentType,
      installments: (b.installments as { amount: number; date: string }[] | null) ?? null,
      installmentsCount: b.installmentsCount,
      includesVAT: b.includesVAT,
      vatAmount: b.vatAmount ? b.vatAmount.toNumber() : null,
      subjectToTax: b.subjectToTax,
      taxAmount: b.taxAmount ? b.taxAmount.toNumber() : null,
      discountExceeded: b.discountExceeded,
      sellerName: b.seller?.name ?? null,
    })),
    activities: lead.activities.map((a) => ({
      id: a.id,
      type: a.type,
      note: a.note,
      createdAt: a.createdAt,
      userName: a.user?.name ?? null,
    })),
  };
}

/**
 * عدد «لم يتم التواصل» = NEW + مُسند لموظف فعلي (ليس مالكًا) + غير مؤرشف.
 * assigneeIds (اختياري): يقصر العدّ على موظفين محدّدين (للمدير).
 */
export async function getNotContactedCount(assigneeIds?: string[]): Promise<number> {
  const { where } = await scopeForUser();
  const ownerIds = await getOwnerIds();
  const assignee = assigneeIds && assigneeIds.length
    ? { in: assigneeIds }
    : { not: null, ...(ownerIds.length ? { notIn: ownerIds } : {}) };
  return prisma.lead.count({ where: { ...where, stage: "NEW", isArchived: false, assignedToId: assignee } });
}

/** قائمة الموظفين (لفلتر المدير وإعادة الإسناد). */
export async function getEmployees() {
  return prisma.user.findMany({
    where: { role: "EMPLOYEE", active: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}
