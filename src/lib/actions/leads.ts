"use server";

import { revalidatePath } from "next/cache";
import {
  ActivityType,
  Channel,
  LeadStage,
  Priority,
  UnitType,
} from "@prisma/client";
import type { PurchaseMethod, PurchaseGoal, FirstContactStage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toUserError } from "@/lib/action-error";
import { parseEnum } from "@/lib/parse-enum";
import { requireUser, isManager, requireManagerAction } from "@/lib/auth-guards";
import { logAudit } from "@/lib/audit";
import { emitNotification, emitLeadAssignedBatch, notifyBestEffort } from "@/lib/notifications/emit";
import { pickInitialAssignee, markContacted } from "@/lib/auto-distribute";
import { assignLead, assignLeadsToEmployee, assignmentData, FRESH_RESET_DATA } from "@/lib/assignment";
import { applyStageChange } from "@/lib/stage-change";
import { latestRevealAction, shouldHideHistory, REVEAL_HISTORY_ACTION, HIDE_HISTORY_ACTION } from "@/lib/visibility";
import { isRecentSameAdDuplicate, phoneHasExistingLead } from "@/lib/phone-dupe";
import { getLeadDetail, type LeadDetail } from "@/lib/data/leads";
import { channelForSourceName } from "@/lib/source-channel";
import { resolveAutoPoolAt } from "@/lib/auto-pool";
import { manualTransferReason, redistributeReason, MANUAL_UNARCHIVE_FRESH, type TransferMode } from "@/lib/transfer-mode";
import { ALL_AREAS, canonicalAreas } from "@/lib/districts";

export type ActionResult = { ok: boolean; error?: string };

/** جلب تفاصيل العميل للدرج (مع تحقق الصلاحية داخل getLeadDetail). */
export async function fetchLeadDetail(id: string): Promise<LeadDetail | null> {
  return getLeadDetail(id);
}

/** يتحقق أن العميل ضمن صلاحية المستخدم (مالكه أو مدير). يرجّع المستخدم أو يرمي. */
async function assertLeadAccess(leadId: string) {
  const user = await requireUser();
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, assignedToId: true, stage: true },
  });
  if (!lead) throw new Error("العميل غير موجود");
  if (!isManager(user.role) && lead.assignedToId !== user.id) {
    throw new Error("ما عندك صلاحية على هذا العميل");
  }
  return { user, lead };
}

function revalidateLeads() {
  revalidatePath("/leads");
  revalidatePath("/pipeline");
  revalidatePath("/dashboard");
  revalidatePath("/analytics");
}

