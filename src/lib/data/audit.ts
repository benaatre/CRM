import "server-only";

import type { Prisma } from "@prisma/client";
import { FollowUpType } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export type AuditEntry = {
  id: string;
  action: string;
  summary: string;
  userId: string | null;
  userName: string | null;
  createdAt: Date;
};

/** فئات النوع الجديدة — كل فئة = مجموعة actions (طبقة عرض فوق المفاتيح الخام). */
export type AuditCategory = "dist" | "pull" | "fu" | "booking" | "archive" | "security";

export const AUDIT_CATEGORIES: { value: AuditCategory; label: string }[] = [
  { value: "dist", label: "توزيع" },
  { value: "pull", label: "سحب" },
  { value: "fu", label: "متابعات" },
  { value: "booking", label: "حجوزات" },
  { value: "archive", label: "أرشفة" },
  { value: "security", label: "أمان" },
];

// خريطة الفئة → شرط Prisma على action (in/startsWith) — مصدر واحد للفلترة.
const CATEGORY_WHERE: Record<AuditCategory, Prisma.AuditLogWhereInput> = {
  dist: {
    action: {
      in: [
        "lead.created", "lead.reassigned", "lead.transferred", "lead.distributed",
        "lead.recovered", "lead.no_response.distributed", "lead.no_response.autoDistributed",
      ],
    },
  },
  pull: {
    action: {
      in: [
        "lead.no_response.manualPulled", "lead.no_response.autoPulled",
        "lead.no_response.manualPullBatch", "lead.no_response.autoPullBatch",
        "lead.no_response.undoPull", "lead.no_response.undoPullBatch",
        "lead.no_response.warned", "lead.no_response.warnedAll",
      ],
    },
  },
  fu: { action: { in: ["followup.added", "lead.firstStage", "lead.stage"] } },
  booking: { action: { startsWith: "booking." } },
  archive: { action: { in: ["lead.archived", "lead.unarchived"] } },
  security: { action: { in: ["REVEAL_HISTORY", "HIDE_HISTORY", "user.securityChange", "lead.deleted"] } },
};

export type AuditFilters = {
  /** فئة النوع الجديدة (توزيع/سحب/متابعات/حجوزات/أرشفة/أمان). */
  category?: AuditCategory;
  /** معرّف المستخدم الفاعل. */
  userId?: string;
  /** من تاريخ (شامل). */
  from?: Date;
  /** إلى تاريخ (شامل). */
  to?: Date;
  limit?: number;
};

export async function getAuditLog(filters: AuditFilters = {}): Promise<AuditEntry[]> {
  const { category, userId, from, to, limit = 150 } = filters;

  const where: Prisma.AuditLogWhereInput = { ...(category ? CATEGORY_WHERE[category] : {}) };
  if (userId) where.userId = userId;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = from;
    if (to) where.createdAt.lte = to;
  }

  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit, // سقف الصفحة — لا نجلب الجدول كاملًا
    include: { user: { select: { name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    summary: r.summary,
    userId: r.userId,
    userName: r.user?.name ?? null,
    createdAt: r.createdAt,
  }));
}

// ===================== حلّ الأسماء (IDs → أسماء) =====================

// cuid (معرّفات Prisma): تبدأ بـ c ثم ٢٤ خانة [a-z0-9] — نلتقطها من نصوص summary.
const CUID_RE = /\bc[a-z0-9]{24}\b/g;

export type AuditNameMaps = {
  /** معرّف عميل → اسمه (غير الموجود = محذوف — لا يظهر في الخريطة). */
  leadNames: Record<string, string>;
  /** معرّف مستخدم → اسمه. */
  userNames: Record<string, string>;
};

/**
 * يجمع كل الـIDs الظاهرة في سجلات الصفحة الحالية (من نص summary) ويحلّها بأسمائها —
 * استعلامان مجمّعان فقط (عملاء + مستخدمون)، لا N+1. الغائب من الخريطتين = عميل محذوف.
 * extraLeadIds: معرّفات إضافية تُحل معها (مثل عملاء الاستدلال للسجلات القديمة).
 */
export async function resolveAuditNames(entries: { summary: string }[], extraLeadIds: string[] = []): Promise<AuditNameMaps> {
  const ids = new Set<string>(extraLeadIds);
  for (const e of entries) {
    for (const m of e.summary.matchAll(CUID_RE)) ids.add(m[0]);
  }
  if (ids.size === 0) return { leadNames: {}, userNames: {} };
  const list = [...ids];
  const [leads, users] = await Promise.all([
    prisma.lead.findMany({ where: { id: { in: list } }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { id: { in: list } }, select: { id: true, name: true } }),
  ]);
  return {
    leadNames: Object.fromEntries(leads.map((l) => [l.id, l.name])),
    userNames: Object.fromEntries(users.map((u) => [u.id, u.name])),
  };
}

// ===================== استدلال عميل سجلات المتابعة القديمة =====================

// أفعال المتابعة/المرحلة — سجلاتها القديمة كُتبت بلا معرّف عميل في النص.
export const FU_AUDIT_ACTIONS = new Set(["followup.added", "lead.firstStage", "lead.stage"]);
// نسخة غير-global للفحص (الـglobal stateful مع .test).
const CUID_TEST = /\bc[a-z0-9]{24}\b/;

