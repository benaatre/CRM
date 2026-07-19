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
import { getPendingPullByEmployee } from "@/lib/data/no-response";

export type ActionResult = { ok: boolean; error?: string; message?: string };

const MAX_REASSIGNS = 3;

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
    const n = row ? row.pending + row.overdue : 0;
    if (n === 0) return { ok: true, message: "الموظف ما عنده عملاء متأخرون" };

    await notify(prisma, [employeeId], "no_response.warn",
      "تحرّك على عملائك", `عندك ${n} عملاء بلا تواصل — تحرّك عليهم قبل ما ينسحبون منك.`, "/leads");
    await logAudit(prisma, { userId: actor.id, action: "lead.no_response.warned", entity: "user", entityId: employeeId, summary: `أرسل إنذارًا لموظف (${n} عملاء متأخرون)` });

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
    const targets = summary.employees.filter((e) => e.pending + e.overdue > 0);
    if (targets.length === 0) return { ok: true, message: "ما فيه موظفون عندهم عملاء متأخرون" };

    for (const e of targets) {
      const n = e.pending + e.overdue;
      await notify(prisma, [e.id], "no_response.warn",
        "تحرّك على عملائك", `عندك ${n} عملاء بلا تواصل — تحرّك عليهم قبل ما ينسحبون منك.`, "/leads");
    }
    await logAudit(prisma, { userId: actor.id, action: "lead.no_response.warnedAll", entity: "user", summary: `أرسل إنذارات لـ ${targets.length} موظف` });

    revalidatePath("/no-response");
    return { ok: true, message: `أُرسلت الإنذارات لـ ${targets.length} موظف` };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}