/** إنشاء عميل جديد. الموظف يُسند العميل لنفسه؛ المدير يقدر يختار. */
export async function createLead(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();

    const name = String(formData.get("name") ?? "").trim();
    const phone = String(formData.get("phone") ?? "").trim();
    if (!name) return { ok: false, error: "اكتب اسم العميل" };
    if (!/^\d{9,10}$/.test(phone.replace(/\s/g, "")))
      return { ok: false, error: "رقم جوال غير صحيح" };

    const channel = parseEnum(Channel, formData.get("channel"), Channel.OTHER)!;
    // المصدر إجباري عند الإضافة اليدوية.
    const sourceId = String(formData.get("sourceId") ?? "").trim();
    if (!sourceId) return { ok: false, error: "اختر مصدر العميل" };
    const sourceExists = await prisma.leadSource.findUnique({ where: { id: sourceId }, select: { id: true } });
    if (!sourceExists) return { ok: false, error: "المصدر غير صالح" };
    const unitTypeRaw = formData.get("unitType") as string;
    const unitType =
      unitTypeRaw && unitTypeRaw in UnitType
        ? (unitTypeRaw as UnitType)
        : null;
    const budgetRaw = String(formData.get("budget") ?? "").replace(/[^\d]/g, "");
    const budget = budgetRaw ? Number(budgetRaw) : null;
    const notes = String(formData.get("notes") ?? "").trim() || null;
    // «في أي حي تفضّل التملك؟» — اختياري. التحقق على الخادم: القيم المعتمدة فقط.
    const preferredAreas = canonicalAreas(
      formData.getAll("preferredAreas").map(String).filter((a) => ALL_AREAS.includes(a)),
    );

    // استثناء المكرر: نفس الرقم + نفس الإعلان (المصدر) خلال ٤٨ ساعة = ضجيج/تكرار آلي → لا نضيف نسخة.
    // غير ذلك (مصدر مختلف أو بعد ٤٨ ساعة) يُضاف ويظهر في «العملاء المكررون».
    if (await isRecentSameAdDuplicate(phone, { sourceId, channel }, new Date())) {
      return { ok: false, error: "هذا الرقم مضاف من نفس المصدر خلال آخر ٤٨ ساعة — ما نضيف نسخة مكرّرة." };
    }
    // مكرر (جواله يطابق سجلًا موجودًا بآخر-٩) = لا يُسنَد آليًا؛ يبقى معلّقًا في «العملاء المكررون».
    const isDup = await phoneHasExistingLead(phone);

    // الإسناد: المكرر لا يُوزّع آليًا (يبقى غير موزّع) — نحترم اختيار المدير الصريح فقط.
    // autoDistributed = أُسند عبر التوزيع التلقائي → يبدأ عدّاد إعادة التوجيه (assignedAt).
    let assignedToId: string | null = isDup ? null : user.id;
    let autoDistributed = false;
    const chosen = String(formData.get("assignedToId") ?? "");
    if (isDup) {
      if (isManager(user.role) && chosen) assignedToId = chosen; // اختيار صريح فقط، لا تلقائي
    } else if (isManager(user.role)) {
      if (chosen) {
        assignedToId = chosen;
      } else {
        // التوزيع التلقائي الذكي (إن مُفعّل وداخل النافذة ومع وجود مشاركين متواجدين).
        // حُذف الـfallback القديم (autoAssign للأقل حملًا) — كان يتجاهل distOrder
        // والنافذة الزمنية وmaxClients، فيوزّع بمجمّع مختلف عن نظام التوزيع الرسمي.
        const picked = await pickInitialAssignee(prisma);
        if (picked) {
          assignedToId = picked;
          autoDistributed = true;
        }
      }
    }

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    // باب البركة ١: مصدر موسوم autoPool → العميل يدخل بركة التوزيع التلقائي عند إنشائه.
    // لا يدخلها إن اختار المدير موظفًا صراحةً (قرار بشري = يدوي = خارج البركة دائمًا).
    const autoPoolAt = await resolveAutoPoolAt(sourceId, assignedToId, autoDistributed);

    const lead = await prisma.lead.create({
      data: {
        name,
        phone,
        channel,
        unitType,
        budget,
        notes,
        createdById: user.id,
        sourceId,
        stage: LeadStage.NEW,
        priority: Priority.MEDIUM,
        nextFollowup: tomorrow,
        ...(preferredAreas.length ? { preferredAreas } : {}),
        // م-١: أختام الإسناد الموحّدة — اختيار بشري (موظف لنفسه/مدير) = يدوي بحصانته.
        ...(assignedToId ? assignmentData(assignedToId, { manual: !autoDistributed }) : {}),
        ...(autoPoolAt ? { autoPoolAt } : {}),
      },
    });
    if (assignedToId) {
      await prisma.reassignment.create({
        data: { leadId: lead.id, fromUserId: null, toUserId: assignedToId, reason: autoDistributed ? "initial" : "manual" },
      });
    }
    // آثار جانبية بعد الحفظ — فشلها ما يُفشِل إنشاء العميل (#29).
    await notifyBestEffort("lead.created.audit", () =>
      logAudit(prisma, { userId: user.id, action: "lead.created", entity: "lead", entityId: lead.id, summary: `أضاف عميل ${name}` }));
    // حدث: توزّع عليك عميل — يُطلق فقط عند الإسناد لموظف غير المُنشئ (إسناد مدير/تلقائي).
    if (assignedToId && assignedToId !== user.id) {
      await notifyBestEffort("lead.created.notify", () =>
        emitNotification({
          eventKey: "lead_assigned",
          assignedUserId: assignedToId,
          title: "توزّع عليك عميل",
          body: `العميل: ${name}`,
          link: `/leads/${lead.id}`,
        }));
    }

    revalidateLeads();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toUserError(e, "lead.create") };
  }
}