/**
 * للسجلات القديمة بلا معرّف: نستدل بالعميل من جدول FollowUp — متابعة بنفس الفاعل
 * وتوقيت ضمن ±٦٠ ثانية من السجل (الأقرب زمنيًا يفوز). استعلام مجمّع واحد للصفحة — لا N+1.
 * يرجّع: معرّف السجل → معرّف العميل المستدل.
 */
export async function inferFollowupLeads(entries: AuditEntry[]): Promise<Record<string, string>> {
  const targets = entries.filter(
    (e) => FU_AUDIT_ACTIONS.has(e.action) && e.userId && !CUID_TEST.test(e.summary),
  );
  if (targets.length === 0) return {};
  const times = targets.map((e) => e.createdAt.getTime());
  const fus = await prisma.followUp.findMany({
    where: {
      createdBy: { in: [...new Set(targets.map((e) => e.userId as string))] },
      createdAt: { gte: new Date(Math.min(...times) - 60_000), lte: new Date(Math.max(...times) + 60_000) },
    },
    select: { leadId: true, createdBy: true, createdAt: true },
  });
  const out: Record<string, string> = {};
  for (const e of targets) {
    let best: { leadId: string; dt: number } | null = null;
    for (const f of fus) {
      if (f.createdBy !== e.userId) continue;
      const dt = Math.abs(f.createdAt.getTime() - e.createdAt.getTime());
      if (dt <= 60_000 && (!best || dt < best.dt)) best = { leadId: f.leadId, dt };
    }
    if (best) out[e.id] = best.leadId;
  }
  return out;
}

// ===================== عدّادات الموظفين ضمن الفترة =====================

export type AuditEmployeeStat = {
  id: string;
  name: string;
  calls: number;      // اتصالات مسجّلة (متابعات CALL)
  followups: number;  // كل المتابعات
  visits: number;     // زيارات (مشروع/مكتب)
  bookings: number;   // حجوزات أنشأها
  received: number;   // عملاء استقبلهم (Reassignment→toUserId)
  pulled: number;     // عملاء سُحبوا منه (Reassignment fromUserId→الحوض)
};

const VISIT_TYPES: FollowUpType[] = [FollowUpType.VISIT_PROJECT, FollowUpType.VISIT_OFFICE];

/**
 * عدّادات نشاط الموظفين ضمن الفترة — من الجداول الأصلية (FollowUp/Booking/Reassignment)
 * لا من نصوص السجل: استعلامات groupBy مجمّعة فقط (لا N+1). الترتيب: الأنشط أولًا.
 */
export async function getAuditEmployeeStats(from?: Date, to?: Date): Promise<AuditEmployeeStat[]> {
  const range = from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } : undefined;
  const created = range ? { createdAt: range } : {};

  const [employees, fuByType, bookings, received, pulled] = await Promise.all([
    prisma.user.findMany({ where: { role: "EMPLOYEE", active: true }, select: { id: true, name: true } }),
    prisma.followUp.groupBy({ by: ["createdBy", "type"], where: { ...created }, _count: { _all: true } }),
    prisma.booking.groupBy({ by: ["sellerId"], where: { ...created }, _count: { _all: true } }),
    prisma.reassignment.groupBy({ by: ["toUserId"], where: { ...created, toUserId: { not: null } }, _count: { _all: true } }),
    prisma.reassignment.groupBy({ by: ["fromUserId"], where: { ...created, toUserId: null, fromUserId: { not: null } }, _count: { _all: true } }),
  ]);

  const bookingsBy = new Map(bookings.map((b) => [b.sellerId, b._count._all]));
  const receivedBy = new Map(received.map((r) => [r.toUserId as string, r._count._all]));
  const pulledBy = new Map(pulled.map((r) => [r.fromUserId as string, r._count._all]));

  const rows = employees.map((e) => {
    const mine = fuByType.filter((f) => f.createdBy === e.id);
    const followups = mine.reduce((s, f) => s + f._count._all, 0);
    const calls = mine.filter((f) => f.type === FollowUpType.CALL).reduce((s, f) => s + f._count._all, 0);
    const visits = mine.filter((f) => VISIT_TYPES.includes(f.type)).reduce((s, f) => s + f._count._all, 0);
    return {
      id: e.id,
      name: e.name,
      calls,
      followups,
      visits,
      bookings: bookingsBy.get(e.id) ?? 0,
      received: receivedBy.get(e.id) ?? 0,
      pulled: pulledBy.get(e.id) ?? 0,
    };
  });

  // الأنشط أولًا (مجموع اللمسات)، ونخفي من نشاطه صفر بالكامل؟ لا — نعرضه (شفافية).
  return rows.sort((a, b) => (b.followups + b.bookings + b.received) - (a.followups + a.bookings + a.received));
}

export type AuditActor = { id: string; name: string };

/**
 * كل مستخدم له سطور فعلية في السجل (مالك/مدير/موظف) — لفلتر «مَن».
 * distinct userId من AuditLog ثم جلب الأسماء.
 */
export async function getAuditActors(): Promise<AuditActor[]> {
  const rows = await prisma.auditLog.findMany({
    where: { userId: { not: null } },
    distinct: ["userId"],
    select: { userId: true },
  });
  const ids = rows.map((r) => r.userId).filter((v): v is string => !!v);
  if (ids.length === 0) return [];

  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return users.map((u) => ({ id: u.id, name: u.name }));
}
