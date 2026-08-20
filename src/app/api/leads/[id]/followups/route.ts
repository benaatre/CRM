import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { FollowUpType, FollowUpResult, FollowUpSection, LeadStage, FirstContactStage, ActivityType } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { markContacted } from "@/lib/auto-distribute";
import { shouldHideHistory } from "@/lib/visibility";
import { followUpResultLabels, firstContactStageLabels } from "@/lib/labels";
import { parseRiyadhLocal } from "@/lib/ksa-time";
import {
  deriveOutcome,
  REJECTED_RESULTS,
  REJECTED_RESULT_ERROR,
  NOTE_REQUIRED_RESULTS,
  AUTO_ARCHIVE_RESULTS,
  APPOINTMENT_DATE_REQUIRED_RESULTS,
  VISIT_APPOINTMENT_RESULTS,
} from "@/lib/followup-outcome";

export const runtime = "nodejs";

function isManager(role: string) {
  return role === "OWNER" || role === "ADMIN";
}
// FINANCE بلا عملاء نهائيًا (قرار 2026-08-20) — يُصدّ قبل أي فحص ملكية.
function isFinanceBlocked(role: string) {
  return role === "FINANCE";
}

/** يتحقق من جلسة + صلاحية الوصول للعميل (الموظف لعملائه فقط). */
async function authorize(leadId: string) {
  const session = await auth();
  if (!session?.user) return { error: NextResponse.json({ error: "غير مصرّح" }, { status: 401 }) };
  if (isFinanceBlocked(session.user.role)) return { error: NextResponse.json({ error: "المدير المالي بلا صلاحية عملاء" }, { status: 403 }) };
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, assignedToId: true, assignedAt: true, stage: true, visitAt: true, firstContactAt: true, firstContactStage: true, firstContactDate: true } });
  if (!lead) return { error: NextResponse.json({ error: "العميل غير موجود" }, { status: 404 }) };
  if (!isManager(session.user.role) && lead.assignedToId !== session.user.id) {
    return { error: NextResponse.json({ error: "ما عندك صلاحية على هذا العميل" }, { status: 403 }) };
  }
  return { user: session.user, lead };
}

// GET /api/leads/[id]/followups — متابعات العميل (تصاعدي: الأقدم أولًا).
// الخطوة ٣ب: للموظف مع عميل موزَّع «كجديد» (_fresh): ما قبل آخر إسناد يُحذف من الـpayload.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const a = await authorize(id);
  if (a.error) return a.error;

  const lastAssign = await prisma.reassignment.findFirst({
    where: { leadId: id, toUserId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { reason: true },
  });
  const hide = await shouldHideHistory(prisma, a.user.role, { id, lastAssignReason: lastAssign?.reason ?? null, assignedAt: a.lead.assignedAt });

  const window = hide && a.lead.assignedAt ? { createdAt: { gt: a.lead.assignedAt } } : {};
  const [items, systemActs] = await Promise.all([
    prisma.followUp.findMany({
      where: { leadId: id, ...window },
      orderBy: { createdAt: "asc" },
      include: { employee: { select: { name: true } } },
    }),
    // أفعال النظام (userId = null): تنزيل «مهتم راكد» وما شابهه. كانت لا تظهر في كرت
    // العميل إطلاقًا — فالعميل ينتقل لـ«موعد لاحق» بموعد متابعة بلا أي تفسير أمام
    // الموظف. تُعرض الآن في السجل نفسه موسومةً «تلقائي — النظام» لا باسم أحد.
    prisma.activity.findMany({
      where: { leadId: id, userId: null, ...window },
      orderBy: { createdAt: "asc" },
      select: { id: true, note: true, type: true, createdAt: true },
    }),
  ]);
  // وسم «مُعدَّلة»: من سجل التدقيق (followup.edited · entityId=معرّف المتابعة) — استعلام واحد.
  const editedRows = items.length
    ? await prisma.auditLog.findMany({
        where: { action: "followup.edited", entityId: { in: items.map((f) => f.id) } },
        select: { entityId: true },
      })
    : [];
  const editedSet = new Set(editedRows.map((r) => r.entityId));

  const manager = isManager(a.user.role);
  const now = Date.now();
  // النتيجة تُعدَّل على آخر متابعة فقط (حالة العميل تتبعها) — للعرض؛ PATCH يعيد الفرض.
  const latestId = items.length ? items[items.length - 1].id : null;
  return NextResponse.json({
    // أفعال النظام منفصلة عن المتابعات عمدًا: صف FollowUp لا يُنشأ إلا من فعل بشري
    // (القاعدة الصارمة فوق model FollowUp) — فالنظام لا «يسجّل متابعة» بل يُعرض حدثًا.
    systemEvents: systemActs.map((s) => ({
      id: s.id,
      note: s.note ?? "إجراء تلقائي من النظام",
      type: s.type,
      createdAt: s.createdAt,
    })),
    items: items.map((f) => {
      const mine = f.createdBy === a.user.id;
      const withinWindow = now - f.createdAt.getTime() <= EDIT_WINDOW_MS;
      return {
        id: f.id,
        type: f.type,
        result: f.result,
        section: f.section,
        stageAfter: f.stageAfter,
        note: f.note,
        nextDate: f.nextDate,
        createdAt: f.createdAt,
        employeeName: f.employee?.name ?? null,
        // نسبة المتابعة صراحةً: كاتبها هو مالك العميل الآن؟ وهل هي من تسجيل المستخدم نفسه؟
        // العميل المنقول «بمحتواه» يحمل متابعات مالكه السابق — وهذا مصدر شكوى
        // «متابعات ما سجّلتها». الوسم في السجل يزيل اللبس بلا حذف أي تاريخ.
        byCurrentOwner: !!a.lead.assignedToId && f.createdBy === a.lead.assignedToId,
        mine,
        edited: editedSet.has(f.id),
        // الصلاحية تُعاد حسابها على الخادم عند PATCH — هذه للعرض فقط.
        canEdit: manager || (mine && withinWindow),
        canEditResult: manager && f.id === latestId,
      };
    }),
  });
}