/** تغيير مرحلة العميل من الدرج — م-٢: نفس مسار الكانبان بالضبط (applyStageChange). */
export async function updateLeadStage(
  leadId: string,
  stage: LeadStage,
): Promise<ActionResult> {
  try {
    const { user, lead } = await assertLeadAccess(leadId);
    if (lead.stage === stage) return { ok: true };
    // «غير مهتم» لا يُقبل كتحويل مرحلة مباشر — لازم يمرّ بسبب منظّم عبر POST /followups.
    if (stage === LeadStage.CLOSED_LOST) {
      return { ok: false, error: "تحويل «غير مهتم» لازم يكون مع سبب — سجّله من نتيجة المتابعة." };
    }
    // «موعد زيارة مؤكّد» بلا تاريخ زيارة = مرحلة بلا موعد ولا تذكير — نفس منع الكانبان بالضبط.
    if (stage === LeadStage.VISIT_SCHEDULED) {
      return { ok: false, error: "موعد الزيارة يُسجَّل من متابعة «زيارة» بتاريخ ووقت — مو بتغيير المرحلة." };
    }

    const full = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, stage: true, firstContactStage: true, firstContactDate: true, firstContactAt: true },
    });
    if (!full) return { ok: false, error: "العميل غير موجود" };

    await prisma.$transaction((tx) => applyStageChange(tx, full, stage, user.id, "من الدرج"));

    revalidateLeads();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

