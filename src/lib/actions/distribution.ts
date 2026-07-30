"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { toUserError } from "@/lib/action-error";
import { requireManager, requireRole } from "@/lib/auth-guards";
import { logAudit } from "@/lib/audit";
import { runDistributionPasses, executeSweepPull } from "@/lib/auto-distribute";

export type ActionResult = { ok: boolean; error?: string; message?: string };

export type DistConfig = {
  autoDistribute: boolean;
  /** «الحزمة ب»: السحب التلقائي للمتأخر (تنفيذ آلي بدل الاقتراح) — للمالك. */
  autoSweepEnabled: boolean;
  /** «الحزمة ب»: إعادة توزيع مسحوبي «لم يتم الرد» آليًا (كجديد) — للمالك. */
  autoRedistributeEnabled: boolean;
  /** إنذار ما قبل السحب بالدقائق (إشعار للموظف + وميض أحمر بالقائمة). */
  sweepWarnMin: number;
  /** «فاصل الاستقبال»: عميل واحد آليًا لكل موظف كل هذه الدقائق (٠ = بلا فاصل). */
  distReceiveGapMin: number;
  /** نافذة السحب التلقائي المستقلة (بتوقيت الرياض). */
  sweepStartHour: number;
  sweepEndHour: number;
  distStartHour: number;
  distEndHour: number;
  distTimeoutMin: number;
  distPresenceMin: number;
  distInitialMode: "ROUND_ROBIN" | "LEAST_LOADED" | "MOST_ACTIVE";
  distReassignMode: "ROTATION" | "LEAST_LOADED" | "MOST_ACTIVE";
  /** حوكمة التوزيع — null = بلا سقف / بلا تحديد دفعة. */
  distBatchSize: number | null;
  distPerEmployeePerWindow: number | null;
  distWindowMin: number;
  order: string[];
};

export type DistEmployee = {
  id: string; name: string; active: boolean; online: boolean;
  paused: boolean; pauseReason: string | null; pauseUntil: Date | null;
  /** سقف ما يستقبله في اليوم الواحد — null = بلا سقف. */
  dailyAssignCap: number | null;
};

const ONLINE_MS = 5 * 60 * 1000;

export type LastCron = { at: Date | null; distributed: number; reassigned: number };

/** إعدادات التوزيع + قائمة الموظفين + آخر دورة كرون + الحاجز التاريخي (للوحة الإعدادات). */
export async function getDistributionConfig(): Promise<{ config: DistConfig; employees: DistEmployee[]; lastCron: LastCron; sweepCutoffAt: Date }> {
  await requireManager();
  const s = await prisma.settings.upsert({
    where: { id: "singleton" }, update: {}, create: { id: "singleton" },
    select: {
      autoDistribute: true, autoSweepEnabled: true, autoRedistributeEnabled: true,
      sweepWarnMin: true, distReceiveGapMin: true, sweepStartHour: true, sweepEndHour: true,
      distStartHour: true, distEndHour: true, distTimeoutMin: true,
      distPresenceMin: true, distOrder: true, distInitialMode: true, distReassignMode: true,
      lastCronAt: true, lastCronDistributed: true, lastCronReassigned: true, sweepCutoffAt: true,
      distBatchSize: true, distPerEmployeePerWindow: true, distWindowMin: true,
    },
  });
  const emps = await prisma.user.findMany({
    where: { role: "EMPLOYEE" },
    select: { id: true, name: true, active: true, lastSeenAt: true, availabilityPaused: true, pauseReason: true, pauseUntil: true, dailyAssignCap: true },
    orderBy: { name: "asc" },
  });
  const now = Date.now();
  // رتّب القائمة: المشاركون (بترتيب distOrder) أولًا، ثم البقية.
  const inOrder = s.distOrder.filter((id) => emps.some((e) => e.id === id));
  const rest = emps.map((e) => e.id).filter((id) => !inOrder.includes(id));
  const ordered = [...inOrder, ...rest];
  const byId = new Map(emps.map((e) => [e.id, e]));
  return {
    config: {
      autoDistribute: s.autoDistribute,
      autoSweepEnabled: s.autoSweepEnabled,
      autoRedistributeEnabled: s.autoRedistributeEnabled,
      sweepWarnMin: s.sweepWarnMin,
      distReceiveGapMin: s.distReceiveGapMin,
      sweepStartHour: s.sweepStartHour,
      sweepEndHour: s.sweepEndHour,
      distStartHour: s.distStartHour,
      distEndHour: s.distEndHour,
      distTimeoutMin: s.distTimeoutMin,
      distPresenceMin: s.distPresenceMin,
      distInitialMode: s.distInitialMode as DistConfig["distInitialMode"],
      distReassignMode: s.distReassignMode as DistConfig["distReassignMode"],
      distBatchSize: s.distBatchSize,
      distPerEmployeePerWindow: s.distPerEmployeePerWindow,
      distWindowMin: s.distWindowMin,
      order: inOrder,
    },
    employees: ordered.map((id) => {
      const e = byId.get(id)!;
      return {
        id: e.id, name: e.name, active: e.active,
        online: !!e.lastSeenAt && now - e.lastSeenAt.getTime() < ONLINE_MS,
        paused: e.availabilityPaused, pauseReason: e.pauseReason, pauseUntil: e.pauseUntil,
        dailyAssignCap: e.dailyAssignCap,
      };
    }),
    lastCron: { at: s.lastCronAt, distributed: s.lastCronDistributed, reassigned: s.lastCronReassigned },
    sweepCutoffAt: s.sweepCutoffAt,
  };
}

