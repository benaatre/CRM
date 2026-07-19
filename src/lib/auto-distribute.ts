import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import { ActivityType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { notify, ownerIds } from "@/lib/notify";
import { emitNotification, emitLeadAssignedBatch, type LeadAssignedBucket } from "@/lib/notifications/emit";
import { duplicateLeadIds } from "@/lib/phone-dupe";
import { MAX_REASSIGNS, NEW_LEAD_TIMEOUT_MIN, leadTimeoutMin, sweepEligible } from "./sweep-eligibility";

// نعيد تصدير الحد الأدنى للمهلة (تستورده أكشنات التوزيع من هنا) — مصدره الوحدة النقية.
export { MIN_REASSIGN_TIMEOUT_MIN } from "./sweep-eligibility";

type Db = PrismaClient | Prisma.TransactionClient;

// المراحل المتقدّمة التي لا يُعاد توجيه عملائها (حجز/بيع + مقفول-خسارة #19).
const ADVANCED_STAGES = ["RESERVED", "CLOSED_WON", "CLOSED_LOST"] as const;

// ===================== سويتشات env: فصل التوزيع الأولي عن السحب =====================
//
// pass التوزيع الأولي (توزيع غير الموزّعين والجدد) و pass السحب (إعادة توجيه المتأخرين)
// صارا مستقلين — كل واحد يشتغل فقط لو سويتشه true. autoDistribute في القاعدة يبقى شرطًا
// إضافيًا فوق السويتشين (لا يُكسَر). الافتراضي الآمن: توزيع أولي مفعّل، سحب مطفأ.

function envSwitch(v: string | undefined, def: boolean): boolean {
  if (v == null || v.trim() === "") return def;
  return ["true", "1", "on", "yes"].includes(v.trim().toLowerCase());
}
/** توزيع غير الموزّعين والجدد — مفعّل افتراضيًا. */
export function initialDistributeOn(): boolean { return envSwitch(process.env.AUTO_INITIAL_DISTRIBUTE, true); }
/** سحب المتأخرين وإعادة توجيههم — مطفأ افتراضيًا (خطر: ينقل بين الموظفين). */
export function reassignSweepOn(): boolean { return envSwitch(process.env.AUTO_REASSIGN_SWEEP, false); }

// سقف مطلق: لا يُرشَّح أكثر من ٥ عملاء في نداء الكرون الواحد.
const SWEEP_CAP = 5;

// ملاحظة: منطق الأهلية النقي (نموذج المهلتين + قواعد الحماية + الحاجز التاريخي) في
// ./sweep-eligibility — بلا server-only ليُختبَر مباشرة. نستورده أعلاه ونعيد تصدير حدّ المهلة.

// ===================== أدوات التوقيت (توقيت السعودية UTC+3 بلا تغيير صيفي) =====================

const KSA_OFFSET_MS = 3 * 60 * 60 * 1000;

/** ساعة اليوم بتوقيت السعودية (٠–٢٣) مهما كان توقيت الخادم. */
export function ksaHour(now: Date): number {
  return new Date(now.getTime() + KSA_OFFSET_MS).getUTCHours();
}

/** لحظة بداية «اليوم» بتوقيت السعودية كـ Date عالمي (لعدّ متابعات اليوم). */
export function ksaTodayStart(now: Date): Date {
  const shifted = new Date(now.getTime() + KSA_OFFSET_MS);
  const midnightShifted = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  return new Date(midnightShifted - KSA_OFFSET_MS);
}

/** هل نحن داخل نافذة عمل التوزيع [start, end)؟ */
export function isWithinWindow(startHour: number, endHour: number, now: Date): boolean {
  const h = ksaHour(now);
  if (startHour === endHour) return true; // نافذة على مدار اليوم
  if (startHour < endHour) return h >= startHour && h < endHour;
  // نافذة تعبر منتصف الليل (مثل ٢١ → ٦)
  return h >= startHour || h < endHour;
}

// ===================== الإعدادات والموظفون المشاركون =====================

export type DistSettings = {
  autoDistribute: boolean;
  distStartHour: number;
  distEndHour: number;
  distTimeoutMin: number;
  distPresenceMin: number;
  distOrder: string[];
  distPointer: number;
  distInitialMode: string; // ROUND_ROBIN | LEAST_LOADED
  distReassignMode: string; // MOST_ACTIVE | ROTATION
  sweepCutoffAt: Date; // الحاجز التاريخي — لا يُرشَّح ليد assignedAt < هذا التاريخ
};

const DIST_SELECT = {
  autoDistribute: true, distStartHour: true, distEndHour: true, distTimeoutMin: true,
  distPresenceMin: true, distOrder: true, distPointer: true, distInitialMode: true, distReassignMode: true,
  sweepCutoffAt: true,
} as const;

/** يجلب إعدادات التوزيع (ينشئ السجل إن لزم). */
export async function getDistSettings(db: Db = prisma): Promise<DistSettings> {
  const s = await db.settings.upsert({ where: { id: "singleton" }, update: {}, create: { id: "singleton" }, select: DIST_SELECT });
  return s;
}

/**
 * الموظفون المشاركون المتواجدون — من distOrder، مفعّلون، وآخر ظهورهم ضمن حد التواجد.
 * يحافظ على ترتيب distOrder. إذا distPresenceMin = 0 يتجاهل شرط التواجد (يكفي active).
 */
export async function presentParticipants(db: Db, settings: DistSettings, now: Date): Promise<string[]> {
  if (settings.distOrder.length === 0) return [];
  const since = settings.distPresenceMin > 0 ? new Date(now.getTime() - settings.distPresenceMin * 60_000) : null;
  const users = await db.user.findMany({
    where: { id: { in: settings.distOrder }, active: true },
    select: {
      id: true, lastSeenAt: true, availabilityPaused: true, pauseUntil: true, maxClients: true,
      _count: { select: { assignedLeads: { where: { isArchived: false } } } },
    },
  });
  const ok = new Set(
    users
      .filter((u) => (since ? !!u.lastSeenAt && u.lastSeenAt >= since : true))
      // استثناء المتوقّفين عن الاستقبال (إلا من انتهت مدة إيقافه — سيُرجَع تلقائيًا).
      .filter((u) => !u.availabilityPaused || (u.pauseUntil != null && u.pauseUntil <= now))
      // استثناء من بلغ حدّه الأقصى (maxClients) — #21.
      .filter((u) => u.maxClients == null || u._count.assignedLeads < u.maxClients)
      .map((u) => u.id),
  );
  // الترتيب حسب distOrder، مع إبقاء المتواجدين فقط
  return settings.distOrder.filter((id) => ok.has(id));
}

/** اختيار التالي في الدور الثابت ابتداءً من pointer+1، متخطّيًا غير المتواجدين. */
function pickRotation(order: string[], present: Set<string>, pointer: number, excludeId?: string): { userId: string; pointer: number } | null {
  if (order.length === 0) return null;
  for (let i = 1; i <= order.length; i++) {
    const idx = (pointer + i) % order.length;
    const id = order[idx];
    if (present.has(id) && id !== excludeId) return { userId: id, pointer: idx };
  }
  return null;
}

/** الأقل عملاءً (غير مؤرشفين) بين المشاركين المتواجدين. */
async function pickLeastLoaded(db: Db, candidates: string[], excludeId?: string): Promise<string | null> {
  const ids = candidates.filter((id) => id !== excludeId);
  if (ids.length === 0) return null;
  const counts = await db.lead.groupBy({
    by: ["assignedToId"],
    where: { assignedToId: { in: ids }, isArchived: false },
    _count: { _all: true },
  });
  const loadById = new Map(counts.map((c) => [c.assignedToId as string, c._count._all]));
  let best: string | null = null;
  let min = Infinity;
  for (const id of ids) {
    const l = loadById.get(id) ?? 0;
    if (l < min) { min = l; best = id; }
  }
  return best;
}

/** الأكثر متابعاتٍ مسجّلة اليوم بين المشاركين المتواجدين (تعادل → ترتيب الدور). */
async function pickMostActiveToday(db: Db, order: string[], candidates: string[], now: Date, excludeId?: string): Promise<string | null> {
  const ids = candidates.filter((id) => id !== excludeId);
  if (ids.length === 0) return null;
  const grouped = await db.followUp.groupBy({
    by: ["createdBy"],
    where: { createdBy: { in: ids }, createdAt: { gte: ksaTodayStart(now) } },
    _count: { _all: true },
  });
  const countById = new Map(grouped.map((g) => [g.createdBy, g._count._all]));
  // رتّب حسب: الأكثر متابعات أولًا، وعند التعادل الأسبق في ترتيب الدور.
  return [...ids].sort((a, b) => {
    const d = (countById.get(b) ?? 0) - (countById.get(a) ?? 0);
    if (d !== 0) return d;
    return order.indexOf(a) - order.indexOf(b);
  })[0];
}

// ===================== الإسناد الأولي =====================

/**
 * يحدّد الموظف المُسند للعميل الجديد حسب إعدادات التوزيع — أو null لو التوزيع متوقّف/
 * خارج النافذة/ما فيه مشاركون متواجدون. يحدّث المؤشّر عند الدور الثابت.
 * لا يكتب على العميل — يرجّع المعرّف فقط ليدمجه المنادي في عملية الإنشاء.
 */
export async function pickInitialAssignee(db: Db, now: Date = new Date()): Promise<string | null> {
  const settings = await getDistSettings(db);
  if (!settings.autoDistribute) return null;
  if (!isWithinWindow(settings.distStartHour, settings.distEndHour, now)) return null;
  const present = await presentParticipants(db, settings, now);
  if (present.length === 0) return null;

  if (settings.distInitialMode === "LEAST_LOADED") {
    return pickLeastLoaded(db, present);
  }
  // الدور الثابت
  const picked = pickRotation(settings.distOrder, new Set(present), settings.distPointer);
  if (!picked) return null;
  await db.settings.update({ where: { id: "singleton" }, data: { distPointer: picked.pointer } });
  return picked.userId;
}

// ===================== «التواصل» يوقف العدّاد =====================

/**
 * يضبط وقت أول «تواصل» للعميل (إن لم يكن مضبوطًا) ليوقف عدّاد إعادة التوجيه.
 * يُستدعى عند: متابعة CALL/WHATSAPP، زر إرسال واتساب، أو تحديد موعد متابعة قادم.
 */
export async function markContacted(db: Db, leadId: string, when: Date = new Date()): Promise<void> {
  await db.lead.updateMany({ where: { id: leadId, contactedAt: null }, data: { contactedAt: when } });
}

// ===================== الفحص الدوري وإعادة التوجيه =====================

/**
 * يُرجِع تلقائيًا الموظفين الذين انتهت مدة إيقافهم (pauseUntil مرّ) ويرسل إشعارًا لهم وللمالك.
 */
export async function autoResumeExpiredPauses(now: Date = new Date()): Promise<number> {
  const expired = await prisma.user.findMany({
    where: { availabilityPaused: true, pauseUntil: { not: null, lte: now } },
    select: { id: true, name: true },
  });
  if (expired.length === 0) return 0;
  const mgrs = await ownerIds(prisma);
  for (const u of expired) {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: u.id },
        data: { availabilityPaused: false, pauseReason: null, pauseUntil: null, pausedBy: null, pausedAt: null },
      });
      await notify(tx, [u.id], "availability.resumed", "رجعت لاستقبال العملاء", "انتهت مدة الإيقاف — ترجع الآن ضمن التوزيع");
      await notify(tx, mgrs, "availability.resumed", "موظف رجع للاستقبال", `${u.name} رجع تلقائيًا بعد انتهاء مدة الإيقاف`);
    });
  }
  return expired.length;
}

