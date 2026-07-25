import "server-only";

import { ActivityType, FollowUpType, LeadStage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { emitNotification } from "@/lib/notifications/emit";
import { logAudit } from "@/lib/audit";
import { VISIT_APPOINTMENT_RESULTS } from "@/lib/labels";
import { VISIT_ENGINE_EPOCH, INTERESTED_STALE_DEMOTE_DAYS } from "@/lib/visit-engine";

const CLOSED = ["CLOSED_WON", "CLOSED_LOST"] as const;
const HOUR_MS = 3_600_000;
const VISIT_TYPES = [FollowUpType.VISIT_PROJECT, FollowUpType.VISIT_OFFICE];

// توقيت الرياض (+٣ ثابت) — لصباح يوم الزيارة (٨ص) ومطابقة «نفس اليوم».
const KSA_OFFSET_MS = 3 * HOUR_MS;
const ksaHourOf = (d: Date) => new Date(d.getTime() + KSA_OFFSET_MS).getUTCHours();
const ksaDayKey = (d: Date) => new Date(d.getTime() + KSA_OFFSET_MS).toISOString().slice(0, 10);

/** ساعة الموعد بالعربي (توقيت الرياض) — لنص الإشعار. */
function ksaTime(d: Date): string {
  return new Intl.DateTimeFormat("ar-SA-u-nu-arab", { timeZone: "Asia/Riyadh", hour: "numeric", minute: "2-digit" }).format(d);
}

/**
 * dedup مجمّع: الروابط المُرسل إليها سابقًا لنوع إشعار — استعلام واحد للدفعة (لا N+1).
 * كل تذكير رابطه فريد (r=مرحلة التذكير + t=وقت الموعد ms) — فلا يتكرر لنفس الموعد أبدًا،
 * وتغيير الموعد (t جديد) يفتح تذكيرًا جديدًا تلقائيًا. المفتاح: userId|link.
 */
async function sentKeys(type: string, links: string[]): Promise<Set<string>> {
  if (links.length === 0) return new Set();
  const rows = await prisma.notification.findMany({
    where: { type, link: { in: links } },
    select: { link: true, userId: true },
  });
  return new Set(rows.map((r) => `${r.userId}|${r.link}`));
}

async function notifyTimings(): Promise<{ followupBeforeHours: number; staleHours: number }> {
  const s = await prisma.settings.findUnique({ where: { id: "singleton" }, select: { notifyConfig: true } });
  const cfg = (s?.notifyConfig as { followupBeforeHours?: number; staleHours?: number } | null) ?? null;
  return { followupBeforeHours: cfg?.followupBeforeHours ?? 2, staleHours: cfg?.staleHours ?? 48 };
}

/**
 * تذكيرا موعد المتابعة (للموظف صاحب الموعد): قبل الموعد بساعة + عند حلوله —
 * مرة واحدة لكل مرحلة لكل موعد (dedup برابط فريد r+t)، والنقر يفتح ملف العميل.
 */
export async function runFollowupDueCheck(now: Date = new Date()): Promise<number> {
  const leads = await prisma.lead.findMany({
    where: {
      // نافذة تغطي المرحلتين: [فائت قريبًا (دورة الكرون ١٥د) … قادم خلال ساعة]
      nextFollowup: { gte: new Date(now.getTime() - HOUR_MS), lte: new Date(now.getTime() + HOUR_MS) },
      isArchived: false,
      stage: { notIn: [...CLOSED] },
      assignedToId: { not: null },
    },
    select: { id: true, name: true, assignedToId: true, nextFollowup: true },
  });
  if (leads.length === 0) return 0;

  type Plan = { link: string; userId: string; title: string; body: string };
  const plans: Plan[] = [];
  for (const l of leads) {
    const at = l.nextFollowup as Date;
    const t = at.getTime();
    if (at > now) {
      // قبل الموعد بساعة (أول دورة كرون تدخل النافذة)
      plans.push({
        link: `/leads/${l.id}?r=fu1h&t=${t}`,
        userId: l.assignedToId as string,
        title: "موعد متابعة بعد شوي",
        body: `العميل: ${l.name} — الساعة ${ksaTime(at)}`,
      });
    } else {
      // حلّ الموعد
      plans.push({
        link: `/leads/${l.id}?r=fudue&t=${t}`,
        userId: l.assignedToId as string,
        title: "حان موعد المتابعة",
        body: `العميل: ${l.name} — تواصل معه الآن`,
      });
    }
  }
  const sent = await sentKeys("followup_due", plans.map((p) => p.link));
  let emitted = 0;
  for (const p of plans) {
    if (sent.has(`${p.userId}|${p.link}`)) continue;
    await emitNotification({ eventKey: "followup_due", assignedUserId: p.userId, title: p.title, body: p.body, link: p.link });
    emitted++;
  }
  return emitted;
}

/**
 * التذكير الثاني (مرة واحدة): إشعار «حان موعد المتابعة» ما فُتح (غير مقروء) ومضى عليه ٣ ساعات.
 */
export async function runLateFollowupReminder(now: Date = new Date()): Promise<number> {
  const stale = await prisma.notification.findMany({
    where: {
      type: "followup_due",
      link: { contains: "r=fudue" },
      read: false,
      createdAt: { lte: new Date(now.getTime() - 3 * HOUR_MS), gte: new Date(now.getTime() - 24 * HOUR_MS) },
    },
    select: { userId: true, link: true, body: true },
  });
  if (stale.length === 0) return 0;

  const plans = stale
    .map((n) => ({
      userId: n.userId,
      body: n.body,
      link: n.link!.replace("r=fudue", "r=fulate"),
    }))
    .filter((p): p is { userId: string; body: string | null; link: string } => !!p.link);
  const sent = await sentKeys("followup_due", plans.map((p) => p.link));
  let emitted = 0;
  for (const p of plans) {
    if (sent.has(`${p.userId}|${p.link}`)) continue;
    await emitNotification({
      eventKey: "followup_due",
      assignedUserId: p.userId,
      title: "تذكير: موعد متابعة فاتك",
      body: p.body ?? undefined,
      link: p.link,
    });
    emitted++;
  }
  return emitted;
}

/**
 * تذكيرا الزيارة المجدولة (متابعة نوع زيارة بموعد قادم): قبلها بيوم + صباح يومها (٨ص بتوقيت الرياض).
 * الجمهور: الموظف الحالي المسند له العميل (لا كاتب المتابعة — قد يتغير الإسناد).
 */
export async function runVisitReminderCheck(now: Date = new Date()): Promise<number> {
  const fus = await prisma.followUp.findMany({
    where: {
      // متابعة نوع زيارة (النمط القديم) أو نتيجة «موعد زيارة» (محرّك الزيارات:
      // INTERESTED_VISIT_SCHEDULED / VISIT_NO_SHOW_RESCHEDULED — nextDate = موعد الزيارة).
      OR: [{ type: { in: VISIT_TYPES } }, { result: { in: VISIT_APPOINTMENT_RESULTS } }],
      nextDate: { gt: now, lte: new Date(now.getTime() + 24 * HOUR_MS) },
      lead: { isArchived: false, stage: { notIn: [...CLOSED] }, assignedToId: { not: null } },
    },
    select: { leadId: true, nextDate: true, lead: { select: { name: true, assignedToId: true } } },
  });
  if (fus.length === 0) return 0;

  type Plan = { link: string; userId: string; title: string; body: string };
  const plans: Plan[] = [];
  for (const f of fus) {
    const at = f.nextDate as Date;
    const t = at.getTime();
    const userId = f.lead.assignedToId as string;
    // قبلها بيوم (أول دورة تدخل نافذة الـ٢٤ ساعة)
    plans.push({
      link: `/leads/${f.leadId}?r=v1d&t=${t}`,
      userId,
      title: "زيارة مجدولة بكرة",
      body: `العميل: ${f.lead.name} — ${ksaTime(at)}`,
    });
    // صباح يومها (من ٨ص بتوقيت الرياض)
    if (ksaHourOf(now) >= 8 && ksaDayKey(at) === ksaDayKey(now)) {
      plans.push({
        link: `/leads/${f.leadId}?r=vam&t=${t}`,
        userId,
        title: "عندك زيارة اليوم",
        body: `العميل: ${f.lead.name} — الساعة ${ksaTime(at)}`,
      });
    }
  }
  const sent = await sentKeys("visit_due", plans.map((p) => p.link));
  let emitted = 0;
  for (const p of plans) {
    if (sent.has(`${p.userId}|${p.link}`)) continue;
    await emitNotification({ eventKey: "visit_due", assignedUserId: p.userId, title: p.title, body: p.body, link: p.link });
    emitted++;
  }
  return emitted;
}

/**
 * السقف الزمني على «مهتم» (محرّك الزيارات): عميل INTERESTED بلا أي متابعة ١٤ يومًا
 * (من نقطة صفر الميزة حدًّا أدنى — لا تنزيل جماعيًا للراكدين القدامى) ينزل تلقائيًا
 * إلى «موعد لاحق» بموعد صباح الغد (١٠ص بتوقيت الرياض) — فيدخل دورة متابعات اليوم
 * والتذكيرات طبيعيًا. سجل تدقيق + نشاط لكل تنزيل. دفعات ٥٠ لكل دورة (الكرون كل دقائق).
 */
export async function runInterestedStaleDemotion(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - INTERESTED_STALE_DEMOTE_DAYS * 86_400_000);
  // قبل (نقطة الصفر + ١٤ يومًا) ما فيه أي تنزيل إطلاقًا.
  if (VISIT_ENGINE_EPOCH > cutoff) return 0;

  const stale = await prisma.lead.findMany({
    where: {
      stage: LeadStage.INTERESTED,
      isArchived: false,
      createdAt: { lte: cutoff },
      // «بلا أي متابعة جديدة»: ولا متابعة واحدة بعد حدّ الـ١٤ يومًا.
      followUps: { none: { createdAt: { gt: cutoff } } },
    },
    select: { id: true, name: true },
    orderBy: { updatedAt: "asc" },
    take: 50,
  });
  if (stale.length === 0) return 0;

  // موعد الغد ١٠ص بتوقيت الرياض (٧:٠٠ UTC).
  const k = new Date(now.getTime() + KSA_OFFSET_MS);
  const tomorrow10 = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() + 1, 7, 0, 0));

  let demoted = 0;
  for (const l of stale) {
    await prisma.$transaction(async (tx) => {
      await tx.lead.update({
        where: { id: l.id },
        data: { stage: LeadStage.FOLLOW_UP_LATER, nextFollowup: tomorrow10 },
      });
      await tx.activity.create({
        data: {
          leadId: l.id,
          type: ActivityType.STAGE_CHANGE,
          note: "تنزيل تلقائي: مهتم بلا متابعة ١٤ يومًا ← «موعد لاحق» بموعد صباح الغد",
        },
      });
      await logAudit(tx, {
        action: "lead.autoDemoted",
        entity: "lead",
        entityId: l.id,
        summary: `تنزيل تلقائي (راكد ١٤ يومًا): مهتم ← موعد لاحق · العميل=${l.id}`,
      });
    });
    demoted++;
  }
  return demoted;
}