// نافذة تعديل الموظف لمتابعته: ٦٠ دقيقة من تسجيلها.
const EDIT_WINDOW_MS = 60 * 60 * 1000;

// PATCH /api/leads/[id]/followups — تعديل متابعة:
//   الموظف: متابعته هو خلال ساعة — الملاحظة وموعد المتابعة القادم فقط (النتيجة لا تُعدَّل).
//   المالك/المدير: أي متابعة أي وقت — لكن حالة العميل تتبع آخر متابعة فقط:
//   المتابعة القديمة يُعدَّل نصها ووقتها بلا أي مساس بجدول Lead، والنتيجة تُغيَّر
//   على الأحدث حصرًا وبنفس صرامة POST (lib/followup-outcome). التعديل لا يمحو
//   الأصل: سجل تدقيق + وسم «مُعدَّلة».
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const a = await authorize(id);
  if (a.error) return a.error;
  const { user, lead } = a;
  const manager = isManager(user.role);

  let body: { followupId?: string; note?: string; nextDate?: string | null; result?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 });
  }
  if (!body.followupId) return NextResponse.json({ error: "معرّف المتابعة مفقود" }, { status: 400 });

  const fu = await prisma.followUp.findUnique({
    where: { id: body.followupId },
    select: { id: true, leadId: true, createdBy: true, createdAt: true, result: true, note: true, nextDate: true },
  });
  if (!fu || fu.leadId !== id) return NextResponse.json({ error: "المتابعة غير موجودة" }, { status: 404 });

  // الصلاحية على الخادم (لا الواجهة): الموظف = متابعته + نافذة ساعة + بلا نتيجة.
  if (!manager) {
    if (fu.createdBy !== user.id) {
      return NextResponse.json({ error: "تعديل المتابعة لصاحبها فقط" }, { status: 403 });
    }
    if (Date.now() - fu.createdAt.getTime() > EDIT_WINDOW_MS) {
      return NextResponse.json({ error: "مهلة التعديل انتهت (ساعة من التسجيل) — سجّل متابعة جديدة" }, { status: 403 });
    }
    if (body.result !== undefined) {
      return NextResponse.json({ error: "النتيجة ما تتعدل — تغييرها يغيّر المرحلة، سجّل متابعة جديدة" }, { status: 403 });
    }
  }

  let nextDate: Date | null | undefined = undefined;
  if (body.nextDate !== undefined) {
    if (body.nextDate === null || body.nextDate === "") nextDate = null;
    else {
      // نص datetime-local بلا منطقة = وقت حائط الرياض — لا توقيت الخادم (UTC على الإنتاج).
      nextDate = parseRiyadhLocal(body.nextDate);
      if (Number.isNaN(nextDate.getTime())) return NextResponse.json({ error: "تاريخ المتابعة غير صحيح" }, { status: 400 });
    }
  }
  const newResult = body.result !== undefined && body.result in FollowUpResult ? (body.result as FollowUpResult) : undefined;
  if (body.result !== undefined && !newResult) return NextResponse.json({ error: "نتيجة المتابعة غير صحيحة" }, { status: 400 });
  const resultChanged = !!newResult && newResult !== fu.result;

  // حالة العميل تتبع آخر متابعة فقط — تعديل متابعة أقدم لا يلمس جدول Lead إطلاقًا.
  const latest = await prisma.followUp.findFirst({
    where: { leadId: id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true },
  });
  const isLatest = latest?.id === fu.id;

  if (!isLatest && resultChanged) {
    return NextResponse.json({ error: "ما تقدر تغيّر نتيجة متابعة قديمة — حالة العميل تتبع آخر متابعة" }, { status: 400 });
  }

  // الحالة النهائية للصف بعد التعديل — عليها تُفرض إلزامات POST نفسها.
  const finalResult = newResult ?? fu.result;
  const finalNote = body.note !== undefined ? body.note.trim() || null : fu.note;
  const finalNextDate = nextDate !== undefined ? nextDate : fu.nextDate;

  const outcome = resultChanged ? deriveOutcome(newResult!) : null;
  if (isLatest) {
    if (resultChanged && REJECTED_RESULTS.includes(newResult!)) {
      return NextResponse.json({ error: REJECTED_RESULT_ERROR }, { status: 400 });
    }
    // النص الإلزامي يُفحص عند تغيير النتيجة أو المساس بالملاحظة — لا عند تعديل موعد فقط
    // (حتى لا يعلق صف قديم سُجّل قبل فرض القاعدة).
    if ((resultChanged || body.note !== undefined) && NOTE_REQUIRED_RESULTS.includes(finalResult) && !finalNote) {
      return NextResponse.json({ error: `نتيجة «${followUpResultLabels[finalResult]}» تحتاج نصًا — اكتب ما قاله العميل.` }, { status: 400 });
    }
    if ((resultChanged || nextDate !== undefined) && APPOINTMENT_DATE_REQUIRED_RESULTS.includes(finalResult) && !finalNextDate) {
      return NextResponse.json({ error: "حدّد تاريخ ووقت الموعد." }, { status: 400 });
    }
  }

  // المرحلة الجديدة: من المسار الموحّد — نتائج «بلا تغيير مرحلة» تثبّت مرحلة العميل الحالية.
  const newStage = outcome && outcome.stage !== "keep" ? outcome.stage : undefined;

  // ما يُكتب على العميل — فقط عندما تكون المتابعة هي الأحدث:
  const leadPatch: Record<string, unknown> = {};
  if (isLatest) {
    const finalIsVisitAppt = VISIT_APPOINTMENT_RESULTS.includes(finalResult);
    if (finalIsVisitAppt) {
      // متابعة «موعد زيارة»: تاريخها يعدّل visitAt (لا nextFollowup) — نفس منطق POST.
      if (nextDate !== undefined || resultChanged) leadPatch.visitAt = finalNextDate;
    } else if (nextDate !== undefined) {
      // nextFollowup يتغيّر فقط إذا أُرسل nextDate صراحةً — غيابه من الطلب يعني «لا تلمسه».
      leadPatch.nextFollowup = nextDate;
    }
    if (resultChanged) {
      if (newStage) leadPatch.stage = newStage;
      if (outcome!.archive) leadPatch.isArchived = true;
      // فكّ الأرشفة: النتيجة كانت «نهائيًا/مسوّق» وتغيّرت لنتيجة غير مؤرشفة.
      else if (AUTO_ARCHIVE_RESULTS.includes(fu.result)) leadPatch.isArchived = false;
      // العدّاد يزيد فقط عند التغيير «إلى» إعادة الجدولة (لا إذا كانت هي أصلًا).
      if (newResult === "VISIT_NO_SHOW_RESCHEDULED") leadPatch.visitRescheduleCount = { increment: 1 };
      // الخروج من «موعد زيارة مؤكّد» لأي مرحلة أخرى يمسح موعد الزيارة المعلّق (نفس POST).
      if (!finalIsVisitAppt && lead.stage === LeadStage.VISIT_SCHEDULED && newStage && newStage !== LeadStage.VISIT_SCHEDULED) {
        leadPatch.visitAt = null;
      }
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.followUp.update({
      where: { id: fu.id },
      data: {
        ...(body.note !== undefined ? { note: finalNote } : {}),
        ...(nextDate !== undefined ? { nextDate } : {}),
        ...(resultChanged ? { result: newResult, stageAfter: newStage ?? lead.stage } : {}),
      },
    });
    if (Object.keys(leadPatch).length) {
      await tx.lead.update({ where: { id }, data: leadPatch });
    }
    // التعديل لا يمحو الأصل — سجل تدقيق بنمط المعرّفات (العميل=cuid يصير اسمًا رابطًا في v2).
    await logAudit(tx, {
      userId: user.id,
      action: "followup.edited",
      entity: "followup",
      entityId: fu.id,
      summary: `عدّل متابعة${resultChanged ? ` (النتيجة ← ${followUpResultLabels[newResult!]})` : ""} · العميل=${id}`,
    });
  });

  revalidatePath("/leads");
  revalidatePath("/pipeline");
  revalidatePath("/dashboard");
  return NextResponse.json({ ok: true });
}