/**
 * الموظفون «المتاحون» للتوزيع الأولي — المشاركون في الدور، نشطون، وغير موقوفين أنفسهم.
 * (يختلف عن presentParticipants: لا يشترط التواجد اللحظي/آخر ظهور — يكفي أنه متاح.)
 */
export async function availableParticipants(db: Db, settings: DistSettings, now: Date): Promise<string[]> {
  if (settings.distOrder.length === 0) return [];
  const users = await db.user.findMany({
    where: { id: { in: settings.distOrder }, active: true },
    select: {
      id: true, availabilityPaused: true, pauseUntil: true, maxClients: true,
      _count: { select: { assignedLeads: { where: { isArchived: false } } } },
    },
  });
  const ok = new Set(
    users
      .filter((u) => !u.availabilityPaused || (u.pauseUntil != null && u.pauseUntil <= now))
      // استثناء من بلغ حدّه الأقصى (maxClients) — #21.
      .filter((u) => u.maxClients == null || u._count.assignedLeads < u.maxClients)
      .map((u) => u.id),
  );
  return settings.distOrder.filter((id) => ok.has(id));
}

/**
 * التوزيع الأولي للعملاء غير الموزّعين (assignedToId=null + stage=NEW + غير مؤرشف) —
 * يوزّعهم على المتاحين بنفس منطق الإعداد (دوري ثابت / الأقل حملًا) ويضبط assignedAt
 * ليدخلوا دورة إعادة التوجيه. يُحدّث المؤشّر (في القاعدة والذاكرة). يرجّع عدد الموزّعين.
 */