/**
 * يطلق «موظف ركد / ما رد» للموظفين النشطين الذين عندهم عملاء مفتوحون ولم يسجّلوا
 * أي متابعة منذ staleHours — لمرة واحدة لكل موظف ضمن نافذة الركود (dedup).
 */
export async function runIdleEmployeeCheck(now: Date = new Date()): Promise<number> {
  const { staleHours } = await notifyTimings();
  const cutoff = new Date(now.getTime() - staleHours * 3_600_000);

  const emps = await prisma.user.findMany({ where: { role: "EMPLOYEE", active: true }, select: { id: true, name: true } });
  let emitted = 0;
  for (const e of emps) {
    // عنده شغل مفتوح؟ (بدون عملاء مفتوحين لا يُعتبر راكدًا)
    const openLeads = await prisma.lead.count({
      where: { assignedToId: e.id, isArchived: false, stage: { notIn: [...CLOSED] } },
    });
    if (openLeads === 0) continue;
    const lastFu = await prisma.followUp.findFirst({ where: { createdBy: e.id }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    const idle = !lastFu || lastFu.createdAt < cutoff;
    if (!idle) continue;

    const link = `/admin?u=${e.id}`;
    const recent = await prisma.notification.findFirst({
      where: { type: "employee_idle", link, createdAt: { gte: cutoff } },
      select: { id: true },
    });
    if (recent) continue;
    await emitNotification({
      eventKey: "employee_idle",
      title: "موظف ركد / ما رد",
      body: `${e.name} ما سجّل متابعة من فترة`,
      link,
    });
    emitted++;
  }
  return emitted;
}
