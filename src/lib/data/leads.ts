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
  FollowUpResult,
  FollowUpType,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser, isManager } from "@/lib/auth-guards";
import { daysWaiting } from "@/lib/assignment";
import { hiddenHistoryIds, isFreshDistributed, latestRevealAction, REVEAL_HISTORY_ACTION } from "@/lib/visibility";
import { getNoResponseConfig, noAnswerStats, noResponseBaseline, noResponseState, type NoResponseConfig } from "@/lib/no-response-escalation";
import { MAX_REASSIGNS } from "@/lib/sweep-eligibility";
import { NO_RESPONSE_STAGES } from "@/lib/auto-distribute";
import { bookingCollection } from "@/lib/booking-finance";
import { floorLabels } from "@/lib/labels";
import { duplicateLeadIds } from "@/lib/phone-dupe";
import { INTEREST_UMBRELLA, type LeadSort } from "@/lib/lead-filters";
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
  // تاريخ دخول العميل النظام — للمالك/المدير فقط؛ يُحجب (null) عن الموظف (server-side).
  createdAt: Date | null;
  // لحظة استلام الموظف الحالي للعميل — يبدأ منها عدّاد الانتظار.
  assignedAt: Date | null;
  // أيام الانتظار منذ الاستلام/آخر تواصل (محسوبة على الخادم — تجنّبًا لتسريب createdAt للموظف).
  daysWaiting: number;
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
  // عميل محوّل يحتاج اهتمام: أُعيد توجيهه (reassignCount>0) وما فيه متابعة بعد آخر إسناد (نجمة ⭐).
  isTransferred: boolean;
  // §٦: محوّل بسبب استنفاد المحاولات (آخر سحب reason=no_response_exhausted) → أيقونة حمراء بدل النجمة.
  transferredExhausted: boolean;
  /**
   * الخطوة ٤: عدّاد السحب الحي — يُحسب على الخادم من نفس مصدر المحرّك
   * (noAnswerStats + noResponseBaseline + noResponseState) ويُمرَّر أوقاتًا (ms)
   * فتحسب الحلقة نسبتها محليًا بلا أي استعلام أو polling إضافي.
   * للموظف EMPLOYEE فقط — دائمًا null للمالك/المدير وخارج نظام «لم يتم الرد».
   */
  pull: { state: "grace" | "warning" | "overdue"; baselineMs: number; deadlineMs: number; noAnswerCount: number } | null;
  /** عدد متابعات «لم يستجب» (NO_ANSWER_INTERESTED) — لشارة «لم يستجب ×N» (مدير/مالك). */
  unresponsiveCount: number;
  /** مسوّق (آخر متابعاته NOT_INTERESTED_MARKETER) — وسم واضح ويُستثنى من الإحياء. */
  marketer: boolean;
};

export type LeadActivity = {
  id: string;
  type: ActivityType;
  note: string | null;
  createdAt: Date;
  userName: string | null;
};

export type LeadDetail = LeadRow & {
  // الخطوة ٣ج: وُزّع «كعميل جديد» (آخر إسناد _fresh) — يفعّل زر «كشف السجل» للمالك.
  freshDistributed: boolean;
  // حالة الكشف الحالية (آخر قرار REVEAL/HIDE للمالك) — لعرض حالة الزر بوضوح.
  historyRevealed: boolean;
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
  price: number | null;
  discount: number | null;
  finalPrice: number | null;
  deposit: number | null;
  paymentMethod: PaymentMethod | null;
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
  reassignCount: number;
  assignedAt: Date | null;
  manualAssignedAt: Date | null;
  followUps?: { createdAt: Date; result: FollowUpResult }[];
  reassignments?: { reason: string; toUserId: string | null }[];
  bookings?: { stage: BookingStage; finalPrice: { toNumber(): number }; collectedAmount: { toNumber(): number }; sellerId: string | null }[];
};

/** آخر إسناد فعلي (toUserId ≠ null) — سببه يحمل لاحقة قرار التوزيع (_fresh/_full). */
export function lastAssignReasonOf(reassignments?: { reason: string; toUserId: string | null }[]): string | null {
  return reassignments?.find((r) => r.toUserId !== null)?.reason ?? null;
}