async function distributeUnassignedPass(settings: DistSettings, now: Date, dupIds: Set<string>): Promise<number> {
  const available = await availableParticipants(prisma, settings, now);
  if (available.length === 0) return 0;
  const unassigned = await prisma.lead.findMany({
    // المكررون يُستثنون من التوزيع التلقائي — يُوزّعون حصريًا من «العملاء المكررون».
    where: { assignedToId: null, stage: "NEW", isArchived: false, ...(dupIds.size ? { id: { notIn: [...dupIds] } } : {}) },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
  if (unassigned.length === 0) return 0;

  const availSet = new Set(available);
  let pointer = settings.distPointer;
  // أحمال حالية للأقل-حملًا.
  const load = new Map<string, number>(available.map((id) => [id, 0]));
  if (settings.distInitialMode === "LEAST_LOADED") {
    const counts = await prisma.lead.groupBy({
      by: ["assignedToId"],
      where: { assignedToId: { in: available }, isArchived: false },
      _count: { _all: true },
    });
    for (const c of counts) if (c.assignedToId) load.set(c.assignedToId, c._count._all);
  }

  let distributed = 0;
  // نجمّع لكل موظف عدد ما استقبله + عيّنة، عشان إشعار واحد مجمّع بدل عدة أصوات.
  const buckets = new Map<string, LeadAssignedBucket>();
  for (const lead of unassigned) {
    let pick: string | null = null;
    if (settings.distInitialMode === "LEAST_LOADED") {
      let min = Infinity;
      for (const id of available) { const l = load.get(id) ?? 0; if (l < min) { min = l; pick = id; } }
      if (pick) load.set(pick, (load.get(pick) ?? 0) + 1);
    } else {
      const picked = pickRotation(settings.distOrder, availSet, pointer);
      if (picked) { pick = picked.userId; pointer = picked.pointer; }
    }
    if (!pick) break;
    const toUserId = pick;
    await prisma.$transaction(async (tx) => {
      await tx.lead.update({ where: { id: lead.id }, data: { assignedToId: toUserId, assignedAt: now } });
      await tx.reassignment.create({ data: { leadId: lead.id, fromUserId: null, toUserId, reason: "initial" } });
    });
    const b = buckets.get(toUserId);
    if (b) b.count++;
    else buckets.set(toUserId, { userId: toUserId, count: 1, sampleLeadId: lead.id, sampleName: lead.name });
    distributed++;
  }

  // إشعار مجمّع لكل موظف (واحد مهما كان عدد العملاء).
  await emitLeadAssignedBatch([...buckets.values()]);

  if (settings.distInitialMode !== "LEAST_LOADED" && pointer !== settings.distPointer) {
    await prisma.settings.update({ where: { id: "singleton" }, data: { distPointer: pointer } });
    settings.distPointer = pointer; // حدّث في الذاكرة لمرحلة إعادة التوجيه
  }
  return distributed;
}

/**
 * #22: يصعّد للمالك العملاء الذين بلغوا سقف إعادة التوجيه (reassignCount ≥ MAX) بلا تواصل —
 * ما زالوا مفتوحين ومع آخر موظف. إشعار واحد لكل عميل (dedup عبر سجل الإشعارات).
 */
async function escalateCappedLeads(): Promise<void> {
  const capped = await prisma.lead.findMany({
    where: {
      assignedToId: { not: null },
      contactedAt: null,
      isArchived: false,
      stage: { notIn: [...ADVANCED_STAGES] },
      reassignCount: { gte: MAX_REASSIGNS },
    },
    select: { id: true, name: true },
  });
  if (capped.length === 0) return;

  const links = capped.map((l) => `/leads/${l.id}`);
  const already = await prisma.notification.findMany({
    where: { type: "dist.capped", link: { in: links } },
    select: { link: true },
  });
  const notifiedSet = new Set(already.map((n) => n.link));
  const fresh = capped.filter((l) => !notifiedSet.has(`/leads/${l.id}`));
  if (fresh.length === 0) return;

  const owners = await ownerIds(prisma);
  for (const l of fresh) {
    await notify(
      prisma, owners, "dist.capped", "عميل تجاوز حد إعادة التوجيه",
      `${l.name} تنقّل ${MAX_REASSIGNS} مرات بلا تواصل — يحتاج تدخّلك`, `/leads/${l.id}`,
    );
  }
}

/**
 * pass السحب (قاعدة ٥ — اقتراح لا تنفيذ): يرشّح المتأخرين للمالك بدل ما يسحبهم. يطبّق شبكة
 * الأمان الكاملة عبر sweepEligible (النقي)، سقف ٥ لكل نداء، ولوق إجباري، ثم يكتب SweepCandidate
 * (upsert) ويشعر المالك بعدد الجدد. لا ينقل أي عميل — النقل بضغطة المالك (executeSweepPull) فقط.
 * يرجّع عدد المرشّحين الجدد + المفحوصين.
 */
async function runReassignSweepPass(settings: DistSettings, now: Date, dupIds: Set<string>): Promise<{ proposed: number; checked: number; skipped?: string }> {
  // استعلام تقريبي على القاعدة (للأداء) يعكس قواعد الحماية الدائمة؛ الحكم النهائي بـ sweepEligible.
  const loosest = new Date(now.getTime() - NEW_LEAD_TIMEOUT_MIN * 60_000);
  const overdueRaw = await prisma.lead.findMany({
    where: {
      assignedToId: { not: null },
      assignedAt: { not: null, lte: loosest, gte: settings.sweepCutoffAt }, // قاعدة ٣: بعد الحاجز التاريخي فقط
      contactedAt: null,                    // قاعدة ١: تواصل مسجّل → حصانة
      stage: "NEW",                          // قاعدة ١: المرحلة ∉ [NEW] → حصانة
      isArchived: false,
      manualAssignedAt: null,                // قاعدة ٢: حصانة الإسناد اليدوي الدائمة
      followUps: { none: {} },               // قاعدة ١: أي متابعة واحدة → حصانة دائمة
      reassignCount: { lt: MAX_REASSIGNS }, // #22: تجاوزوا السقف يبقون مع آخر موظف
      ...(dupIds.size ? { id: { notIn: [...dupIds] } } : {}), // المكرر لا يُرشَّح آليًا
    },
    select: {
      id: true, assignedToId: true, name: true, assignedAt: true, createdAt: true,
      reassignCount: true, contactedAt: true, isArchived: true, stage: true, manualAssignedAt: true,
    },
    orderBy: { assignedAt: "asc" },
  });

  // #22: عملاء بلغوا سقف إعادة التوجيه بلا تواصل → تصعيد للمالك.
  await escalateCappedLeads();

  // الحكم النهائي بالدالة النقية (مصدر الحقيقة). hasFollowUp=false لأن الاستعلام صفّى ذوي المتابعات.
  const overdue = overdueRaw.filter((l) => sweepEligible({ ...l, hasFollowUp: false }, settings, now));
  if (overdue.length === 0) return { proposed: 0, checked: 0 };

  // سقف مطلق: لا أكثر من ٥ مرشّحين في نداء الكرون الواحد.
  const candidates = overdue.slice(0, SWEEP_CAP);

  let proposed = 0; // الجدد فقط (لإشعار المالك)
  for (const lead of candidates) {
    const from = lead.assignedToId as string;
    const tmin = leadTimeoutMin(lead, settings, now);
    // لوق إجباري قبل كل ترشيح: leadId · من · وقت الإسناد · السبب (المهلة المطبّقة).
    console.info(
      `[sweep] propose lead=${lead.id} from=${from} assignedAt=${lead.assignedAt?.toISOString()} reason=timeout(${tmin}min)`,
    );
    const existing = await prisma.sweepCandidate.findUnique({ where: { leadId: lead.id }, select: { id: true } });
    await prisma.sweepCandidate.upsert({
      where: { leadId: lead.id },
      update: { fromUserId: from, reason: "timeout", timeoutMin: tmin, leadAssignedAt: lead.assignedAt },
      create: { leadId: lead.id, fromUserId: from, reason: "timeout", timeoutMin: tmin, leadAssignedAt: lead.assignedAt },
    });
    if (!existing) proposed++;
  }

  // إشعار المالك بعدد المرشّحين الجدد فقط (لا إزعاج لو ما فيه جديد).
  if (proposed > 0) {
    const owners = await ownerIds(prisma);
    await notify(prisma, owners, "dist.sweep_candidates", "مرشّحون للسحب",
      `فيه ${proposed} عميل مرشّح للسحب — راجعهم قبل ما يُنقلوا`, "/distribution");
  }

  return { proposed, checked: candidates.length };
}

/**
 * تنفيذ سحب مرشّح واحد بموافقة المالك (زر «اسحب»): يختار المستقبِل حسب وضع إعادة التوجيه ثم ينقل
 * العميل فعليًا (assignedAt=now, reassignCount+1) مع سجل/نشاط/إشعارات، ويحذف بطاقة الترشيح.
 * لا يضبط manualAssignedAt — الموظف الجديد يبدأ مهلته من جديد ويدخل الدورة عاديًا.
 */
export async function executeSweepPull(leadId: string, now: Date = new Date()): Promise<{ ok: boolean; toUserId?: string; error?: string }> {
  const settings = await getDistSettings(prisma);
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, name: true, assignedToId: true } });
  if (!lead || !lead.assignedToId) return { ok: false, error: "العميل غير موجود أو غير مُسند" };
  const from = lead.assignedToId;

  const present = await presentParticipants(prisma, settings, now);
  if (present.length === 0) return { ok: false, error: "ما فيه موظف متواجد لاستقبال العميل الآن" };

  let toUserId: string | null;
  let pointer = settings.distPointer;
  if (settings.distReassignMode === "ROTATION") {
    const picked = pickRotation(settings.distOrder, new Set(present), pointer, from);
    if (picked) { toUserId = picked.userId; pointer = picked.pointer; } else toUserId = null;
  } else {
    toUserId = await pickMostActiveToday(prisma, settings.distOrder, present, now, from);
  }
  if (!toUserId || toUserId === from) return { ok: false, error: "ما فيه موظف بديل مناسب لاستقباله" };
  const target = toUserId;

  console.info(`[sweep] pull(approved) lead=${lead.id} from=${from} to=${target}`);
  await prisma.$transaction(async (tx) => {
    await tx.lead.update({ where: { id: lead.id }, data: { assignedToId: target, assignedAt: now, reassignCount: { increment: 1 } } });
    await tx.reassignment.create({ data: { leadId: lead.id, fromUserId: from, toUserId: target, reason: "timeout" } });
    await tx.activity.create({ data: { leadId: lead.id, userId: null, type: ActivityType.ASSIGNMENT, note: "سحب بموافقة المالك (تقصير في التواصل)" } });
    await emitNotification({
      eventKey: "lead_reassigned", assignedUserId: target, title: "إعادة توزيع عميل",
      body: `${lead.name} — نُقل إليك بعد تأخّر الموظف السابق`, link: `/leads/${lead.id}`,
    }, tx);
    await notify(tx, [from], "lead_lost", "فاتك عميل",
      `${lead.name} — سحبه المالك بعد تأخّر التواصل. بادر بعملائك بسرعة.`, `/leads/${lead.id}`);
    await tx.sweepCandidate.deleteMany({ where: { leadId: lead.id } });
  });
  if (settings.distReassignMode === "ROTATION" && pointer !== settings.distPointer) {
    await prisma.settings.update({ where: { id: "singleton" }, data: { distPointer: pointer } });
  }
  return { ok: true, toUserId: target };
}

