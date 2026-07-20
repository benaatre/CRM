"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { ActivityType, LeadStage, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toUserError } from "@/lib/action-error";
import { requireUser } from "@/lib/auth-guards";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { emitLeadAssignedBatch, type LeadAssignedBucket } from "@/lib/notifications/emit";
import { NO_RESPONSE_STAGES } from "@/lib/auto-distribute";
import {
  warnMessage, getNoResponseConfig, noResponseBaseline, noResponseState, noAnswerStats, type EscalationCategory,
} from "@/lib/no-response-escalation";
import { getPendingPullByEmployee, type PendingPullEmployee } from "@/lib/data/no-response";

export type ActionResult = { ok: boolean; error?: string; message?: string };

const MAX_REASSIGNS = 3;

// فئات غير محصّنة + عدد المتابعات الممثّل لها (لنص الإنذار المتدرّج).
const WARN_CATS: { cat: EscalationCategory; fu: number }[] = [
  { cat: "none", fu: 0 }, { cat: "one", fu: 1 }, { cat: "two", fu: 2 }, { cat: "threePlus", fu: 3 },
];
const WARN_LINK = "/leads?stages=NEW,ATTEMPTED&sort=oldest";

/** يرسل للموظف إشعارًا مجمّعًا منفصلًا لكل فئة تصعيد فيها عملاء متأخرون. يرجّع العدد المُرسَل. */
async function sendGraduatedWarnings(emp: PendingPullEmployee): Promise<number> {
  let sent = 0;
  for (const { cat, fu } of WARN_CATS) {
    const stat = emp.byCategory[cat];
    const n = stat.pending + stat.overdue;
    if (n === 0) continue;
    await notify(prisma, [emp.id], "no_response.warn", "متابعة مطلوبة", warnMessage(fu, n), WARN_LINK);
    sent += n;
  }
  return sent;
}

function revalidateNoResponse() {
  revalidatePath("/no-response");
  revalidatePath("/leads");
  revalidatePath("/dashboard");
}

/** تحقّق أن المستخدم مالك — الإجراءات هنا كلها للمالك فقط (مفروضة على الخادم). */
async function requireOwner() {
  const user = await requireUser();
  if (user.role !== Role.OWNER) throw new Error("هذا الإجراء للمالك فقط");
  return user;
}

// حالة العميل عند التوزيع: «ببياناته كما هي» أو «كعميل جديد».
export type LeadState = "asis" | "fresh";

/**
 * يُسند عميل الحوض لموظف بنافذة مهلة جديدة (assignedAt=now، contactedAt=null) داخل معاملة.
 * لا يلمس reassignCount: العدّاد ملك السحب التلقائي وحده (زيادته هنا تُضاعف العدّ وتكسر سقف «٣ دورات»).
 * fresh = يرجّع المرحلة «جديد» ويصفّر nextFollowup — المتابعات محفوظة (سجل تاريخي، لا تُحذف).
 */
function assignQueueLead(tx: Prisma.TransactionClient, leadId: string, toUserId: string, actorId: string, now: Date, state: LeadState) {
  const fresh = state === "fresh";
  return Promise.all([
    tx.lead.update({
      where: { id: leadId },
      data: {
        assignedToId: toUserId, assignedAt: now, contactedAt: null,
        ...(fresh ? { stage: LeadStage.NEW, nextFollowup: null } : {}),
      },
    }),
    tx.reassignment.create({ data: { leadId, fromUserId: null, toUserId, reason: "manual_redistribute" } }),
    tx.activity.create({ data: { leadId, userId: actorId, type: ActivityType.ASSIGNMENT, note: fresh ? "توزيع يدوي من «لم يتم الرد» (كعميل جديد)" : "توزيع يدوي من «لم يتم الرد»" } }),
  ]);
}

