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
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser, isManager } from "@/lib/auth-guards";

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
  purchaseMethod: PurchaseMethod | null;
  purchaseGoal: PurchaseGoal | null;
  firstContactStage: FirstContactStage | null;
  firstContactDate: Date | null;
  isArchived: boolean;
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
  bookingId: string | null;
  activities: LeadActivity[];
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
  assignedTo: { id: string; name: string } | null;
  project: { name: string } | null;
  _count: { activities: number };
  purchaseMethod: PurchaseMethod | null;
  purchaseGoal: PurchaseGoal | null;
  firstContactStage: FirstContactStage | null;
  firstContactDate: Date | null;
  isArchived: boolean;
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
    assignedTo: l.assignedTo,
    projectName: l.project?.name ?? null,
    activitiesCount: l._count.activities,
    purchaseMethod: l.purchaseMethod,
    purchaseGoal: l.purchaseGoal,
    firstContactStage: l.firstContactStage,
    firstContactDate: l.firstContactDate,
    isArchived: l.isArchived,
  };
}

const rowInclude = {
  assignedTo: { select: { id: true, name: true } },
  project: { select: { name: true } },
  _count: { select: { activities: true } },
} as const;

/** كل العملاء (مُحجّمين) — للجدول. archived=false: جاري العمل · true: تم الحجز/الشراء. */
export async function getLeads(archived = false): Promise<LeadRow[]> {
  const { where } = await scopeForUser();
  const leads = await prisma.lead.findMany({
    where: { ...where, isArchived: archived },
    orderBy: [{ createdAt: "desc" }],
    include: rowInclude,
  });
  return leads.map(toRow);
}

/** العملاء مجمّعين حسب المرحلة — للكانبان. */
export async function getPipeline(): Promise<LeadRow[]> {
  const { where } = await scopeForUser();
  const leads = await prisma.lead.findMany({
    where,
    orderBy: [{ priority: "asc" }, { updatedAt: "desc" }],
    include: rowInclude,
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
      booking: { select: { id: true } },
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
    bookingId: lead.booking?.id ?? null,
    activities: lead.activities.map((a) => ({
      id: a.id,
      type: a.type,
      note: a.note,
      createdAt: a.createdAt,
      userName: a.user?.name ?? null,
    })),
  };
}

/** قائمة الموظفين (لفلتر المدير وإعادة الإسناد). */
export async function getEmployees() {
  return prisma.user.findMany({
    where: { role: "EMPLOYEE", active: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}