type RowCtx = { userId: string; manager: boolean; hidden: Set<string>; nrConfig: NoResponseConfig; now: Date };

function toRow(l: LeadWithRels, ctx: RowCtx): LeadRow {
  // محوّل: أُعيد توجيهه (reassignCount>0) ولم تُسجَّل متابعة بعد آخر إسناد (تختفي العلامة أول متابعة).
  const latestFuAt = l.followUps?.[0]?.createdAt ?? null;
  const transferred = l.reassignCount > 0 && l.assignedAt != null && (latestFuAt == null || latestFuAt <= l.assignedAt);
  // آخر سحب (toUserId=null) من آخر ٥ سجلات — يكفي عمليًا (سحب/توزيع يتناوبان).
  const lastPullReason = l.reassignments?.find((r) => r.toUserId === null)?.reason ?? "";
  // الخطوة ٣ب: عميل موزَّع «كجديد» ومخفي سجله عن الموظف — العدّاد لما بعد الإسناد فقط،
  // وأول تواصل/المرحلة الأولى لا يُرسلان. العلامة ⭐/🔴 (isTransferred) تبقى كما هي.
  const hidden = ctx.hidden.has(l.id);
  const postAssignFuCount = l.assignedAt
    ? (l.followUps ?? []).filter((f) => f.createdAt > l.assignedAt!).length
    : 0;
  // الخطوة ٤: عدّاد السحب الحي — نفس أهلية محرّك «لم يتم الرد» حرفيًا (مراحل NEW/ATTEMPTED،
  // بلا حصانة يدوية، دون سقف الدورات) ونفس دواله النقية. للموظف فقط.
  const pull = ((): LeadRow["pull"] => {
    if (ctx.manager) return null;
    if (l.isArchived || l.manualAssignedAt != null || l.assignedAt == null) return null;
    if (!(NO_RESPONSE_STAGES as readonly string[]).includes(l.stage)) return null;
    if (l.reassignCount >= MAX_REASSIGNS) return null;
    const stats = noAnswerStats(l.followUps ?? [], l.assignedAt);
    if (!stats.included) return null; // رد العميل → خارج النظام
    const baseline = noResponseBaseline(l.assignedAt, stats.lastNoAnswerAt, ctx.nrConfig.activationDate);
    const { state, pullDay } = noResponseState(stats.noAnswerCount, baseline, ctx.now, ctx.nrConfig);
    if (state === "out" || pullDay === null || baseline === null) return null;
    return {
      state,
      baselineMs: baseline.getTime(),
      deadlineMs: baseline.getTime() + pullDay * 86_400_000,
      noAnswerCount: stats.noAnswerCount,
    };
  })();
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
    // حجب تاريخ دخول النظام عن الموظف (يراه OWNER/ADMIN فقط) — نفس نمط حجب مبالغ الحجوزات.
    createdAt: ctx.manager ? l.createdAt : null,
    assignedAt: l.assignedAt,
    // يُحسب على الخادم بالتواريخ الحقيقية، فلا يحتاج الموظف createdAt إطلاقًا.
    daysWaiting: daysWaiting({ assignedAt: l.assignedAt, createdAt: l.createdAt, lastContact: l.lastContact }),
    lastContact: l.lastContact,
    nextFollowup: l.nextFollowup,
    // المُسند لمالك يُعرض «غير موزّع» (المالك ليس موظف مبيعات).
    assignedTo: l.assignedTo && l.assignedTo.role !== "OWNER" ? { id: l.assignedTo.id, name: l.assignedTo.name } : null,
    projectName: l.project?.name ?? null,
    activitiesCount: l._count.activities,
    followUpsCount: hidden ? postAssignFuCount : l._count.followUps,
    purchaseMethod: l.purchaseMethod,
    purchaseGoal: l.purchaseGoal,
    firstContactStage: hidden ? null : l.firstContactStage,
    firstContactDate: hidden ? null : l.firstContactDate,
    isArchived: l.isArchived,
    // المحصّل/المتبقّي يظهر فقط للبائع أو المدير — وإلا يُحجب (null).
    booking: (() => {
      const bk = l.bookings?.[0];
      if (!bk) return null;
      const mine = ctx.manager || bk.sellerId === ctx.userId;
      return mine ? bookingCollection(bk.stage, bk.finalPrice.toNumber(), bk.collectedAmount.toNumber()) : null;
    })(),
    // نجمة العميل المحوّل: أُعيد توجيهه ولم يُسجّل أي متابعة بعد آخر إسناد (تختفي أول متابعة).
    isTransferred: transferred,
    // §٦: أيقونة حمراء لو آخر سحب كان بسبب استنفاد المحاولات (وإلا نجمة ذهبية للتقصير).
    transferredExhausted: transferred && lastPullReason.startsWith("no_response_exhausted"),
    pull,
    // من نافذة أحدث ٢٠ متابعة (المجلوبة أصلًا) — كافية عمليًا لكلا العدّادين.
    unresponsiveCount: (l.followUps ?? []).filter((f) => f.result === "NO_ANSWER_INTERESTED").length,
    marketer: (l.followUps ?? []).some((f) => f.result === "NOT_INTERESTED_MARKETER"),
  };
}