export type PassResult = { on: boolean; count: number; skipped?: string };
export type DistributionRunResult = {
  ok: boolean;
  initialDistribute: PassResult;
  reassignSweep: PassResult;
  error?: string;
};

/**
 * الدالة المركزية لدورة الكرون: تشغّل pass التوزيع الأولي و pass السحب — كلٌّ مستقلّ خلف سويتش
 * env خاص، وكلاهما مشروط إضافيًا بـ autoDistribute (القاعدة) + نافذة العمل. تحدّث «آخر دورة كرون».
 * تُعيد حالة كل pass صراحة (on/count/skipped). السويتشان مطفيان → ok مع صفر، لا تفشل.
 */
export async function runDistributionPasses(now: Date = new Date()): Promise<DistributionRunResult> {
  try {
    // رجوع تلقائي للموظفين الذين انتهت مدة إيقافهم — يعمل دائمًا.
    await autoResumeExpiredPauses(now);

    const settings = await getDistSettings(prisma);
    const initialOn = initialDistributeOn();
    const sweepOn = reassignSweepOn();
    const within = isWithinWindow(settings.distStartHour, settings.distEndHour, now);
    // شرط القاعدة + النافذة فوق السويتشين (لا يُكسَر autoDistribute).
    const gateSkip = !settings.autoDistribute ? "التوزيع التلقائي متوقّف (القاعدة)" : !within ? "خارج نافذة العمل" : null;

    const dupIds = (initialOn || sweepOn) && !gateSkip ? await duplicateLeadIds() : new Set<string>();

    // pass ١: توزيع أولي (مفعّل افتراضيًا).
    let initial: PassResult;
    if (!initialOn) initial = { on: false, count: 0, skipped: "السويتش مطفأ (AUTO_INITIAL_DISTRIBUTE)" };
    else if (gateSkip) initial = { on: true, count: 0, skipped: gateSkip };
    else initial = { on: true, count: await distributeUnassignedPass(settings, now, dupIds) };

    // pass ٢: ترشيح المتأخرين للسحب (مطفأ افتراضيًا). true = «اقترح للمالك»، لا تنفيذ تلقائي.
    let sweep: PassResult;
    if (!sweepOn) sweep = { on: false, count: 0, skipped: "السويتش مطفأ (AUTO_REASSIGN_SWEEP)" };
    else if (gateSkip) sweep = { on: true, count: 0, skipped: gateSkip };
    else {
      const r = await runReassignSweepPass(settings, now, dupIds);
      sweep = { on: true, count: r.proposed, skipped: r.skipped };
    }

    // «آخر دورة كرون» — لعرضها في اللوحة. فشل التحديث لا يُفشِل الدورة.
    await prisma.settings.update({
      where: { id: "singleton" },
      data: { lastCronAt: now, lastCronDistributed: initial.count, lastCronReassigned: sweep.count },
    }).catch((e) => console.error("[cron] تعذّر تحديث آخر دورة", e));

    return { ok: true, initialDistribute: initial, reassignSweep: sweep };
  } catch (e) {
    return { ok: false, initialDistribute: { on: false, count: 0 }, reassignSweep: { on: false, count: 0 }, error: (e as Error).message };
  }
}