/** العملاء الصالحون للتوزيع من الحوض ضمن مجموعة معرّفات (في الحوض + دون السقف). */
async function eligibleQueueLeads(ids: string[]) {
  return prisma.lead.findMany({
    where: {
      id: { in: ids },
      assignedToId: null,
      reassignCount: { gt: 0, lt: MAX_REASSIGNS },
      isArchived: false,
      stage: { in: [...NO_RESPONSE_STAGES] },
    },
    select: { id: true, name: true },
  });
}

/** الموظفون النشطون المتاحون للاستقبال مع سعتهم المتبقية (Infinity = بلا حد). */
async function activeEmployees(now: Date) {
  const emps = await prisma.user.findMany({
    where: {
      role: Role.EMPLOYEE, active: true,
      OR: [{ availabilityPaused: false }, { availabilityPaused: true, pauseUntil: { not: null, lte: now } }],
    },
    select: { id: true, name: true, maxClients: true, _count: { select: { assignedLeads: { where: { isArchived: false } } } } },
    orderBy: { name: "asc" },
  });
  return emps.map((e) => ({
    id: e.id, name: e.name,
    capacity: e.maxClients == null ? Infinity : Math.max(0, e.maxClients - e._count.assignedLeads),
  }));
}

// خيارات التوزيع اليدوي من نافذة «توزيع المحدّدين».
export type DistributeOpts = {
  employeeIds: string[];        // المشاركون في التوزيع (المالك يختارهم)
  mode: "single" | "even";      // كلهم لموظف واحد | بالتساوي على المشاركين
  leadState: LeadState;         // ببياناته كما هي | كعميل جديد
};

/**
 * توزيع فردي لعميل من الحوض لموظف — للمالك فقط. (يستخدمه زر الصف — ببياناته كما هي.)
 */
export async function distributeNoResponseLead(leadId: string, toUserId: string): Promise<ActionResult> {
  return distributeNoResponseBatch([leadId], { employeeIds: [toUserId], mode: "single", leadState: "asis" });
}

/**
 * توزيع دفعة من عملاء الحوض على المشاركين المختارين — للمالك فقط.
 * single = كلهم لموظف واحد · even = بالتساوي (round-robin) مع احترام السعة القصوى.
 * يتخطّى المستنفدين ومن خرج من الحوض؛ إشعار مجمّع لكل موظف.
 */