function clampHour(n: number) { return Math.min(23, Math.max(0, Math.round(n))); }

/**
 * المفتاح الرئيسي «التوزيع التلقائي: شغال/متوقف» — حفظ فوري مستقل عن بقية الإعدادات
 * (يقرأ ويكتب Settings.autoDistribute). التشغيل يشترط وجود موظفين في الدور.
 */
export async function setAutoDistribute(on: boolean): Promise<ActionResult> {
  try {
    const user = await requireManager();
    if (on) {
      const s = await prisma.settings.findUnique({ where: { id: "singleton" }, select: { distOrder: true } });
      if (!s || s.distOrder.length === 0) {
        return { ok: false, error: "أضف موظفًا واحدًا على الأقل لجدول الدور قبل تشغيل التوزيع" };
      }
    }
    await prisma.settings.update({ where: { id: "singleton" }, data: { autoDistribute: on } });
    await logAudit(prisma, {
      userId: user.id, action: "settings.autoDistribute", entity: "settings", entityId: "singleton",
      summary: on ? "شغّل التوزيع التلقائي (المفتاح الرئيسي)" : "أوقف التوزيع التلقائي (المفتاح الرئيسي)",
    });
    revalidatePath("/distribution");
    return { ok: true, message: on ? "التوزيع التلقائي صار شغالًا" : "التوزيع التلقائي توقّف" };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

/** رقم موجب أو null — الصفر والسالب والفارغ كلها «بلا سقف». */
function posOrNull(v: number | null | undefined): number | null {
  const n = Math.round(Number(v) || 0);
  return n > 0 ? n : null;
}

/** حفظ إعدادات التوزيع — للمالك/المدير فقط (تحقّق على الخادم). */
export async function updateDistributionConfig(input: DistConfig): Promise<ActionResult> {
  try {
    await requireManager();
    const order = [...new Set((input.order ?? []).filter(Boolean))];
    // تحقّق أن المعرّفات تخص موظفين فعليين.
    if (order.length > 0) {
      const valid = await prisma.user.findMany({ where: { id: { in: order }, role: "EMPLOYEE" }, select: { id: true } });
      const validSet = new Set(valid.map((v) => v.id));
      if (order.some((id) => !validSet.has(id))) return { ok: false, error: "في موظف غير صالح بالقائمة" };
    }
    if (input.autoDistribute && order.length === 0) {
      return { ok: false, error: "اختر موظفًا واحدًا على الأقل للمشاركة في التوزيع" };
    }
    const startHour = clampHour(input.distStartHour);
    const endHour = clampHour(input.distEndHour);
    // مهلة السحب: بلا أرضية — القيمة كما يضبطها المالك، بحدّ أدنى تقني دقيقة واحدة
    // (صفر/سالب يعطّل المعنى). الأمان يأتي من أن السحب اقتراح لا تنفيذ: الكرون يكتب
    // SweepCandidate والنقل الفعلي لا يقع إلا بموافقة المالك في اللوحة.
    const timeout = Math.round(input.distTimeoutMin || 0);
    if (!Number.isInteger(timeout) || timeout < 1) {
      return { ok: false, error: "مهلة السحب لازم دقيقة واحدة على الأقل" };
    }
    const presence = Math.max(0, Math.round(input.distPresenceMin ?? 30));
    // طرق التوزيع الثلاث (بالترتيب / الأقل حملًا / الأكثر نشاطًا) — أي قيمة أخرى = الافتراضي.
    const initialMode = ["LEAST_LOADED", "MOST_ACTIVE"].includes(input.distInitialMode) ? input.distInitialMode : "ROUND_ROBIN";
    const reassignMode = ["LEAST_LOADED", "MOST_ACTIVE"].includes(input.distReassignMode) ? input.distReassignMode : "ROTATION";
    // «فاصل الاستقبال» — صفر = بلا فاصل، وسقف تقني ٢٤ ساعة.
    const receiveGap = Math.min(1440, Math.max(0, Math.round(input.distReceiveGapMin ?? 10)));

    await prisma.settings.update({
      where: { id: "singleton" },
      data: {
        autoDistribute: !!input.autoDistribute,
        distStartHour: startHour,
        distEndHour: endHour,
        distTimeoutMin: timeout,
        distPresenceMin: presence,
        distInitialMode: initialMode,
        distReassignMode: reassignMode,
        distReceiveGapMin: receiveGap,
        distOrder: order,
        // حوكمة الدفعات والسقوف — الصفر/السالب/الفارغ كلها «بلا سقف» (null).
        distBatchSize: posOrNull(input.distBatchSize),
        distPerEmployeePerWindow: posOrNull(input.distPerEmployeePerWindow),
        distWindowMin: Math.max(1, Math.round(input.distWindowMin || 30)),
        // المؤشّر يشير لآخر من استلم — نضبطه على آخر القائمة حتى يبدأ الدور من الأول (#41).
        distPointer: order.length > 0 ? order.length - 1 : 0,
      },
    });
    revalidatePath("/distribution");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

/**
 * «الحزمة ب»: إعدادات الأتمتة — للمالك حصرًا (تنفيذ آلي بلا موافقات لاحقة، فقرارها له وحده):
 *   autoSweepEnabled: السحب التلقائي للمتأخر (يستبدل الاقتراح اليدوي) + أرضية مهلة ٦٠ دقيقة.
 *   autoRedistributeEnabled: إعادة توزيع مسحوبي «لم يتم الرد» آليًا (كجديد).
 */
export async function updateAutoPilotConfig(input: {
  autoSweepEnabled: boolean;
  autoRedistributeEnabled: boolean;
  distTimeoutMin: number;
  /** دقائق إنذار ما قبل السحب (١–١٢٠). */
  sweepWarnMin: number;
  /** نافذة السحب التلقائي (بتوقيت الرياض). */
  sweepStartHour: number;
  sweepEndHour: number;
  /** طريقة إعادة توزيع المسحوب: بالترتيب (الافتراضي) / الأقل حملًا / الأكثر نشاطًا. */
  distReassignMode: "ROTATION" | "LEAST_LOADED" | "MOST_ACTIVE";
}): Promise<ActionResult> {
  try {
    const user = await requireRole("OWNER");
    const timeout = Math.round(input.distTimeoutMin || 0);
    if (!Number.isInteger(timeout) || timeout < 1) return { ok: false, error: "المهلة لازم دقيقة واحدة على الأقل" };
    // أرضية أمان: مع التنفيذ الآلي ما فيه موافقة لاحقة تصحّح مهلة متهورة.
    if (input.autoSweepEnabled && timeout < 60) {
      return { ok: false, error: "مع السحب التلقائي، المهلة ما تنزل عن ٦٠ دقيقة (أرضية أمان)" };
    }
    const warn = Math.round(input.sweepWarnMin || 0);
    if (warn < 1 || warn > 120) return { ok: false, error: "دقائق الإنذار بين ١ و١٢٠" };
    if (warn >= timeout) return { ok: false, error: "الإنذار لازم يكون أقصر من المهلة نفسها" };
    const reassignMode = ["LEAST_LOADED", "MOST_ACTIVE"].includes(input.distReassignMode) ? input.distReassignMode : "ROTATION";
    await prisma.settings.update({
      where: { id: "singleton" },
      data: {
        autoSweepEnabled: !!input.autoSweepEnabled,
        autoRedistributeEnabled: !!input.autoRedistributeEnabled,
        distTimeoutMin: timeout,
        sweepWarnMin: warn,
        sweepStartHour: clampHour(input.sweepStartHour),
        sweepEndHour: clampHour(input.sweepEndHour),
        distReassignMode: reassignMode,
      },
    });
    await logAudit(prisma, {
      userId: user.id, action: "settings.autoPilot", entity: "settings", entityId: "singleton",
      summary: `إعدادات السحب: تلقائي=${input.autoSweepEnabled ? "شغال" : "متوقف"} · إعادة توزيع المسحوبين=${input.autoRedistributeEnabled ? "شغال" : "متوقف"} · المهلة=${timeout}د · الإنذار=${warn}د · النافذة=${clampHour(input.sweepStartHour)}→${clampHour(input.sweepEndHour)} · الطريقة=${reassignMode}`,
    });
    revalidatePath("/distribution");
    return { ok: true, message: "حُفظت إعدادات السحب التلقائي" };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

/** تشغيل دورة التوزيع يدويًا (زر «افحص الآن» في اللوحة) — يحترم السويتشين. */
export async function runSweepNow(): Promise<ActionResult> {
  try {
    await requireManager();
    const res = await runDistributionPasses();
    if (!res.ok) return { ok: false, error: res.error ?? "صار خطأ" };
    revalidatePath("/distribution");
    revalidatePath("/leads");
    const i = res.initialDistribute;
    const s = res.reassignSweep;
    const part = (label: string, p: typeof i) => `${label}: ${p.on ? p.count : "مطفأ"}${p.on && p.skipped ? ` (${p.skipped})` : ""}`;
    return { ok: true, message: `${part("توزيع أولي", i)} · ${part("ترشيح للسحب", s)}` };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

// ===================== قاعدة ٥: مرشّحو السحب (موافقة المالك) =====================

export type SweepCandidateRow = {
  id: string;
  leadId: string;
  leadName: string;
  fromName: string | null;
  assignedAt: Date | null;
  lastActivityAt: Date | null;
  reason: string;
  timeoutMin: number | null;
};

/** قائمة المرشّحين للسحب (المعلّقين بانتظار قرار المالك). */
export async function getSweepCandidates(): Promise<SweepCandidateRow[]> {
  await requireManager();
  const cands = await prisma.sweepCandidate.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      lead: { select: { name: true, activities: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } } } },
    },
  });
  const fromIds = [...new Set(cands.map((c) => c.fromUserId).filter(Boolean) as string[])];
  const users = fromIds.length
    ? await prisma.user.findMany({ where: { id: { in: fromIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  return cands.map((c) => ({
    id: c.id,
    leadId: c.leadId,
    leadName: c.lead?.name ?? "—",
    fromName: c.fromUserId ? nameById.get(c.fromUserId) ?? null : null,
    assignedAt: c.leadAssignedAt,
    lastActivityAt: c.lead?.activities[0]?.createdAt ?? null,
    reason: c.reason,
    timeoutMin: c.timeoutMin,
  }));
}

/** «اسحب» — المالك يوافق على سحب مرشّح واحد وينقله فعليًا. */
export async function approveSweepPull(candidateId: string): Promise<ActionResult> {
  try {
    await requireRole("OWNER");
    const cand = await prisma.sweepCandidate.findUnique({ where: { id: candidateId }, select: { leadId: true } });
    if (!cand) return { ok: false, error: "المرشّح غير موجود (ربما عُولج)" };
    const res = await executeSweepPull(cand.leadId);
    if (!res.ok) return { ok: false, error: res.error ?? "تعذّر السحب" };
    revalidatePath("/distribution");
    revalidatePath("/leads");
    return { ok: true, message: "تم سحب العميل ونقله لموظف آخر" };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

/** «اترك عنده» — يترك العميل عند موظفه ويمنحه حصانة دائمة (لا يُرشَّح ثانية). */
export async function dismissSweepCandidate(candidateId: string): Promise<ActionResult> {
  try {
    await requireRole("OWNER");
    const cand = await prisma.sweepCandidate.findUnique({ where: { id: candidateId }, select: { leadId: true } });
    if (!cand) return { ok: false, error: "المرشّح غير موجود" };
    await prisma.$transaction([
      prisma.lead.update({ where: { id: cand.leadId }, data: { manualAssignedAt: new Date() } }),
      prisma.sweepCandidate.delete({ where: { id: candidateId } }),
    ]);
    revalidatePath("/distribution");
    return { ok: true, message: "تُرك العميل عند موظفه (حصانة دائمة)" };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

/** «اترك الكل» — يترك كل المرشّحين المعلّقين ويمنحهم حصانة دائمة. */
export async function dismissAllSweepCandidates(): Promise<ActionResult> {
  try {
    await requireRole("OWNER");
    const cands = await prisma.sweepCandidate.findMany({ select: { id: true, leadId: true } });
    if (cands.length === 0) return { ok: true, message: "ما فيه مرشّحون" };
    const now = new Date();
    await prisma.$transaction([
      prisma.lead.updateMany({ where: { id: { in: cands.map((c) => c.leadId) } }, data: { manualAssignedAt: now } }),
      prisma.sweepCandidate.deleteMany({ where: { id: { in: cands.map((c) => c.id) } } }),
    ]);
    revalidatePath("/distribution");
    return { ok: true, message: `تُرك ${cands.length} عميل عند موظفيهم` };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

// ===================== قاعدة ٣: الحاجز التاريخي للسحب =====================

/** ضبط تاريخ بداية السحب (أي ليد أُسند قبله محميّ). */
export async function updateSweepCutoff(iso: string): Promise<ActionResult> {
  try {
    await requireRole("OWNER");
    const d = new Date(iso);
    if (isNaN(d.getTime())) return { ok: false, error: "تاريخ غير صالح" };
    await prisma.settings.update({ where: { id: "singleton" }, data: { sweepCutoffAt: d } });
    revalidatePath("/distribution");
    return { ok: true, message: "تم تحديث حاجز السحب التاريخي" };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

/** «حماية كل العملاء الحاليين» — يضبط الحاجز على الآن، فالسحب يبدأ من ما بعده فقط. */
export async function protectAllCurrentFromSweep(): Promise<ActionResult> {
  try {
    await requireRole("OWNER");
    await prisma.settings.update({ where: { id: "singleton" }, data: { sweepCutoffAt: new Date() } });
    revalidatePath("/distribution");
    return { ok: true, message: "تم حماية كل العملاء الحاليين — السحب يبدأ من الآن" };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

// ===================== أبواب بركة التوزيع التلقائي (٢ و ٣) =====================
// القاعدة القاطعة: العميل في البركة ⟺ autoPoolAt != null، وmanualAssignedAt != null
// يعني خارجها دائمًا. لذلك كل باب يمسح manualAssignedAt عند الإدخال — الاثنان متنافيان.
// الصلاحية على الخادم (requireManager) لا على الواجهة.

/** حدّ أقصى للدفعة الواحدة — يمنع إدخال آلاف العملاء بضغطة واحدة بالخطأ. */
const POOL_ADMIT_CAP = 500;

/**
 * الباب ٢: إدخال عملاء **غير موزّعين** إلى البركة.
 * لا يمسّ أي عميل مُسند — من له موظف يمرّ بالباب ٣ وحده.
 */
export async function admitToAutoPool(leadIds: string[]): Promise<ActionResult> {
  try {
    const user = await requireManager();
    const ids = [...new Set((leadIds ?? []).filter(Boolean))];
    if (ids.length === 0) return { ok: false, error: "ما حدّدت عملاء" };
    if (ids.length > POOL_ADMIT_CAP) return { ok: false, error: `الحد الأقصى ${POOL_ADMIT_CAP} عميل في المرة` };

    // الشرط الصارم: غير موزّع + جديد + غير مؤرشف + ليس في البركة أصلًا.
    const eligible = await prisma.lead.findMany({
      where: { id: { in: ids }, assignedToId: null, stage: "NEW", isArchived: false, autoPoolAt: null },
      select: { id: true },
    });
    if (eligible.length === 0) {
      return { ok: false, error: "ما فيه عميل مؤهّل — الشرط: غير موزّع، مرحلته «جديد»، وغير موجود في البركة" };
    }
    const eligibleIds = eligible.map((l) => l.id);
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.lead.updateMany({
        where: { id: { in: eligibleIds } },
        data: { autoPoolAt: now, manualAssignedAt: null },
      });
      await logAudit(tx, {
        userId: user.id,
        action: "lead.autoPoolAdmitted",
        entity: "lead",
        entityId: eligibleIds[0],
        summary: `أدخل ${eligibleIds.length} عميلًا لبركة التوزيع التلقائي (غير موزّعين)`,
      });
    });
    revalidatePath("/distribution");
    revalidatePath("/leads");
    const skipped = ids.length - eligibleIds.length;
    return {
      ok: true,
      message: skipped > 0
        ? `دخل ${eligibleIds.length} عميلًا البركة — و${skipped} غير مؤهّلين (مُسندون أو في البركة أصلًا)`
        : `دخل ${eligibleIds.length} عميلًا بركة التوزيع التلقائي`,
    };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

/**
 * الباب ٣: تحويل عملاء **مُسندين لموظف** إلى البركة — يسحبهم من صاحبهم الحالي.
 * يمسح الإسناد ويمسح حصانة اليدوي ويضع ختم البركة، ويسجّل في سجل التدقيق:
 * من كان يملكه · إلى البركة · بأمر مَن.
 */
export async function transferToAutoPool(leadIds: string[]): Promise<ActionResult> {
  try {
    const user = await requireManager();
    const ids = [...new Set((leadIds ?? []).filter(Boolean))];
    if (ids.length === 0) return { ok: false, error: "ما حدّدت عملاء" };
    if (ids.length > POOL_ADMIT_CAP) return { ok: false, error: `الحد الأقصى ${POOL_ADMIT_CAP} عميل في المرة` };

    const targets = await prisma.lead.findMany({
      where: { id: { in: ids }, isArchived: false },
      select: { id: true, name: true, assignedToId: true },
    });
    if (targets.length === 0) return { ok: false, error: "ما فيه عملاء مطابقون" };

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      for (const t of targets) {
        await tx.lead.update({
          where: { id: t.id },
          data: {
            assignedToId: null,
            autoPoolAt: now,
            manualAssignedAt: null,
            assignedAt: null,
            contactedAt: null,
          },
        });
        // سجل التحويل نفسه (من → الحوض) بنفس نمط Reassignment القائم.
        if (t.assignedToId) {
          await tx.reassignment.create({
            data: { leadId: t.id, fromUserId: t.assignedToId, toUserId: null, reason: "to_auto_pool" },
          });
        }
        await tx.activity.create({
          data: { leadId: t.id, userId: user.id, type: "ASSIGNMENT", note: "حُوّل إلى بركة التوزيع التلقائي" },
        });
      }
      await logAudit(tx, {
        userId: user.id,
        action: "lead.autoPoolTransferred",
        entity: "lead",
        entityId: targets[0].id,
        summary: `حوّل ${targets.length} عميلًا إلى بركة التوزيع التلقائي (سُحبوا من أصحابهم)`,
      });
    });
    revalidatePath("/distribution");
    revalidatePath("/leads");
    return { ok: true, message: `حُوّل ${targets.length} عميلًا إلى البركة — المحرك يوزّعهم في الدورة القادمة` };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

/** إخراج عملاء من البركة (تراجع) — يعيدهم خارج المحرك بلا لمس إسنادهم. */
export async function removeFromAutoPool(leadIds: string[]): Promise<ActionResult> {
  try {
    const user = await requireManager();
    const ids = [...new Set((leadIds ?? []).filter(Boolean))];
    if (ids.length === 0) return { ok: false, error: "ما حدّدت عملاء" };
    const res = await prisma.lead.updateMany({
      where: { id: { in: ids }, autoPoolAt: { not: null } },
      data: { autoPoolAt: null },
    });
    if (res.count === 0) return { ok: false, error: "ما فيه عميل داخل البركة من المحدّدين" };
    await logAudit(prisma, {
      userId: user.id, action: "lead.autoPoolRemoved", entity: "lead", entityId: ids[0],
      summary: `أخرج ${res.count} عميلًا من بركة التوزيع التلقائي`,
    });
    revalidatePath("/distribution");
    revalidatePath("/leads");
    return { ok: true, message: `خرج ${res.count} عميلًا من البركة` };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

/** عدد العملاء داخل البركة الآن (للوحة والمعاينة). */
export async function countAutoPool(): Promise<{ total: number; unassigned: number; assigned: number }> {
  await requireManager();
  const [total, unassigned] = await Promise.all([
    prisma.lead.count({ where: { autoPoolAt: { not: null }, isArchived: false } }),
    prisma.lead.count({ where: { autoPoolAt: { not: null }, isArchived: false, assignedToId: null } }),
  ]);
  return { total, unassigned, assigned: total - unassigned };
}

/** حفظ السقوف اليومية لدفعة موظفين (عمود «السقف اليومي» في لوحة التوزيع). */
export async function updateDailyAssignCaps(
  items: { userId: string; cap: number | null }[],
): Promise<ActionResult> {
  try {
    await requireManager();
    const rows = (items ?? []).filter((i) => i.userId);
    if (rows.length === 0) return { ok: true };
    await prisma.$transaction(
      rows.map((r) =>
        prisma.user.update({
          where: { id: r.userId },
          data: { dailyAssignCap: r.cap != null && r.cap > 0 ? Math.round(r.cap) : null },
        }),
      ),
    );
    revalidatePath("/distribution");
    return { ok: true, message: `حُدّث السقف اليومي لـ${rows.length} موظف` };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}