/** سياق الصف الكامل (قرار الإخفاء + إعداد «لم يتم الرد») — يُبنى مرة لكل طلب. */
async function buildRowCtx(userId: string, manager: boolean, role: Role, leads: LeadWithRels[]): Promise<RowCtx> {
  const hidden = await hiddenHistoryIds(
    prisma, role,
    leads.map((l) => ({ id: l.id, lastAssignReason: lastAssignReasonOf(l.reassignments) })),
  );
  return { userId, manager, hidden, nrConfig: getNoResponseConfig(), now: new Date() };
}

const rowInclude = {
  assignedTo: { select: { id: true, name: true, role: true } },
  project: { select: { name: true } },
  _count: { select: { activities: true, followUps: true } },
  // أحدث ٢٠ متابعة (وقت + نتيجة) — لعدّاد ما بعد الإسناد (الإخفاء) وإحصاء «لم يرد» (العدّاد الحي).
  // نفس الاستعلام الواحد (بلا استعلامات إضافية)؛ >٢٠ متابعة بعد إسنادٍ واحد غير واقعي عمليًا.
  followUps: { orderBy: { createdAt: "desc" }, take: 20, select: { createdAt: true, result: true } },
  // آخر ٥ سجلات تحويل (بلا فلتر) — منها آخر سحب (toUserId=null → نجمة/أيقونة §٦)
  // وآخر إسناد فعلي (toUserId≠null → لاحقة _fresh لقرار الإخفاء).
  reassignments: { orderBy: { createdAt: "desc" }, take: 5, select: { reason: true, toUserId: true } },
  bookings: { select: { stage: true, finalPrice: true, collectedAmount: true, sellerId: true }, orderBy: { createdAt: "desc" }, take: 1 },
} as const;

export type LeadTab = "working" | "archived" | "hidden" | "unassigned" | "all";

