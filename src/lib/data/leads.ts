import "server-only";

import type {
  Channel,
  LeadStage,
  Priority,
  UnitType,
  ActivityType,
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
  };
}

const rowInclude = {
  assignedTo: { select: { id: true, name: true } },
  project: { select: { name: true } },
  _count: { select: { activities: true } },
} as const;

/** كل العملاء (مُحجّمين) — للجدول. */
export async function getLeads(): Promise<LeadRow[]> {
  const { where } = await scopeForUser();
  const leads = await prisma.lead.findMany({
    where,
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