// POST /api/leads/[id]/followups — إضافة متابعة + تحديث مرحلة العميل تلقائيًا.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const a = await authorize(id);
  if (a.error) return a.error;
  const { user, lead } = a;

  let body: { type?: string; result?: string; section?: string; stage?: string; note?: string; nextDate?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 });
  }

  const type = body.type as FollowUpType;
  const result = body.result as FollowUpResult;
  if (!type || !(type in FollowUpType)) return NextResponse.json({ error: "نوع المتابعة غير صحيح" }, { status: 400 });
  if (!result || !(result in FollowUpResult)) return NextResponse.json({ error: "نتيجة المتابعة غير صحيحة" }, { status: 400 });

  const section = body.section && body.section in FollowUpSection ? (body.section as FollowUpSection) : null;
  // #32: تاريخ غير صالح يُرفض برسالة عربية بدل خطأ Prisma خام.
  let nextDate: Date | null = null;
  if (body.nextDate) {
    // نص datetime-local بلا منطقة = وقت حائط الرياض — لا توقيت الخادم (UTC على الإنتاج).
    nextDate = parseRiyadhLocal(body.nextDate);
    if (Number.isNaN(nextDate.getTime())) return NextResponse.json({ error: "تاريخ المتابعة غير صحيح" }, { status: 400 });
  }

  // ===== الإلزام على الخادم (محرّك الزيارات) — لا الواجهة فقط =====
  // القواعد كلها من مصدر واحد (lib/followup-outcome) يتشاركه POST وPATCH.
  // «مهتم» الخام بلا خطوة تالية مرفوض: أحد ثلاثة (موعد زيارة / موعد اتصال / غير مناسب).
  // نتائج «بلا تغيير مرحلة» (لم يستجب/حسبة البنك/في الانتظار) خارج هذا الإلزام.
  if (REJECTED_RESULTS.includes(result)) {
    return NextResponse.json({ error: REJECTED_RESULT_ERROR }, { status: 400 });
  }
  // المواعيد بلا تاريخ ما تنحفظ (موعد الزيارة/إعادة الجدولة/موعد الاتصال).
  const isVisitAppt = VISIT_APPOINTMENT_RESULTS.includes(result);
  if (APPOINTMENT_DATE_REQUIRED_RESULTS.includes(result) && !nextDate) {
    return NextResponse.json({ error: "حدّد تاريخ ووقت الموعد." }, { status: 400 });
  }
  // نتائج «بلا تغيير مرحلة»: المرحلة تثبت على الخادم مهما أُرسل — فلا تُحرَّك المرحلة
  // ولا يدخل العميل نظام «لم يتم الرد» (نتيجتها ليست NOT_ANSWERED_*).
  // غير ذلك: المرحلة المرسلة صراحةً تُقدَّم؛ وإلا تُشتق من النتيجة.
  const requestedStage = body.stage && body.stage in LeadStage ? (body.stage as LeadStage) : undefined;
  const outcome = deriveOutcome(result, requestedStage);
  const newStage = outcome.stage === "keep" ? lead.stage : outcome.stage;
  const bumpsAttempt = type === "CALL" || type === "WHATSAPP";

  // المرحلة الأولى تُحدَّد مرة واحدة من أول متابعة (حسب قسمها).
  const sectionToFirst: Record<FollowUpSection, FirstContactStage> = {
    INTERESTED: FirstContactStage.INTERESTED,
    NO_ANSWER: FirstContactStage.NO_ANSWER,
    NOT_INTERESTED: FirstContactStage.NOT_INTERESTED,
  };
  const firstStage = !lead.firstContactStage && section ? sectionToFirst[section] : null;

  const created = await prisma.$transaction(async (tx) => {
    const fu = await tx.followUp.create({
      data: { leadId: id, type, result, section, stageAfter: newStage, note: body.note?.trim() || null, nextDate, createdBy: user.id },
      include: { employee: { select: { name: true } } },
    });
    // أرشفة تلقائية: «غير مهتم بالعقارات نهائيًا» أو «مسوّق» → يُؤرشف مع الإغلاق مباشرة.
    // ⚠️ الانتساب يبقى (assignedToId لا يُمسح) — نحتاج نعرف عملاء مين في الأرشيف.
    const autoArchive = outcome.archive;
    await tx.lead.update({
      where: { id },
      data: {
        stage: newStage,
        ...(autoArchive ? { isArchived: true } : {}),
        lastContact: new Date(),
        // أول تواصل: الوقت والتاريخ يُحفظان مرة واحدة فقط (عند أول متابعة).
        firstContactAt: lead.firstContactAt ?? new Date(),
        firstContactDate: lead.firstContactDate ?? new Date(),
        // المرحلة الأولى تُحدَّد مرة واحدة من قسم أول متابعة.
        ...(firstStage ? { firstContactStage: firstStage } : {}),
        // موعد الزيارة له visitAt ومنظومة تذكيره الخاصة — لا يلمس nextFollowup (دورة الاتصالات).
        ...(nextDate && !isVisitAppt ? { nextFollowup: nextDate } : {}),
        ...(isVisitAppt ? { visitAt: nextDate } : {}),
        // «ما حضر — إعادة جدولة»: العدّاد يزيد (يظهر للمالك في ملف العميل).
        ...(result === "VISIT_NO_SHOW_RESCHEDULED" ? { visitRescheduleCount: { increment: 1 } } : {}),
        // الخروج من «موعد زيارة مؤكّد» لأي مرحلة أخرى يمسح موعد الزيارة المعلّق.
        ...(!isVisitAppt && lead.stage === LeadStage.VISIT_SCHEDULED && newStage !== LeadStage.VISIT_SCHEDULED ? { visitAt: null } : {}),
        ...(bumpsAttempt ? { attempts: { increment: 1 } } : {}),
      },
    });
    // «الزيارة زيارة»: موعد زيارة جديد وعنده زيارة قادمة = استبدال — visitAt تحدّث أعلاه،
    // وتذكير الموعد القديم يبطل تلقائيًا (التذكيرات مشروطة بمطابقة visitAt الحالي)،
    // وسجل يوضح الاستبدال بلا أي عدّاد ظاهر للموظف.
    if (isVisitAppt && nextDate && lead.visitAt && lead.visitAt > new Date() && lead.visitAt.getTime() !== nextDate.getTime()) {
      const fmt = (d: Date) => new Intl.DateTimeFormat("ar-SA-u-nu-arab", { calendar: "gregory", timeZone: "Asia/Riyadh", dateStyle: "medium", timeStyle: "short" }).format(d);
      await tx.activity.create({
        data: { leadId: id, userId: user.id, type: ActivityType.NOTE, note: `أعيدت جدولة الزيارة من ${fmt(lead.visitAt)} إلى ${fmt(nextDate)}` },
      });
    }
    // سجل أول تواصل في الـTimeline (Activity) — مع اسم الموظف والوقت تلقائيًا.
    if (firstStage) {
      await tx.activity.create({
        data: { leadId: id, userId: user.id, type: ActivityType.NOTE, note: `تم تسجيل أول تواصل: ${firstContactStageLabels[firstStage]}` },
      });
    }
    // #20: أي متابعة مسجّلة = تعامل فعلي مع العميل → توقف عدّاد إعادة التوجيه.
    // (عدّاد المحاولات attempts يبقى للمكالمات/واتساب فقط عبر bumpsAttempt أعلاه.)
    await markContacted(tx, id);
    // الحصانة اللحظية (خلل المرشحين): أي متابعة تُلغي مسار السحب فورًا — بطاقة الترشيح
    // تُحذف لحظة التسجيل نفسها (لا عند الدورة الجاية)، والعدّاد/الوميض يختفيان معها.
    await tx.sweepCandidate.deleteMany({ where: { leadId: id } });
    await logAudit(tx, {
      userId: user.id, action: "followup.added", entity: "lead", entityId: id,
      // معرّف العميل داخل النص — يلتقطه resolveAuditNames فيتحوّل لاسم رابط في سجل التدقيق v2.
      summary: `متابعة: ${followUpResultLabels[result]} · العميل=${id}`,
    });
    return fu;
  });

  // المتابعة تغيّر المرحلة → ينعكس في الجدول والكانبان ولوحة التحكم.
  revalidatePath("/leads");
  revalidatePath("/pipeline");
  revalidatePath("/dashboard");
  revalidatePath("/analytics");

  return NextResponse.json({
    ok: true,
    followup: {
      id: created.id, type: created.type, result: created.result, note: created.note,
      nextDate: created.nextDate, createdAt: created.createdAt, employeeName: created.employee?.name ?? null,
    },
    newStage,
  });
}