export type LeadFilters = {
  tab?: LeadTab;
  stages?: LeadStage[];
  assigneeIds?: string[];
  includeUnassigned?: boolean;
  /** فلتر «لم يستجب»: مهتمون تراكمت عليهم متابعات NO_ANSWER_INTERESTED — للمالك/المدير فقط. */
  unresponsive?: boolean;
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
  const { user, where, manager } = await scopeForUser();
  const { tab = "working", stages, assigneeIds, includeUnassigned, unresponsive, q, sort = "activity" } = filters;

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
  // فلتر «لم يستجب» (مدير/مالك فقط — يُتجاهل للموظف): مهتمون عليهم متابعة NO_ANSWER_INTERESTED واحدة فأكثر.
  if (manager && unresponsive) {
    and.push({ stage: { in: INTEREST_UMBRELLA }, followUps: { some: { result: "NO_ANSWER_INTERESTED" } } });
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
  // الخطوة ٣ب: قرار الإخفاء للدفعة كاملة (استعلام تدقيق واحد) — للموظف فقط.
  const ctx = await buildRowCtx(user.id, manager, user.role, leads);
  return leads.map((l) => toRow(l, ctx));
}

/** أعداد التبويبات (جاري العمل / تم الحجز / مؤرشف / غير موزّع) ضمن صلاحية المستخدم — لشارات التبويبات. */
export async function getLeadCounts(): Promise<{ working: number; archived: number; hidden: number; unassigned: number }> {
  const { where } = await scopeForUser();
  const ownerIds = await getOwnerIds();
  const dupIds = await duplicateLeadIds(); // لاستثناء المكررين من عدّاد «غير موزّعين» فقط
  // دمج التحجيم مع شرط التبويب تحت AND — لا spread يطغى على assignedToId (كان يمسح تحجيم الموظف).
  const unassignedWhere = {
    AND: [
      where,
      tabWhere("unassigned", ownerIds) ?? {},
      ...(dupIds.size ? [{ id: { notIn: [...dupIds] } }] : []),
    ],
  };
  const [working, archived, hidden, unassigned] = await Promise.all([
    prisma.lead.count({ where: { AND: [where, tabWhere("working", ownerIds) ?? {}] } }),
    prisma.lead.count({ where: { AND: [where, tabWhere("archived", ownerIds) ?? {}] } }),
    prisma.lead.count({ where: { AND: [where, tabWhere("hidden", ownerIds) ?? {}] } }),
    prisma.lead.count({ where: unassignedWhere }),
  ]);
  return { working, archived, hidden, unassigned };
}

/** العملاء مجمّعين حسب المرحلة — للكانبان. */
export async function getPipeline(): Promise<LeadRow[]> {
  const { user, where, manager } = await scopeForUser();
  const leads = await prisma.lead.findMany({
    where,
    orderBy: [{ priority: "asc" }, { updatedAt: "desc" }],
    include: rowInclude,
    take: 500, // سقف مؤقت لحين ترقيم الكانبان لكل عمود (#14)
  });
  const ctx = await buildRowCtx(user.id, manager, user.role, leads);
  return leads.map((l) => toRow(l, ctx));
}

/** تفاصيل عميل واحد + سجل المتابعات — مع تحقق الصلاحية. يرجّع null إن لم يُسمح. */
export async function getLeadDetail(id: string): Promise<LeadDetail | null> {
  const { user, where, manager } = await scopeForUser();
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
  // الخطوة ٣ب/ج: قرار الإخفاء لهذا العميل + حالة الكشف (لزر المالك).
  const lastAssignReason = lastAssignReasonOf(lead.reassignments);
  const freshDistributed = isFreshDistributed(lastAssignReason);
  const ctx = await buildRowCtx(user.id, manager, user.role, [lead]);
  const isHidden = ctx.hidden.has(lead.id);
  const revealAction = freshDistributed ? await latestRevealAction(prisma, lead.id) : null;
  // الأنشطة (Timeline): للمخفي تُحذف الأقدم من آخر إسناد — لا تكشف تاريخ ما قبل الاستلام.
  const visibleActivities = isHidden && lead.assignedAt
    ? lead.activities.filter((a) => a.createdAt > lead.assignedAt!)
    : lead.activities;
  return {
    ...toRow(lead, ctx),
    freshDistributed,
    historyRevealed: revealAction === REVEAL_HISTORY_ACTION,
    activitiesCount: visibleActivities.length,
    nationalId: lead.nationalId,
    notes: lead.notes,
    firstContactAt: isHidden ? null : lead.firstContactAt,
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
    bookings: lead.bookings.map((b) => {
      // المبالغ تظهر فقط للبائع أو المدير/المالك — وإلا تُحجب (null).
      const mineBooking = manager || b.sellerId === user.id;
      return {
        id: b.id,
        createdAt: b.createdAt,
        unitNumber: b.unit?.number ?? "—",
        floor: b.unit?.floorLevel ? floorLabels[b.unit.floorLevel] : (b.unit?.floor ?? null),
        projectName: b.unit?.project?.name ?? null,
        nationality: b.nationality,
        nationalId: b.nationalId,
        secondaryPhone: b.secondaryPhone,
        price: mineBooking ? b.price.toNumber() : null,
        discount: mineBooking ? b.discount.toNumber() : null,
        finalPrice: mineBooking ? b.finalPrice.toNumber() : null,
        deposit: mineBooking && b.deposit ? b.deposit.toNumber() : null,
        paymentMethod: mineBooking ? b.paymentMethod : null,
        bankName: mineBooking ? b.bankName : null,
        cashPaymentType: mineBooking ? b.cashPaymentType : null,
        installments: mineBooking ? ((b.installments as { amount: number; date: string }[] | null) ?? null) : null,
        installmentsCount: b.installmentsCount,
        includesVAT: b.includesVAT,
        vatAmount: mineBooking && b.vatAmount ? b.vatAmount.toNumber() : null,
        subjectToTax: b.subjectToTax,
        taxAmount: mineBooking && b.taxAmount ? b.taxAmount.toNumber() : null,
        discountExceeded: b.discountExceeded,
        sellerName: b.seller?.name ?? null,
      };
    }),
    activities: visibleActivities.map((a) => ({
      id: a.id,
      type: a.type,
      note: a.note,
      createdAt: a.createdAt,
      userName: a.user?.name ?? null,
    })),
  };
}

// ===== سجل التحويلات (للمالك فقط) — رؤية كاملة دائمًا =====

export type LeadTransferEntry = { id: string; fromName: string | null; toName: string | null; reason: string; createdAt: Date };
export type LeadFollowUpEntry = { id: string; result: FollowUpResult; type: FollowUpType; note: string | null; authorName: string | null; createdAt: Date };
export type LeadTransferHistory = { transferCount: number; transfers: LeadTransferEntry[]; followUps: LeadFollowUpEntry[] };

/**
 * سجل تحويلات عميل + متابعاته بنصّها وكاتبها — للمالك فقط (نصوص متابعات الموظفين حسّاسة).
 * يُقرأ من Reassignment (من→إلى·السبب·الوقت) + FollowUp (النتيجة·النص·الكاتب·الوقت) — بلا حقول جديدة.
 * غير المالك يرجّع null (الصلاحية على الخادم لا الواجهة).
 */
export async function getLeadTransferHistory(id: string): Promise<LeadTransferHistory | null> {
  const user = await requireUser();
  if (user.role !== "OWNER") return null;
  const [reassignments, followUps] = await Promise.all([
    prisma.reassignment.findMany({
      where: { leadId: id }, orderBy: { createdAt: "asc" },
      select: { id: true, fromUserId: true, toUserId: true, reason: true, createdAt: true },
    }),
    prisma.followUp.findMany({
      where: { leadId: id }, orderBy: { createdAt: "asc" },
      select: { id: true, result: true, type: true, note: true, createdAt: true, createdBy: true },
    }),
  ]);
  const userIds = [...new Set(
    [...reassignments.flatMap((r) => [r.fromUserId, r.toUserId]), ...followUps.map((f) => f.createdBy)]
      .filter((x): x is string => !!x),
  )];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  return {
    // عدد التحويلات الفعلية (بلا الإسناد الأولي «initial»).
    transferCount: reassignments.filter((r) => r.reason !== "initial").length,
    transfers: reassignments.map((r) => ({
      id: r.id,
      fromName: r.fromUserId ? (nameById.get(r.fromUserId) ?? null) : null,
      toName: r.toUserId ? (nameById.get(r.toUserId) ?? null) : null,
      reason: r.reason, createdAt: r.createdAt,
    })),
    followUps: followUps.map((f) => ({
      id: f.id, result: f.result, type: f.type, note: f.note,
      authorName: nameById.get(f.createdBy) ?? null, createdAt: f.createdAt,
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
  // دمج تحت AND — يمنع assignedToId من مسح تحجيم الموظف (where) في الـ spread.
  return prisma.lead.count({ where: { AND: [where, { stage: "NEW", isArchived: false, assignedToId: assignee }] } });
}

/**
 * عدد المهتمين الذين عليهم متابعات «لم يستجب» (لشارة فلتر «لم يستجب ×N») — للمالك/المدير.
 * غير المدير يرجّع صفرًا (الفلتر لا يظهر له أصلًا).
 */
export async function getUnresponsiveCount(): Promise<number> {
  const { manager } = await scopeForUser();
  if (!manager) return 0;
  return prisma.lead.count({
    where: {
      stage: { in: INTEREST_UMBRELLA },
      isArchived: false,
      followUps: { some: { result: "NO_ANSWER_INTERESTED" } },
    },
  });
}

/** قائمة الموظفين (لفلتر المدير وإعادة الإسناد). */
export async function getEmployees() {
  return prisma.user.findMany({
    where: { role: "EMPLOYEE", active: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}