export async function distributeNoResponseBatch(leadIds: string[], opts: DistributeOpts): Promise<ActionResult> {
  try {
    const actor = await requireOwner();
    const ids = [...new Set(leadIds.filter(Boolean))];
    if (ids.length === 0) return { ok: false, error: "ما فيه عملاء محدّدون" };

    const chosen = [...new Set((opts.employeeIds ?? []).filter(Boolean))];
    if (chosen.length === 0) return { ok: false, error: "اختر موظفًا واحدًا على الأقل" };
    if (opts.mode === "single" && chosen.length !== 1) return { ok: false, error: "«كلهم لموظف واحد» يتطلب اختيار موظف واحد" };

    const now = new Date();
    // الموظفون النشطون المختارون + سعتهم — نحترم maxClients في التوزيع بالتساوي.
    const emps = (await activeEmployees(now)).filter((e) => chosen.includes(e.id));
    if (emps.length === 0) return { ok: false, error: "الموظفون المختارون غير متاحين" };
    const nameById = new Map(emps.map((e) => [e.id, e.name]));

    const eligible = await eligibleQueueLeads(ids);
    if (eligible.length === 0) return { ok: false, error: "ما فيه عملاء صالحون للتوزيع (خرجوا من الحوض أو مستنفدون)" };

    // فرض على الخادم: لا يُوزَّع عميل لموظف سُحب منه (يطابق تعطيل الواجهة). المصدر = آخر سحب (Reassignment→null).
    const pulls = await prisma.reassignment.findMany({
      where: { leadId: { in: eligible.map((e) => e.id) }, toUserId: null },
      orderBy: { createdAt: "desc" },
      select: { leadId: true, fromUserId: true },
    });
    const sourceByLead = new Map<string, string>();
    for (const r of pulls) if (r.fromUserId && !sourceByLead.has(r.leadId)) sourceByLead.set(r.leadId, r.fromUserId);
    const sourceSet = new Set(sourceByLead.values());
    const conflict = chosen.find((id) => sourceSet.has(id));
    if (conflict) {
      return { ok: false, error: `ما ينفع توزيع لموظف سُحب منه العميل (${nameById.get(conflict) ?? "موظف"}) — اختر موظفًا آخر.` };
    }

    // خطة الإسناد: single → الكل لواحد؛ even → round-robin على المختارين ضمن سعتهم.
    const cap = new Map(emps.map((e) => [e.id, opts.mode === "single" ? Infinity : e.capacity]));
    const order = emps.map((e) => e.id);
    const plan: { leadId: string; name: string; toUserId: string }[] = [];
    let idx = 0;
    for (const l of eligible) {
      let pick: string | null = null;
      if (opts.mode === "single") pick = order[0];
      else {
        for (let tries = 0; tries < order.length; tries++) {
          const id = order[idx % order.length];
          idx++;
          if ((cap.get(id) ?? 0) > 0) { pick = id; break; }
        }
      }
      if (!pick) break; // الجميع بلغوا سعتهم (even)
      cap.set(pick, (cap.get(pick) as number) - 1);
      plan.push({ leadId: l.id, name: l.name, toUserId: pick });
    }
    if (plan.length === 0) return { ok: false, error: "الموظفون المختارون وصلوا حدّهم الأقصى" };

    await prisma.$transaction(async (tx) => {
      for (const p of plan) await assignQueueLead(tx, p.leadId, p.toUserId, actor.id, now, opts.leadState);
    });

    const buckets = new Map<string, LeadAssignedBucket>();
    for (const p of plan) {
      const b = buckets.get(p.toUserId);
      if (b) b.count++;
      else buckets.set(p.toUserId, { userId: p.toUserId, count: 1, sampleLeadId: p.leadId, sampleName: p.name });
    }
    await emitLeadAssignedBatch([...buckets.values()]);
    await logAudit(prisma, {
      userId: actor.id, action: "lead.no_response.distributed", entity: "lead",
      summary: `وزّع ${plan.length} عميل من «لم يتم الرد» (${opts.mode === "single" ? `إلى ${nameById.get(order[0])}` : `بالتساوي على ${buckets.size} موظف`}${opts.leadState === "fresh" ? " — كعميل جديد" : ""})`,
    });

    revalidateNoResponse();
    const skipped = ids.length - plan.length;
    const who = opts.mode === "single" ? `إلى ${nameById.get(order[0])}` : `على ${buckets.size} موظف`;
    const base = `وُزّع ${plan.length} عميل ${who}`;
    return { ok: true, message: skipped > 0 ? `${base} — تُخطّي ${skipped} (خارج الحوض/مستنفد/سعة)` : base };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

/**
 * توزيع تلقائي لكل الحوض على الموظفين النشطين (round-robin بالترتيب) — يحترم السعة القصوى.
 * للمالك فقط. إشعار مجمّع لكل موظف.
 */
export async function autoDistributeNoResponse(): Promise<ActionResult> {
  try {
    const actor = await requireOwner();
    const now = new Date();

    const emps = await activeEmployees(now);
    if (emps.length === 0) return { ok: false, error: "ما فيه موظفون نشطون للتوزيع" };

    const queue = await prisma.lead.findMany({
      where: { assignedToId: null, reassignCount: { gt: 0, lt: MAX_REASSIGNS }, isArchived: false, stage: { in: [...NO_RESPONSE_STAGES] } },
      select: { id: true, name: true },
      orderBy: { updatedAt: "asc" },
    });
    if (queue.length === 0) return { ok: true, message: "ما فيه عملاء في الحوض للتوزيع" };

    const cap = new Map(emps.map((e) => [e.id, e.capacity]));
    const order = emps.map((e) => e.id);
    const buckets = new Map<string, LeadAssignedBucket>();
    const assignments: { leadId: string; toUserId: string }[] = [];
    let idx = 0;
    for (const lead of queue) {
      let pick: string | null = null;
      for (let tries = 0; tries < order.length; tries++) {
        const id = order[idx % order.length];
        idx++;
        if ((cap.get(id) ?? 0) > 0) { pick = id; break; }
      }
      if (!pick) break; // الجميع بلغوا سعتهم
      cap.set(pick, (cap.get(pick) as number) - 1);
      assignments.push({ leadId: lead.id, toUserId: pick });
      const b = buckets.get(pick);
      if (b) b.count++;
      else buckets.set(pick, { userId: pick, count: 1, sampleLeadId: lead.id, sampleName: lead.name });
    }
    if (assignments.length === 0) return { ok: false, error: "كل الموظفين وصلوا الحد الأقصى لعملائهم" };

    await prisma.$transaction(async (tx) => {
      for (const a of assignments) await assignQueueLead(tx, a.leadId, a.toUserId, actor.id, now, "asis");
    });
    await emitLeadAssignedBatch([...buckets.values()]);
    await logAudit(prisma, {
      userId: actor.id, action: "lead.no_response.autoDistributed", entity: "lead",
      summary: `وزّع تلقائيًا ${assignments.length} عميل من «لم يتم الرد» على ${buckets.size} موظف`,
    });

    revalidateNoResponse();
    const leftover = queue.length - assignments.length;
    const base = `وُزّع ${assignments.length} عميل على ${buckets.size} موظف`;
    return { ok: true, message: leftover > 0 ? `${base} — بقي ${leftover} (الموظفون وصلوا حدّهم)` : base };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

/** إشعار موظف واحد بعملائه المتأخرين — للمالك فقط. */
export async function warnEmployee(employeeId: string): Promise<ActionResult> {
  try {
    const actor = await requireOwner();
    const summary = await getPendingPullByEmployee();
    const row = summary.employees.find((e) => e.id === employeeId);
    const n = row ? row.totalPending + row.totalOverdue : 0;
    if (!row || n === 0) return { ok: true, message: "الموظف ما عنده عملاء متأخرون" };

    const sent = await sendGraduatedWarnings(row);
    await logAudit(prisma, { userId: actor.id, action: "lead.no_response.warned", entity: "user", entityId: employeeId, summary: `أرسل إنذار تصعيد لموظف (${sent} عميل)` });

    revalidatePath("/no-response");
    return { ok: true, message: "أُرسل الإنذار" };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

/** إشعار مجمّع لكل موظف عنده عملاء متأخرون — للمالك فقط. */
export async function warnAllEmployees(): Promise<ActionResult> {
  try {
    const actor = await requireOwner();
    const summary = await getPendingPullByEmployee();
    const targets = summary.employees.filter((e) => e.totalPending + e.totalOverdue > 0);
    if (targets.length === 0) return { ok: true, message: "ما فيه موظفون عندهم عملاء متأخرون" };

    for (const e of targets) await sendGraduatedWarnings(e);
    await logAudit(prisma, { userId: actor.id, action: "lead.no_response.warnedAll", entity: "user", summary: `أرسل إنذارات تصعيد لـ ${targets.length} موظف` });

    revalidatePath("/no-response");
    return { ok: true, message: `أُرسلت الإنذارات لـ ${targets.length} موظف` };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

/**
 * سحب يدوي من المالك: يسحب عملاء محدّدين من موظفيهم إلى حوض «لم يتم الرد» (assignedToId=null).
 * يعمل حتى في وضع dry-run (فعل يدوي صريح). OWNER فقط، مفروض على الخادم.
 * لكل عميل: reassignCount++ · Reassignment{manual_pull} · نشاط · إشعار الموظف · تدقيق.
 */
export async function manualPullBatch(leadIds: string[]): Promise<ActionResult> {
  try {
    const actor = await requireOwner();
    const ids = [...new Set((leadIds ?? []).filter(Boolean))];
    if (ids.length === 0) return { ok: false, error: "ما فيه عملاء محدّدون" };

    // مُسندون لموظف فعلي، غير مؤرشفين (لا نسحب من غير موظف).
    const leads = await prisma.lead.findMany({
      where: { id: { in: ids }, assignedToId: { not: null }, isArchived: false },
      select: { id: true, name: true, assignedToId: true, assignedTo: { select: { role: true } } },
    });
    const targets = leads.filter((l) => l.assignedTo?.role === "EMPLOYEE");
    if (targets.length === 0) return { ok: false, error: "ما فيه عملاء صالحون للسحب (غير مُسندين لموظف)" };

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      for (const l of targets) {
        const from = l.assignedToId as string;
        await tx.lead.update({
          where: { id: l.id },
          data: { assignedToId: null, assignedAt: null, contactedAt: null, reassignCount: { increment: 1 } },
        });
        await tx.reassignment.create({ data: { leadId: l.id, fromUserId: from, toUserId: null, reason: "manual_pull" } });
        await tx.activity.create({ data: { leadId: l.id, userId: actor.id, type: ActivityType.ASSIGNMENT, note: "سحب يدوي من الإدارة — لم يتم الرد" } });
      }
    });

    // إشعارات + تدقيق (معزولة — فشلها لا يوقف العملية).
    try {
      for (const l of targets) {
        await notify(prisma, [l.assignedToId], "lead_lost", "انسحب منك عميل",
          `${l.name} — سُحب منك من الإدارة لعدم التواصل. بادر بعملائك بسرعة.`, `/leads/${l.id}`);
      }
    } catch (e) { console.error("[manual_pull] إشعارات", e); }
    await logAudit(prisma, { userId: actor.id, action: "lead.no_response.manualPull", entity: "lead", summary: `سحب يدوي لـ ${targets.length} عميل إلى حوض «لم يتم الرد»` });

    revalidateNoResponse();
    const skipped = ids.length - targets.length;
    return { ok: true, message: skipped > 0 ? `سُحب ${targets.length} عميل — تُخطّي ${skipped}` : `سُحب ${targets.length} عميل إلى الحوض` };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

/** سحب يدوي لعميل واحد — للمالك فقط. */
export async function manualPullLead(leadId: string): Promise<ActionResult> {
  return manualPullBatch([leadId]);
}

// فئة مجموعة السحب: «يُسحب الآن» (overdue) بعتباتها، أو «بانتظار» (pending) حسب عدد المتابعات.
export type PullGroupCategory =
  | "overdue_all" | "overdue_very" | "overdue_late"
  | "pending_all" | "pending_0" | "pending_1" | "pending_2" | "pending_3plus";

const OVERDUE_VERY_DAYS = 5;
const OVERDUE_LATE_DAYS = 3;

function matchPullCategory(cat: PullGroupCategory, state: string, daysSince: number, fu: number): boolean {
  if (cat.startsWith("overdue")) {
    if (state !== "overdue") return false;
    if (cat === "overdue_very") return daysSince >= OVERDUE_VERY_DAYS;
    if (cat === "overdue_late") return daysSince >= OVERDUE_LATE_DAYS && daysSince < OVERDUE_VERY_DAYS;
    return true; // overdue_all
  }
  if (state !== "pending") return false;
  if (cat === "pending_0") return fu === 0;
  if (cat === "pending_1") return fu === 1;
  if (cat === "pending_2") return fu === 2;
  if (cat === "pending_3plus") return fu >= 3;
  return true; // pending_all
}

/**
 * سحب مجموعة كاملة من عملاء موظف بمعيار الفئة (يُحسب على الخادم بنفس منطق المحرّك) — للمالك فقط.
 * يعمل حتى في dry-run (فعل يدوي صريح). يفوّض للسحب اليدوي (Reassignment + reassignCount++ + إشعار + تدقيق).
 */
export async function pullGroup(employeeId: string, category: PullGroupCategory): Promise<ActionResult> {
  try {
    await requireOwner();
    if (!employeeId) return { ok: false, error: "حدّد الموظف" };
    const config = getNoResponseConfig();
    const now = new Date();

    const leads = await prisma.lead.findMany({
      where: {
        assignedToId: employeeId, isArchived: false, stage: { in: [...NO_RESPONSE_STAGES] },
        reassignCount: { lt: MAX_REASSIGNS }, manualAssignedAt: null, assignedTo: { role: "EMPLOYEE" },
      },
      select: { id: true, assignedAt: true },
    });
    const ids = leads.map((l) => l.id);
    const fus = ids.length ? await prisma.followUp.findMany({ where: { leadId: { in: ids } }, select: { leadId: true, result: true, createdAt: true } }) : [];
    const fuByLead = new Map<string, { result: string; createdAt: Date }[]>();
    for (const f of fus) {
      const arr = fuByLead.get(f.leadId);
      if (arr) arr.push({ result: f.result, createdAt: f.createdAt });
      else fuByLead.set(f.leadId, [{ result: f.result, createdAt: f.createdAt }]);
    }

    const picked: string[] = [];
    for (const l of leads) {
      const stats = noAnswerStats(fuByLead.get(l.id) ?? []);
      if (!stats.included) continue; // رد العميل → خارج النظام
      const baseline = noResponseBaseline(l.assignedAt, stats.lastNoAnswerAt, config.activationDate);
      const { state, daysSince } = noResponseState(stats.noAnswerCount, baseline, now, config);
      if (matchPullCategory(category, state, daysSince, stats.noAnswerCount)) picked.push(l.id);
    }
    if (picked.length === 0) return { ok: false, error: "ما فيه عملاء في هذي المجموعة" };
    return manualPullBatch(picked);
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

/**
 * توزيع حوض موظف مصدر كامل على المستلمين — للمالك فقط. يجلب عملاء الحوض المسحوبين من هذا الموظف
 * (آخر Reassignment→null) ويوزّعهم عبر distributeNoResponseBatch (الذي يرفض التوزيع للمصدر على الخادم).
 */
export async function distributePoolGroup(sourceEmployeeId: string, opts: DistributeOpts): Promise<ActionResult> {
  try {
    await requireOwner();
    if (!sourceEmployeeId) return { ok: false, error: "حدّد الموظف المصدر" };
    if ((opts.employeeIds ?? []).includes(sourceEmployeeId)) {
      return { ok: false, error: "ما ينفع توزيع لنفس الموظف المسحوب منه" };
    }
    const leads = await prisma.lead.findMany({
      where: {
        assignedToId: null, reassignCount: { gt: 0 }, isArchived: false, stage: { in: [...NO_RESPONSE_STAGES] },
        reassignments: { some: { toUserId: null, fromUserId: sourceEmployeeId } },
      },
      select: { id: true, reassignments: { where: { toUserId: null }, orderBy: { createdAt: "desc" }, take: 1, select: { fromUserId: true } } },
    });
    // نتأكد أن آخر سحب فعلًا من هذا المصدر (لا من موظف لاحق).
    const ids = leads.filter((l) => l.reassignments[0]?.fromUserId === sourceEmployeeId).map((l) => l.id);
    if (ids.length === 0) return { ok: false, error: "ما فيه عملاء في حوض هذا الموظف" };
    return distributeNoResponseBatch(ids, opts);
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}