/** تسجيل متابعة/نشاط على العميل. */
export async function addActivity(
  leadId: string,
  type: ActivityType,
  note: string,
): Promise<ActionResult> {
  try {
    const { user } = await assertLeadAccess(leadId);

    const bumpsAttempt =
      type === ActivityType.CALL || type === ActivityType.WHATSAPP;
    // م-٢: «تواصل فعلي» = مكالمة/واتساب/زيارة/موعد فقط — ملاحظة داخلية (NOTE) أو تغيير
    // مرحلة لا يضبطان firstContactAt (كانا ينفخان «نسبة الرد» في التحليلات).
    const isContact =
      bumpsAttempt || type === ActivityType.VISIT || type === ActivityType.APPOINTMENT;

    await prisma.$transaction(async (tx) => {
      await tx.activity.create({
        data: { leadId, userId: user.id, type, note: note.trim() || null },
      });
      const lead = await tx.lead.findUnique({
        where: { id: leadId },
        select: { firstContactAt: true },
      });
      await tx.lead.update({
        where: { id: leadId },
        data: {
          lastContact: new Date(),
          ...(isContact ? { firstContactAt: lead?.firstContactAt ?? new Date() } : {}),
          ...(bumpsAttempt ? { attempts: { increment: 1 } } : {}),
        },
      });
      // مكالمة/واتساب = «تواصل» يوقف عدّاد إعادة التوجيه التلقائي.
      if (bumpsAttempt) await markContacted(tx, leadId);
    });

    revalidateLeads();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

/** تحديث أولوية/متابعة/ملاحظات العميل. */
export async function updateLeadFields(
  leadId: string,
  data: { priority?: Priority; nextFollowup?: string | null; notes?: string },
): Promise<ActionResult> {
  try {
    await assertLeadAccess(leadId);
    await prisma.lead.update({
      where: { id: leadId },
      data: {
        ...(data.priority ? { priority: data.priority } : {}),
        ...(data.notes !== undefined ? { notes: data.notes.trim() || null } : {}),
        ...(data.nextFollowup !== undefined
          ? { nextFollowup: data.nextFollowup ? new Date(data.nextFollowup) : null }
          : {}),
      },
    });
    // تحديد موعد متابعة قادم = «تواصل» يوقف عدّاد إعادة التوجيه.
    if (data.nextFollowup) await markContacted(prisma, leadId);
    revalidateLeads();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

/** حذف جماعي — المدير يحذف أي عميل، الموظف يحذف عملاءه فقط. */
/** حذف جماعي نهائي للعملاء — للمالك/المدير فقط (يُتحقق على الخادم). */
export async function bulkDelete(ids: string[]): Promise<ActionResult> {
  try {
    const user = await requireManagerAction(); // OWNER/ADMIN فقط — يرفض الموظف
    if (ids.length === 0) return { ok: false, error: "ما فيه عملاء محدّدين" };
    // امنع حذف عميل عنده بيع مكتمل — البيع سجل مالي ما ينمحي بحذف جماعي.
    const soldBks = await prisma.booking.findMany({
      where: { leadId: { in: ids }, stage: { in: ["SOLD", "DELIVERED"] } },
      select: { lead: { select: { name: true } } },
    });
    if (soldBks.length) {
      const names = [...new Set(soldBks.map((b) => b.lead.name))].join("، ");
      return { ok: false, error: `ما نقدر نحذف: عندهم مبيعات مسجّلة (${names}) — ألغِ البيع أول أو استثنِهم` };
    }
    // حرّر وحدات الحجوزات غير المباعة فقط قبل الحذف (الحجز يُحذف تلقائيًا cascade).
    const bks = await prisma.booking.findMany({ where: { leadId: { in: ids } }, select: { unitId: true } });
    const unitIds = bks.map((b) => b.unitId);
    await prisma.$transaction([
      ...(unitIds.length ? [prisma.unit.updateMany({ where: { id: { in: unitIds } }, data: { status: "AVAILABLE" } })] : []),
      prisma.lead.deleteMany({ where: { id: { in: ids } } }),
    ]);
    await logAudit(prisma, { userId: user.id, action: "lead.deleted", entity: "lead", summary: `حذف ${ids.length} عميل نهائيًا` });
    revalidateLeads();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

/** أرشفة جماعية — تنقل العملاء لتبويب «تم الحجز/الشراء». المدير للكل، الموظف لعملائه فقط. */
export async function bulkArchive(ids: string[]): Promise<ActionResult> {
  try {
    const user = await requireUser();
    if (ids.length === 0) return { ok: false, error: "ما فيه عملاء محدّدين" };
    const scope = isManager(user.role) ? {} : { assignedToId: user.id };
    const res = await prisma.lead.updateMany({ where: { id: { in: ids }, ...scope }, data: { isArchived: true } });
    await logAudit(prisma, { userId: user.id, action: "lead.archived", entity: "lead", summary: `أرشف ${res.count} عميل` });
    revalidateLeads();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

/** أنماط إرجاع العميل من الأرشيف (٦-٤). */
export type UnarchiveMode = "asis" | "freshUnassigned" | "freshKeepEmployee";

/**
 * إرجاع عملاء من تبويب «مؤرشف». المتابعات (FollowUp) لا تُمسح أبدًا في أي نمط.
 * النطاق مثل bulkArchive: الموظف على عملائه فقط، المدير/المالك على الكل (فرض على الخادم).
 * - asis: يشيل الأرشفة فقط (المرحلة والإسناد كما هما) → يرجع لتبويبه الطبيعي — سلوك مقصود.
 * - freshUnassigned: «ولادة كاملة» (FRESH_RESET_DATA) + بلا موظف → حوض «غير موزّعين».
 * - freshKeepEmployee: «ولادة كاملة» + يبقى مع موظفه بإسناد مجدَّد وسبب `_fresh` —
 *   فيطلع له كعميل جديد بنموذج أول تواصل من الصفر وسجله القديم مخفي (وظاهر للمالك).
 */
export async function unarchiveLeads(ids: string[], mode: UnarchiveMode): Promise<ActionResult> {
  try {
    const user = await requireUser();
    if (ids.length === 0) return { ok: false, error: "ما فيه عملاء محدّدين" };
    const scope = isManager(user.role) ? {} : { assignedToId: user.id };

    if (mode === "asis") {
      const res = await prisma.lead.updateMany({ where: { id: { in: ids }, ...scope }, data: { isArchived: false } });
      await logAudit(prisma, { userId: user.id, action: "lead.unarchived", entity: "lead", summary: `أرجع ${res.count} عميل من الأرشيف (asis)` });
      revalidateLeads();
      return { ok: true };
    }

    // أوضاع «كجديد» — «مسوّق» يُستثنى من الإحياء (يبقى بإمكان إرجاعه asis كسجل تاريخي).
    const targets = await prisma.lead.findMany({
      where: { id: { in: ids }, ...scope, NOT: { followUps: { some: { result: "NOT_INTERESTED_MARKETER" } } } },
      select: { id: true, assignedToId: true },
    });
    if (targets.length === 0) {
      return { ok: false, error: "ما فيه عملاء قابلين للإحياء (المسوّقون مستثنون)" };
    }

    await prisma.$transaction(async (tx) => {
      if (mode === "freshUnassigned") {
        // ولادة كاملة + رجوع للحوض: تصفير أختام الإسناد (متسق مع مسارات السحب للحوض)،
        // وسجل حدث (toUserId=null) يوثّق الإحياء — الإخفاء يتفعّل عند توزيعه لاحقًا بلاحقة _fresh.
        await tx.lead.updateMany({
          where: { id: { in: targets.map((t) => t.id) } },
          data: { ...FRESH_RESET_DATA, assignedToId: null, assignedAt: null, contactedAt: null },
        });
        await tx.reassignment.createMany({
          data: targets.map((t) => ({ leadId: t.id, fromUserId: t.assignedToId, toUserId: null, reason: MANUAL_UNARCHIVE_FRESH })),
        });
      } else {
        // freshKeepEmployee: الإسناد يُجدَّد عبر الدالة الموحّدة (assignedAt جديد + سجل بسبب
        // _fresh) — فيشتغل إخفاء التاريخ ونافذة الحالة بنفس آلية النقل «كجديد» حرفيًا.
        const withEmp = targets.filter((t) => t.assignedToId);
        const withoutEmp = targets.filter((t) => !t.assignedToId);
        for (const t of withEmp) {
          await assignLead(tx, t.id, t.assignedToId as string, {
            manual: true,
            reason: MANUAL_UNARCHIVE_FRESH,
            fromUserId: t.assignedToId,
            extraData: FRESH_RESET_DATA,
          });
        }
        // بلا موظف أصلًا؟ ما فيه أحد «يبقى عنده» — يعامَل كرجوع للحوض (ولادة كاملة).
        if (withoutEmp.length) {
          await tx.lead.updateMany({
            where: { id: { in: withoutEmp.map((t) => t.id) } },
            data: { ...FRESH_RESET_DATA, assignedToId: null, assignedAt: null, contactedAt: null },
          });
        }
      }
      await logAudit(tx, { userId: user.id, action: "lead.unarchived", entity: "lead", summary: `أرجع ${targets.length} عميل من الأرشيف (${mode} — ولادة كاملة)` });
    });
    revalidateLeads();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

/**
 * توزيع سجل مكرر لموظف — بأنماط unarchive الثلاثة. المتابعات (FollowUp) لا تُمسح في أي نمط.
 * مالك/مدير فقط (قائمة المكررين managerOnly) — الفرض على الخادم. الإسناد للمالك ممنوع.
 * - asis: ينقله للموظف المختار، المرحلة والمتابعات محفوظة.
 * - freshKeepEmployee: يصفّر المرحلة «جديد» ويُسنده للموظف المختار (المتابعات محفوظة).
 * - freshUnassigned: يصفّر المرحلة «جديد» + بلا موظف → حوض «غير موزّعين» (المتابعات محفوظة).
 */
export async function distributeDuplicateLead(
  leadId: string,
  mode: UnarchiveMode,
  toUserId: string | null,
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    if (user.role !== "OWNER") return { ok: false, error: "توزيع المكررين للمالك فقط" };
    if (!leadId) return { ok: false, error: "ما فيه عميل محدّد" };

    const needsEmployee = mode === "asis" || mode === "freshKeepEmployee";
    if (needsEmployee) {
      if (!toUserId) return { ok: false, error: "اختر الموظف" };
      const target = await prisma.user.findUnique({ where: { id: toUserId }, select: { role: true, active: true } });
      if (!target || !target.active || target.role === "OWNER") return { ok: false, error: "الموظف غير صالح" };
    }
    // «مسوّق» لا يُعاد إحياؤه — سُجّل أنه عقاري/منافس وليس عميلًا.
    const isMarketer = await prisma.followUp.findFirst({
      where: { leadId, result: "NOT_INTERESTED_MARKETER" },
      select: { id: true },
    });
    if (isMarketer) return { ok: false, error: "هذا مسجّل «مسوّق» (عقاري/منافس) — ما يُعاد توزيعه." };

    // نعدّل حقول Lead فقط — المتابعات تبقى محفوظة في الأنماط الثلاثة.
    if (mode === "freshUnassigned") {
      await prisma.lead.update({
        where: { id: leadId },
        data: { stage: LeadStage.NEW, assignedToId: null, assignedAt: null, contactedAt: null },
      });
    } else {
      // م-١: الإسناد عبر الدالة الموحّدة (أختام كاملة + Reassignment). توزيع المكرر قرار بشري = يدوي.
      await assignLead(prisma, leadId, toUserId as string, {
        manual: true,
        reason: "manual_redistribute",
        extraData: mode === "freshKeepEmployee" ? { stage: LeadStage.NEW } : {},
      });
    }
    await logAudit(prisma, { userId: user.id, action: "lead.distributed", entity: "lead", entityId: leadId, summary: `وزّع مكرر (${mode})` });
    revalidateLeads();
    revalidatePath("/leads/duplicates");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

/**
 * الخطوة ٣ج: تبديل كشف سجل عميل موزَّع «كجديد» — للمالك فقط.
 * يكتب AuditLog بنوع REVEAL_HISTORY (كشف) أو HIDE_HISTORY (إعادة إخفاء) بالتناوب؛
 * shouldHideHistory يقرأ الأحدث ويقرّر. يرجّع الحالة الجديدة لعرضها فورًا.
 */
export async function toggleRevealHistory(leadId: string): Promise<{ ok: boolean; revealed?: boolean; error?: string }> {
  try {
    const user = await requireUser();
    if (user.role !== "OWNER") return { ok: false, error: "كشف السجل للمالك فقط" };
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, name: true, assignedAt: true } });
    if (!lead) return { ok: false, error: "العميل غير موجود" };

    // الحالة الحالية ضمن التوزيعة الحالية فقط — كشف توزيعة سابقة لاغٍ (الافتراضي رجع «مخفي»).
    const current = await latestRevealAction(prisma, leadId, lead.assignedAt);
    const revealing = current !== REVEAL_HISTORY_ACTION; // الافتراضي مخفي → الضغطة الأولى تكشف
    await logAudit(prisma, {
      userId: user.id,
      action: revealing ? REVEAL_HISTORY_ACTION : HIDE_HISTORY_ACTION,
      entity: "lead",
      entityId: leadId,
      summary: revealing
        ? `كشف سجل المتابعات القديم للموظف — ${lead.name}`
        : `أعاد إخفاء سجل المتابعات القديم عن الموظف — ${lead.name}`,
    });
    revalidatePath(`/leads/${leadId}`);
    revalidateLeads();
    return { ok: true, revealed: revealing };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

/** تعديل بيانات العميل من تبويب «البيانات» في الدرج. */
export async function updateLead(
  leadId: string,
  data: {
    name?: string;
    phone?: string;
    budget?: string | null;
    unitType?: UnitType | null;
    priority?: Priority;
    purchaseMethod?: PurchaseMethod | null;
    purchaseGoal?: PurchaseGoal | null;
    /** «في أي حي تفضّل التملك؟» — preferredDistrict القديم موقوف الكتابة (deprecated). */
    preferredAreas?: string[];
    sourceId?: string | null;
  },
): Promise<ActionResult> {
  try {
    await assertLeadAccess(leadId);
    const budget =
      data.budget != null ? Number(String(data.budget).replace(/[^\d]/g, "")) || null : undefined;
    await prisma.lead.update({
      where: { id: leadId },
      data: {
        ...(data.name ? { name: data.name.trim() } : {}),
        ...(data.phone ? { phone: data.phone.replace(/[^\d]/g, "") } : {}),
        ...(data.priority ? { priority: data.priority } : {}),
        ...(data.unitType !== undefined ? { unitType: data.unitType } : {}),
        ...(budget !== undefined ? { budget } : {}),
        ...(data.purchaseMethod !== undefined ? { purchaseMethod: data.purchaseMethod } : {}),
        ...(data.purchaseGoal !== undefined ? { purchaseGoal: data.purchaseGoal } : {}),
        ...(data.preferredAreas ? { preferredAreas: canonicalAreas(data.preferredAreas) } : {}),
        ...(data.sourceId !== undefined ? { sourceId: data.sourceId || null } : {}),
      },
    });
    revalidateLeads();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

/** تعديل قناة العميل — للمالك/المدير فقط (الفرض على الخادم؛ الموظف يُرفض). */
/**
 * تحديث بيانات الاستقبال (هدف/طريقة الشراء + رينج السعر + الأحياء + المشاريع + المصدر).
 * توحيد المصدر/القناة: «المصدر» هو الحقل الظاهر الوحيد — تغييره يكتب معه source (النص)
 * وchannel (المشتقة من الاسم) للتوافق الرجعي، فالتحليلات (القنوات) تظل صحيحة بلا حقل ثانٍ.
 */
export async function updateLeadIntake(
  leadId: string,
  data: {
    purchaseGoal?: PurchaseGoal | null;
    purchaseMethod?: PurchaseMethod | null;
    priceMin?: number | null;
    priceMax?: number | null;
    preferredAreas?: string[];
    preferredProjects?: string[];
    sourceId?: string | null;
  },
): Promise<ActionResult> {
  try {
    await assertLeadAccess(leadId);
    // «المصدر» الموحّد: مع sourceId نكتب النص source والقناة المشتقة channel (توافق رجعي —
    // بلا حذف عمود؛ حذف الفائض مؤجّل لجلسة baseline).
    let sourceFields: { sourceId: string | null; source?: string | null; channel?: Channel } = { sourceId: null };
    if (data.sourceId) {
      const src = await prisma.leadSource.findUnique({ where: { id: data.sourceId }, select: { name: true } });
      if (!src) return { ok: false, error: "المصدر غير موجود" };
      sourceFields = { sourceId: data.sourceId, source: src.name, channel: channelForSourceName(src.name) };
    }
    await prisma.lead.update({
      where: { id: leadId },
      data: {
        ...(data.purchaseGoal !== undefined ? { purchaseGoal: data.purchaseGoal } : {}),
        ...(data.purchaseMethod !== undefined ? { purchaseMethod: data.purchaseMethod } : {}),
        ...(data.priceMin !== undefined ? { priceMin: data.priceMin } : {}),
        ...(data.priceMax !== undefined ? { priceMax: data.priceMax } : {}),
        ...(data.preferredAreas ? { preferredAreas: canonicalAreas(data.preferredAreas) } : {}),
        ...(data.preferredProjects ? { preferredProjects: data.preferredProjects } : {}),
        ...(data.sourceId !== undefined ? sourceFields : {}),
      },
    });
    revalidateLeads();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

/** تعيين المرحلة الأولى — مرة واحدة فقط، لا تُعدّل بعدها. */
export async function setFirstContactStage(leadId: string, stage: FirstContactStage): Promise<ActionResult> {
  try {
    const { user } = await assertLeadAccess(leadId);
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { firstContactStage: true, assignedAt: true } });
    if (lead?.firstContactStage) {
      // عميل موزَّع «كجديد» وسجله مخفي: المرحلة الأولى التاريخية محجوبة عن الموظف أصلًا،
      // فمحاولته تحديدها تُقبل بصمت (بلا كتابة — القيمة التاريخية محفوظة) بدل خطأ يكشف وجود سجل قديم.
      const lastAssign = await prisma.reassignment.findFirst({
        where: { leadId, toUserId: { not: null } },
        orderBy: { createdAt: "desc" },
        select: { reason: true },
      });
      const hidden = await shouldHideHistory(prisma, user.role, { id: leadId, lastAssignReason: lastAssign?.reason ?? null, assignedAt: lead.assignedAt });
      if (hidden) return { ok: true };
      return { ok: false, error: "المرحلة الأولى محدّدة مسبقًا ولا تُعدّل" };
    }
    await prisma.lead.update({
      where: { id: leadId },
      data: { firstContactStage: stage, firstContactDate: new Date(), firstContactAt: new Date() },
    });
    await logAudit(prisma, { userId: user.id, action: "lead.firstStage", entity: "lead", entityId: leadId, summary: `حدّد المرحلة الأولى · العميل=${leadId}` });
    revalidateLeads();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

/**
 * تحويل عملاء لموظف — للمدير فقط. وضعان (اللاحقة في السبب هي مصدر الحقيقة — بلا عمود إضافي):
 *  - "full" → `manual_transfer_full`: نقل بالبيانات — الموظف الجديد يرى كل السجل، ويظهر وسم ⇄ «محوَّل».
 *  - "fresh" → `manual_transfer_fresh`: نقل كجديد — اللاحقة `_fresh` تفعّل إخفاء السجل عن الموظف
 *    عبر visibility.ts (نفس آلية إعادة التوزيع)، بلا وسم؛ والتاريخ محفوظ كاملًا للمالك/الأدمن.
 */
export async function transferLeads(
  ids: string[],
  toUserId: string,
  mode: TransferMode,
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    if (!isManager(user.role)) return { ok: false, error: "التحويل للمدير فقط" };
    if (ids.length === 0) return { ok: false, error: "ما فيه عملاء محدّدين" };
    const target = await prisma.user.findUnique({ where: { id: toUserId }, select: { id: true, name: true } });
    if (!target) return { ok: false, error: "الموظف غير موجود" };

    await prisma.$transaction(async (tx) => {
      // م-١ + ح-٤: الإسناد عبر الدالة الموحّدة، والمتابعات لا تُحذف أبدًا (سجل تاريخي).
      // «fresh» = المرحلة «جديد» + تصفير موعد المتابعة القادم فقط.
      await assignLeadsToEmployee(tx, ids, toUserId, {
        manual: true,
        reason: manualTransferReason(mode),
        extraData: mode === "fresh" ? FRESH_RESET_DATA : {},
      });
      await tx.activity.createMany({
        data: ids.map((leadId) => ({
          leadId, userId: user.id, type: ActivityType.ASSIGNMENT,
          note: mode === "fresh" ? `نُقل كعميل جديد إلى ${target.name}` : `نُقل إلى ${target.name}`,
        })),
      });
      await logAudit(tx, {
        userId: user.id, action: "lead.transferred", entity: "lead",
        summary: `${mode === "fresh" ? "نقل كعميل جديد" : "نقل"} ${ids.length} عميل إلى ${target.name}`,
      });
    });
    // إشعار مجمّع للموظف المعني.
    await emitLeadAssignedBatch([{ userId: toUserId, count: ids.length, sampleLeadId: ids[0] }]);
    revalidateLeads();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

/** استرداد عملاء للنظام كعملاء جدد — بدون موظف، المرحلة ترجع «جديد». للمدير فقط. */
export async function recoverLeads(ids: string[]): Promise<ActionResult> {
  try {
    const user = await requireUser();
    if (!isManager(user.role)) return { ok: false, error: "الاسترداد للمدير فقط" };
    if (ids.length === 0) return { ok: false, error: "ما فيه عملاء محدّدين" };

    await prisma.$transaction(async (tx) => {
      // ح-٤: المتابعات لا تُحذف أبدًا. «fresh» = مرحلة «جديد» + تصفير موعد المتابعة فقط،
      // مع تصفير أختام الإسناد (رجوع للحوض) — متسق مع بقية مسارات السحب.
      // «مسوّق» يُستثنى من الاسترداد كعميل جديد (ليس عميلًا — لا إحياء).
      await tx.lead.updateMany({
        where: { id: { in: ids }, NOT: { followUps: { some: { result: "NOT_INTERESTED_MARKETER" } } } },
        data: {
          assignedToId: null, assignedAt: null, contactedAt: null,
          stage: LeadStage.NEW, nextFollowup: null, isArchived: false,
        },
      });
      await tx.activity.createMany({
        data: ids.map((leadId) => ({
          leadId, userId: user.id, type: ActivityType.ASSIGNMENT, note: "استُرد للنظام (بدون موظف)",
        })),
      });
      await logAudit(tx, {
        userId: user.id, action: "lead.recovered", entity: "lead",
        summary: `استرد ${ids.length} عميل للنظام كعملاء جدد`,
      });
    });
    revalidateLeads();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

/**
 * نقل عميل واحد لموظف آخر (من درج العميل) — للمدير فقط، وبنفس وضعَي transferLeads تمامًا:
 * "full" → بالبيانات (وسم ⇄ «محوَّل») · "fresh" → كجديد (إخفاء السجل عن الموظف بلا وسم).
 * mode إلزامي عمدًا: أي مسار نقل جديد يجب أن يقرّر الوضع صراحةً بدل الوقوع في سبب مجرد.
 */
export async function reassignLead(
  leadId: string,
  toUserId: string,
  mode: TransferMode,
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    if (!isManager(user.role))
      return { ok: false, error: "إعادة الإسناد للمدير فقط" };

    const [target, lead] = await Promise.all([
      prisma.user.findUnique({ where: { id: toUserId }, select: { id: true, name: true } }),
      prisma.lead.findUnique({ where: { id: leadId }, select: { name: true } }),
    ]);
    if (!target) return { ok: false, error: "الموظف غير موجود" };

    await prisma.$transaction(async (tx) => {
      // م-١: الإسناد عبر الدالة الموحّدة — أختام كاملة + سجل Reassignment.
      // ح-٤: المتابعات لا تُحذف في أي وضع — «كجديد» إخفاء عرضٍ عن الموظف لا حذفًا.
      await assignLead(tx, leadId, toUserId, {
        manual: true,
        reason: manualTransferReason(mode),
        extraData: mode === "fresh" ? FRESH_RESET_DATA : {},
      });
      await tx.activity.create({
        data: {
          leadId,
          userId: user.id,
          type: ActivityType.ASSIGNMENT,
          note: mode === "fresh" ? `نُقل كعميل جديد إلى ${target.name}` : `نُقل إلى ${target.name}`,
        },
      });
    });
    await logAudit(prisma, {
      userId: user.id, action: "lead.reassigned", entity: "lead", entityId: leadId,
      summary: `${mode === "fresh" ? "نقل كعميل جديد" : "نقل بالبيانات"} عميل إلى ${target.name}`,
    });
    // حدث: توزّع عليك عميل (الجمهور حسب الإعداد — افتراضيًا الموظف المعني).
    await emitNotification({
      eventKey: "lead_assigned",
      assignedUserId: toUserId,
      title: "توزّع عليك عميل",
      body: lead ? `العميل: ${lead.name}` : undefined,
      link: `/leads/${leadId}`,
    });

    revalidateLeads();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}
