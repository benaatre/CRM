"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { ActivityType, LeadStage, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toUserError } from "@/lib/action-error";
import { requireUser } from "@/lib/auth-guards";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { emitTransferredLeadsBatch, type LeadAssignedBucket } from "@/lib/notifications/emit";
import { NO_RESPONSE_STAGES, unreachableLeadIds } from "@/lib/auto-distribute";
import { assignLead } from "@/lib/assignment";
import {
  warnMessage, getNoResponseConfig, noResponseBaseline, noResponseState, noAnswerStats, overdueAgeBucket,
  type EscalationCategory, type OverdueAgeBucket,
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
    const n = stat.warning + stat.overdue; // ننذر عن «تحذير ٢٤س» + «يُسحب الآن» (المستعجلين)
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
 * يُسند عميل الحوض لموظف عبر assignLead الموحّدة (م-١): assignedAt=now + contactedAt=null
 * + سجل Reassignment — **بلا manualAssignedAt**: الحصانة الدائمة للإسناد اليدوي المباشر
 * من المالك (team.ts) فقط؛ عميل الحوض يدخل دورة «لم يتم الرد» من جديد بمهلة كاملة
 * (تجديد assignedAt يمنحها تلقائيًا عبر baseline)، فيرجع للحوض لو أهمله الموظف الجديد.
 * لا يلمس reassignCount: العدّاد ملك السحب التلقائي وحده (زيادته هنا تُضاعف العدّ وتكسر سقف «٣ دورات»).
 * fresh = يرجّع المرحلة «جديد» ويصفّر nextFollowup — المتابعات محفوظة (سجل تاريخي، لا تُحذف).
 */
async function assignQueueLead(tx: Prisma.TransactionClient, leadId: string, toUserId: string, actorId: string, now: Date, state: LeadState): Promise<boolean> {
  const fresh = state === "fresh";
  // حارس تزامن: لا نُسند إلا إذا كان لا يزال في الحوض (assignedToId=null) — تخطٍّ صامت عند التسابق.
  // الخطوة ٣أ: لاحقة القرار في السبب — _fresh (كجديد: سجله يُخفى عن الموظف) · _full (بسجله كاملًا).
  // كل مطابقات startsWith("no_response") في النظام على صفوف السحب (toUserId=null) — لا تتأثر.
  const ok = await assignLead(tx, leadId, toUserId, {
    manual: false,
    reason: fresh ? "manual_redistribute_fresh" : "manual_redistribute_full",
    now,
    guardWhere: { assignedToId: null },
    extraData: fresh ? { stage: LeadStage.NEW, nextFollowup: null } : {},
  });
  if (!ok) return false;
  await tx.activity.create({ data: { leadId, userId: actorId, type: ActivityType.ASSIGNMENT, note: fresh ? "توزيع يدوي من «لم يتم الرد» (كعميل جديد)" : "توزيع يدوي من «لم يتم الرد»" } });
  return true;
}

/**
 * العملاء الصالحون للتوزيع من الحوض ضمن مجموعة معرّفات (في الحوض).
 * افتراضيًا دون السقف؛ allowExhausted=true يسمح بالمستنفدين (reassignCount ≥ MAX) — للتوزيع الاستثنائي.
 */
async function eligibleQueueLeads(ids: string[], allowExhausted = false) {
  return prisma.lead.findMany({
    where: {
      id: { in: ids },
      assignedToId: null,
      reassignCount: allowExhausted ? { gt: 0 } : { gt: 0, lt: MAX_REASSIGNS },
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
  override?: boolean;           // توزيع استثنائي: يسمح بالمستنفدين (تجاوز السقف) — بموافقة صريحة
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

    const eligible = await eligibleQueueLeads(ids, opts.override === true);
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

    const succeeded = new Set<string>();
    await prisma.$transaction(async (tx) => {
      for (const p of plan) {
        if (await assignQueueLead(tx, p.leadId, p.toUserId, actor.id, now, opts.leadState)) succeeded.add(p.leadId);
      }
    });
    const donePlan = plan.filter((p) => succeeded.has(p.leadId));
    if (donePlan.length === 0) return { ok: false, error: "ما تم توزيع أحد (تغيّرت الإسنادات) — حدّث الصفحة" };

    const buckets = new Map<string, LeadAssignedBucket>();
    for (const p of donePlan) {
      const b = buckets.get(p.toUserId);
      if (b) b.count++;
      else buckets.set(p.toUserId, { userId: p.toUserId, count: 1, sampleLeadId: p.leadId, sampleName: p.name });
    }
    // نوع التحويل من حالة التوزيع: fresh = «كعملاء جدد»، asis = «بمحتواهم» (withHistory).
    await emitTransferredLeadsBatch([...buckets.values()], opts.leadState === "fresh" ? "fresh" : "withHistory");
    await logAudit(prisma, {
      userId: actor.id, action: "lead.no_response.distributed", entity: "lead",
      summary: `وزّع ${donePlan.length} عميل من «لم يتم الرد» (${opts.mode === "single" ? `إلى ${nameById.get(order[0])}` : `بالتساوي على ${buckets.size} موظف`}${opts.leadState === "fresh" ? " — كعميل جديد" : ""}${opts.override ? " — توزيع استثنائي (تجاوز السقف)" : ""}) · العملاء=${donePlan.map((p) => p.leadId).slice(0, 50).join(",")}`,
    });

    revalidateNoResponse();
    const skipped = ids.length - donePlan.length;
    const who = opts.mode === "single" ? `إلى ${nameById.get(order[0])}` : `على ${buckets.size} موظف`;
    const base = `وُزّع ${donePlan.length} عميل ${who}`;
    return { ok: true, message: skipped > 0 ? `${base} — تُخطّي ${skipped} (خارج الحوض/مستنفد/سعة/تزامن)` : base };
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

    // §٤: نستبعد «تعذّر الوصول» من التوزيع التلقائي للحوض (يبقون في قسمهم عند المالك).
    const unreachable = await unreachableLeadIds();
    const queue = await prisma.lead.findMany({
      where: {
        assignedToId: null, reassignCount: { gt: 0, lt: MAX_REASSIGNS }, isArchived: false, stage: { in: [...NO_RESPONSE_STAGES] },
        ...(unreachable.size ? { id: { notIn: [...unreachable] } } : {}),
      },
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

    const succeeded = new Set<string>();
    await prisma.$transaction(async (tx) => {
      for (const a of assignments) {
        if (await assignQueueLead(tx, a.leadId, a.toUserId, actor.id, now, "asis")) succeeded.add(a.leadId);
      }
    });
    const doneCount = succeeded.size;
    if (doneCount === 0) return { ok: false, error: "ما تم توزيع أحد (تغيّرت الإسنادات) — حدّث الصفحة" };
    // نُبقي في الدلاء فقط من نجح إسناده فعليًا (تجنّب إشعار زائد عند تخطٍّ تزامنيّ).
    const doneBuckets = [...buckets.values()]
      .map((b) => ({ ...b, count: assignments.filter((a) => a.toUserId === b.userId && succeeded.has(a.leadId)).length }))
      .filter((b) => b.count > 0);
    // التوزيع التلقائي للحوض دائمًا «asis» (بمحتواهم) → withHistory.
    await emitTransferredLeadsBatch(doneBuckets, "withHistory");
    await logAudit(prisma, {
      userId: actor.id, action: "lead.no_response.autoDistributed", entity: "lead",
      summary: `وزّع تلقائيًا ${doneCount} عميل من «لم يتم الرد» على ${doneBuckets.length} موظف`,
    });

    revalidateNoResponse();
    const leftover = queue.length - doneCount;
    const base = `وُزّع ${doneCount} عميل على ${doneBuckets.length} موظف`;
    return { ok: true, message: leftover > 0 ? `${base} — بقي ${leftover} (الموظفون وصلوا حدّهم/تزامن)` : base };
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
    const n = row ? row.totalWarning + row.totalOverdue : 0;
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
    const targets = summary.employees.filter((e) => e.totalWarning + e.totalOverdue > 0);
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
export async function manualPullBatch(leadIds: string[], ctx?: { note?: string }): Promise<ActionResult> {
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

    const batchId = randomUUID();
    const CHUNK = 100;
    // من نجح سحبه فعليًا — للإشعارات المجمّعة والتدقيق الدقيق.
    const pulledTargets: { id: string; name: string; from: string }[] = [];

    // نقسّم لمجموعات (١٠٠) ولكل مجموعة معاملة واحدة بكتابات مجمّعة (٥ استعلامات ثابتة بدل ٤/عميل)
    // — يتفادى P2028 (timeout المعاملة التفاعلية). timeout=15000ms كهامش أمان إضافي لا كحل أساسي.
    const targetIds = targets.map((t) => t.id);
    for (let i = 0; i < targetIds.length; i += CHUNK) {
      const chunkIds = targetIds.slice(i, i + CHUNK);
      const rows = await prisma.$transaction(async (tx) => {
        // حارس ذري: نقرأ الحالة الحالية داخل المعاملة (لا يزال مُسندًا لموظف فعلي) قبل التحديث.
        const confirmed = await tx.lead.findMany({
          where: { id: { in: chunkIds }, assignedToId: { not: null }, isArchived: false, assignedTo: { role: Role.EMPLOYEE } },
          select: { id: true, name: true, assignedToId: true },
        });
        if (confirmed.length === 0) return [] as { id: string; name: string; from: string }[];
        const cids = confirmed.map((c) => c.id);
        // تحديث مجمّع بشرط الحالة (لا يزال مُسندًا) — من صار null بين القراءة والكتابة يُستثنى.
        await tx.lead.updateMany({
          where: { id: { in: cids }, assignedToId: { not: null } },
          data: { assignedToId: null, assignedAt: null, contactedAt: null, reassignCount: { increment: 1 } },
        });
        const confirmedRows = confirmed.map((c) => ({ id: c.id, name: c.name, from: c.assignedToId as string }));
        // كتابات مجمّعة (createMany) بدل create في حلقة: Reassignment · Activity · AuditLog دفعةً.
        await tx.reassignment.createMany({ data: confirmedRows.map((r) => ({ leadId: r.id, fromUserId: r.from, toUserId: null, reason: "manual_pull" })) });
        await tx.activity.createMany({ data: confirmedRows.map((r) => ({ leadId: r.id, userId: actor.id, type: ActivityType.ASSIGNMENT, note: "سحب يدوي من الإدارة — لم يتم الرد" })) });
        await tx.auditLog.createMany({ data: confirmedRows.map((r) => ({
          userId: actor.id, action: "lead.no_response.manualPulled", entity: "lead", entityId: r.id,
          summary: `[batch=${batchId}] سحب يدوي · from=${r.from}${ctx?.note ? ` · ${ctx.note}` : ""}`,
        })) });
        return confirmedRows;
      }, { timeout: 15000 });
      pulledTargets.push(...rows);
    }
    if (pulledTargets.length === 0) return { ok: false, error: "ما تم سحب أحد (تغيّرت الإسنادات) — حدّث الصفحة" };

    // إشعارات مجمّعة لكل موظف (مرة واحدة لكل موظف لا لكل عميل) — خارج المعاملة تمامًا (معزولة).
    const byEmp = new Map<string, { id: string; name: string }[]>();
    for (const t of pulledTargets) {
      const arr = byEmp.get(t.from);
      if (arr) arr.push({ id: t.id, name: t.name });
      else byEmp.set(t.from, [{ id: t.id, name: t.name }]);
    }
    try {
      for (const [empId, list] of byEmp) {
        if (list.length === 1) {
          await notify(prisma, [empId], "lead_lost", "انسحب منك عميل",
            `${list[0].name} — سُحب منك من الإدارة لعدم التواصل. بادر بعملائك بسرعة.`, `/leads/${list[0].id}`);
        } else {
          await notify(prisma, [empId], "lead_lost", "انسحبوا منك عملاء",
            `سُحب منك ${list.length} عملاء من الإدارة لعدم التواصل. بادر بعملائك بسرعة.`, "/leads?stages=NEW,ATTEMPTED&sort=oldest");
        }
      }
    } catch (e) { console.error("[manual_pull] إشعارات", e); }

    // ملخّص الدفعة: batchId · العدد · معرّفات العملاء · الموظفون المصدر (بدل العدد فقط).
    const affected = new Map<string, number>();
    for (const t of pulledTargets) affected.set(t.from, (affected.get(t.from) ?? 0) + 1);
    const names = await prisma.user.findMany({ where: { id: { in: [...affected.keys()] } }, select: { id: true, name: true } });
    const nameById = new Map(names.map((u) => [u.id, u.name]));
    const who = [...affected.entries()].map(([id, n]) => `${nameById.get(id) ?? id}:${n}`).join(" · ");
    await logAudit(prisma, {
      userId: actor.id, action: "lead.no_response.manualPullBatch", entity: "lead", entityId: batchId,
      summary: `سحب يدوي [batch=${batchId}]${ctx?.note ? ` (${ctx.note})` : ""} · العدد=${pulledTargets.length} · العملاء=${pulledTargets.map((t) => t.id).slice(0, 50).join(",")} · الموظفون=${who}`,
    });

    revalidateNoResponse();
    const skipped = ids.length - pulledTargets.length;
    return { ok: true, message: skipped > 0 ? `سُحب ${pulledTargets.length} عميل — تُخطّي ${skipped}` : `سُحب ${pulledTargets.length} عميل إلى الحوض` };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

/** سحب يدوي لعميل واحد — للمالك فقط. */
export async function manualPullLead(leadId: string): Promise<ActionResult> {
  return manualPullBatch([leadId]);
}

// فئة مجموعة السحب: «يُسحب الآن» كلها أو حسب فترة العمر (٣–٧ · ٨–١٤ · ١٥–٣٠ · ٣٠+)،
// أو «بانتظار» (pending) حسب عدد المتابعات. فترات العمر مصدرها overdueAgeBucket (نفس العرض).
export type PullGroupCategory =
  | "overdue_all" | OverdueAgeBucket
  | "pending_all" | "pending_0" | "pending_1" | "pending_2" | "pending_3plus";

function matchPullCategory(cat: PullGroupCategory, state: string, daysSince: number, fu: number): boolean {
  if (cat === "overdue_all") return state === "overdue";
  if (cat.startsWith("age_")) return state === "overdue" && overdueAgeBucket(daysSince) === cat;
  // فئات «بانتظار السحب» = حالة warning (آخر ٢٤س قبل السحب) — الرقم الرئيسي في اللوحة.
  if (state !== "warning") return false;
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
    // م-٥: حصر الجلب بما بعد أقدم assignedAt — العدّاد يحتسب ما بعد آخر إسناد فقط.
    const minAssignedAt = leads.reduce<Date | null>(
      (min, l) => (l.assignedAt && (!min || l.assignedAt < min) ? l.assignedAt : min),
      null,
    );
    const fus = ids.length
      ? await prisma.followUp.findMany({
          where: { leadId: { in: ids }, ...(minAssignedAt ? { createdAt: { gte: minAssignedAt } } : {}) },
          select: { leadId: true, result: true, createdAt: true },
        })
      : [];
    const fuByLead = new Map<string, { result: string; createdAt: Date }[]>();
    for (const f of fus) {
      const arr = fuByLead.get(f.leadId);
      if (arr) arr.push({ result: f.result, createdAt: f.createdAt });
      else fuByLead.set(f.leadId, [{ result: f.result, createdAt: f.createdAt }]);
    }

    const picked: string[] = [];
    for (const l of leads) {
      const stats = noAnswerStats(fuByLead.get(l.id) ?? [], l.assignedAt); // §١أ: عدّاد ما بعد آخر إسناد
      if (!stats.included) continue; // رد العميل → خارج النظام
      const baseline = noResponseBaseline(l.assignedAt, stats.lastNoAnswerAt, config.activationDate);
      const { state, daysSince } = noResponseState(stats.noAnswerCount, baseline, now, config);
      if (matchPullCategory(category, state, daysSince, stats.noAnswerCount)) picked.push(l.id);
    }
    if (picked.length === 0) return { ok: false, error: "ما فيه عملاء في هذي المجموعة" };
    return manualPullBatch(picked, { note: `مجموعة=${category} · موظف=${employeeId}` });
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

// نافذة التراجع عن السحب — آخر ٢٤ ساعة فقط.
const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;
const PULL_BATCH_ACTIONS = ["lead.no_response.autoPullBatch", "lead.no_response.manualPullBatch"];
const PULLED_ACTIONS = ["lead.no_response.autoPulled", "lead.no_response.manualPulled"];

/**
 * التراجع عن دفعة سحب (تلقائية أو يدوية) خلال ٢٤ ساعة — للمالك فقط.
 * يقرأ سجلّات السحب من AuditLog (batchId)، ويُرجع كل عميل لا يزال في الحوض إلى موظفه الأصلي
 * (assignedToId=fromUserId · assignedAt=now · reassignCount--)، ويحذف سطر السحب الأصلي، ويشعر الموظف.
 * ⚠️ لا يمرّ عبر distributeNoResponseBatch فلا تنطبق قاعدة «منع التوزيع للمصدر» — الإرجاع للأصل هو الهدف.
 * حارس تزامن: من أُعيد توزيعه بعد السحب لا يُرجَع (يُتخطّى بصمت).
 */
export async function undoPull(batchId: string): Promise<ActionResult> {
  try {
    const actor = await requireOwner();
    const id = batchId?.trim();
    if (!id) return { ok: false, error: "حدّد الدفعة" };
    const now = new Date();
    const cutoff = new Date(now.getTime() - UNDO_WINDOW_MS);

    // ملخّص الدفعة داخل نافذة ٢٤ ساعة (يحمل وقتها لتحديد نافذة حذف سطر السحب).
    const batch = await prisma.auditLog.findFirst({
      where: { entityId: id, action: { in: PULL_BATCH_ACTIONS }, createdAt: { gte: cutoff } },
      select: { createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    if (!batch) return { ok: false, error: "الدفعة غير موجودة أو مضى عليها أكثر من ٢٤ ساعة" };

    // سجلّات السحب لكل عميل في الدفعة (entityId=leadId، والمصدر داخل الملخّص: from=<id>).
    const leadAudits = await prisma.auditLog.findMany({
      where: { action: { in: PULLED_ACTIONS }, summary: { contains: `batch=${id}` }, createdAt: { gte: cutoff } },
      select: { entityId: true, summary: true },
    });
    const parsed = leadAudits
      .map((a) => ({ leadId: a.entityId, from: /from=([^ ·]+)/.exec(a.summary)?.[1] ?? null }))
      .filter((x): x is { leadId: string; from: string } => !!x.leadId && !!x.from);
    if (parsed.length === 0) return { ok: false, error: "ما فيه عمليات سحب قابلة للتراجع في هذي الدفعة" };

    // نافذة زمنية ضيّقة حول وقت الدفعة لحذف سطر السحب الصحيح (تجنّب حذف سحب لاحق لنفس العميل).
    const winStart = new Date(batch.createdAt.getTime() - 5 * 60_000);
    const winEnd = new Date(batch.createdAt.getTime() + 5 * 60_000);

    const restored: { leadId: string; to: string; name: string }[] = [];
    for (const p of parsed) {
      const name = await prisma.$transaction(async (tx) => {
        // حارس: لا يزال في الحوض (لم يُعَد توزيعه) → نرجّعه لموظفه الأصلي بنافذة مهلة جديدة.
        const res = await tx.lead.updateMany({
          where: { id: p.leadId, assignedToId: null, reassignCount: { gt: 0 } },
          data: { assignedToId: p.from, assignedAt: now, contactedAt: null, reassignCount: { decrement: 1 } },
        });
        if (res.count !== 1) return null;
        // احذف سطر السحب الأصلي (يبقى الأثر الدائم في AuditLog).
        await tx.reassignment.deleteMany({
          where: { leadId: p.leadId, fromUserId: p.from, toUserId: null, OR: [{ reason: { startsWith: "no_response" } }, { reason: "manual_pull" }], createdAt: { gte: winStart, lte: winEnd } },
        });
        await tx.activity.create({ data: { leadId: p.leadId, userId: actor.id, type: ActivityType.ASSIGNMENT, note: "تراجع عن السحب — رجع للموظف الأصلي" } });
        await logAudit(tx, { userId: actor.id, action: "lead.no_response.undoPull", entity: "lead", entityId: p.leadId, summary: `[batch=${id}] تراجع عن السحب · أُرجع إلى ${p.from}` });
        const lead = await tx.lead.findUnique({ where: { id: p.leadId }, select: { name: true } });
        return lead?.name ?? "عميل";
      });
      if (name === null) continue;
      restored.push({ leadId: p.leadId, to: p.from, name });
    }
    if (restored.length === 0) return { ok: false, error: "ما رجع أحد — غالبًا أُعيد توزيعهم بعد السحب" };

    // إشعار الموظفين المُرجَع إليهم (معزول).
    try {
      for (const r of restored) {
        await notify(prisma, [r.to], "lead_assigned", "رجع لك عميل", `${r.name} — رجع لك بعد التراجع عن سحب خاطئ.`, `/leads/${r.leadId}`);
      }
    } catch (e) { console.error("[undoPull] إشعارات", e); }

    await logAudit(prisma, {
      userId: actor.id, action: "lead.no_response.undoPullBatch", entity: "lead", entityId: id,
      summary: `تراجع عن دفعة سحب [batch=${id}] · أُرجع=${restored.length} عميل`,
    });

    revalidateNoResponse();
    const skipped = parsed.length - restored.length;
    return { ok: true, message: skipped > 0 ? `رجّع ${restored.length} عميل — تخطّى ${skipped} (أُعيد توزيعهم)` : `رجّع ${restored.length} عميل لموظفيهم` };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}
