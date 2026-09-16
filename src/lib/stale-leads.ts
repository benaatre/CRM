import "server-only";

import { cache } from "react";
import type { LeadStage, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guards";
import { isManager } from "@/lib/auth-guards";
import { getLeads, type LeadRow } from "@/lib/data/leads";
import {
  STALE_DAYS, MISSED_APPOINTMENT_HOURS, ABANDONED_DAYS, DORMANT_DAYS,
  STALE_EXCLUDED_STAGES, STALE_CLOSED_STAGES, HOT_STAGES,
} from "@/lib/stale-config";

/**
 * «العملاء الراكدين» — نقطة الحقيقة الوحيدة (docs/STALE-LEADS-SPEC.md).
 * قراءات فقط من Lead والمتابعات · صفر schema · المنطق لا يُكرَّر في أي مكوّن.
 *
 * التعريف: مسند وغير مؤرشف ومرحلته خارج المستثنى، وليس عليه أي موعد مستقبلي
 * (موعد قادم — ولو بعد شهرين — يخرجه نهائيًا)، وأحد سببين:
 *   [أ] NO_DATE: بلا أي موعد مجدول إطلاقًا وآخر حركة أقدم من ٧ أيام.
 *   [ب] MISSED: آخر موعد مجدول فات بأكثر من ٤٨ ساعة وما انسجّلت متابعة بعده.
 * «آخر حركة» = الأحدث بين lastContact وآخر متابعة (متابعة «لم يرد» حركة)،
 * وإن غابا فـassignedAt ثم createdAt.
 *
 * النطاق مُطبَّق هنا على الخادم (نمط getMyOverdue): الهوية من الجلسة —
 * الموظف يُجبَر على عملائه وحدهم مهما طلب، والمالك/الأدمن يرى الفريق كله
 * أو موظفًا بعينه.
 */

const DAY_MS = 86_400_000;
const HOT_SET = new Set<LeadStage>(HOT_STAGES);

export type StaleTier = "STALE" | "ABANDONED" | "DORMANT";
export type StaleReason = "NO_DATE" | "MISSED";

export type StaleMeta =
  | { isStale: false }
  | {
      isStale: true;
      /** أيام الركود منذ آخر حركة. */
      days: number;
      tier: StaleTier;
      reason: StaleReason;
      isHot: boolean;
      /** آخر موعد مجدول (الفائت) — null في حالة NO_DATE. */
      lastScheduled: Date | null;
      lastActivity: Date;
    };

/**
 * حقول العميل التي يحتاجها الحكم. followUps تكفي بأقصى قيمها: الدالة لا
 * تستخدم من المصفوفة إلا (أقصى createdAt · أقصى nextDate · هل بعد آخر موعد
 * متابعة؟ = أقصى createdAt > آخر موعد) — فتمرير صفٍّ واحد يحمل القيمتين
 * القصويين مكافئ تمامًا لتمرير التاريخ كاملًا.
 */
export type StaleLeadInput = {
  stage: LeadStage;
  lastContact: Date | null;
  nextFollowup: Date | null;
  assignedAt: Date | null;
  /** يُستخدم كأساس أخير فقط (lastContact ثم assignedAt أسبق)؛ يقبل null لصفوف getLeads المحجوب عنها. */
  createdAt: Date | null;
  followUps: { createdAt: Date; nextDate: Date | null }[];
  /** اختياريان لبطاقات خارج فلتر الراكد — إن حضرا يُفحصان. */
  assignedToId?: string | null;
  isArchived?: boolean;
};

/** الحكم على عميل واحد — يصلح لأي بطاقة حمّلت الحقول أعلاه. */
export function staleMetaFor(lead: StaleLeadInput, now = Date.now()): StaleMeta {
  if (lead.assignedToId === null || lead.isArchived === true) return { isStale: false };
  if (STALE_EXCLUDED_STAGES.includes(lead.stage)) return { isStale: false };

  const schedTimes = [
    ...(lead.nextFollowup ? [+lead.nextFollowup] : []),
    ...lead.followUps.filter((f) => f.nextDate).map((f) => +(f.nextDate as Date)),
  ];
  const lastScheduled = schedTimes.length ? Math.max(...schedTimes) : null;

  // القاعدة الحاسمة: موعد قادم بالمستقبل — ولو بعيدًا — يُخرجه من الركود.
  if (lastScheduled !== null && lastScheduled > now) return { isStale: false };

  const fuCreated = lead.followUps.map((f) => +f.createdAt);
  const lastFu = fuCreated.length ? Math.max(...fuCreated) : null;
  // الأساس: آخر تواصل ثم الإسناد ثم الإنشاء. المستدعون يضمنون وجود أحدها
  // (attachStaleMeta يمتنع عن الحكم إن غابت الثلاثة)؛ الصفر حارس أخير لا يُبلَغ.
  const base = +(lead.lastContact ?? lead.assignedAt ?? lead.createdAt ?? 0);
  const lastActivity = Math.max(base, lastFu ?? 0);

  const condA = lastScheduled === null && lastActivity < now - STALE_DAYS * DAY_MS;
  const condB =
    lastScheduled !== null &&
    lastScheduled < now - MISSED_APPOINTMENT_HOURS * 3_600_000 &&
    (lastFu === null || lastFu <= lastScheduled);
  if (!condA && !condB) return { isStale: false };

  const days = Math.floor((now - lastActivity) / DAY_MS);
  const tier: StaleTier =
    days > DORMANT_DAYS ? "DORMANT" : days >= ABANDONED_DAYS ? "ABANDONED" : "STALE";
  return {
    isStale: true,
    days,
    tier,
    reason: condA ? "NO_DATE" : "MISSED",
    isHot: HOT_SET.has(lead.stage),
    lastScheduled: lastScheduled === null ? null : new Date(lastScheduled),
    lastActivity: new Date(lastActivity),
  };
}

/**
 * where «المرشّحين» — دقيق في الإسناد/الأرشفة/المراحل/استبعاد الموعد المستقبلي
 * (بمصدريه: Lead.nextFollowup وأي FollowUp.nextDate)، ويوسّع قليلًا في شرطي
 * أ/ب لأن مقارنة «متابعة بعد آخر موعد» صفٌّ-بصف لا يعبَّر عنها بـPrisma —
 * فالحكم النهائي دائمًا لـstaleMetaFor.
 */
export function buildStaleWhere(userId?: string, now = new Date()): Prisma.LeadWhereInput {
  return {
    assignedToId: userId ?? { not: null },
    isArchived: false,
    stage: { notIn: STALE_EXCLUDED_STAGES },
    AND: [
      { OR: [{ nextFollowup: null }, { nextFollowup: { lte: now } }] },
      { followUps: { none: { nextDate: { gt: now } } } },
    ],
  };
}

/* ═════════ الجلب الداخلي المشترك ═════════ */

export type StaleRow = {
  id: string;
  name: string;
  phone: string;
  stage: LeadStage;
  days: number;
  tier: StaleTier;
  reason: StaleReason;
  isHot: boolean;
  lastScheduled: Date | null;
  lastActivity: Date;
  /**
   * نص آخر متابعة — سطر «آخر متابعة» بالبطاقات. يُملأ في listStale للصفوف
   * المعروضة فقط (لا عمود بالقاعدة — يؤخذ من أحدث FollowUp)، وnull في العدّ.
   */
  lastNote: string | null;
  /** اسم الموظف المسؤول — لعرض المالك، وموجود دائمًا (الراكد مسند بالتعريف). */
  employeeName: string | null;
  employeeId: string | null;
};

/**
 * النطاق واتجاه الترتيب من الجلسة حصرًا: الموظف ⇒ نفسه مهما طلب واتجاه
 * «employee»؛ المدير (مالك/أدمن) ⇒ الفريق كله أو userId بعينه واتجاه «owner».
 */
async function resolveScope(
  requestedUserId?: string,
): Promise<{ userId?: string; direction: StaleSortDir }> {
  const user = await requireUser();
  if (!isManager(user.role)) return { userId: user.id, direction: "employee" };
  return { userId: requestedUserId, direction: "owner" };
}

/**
 * يجلب راكدي النطاق كاملين (مرشّحون عبر buildStaleWhere ثم حكم staleMetaFor).
 * المتابعات لا تُجلب تاريخًا كاملًا: groupBy بأقصى createdAt/nextDate لكل
 * عميل — مكافئ رياضيًا للتاريخ الكامل (انظر StaleLeadInput) وخفيف يحتمل
 * التحديث الحي.
 */
const fetchStale = cache(async function fetchStale(scopeUserId?: string): Promise<StaleRow[]> {
  const now = Date.now();
  const candidates = await prisma.lead.findMany({
    where: buildStaleWhere(scopeUserId, new Date(now)),
    select: {
      id: true, name: true, phone: true, stage: true,
      lastContact: true, nextFollowup: true, assignedAt: true, createdAt: true,
      assignedToId: true,
      assignedTo: { select: { name: true } },
    },
  });
  if (!candidates.length) return [];

  const agg = await prisma.followUp.groupBy({
    by: ["leadId"],
    where: { leadId: { in: candidates.map((c) => c.id) } },
    _max: { createdAt: true, nextDate: true },
  });
  const maxByLead = new Map(agg.map((a) => [a.leadId, a._max]));

  const rows: StaleRow[] = [];
  for (const c of candidates) {
    const m = maxByLead.get(c.id);
    const meta = staleMetaFor(
      {
        stage: c.stage,
        lastContact: c.lastContact,
        nextFollowup: c.nextFollowup,
        assignedAt: c.assignedAt,
        createdAt: c.createdAt,
        followUps: m?.createdAt
          ? [{ createdAt: m.createdAt, nextDate: m.nextDate ?? null }]
          : [],
      },
      now,
    );
    if (!meta.isStale) continue;
    rows.push({
      id: c.id, name: c.name, phone: c.phone, stage: c.stage,
      days: meta.days, tier: meta.tier, reason: meta.reason, isHot: meta.isHot,
      lastScheduled: meta.lastScheduled, lastActivity: meta.lastActivity,
      lastNote: null,
      employeeName: c.assignedTo?.name ?? null,
      employeeId: c.assignedToId,
    });
  }
  return rows;
});

/** اتجاه ترتيب القائمة حسب الناظر (يُشتقّ من الدور في resolveScope). */
export type StaleSortDir = "employee" | "owner";

/**
 * الترتيب المعتمد (مكان واحد، الاتجاه معامل لا نسخة ثانية): الحارّ أولًا دائمًا.
 * - المالك: الأقدم ركودًا أولًا داخل كل شريحة (نظرة تصفية).
 * - الموظف: داخل الحارّ الأحدث ركودًا أولًا (الأقرب للإنقاذ)، ثم الباقي بالأقدم.
 */
function sortStale<T extends { isHot: boolean; days: number }>(
  rows: T[], direction: StaleSortDir = "owner",
): T[] {
  return [...rows].sort((a, b) => {
    if (a.isHot !== b.isHot) return Number(b.isHot) - Number(a.isHot); // الحارّ أولًا
    if (a.isHot && direction === "employee") return a.days - b.days;   // حارّ الموظف: الأحدث أولًا
    return b.days - a.days;                                            // البقية: الأقدم أولًا
  });
}

/* ═════════ الواجهة العامة ═════════ */

export type StaleCounts = {
  total: number;
  /** الحارّ — محور مستقل يعبر الدرجات الثلاث، لا شريحة منها. */
  hot: number;
  /** الدرجات بالعمر — مجموعها = total. */
  tiers: { stale: number; abandoned: number; dormant: number };
  /** عدّاد مرحلة «موعد لاحق» — خانة كرت الموظف. */
  laterStage: number;
};

/** عدّادات النطاق (نطاق الجلسة؛ المدير يمرّر userId لموظف بعينه اختياريًا). */
export async function countStale(userId?: string): Promise<StaleCounts> {
  return tallyStale(await fetchStale((await resolveScope(userId)).userId));
}

export type StaleTab = "hot" | "later" | "dormant" | "all";

/**
 * قائمة الراكدين — الترتيب المعتمد: الحارّ أولًا ثم الأقدم ركودًا
 * (وداخل تبويب الحارّ: الأقدم ركودًا — قائمة المالك الدوّارة نفسها).
 */
export async function listStale(
  userId?: string,
  opts: { tab?: StaleTab; take?: number } = {},
): Promise<{ rows: StaleRow[]; total: number }> {
  const { tab = "all", take } = opts;
  const { userId: scopeId, direction } = await resolveScope(userId);
  const all = await fetchStale(scopeId);
  const picked =
    tab === "hot" ? all.filter((r) => r.isHot)
    : tab === "later" ? all.filter((r) => r.stage === "FOLLOW_UP_LATER")
    : tab === "dormant" ? all.filter((r) => r.tier === "DORMANT")
    : all;
  const filtered = sortStale(picked, direction);
  const rows = take === undefined ? filtered : filtered.slice(0, take);
  await fillLastNotes(rows);
  return { rows, total: filtered.length };
}

/**
 * سطر «آخر متابعة» للصفوف المعروضة فقط: أحدث متابعة لكل عميل (distinct مع
 * الترتيب التنازلي = الأحدث)، لا جلب تاريخ ولا نص لكل المرشحين. يُطفر في مكانه.
 */
async function fillLastNotes(rows: StaleRow[]): Promise<void> {
  if (!rows.length) return;
  const notes = await prisma.followUp.findMany({
    where: { leadId: { in: rows.map((r) => r.id) } },
    orderBy: { createdAt: "desc" },
    distinct: ["leadId"],
    select: { leadId: true, note: true },
  });
  const noteByLead = new Map(notes.map((n) => [n.leadId, n.note]));
  for (const r of rows) r.lastNote = noteByLead.get(r.id) ?? null;
}

/** يجمع عدّادات الدرجات/الحرارة/«موعد لاحق» من صفوف راكدة محسوبة سلفًا. */
function tallyStale(rows: StaleRow[]): StaleCounts {
  const counts: StaleCounts = { total: rows.length, hot: 0, tiers: { stale: 0, abandoned: 0, dormant: 0 }, laterStage: 0 };
  for (const r of rows) {
    if (r.isHot) counts.hot++;
    if (r.tier === "DORMANT") counts.tiers.dormant++;
    else if (r.tier === "ABANDONED") counts.tiers.abandoned++;
    else counts.tiers.stale++;
    if (r.stage === "FOLLOW_UP_LATER") counts.laterStage++;
  }
  return counts;
}

/* ═════════ رئيسية الموظف — القائمة الشخصية (المرحلة ٣) ═════════ */

/**
 * راكدو المستخدم الحالي لكرت الرئيسية وقائمته الدوّارة. **النطاق شخصيّ دائمًا**
 * (هوية الجلسة، لا يقبل معرّفًا خارجيًا) و**الاتجاه «إنقاذ» (employee) مهما كان
 * الدور** — فالأدمن الذي له عملاء مسندون يرى ترتيب الإنقاذ في قائمته الشخصية:
 * الاتجاه يتبع الشاشة لا الدور. يرجّع العدّادات + أول `take` صفًّا + بقية العدد.
 */
export async function getMyStaleHome(
  take = 9,
): Promise<{ counts: StaleCounts; rows: StaleRow[]; restCount: number }> {
  const user = await requireUser();
  const all = sortStale(await fetchStale(user.id), "employee");
  const counts = tallyStale(all);
  const rows = all.slice(0, take);
  await fillLastNotes(rows);
  return { counts, rows, restCount: Math.max(0, all.length - rows.length) };
}

/* ═════════ فلتر «راكد» في شاشة كل العملاء (المرحلة ٢) ═════════ */

/**
 * شارة العميل الراكد — تُلصق على صف getLeads فيقرأها الجدول. مصدرها staleMetaFor
 * (لا الـwhere): الـwhere يرشّح ١٢٨٢، والحكم النهائي هنا يصفّيهم لـ٩٠٠.
 */
export type StaleBadge = {
  days: number;
  tier: StaleTier;
  reason: StaleReason;
  isHot: boolean;
};

/**
 * يلصق شارة الركود على صفوف getLeads المعروضة (أي فلتر) — تجميعة واحدة خفيفة
 * **مقيّدة بمعرّفات الصفوف المعروضة وحدها** (لا كل المرشحين): groupBy لأقصى
 * (createdAt · nextDate) للمتابعات على تلك المعرّفات، ثم الحكم بـstaleMetaFor
 * من حقول الصف نفسه. يُطفر الحقل في مكانه. المرشّح غير المسند/المؤرشف/المقفول/
 * «لم يرد» يرجع بلا شارة تلقائيًا (staleMetaFor يصدّه). أساس «آخر حركة» يحلّه
 * assignedAt للمسند (createdAt المحجوب عن الموظف لا يلزم — غير المسند بلا شارة).
 */
export async function attachStaleMeta(rows: LeadRow[], now = Date.now()): Promise<void> {
  if (!rows.length) return;
  const agg = await prisma.followUp.groupBy({
    by: ["leadId"],
    where: { leadId: { in: rows.map((r) => r.id) } },
    _max: { createdAt: true, nextDate: true },
  });
  const maxByLead = new Map(agg.map((a) => [a.leadId, a._max]));
  for (const r of rows) {
    // أساس «آخر حركة» يجب أن يوجد حقيقةً: المسند له assignedAt دائمًا. إن غاب
    // الثلاثة (سجل شاذّ + createdAt محجوب عن الموظف) نمتنع عن الحكم بدل تلفيق قِدَم.
    if (!r.lastContact && !r.assignedAt && !r.createdAt) { r.staleMeta = null; continue; }
    const m = maxByLead.get(r.id);
    const meta = staleMetaFor(
      {
        stage: r.stage,
        lastContact: r.lastContact,
        nextFollowup: r.nextFollowup,
        assignedAt: r.assignedAt,
        createdAt: r.createdAt,
        followUps: m?.createdAt ? [{ createdAt: m.createdAt, nextDate: m.nextDate ?? null }] : [],
        assignedToId: r.assignedTo?.id ?? null,
        isArchived: r.isArchived,
      },
      now,
    );
    r.staleMeta = meta.isStale
      ? { days: meta.days, tier: meta.tier, reason: meta.reason, isHot: meta.isHot }
      : null;
  }
}

/** يعيد ترتيب صفوف getLeads (تأتي بترتيب النشاط) على ترتيب قائمة الراكد. */
function reorderByIds<T extends { id: string }>(rows: T[], orderedIds: string[]): T[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return orderedIds
    .map((id) => byId.get(id))
    .filter((r): r is T => r !== undefined);
}

/**
 * صفوف فلتر «راكد» بشكل LeadRow الكامل (الخيار المعتمد: قائمة المعرّفات مرة
 * واحدة ثم القص). ٣ استعلامات: المرشّحون + groupBy (داخل fetchStale المُخزَّن)
 * ثم getLeads بالمعرّفات — لا تُنفَّذ إلا عند تفعيل الفلتر (يستدعيها مسار الـAPI
 * حصرًا بوجود stale=1). العدّاد = طول القائمة الكاملة (٩٠٠)، والصفوف أول ٥٠٠
 * بالترتيب المعتمد مُعاد ترتيبها بالذاكرة على رتبة الراكد.
 */
export async function listStaleLeadRows(
  opts: { employeeId?: string; take?: number } = {},
): Promise<{ rows: LeadRow[]; total: number }> {
  const { employeeId, take = 500 } = opts;
  // المدير يجوز أن يقصر على موظف بعينه (نقرة شيت التوزيع)؛ الموظف مقيّد بنفسه.
  const { userId: scopeId, direction } = await resolveScope(employeeId);
  const all = sortStale(await fetchStale(scopeId), direction);
  const total = all.length;
  const head = all.slice(0, take);
  if (!head.length) return { rows: [], total };

  const ids = head.map((r) => r.id);
  const raw = await getLeads({ tab: "all", ids });
  const metaById = new Map<string, StaleBadge>(
    head.map((r) => [r.id, { days: r.days, tier: r.tier, reason: r.reason, isHot: r.isHot }]),
  );
  const rows = reorderByIds(raw, ids).map((r) => ({ ...r, staleMeta: metaById.get(r.id) ?? null }));
  return { rows, total };
}

/* ═════════ رئيسية المالك — الفريق (المرحلة ٤) ═════════ */

/**
 * راكدو الفريق لكرت المالك وقائمته الدوّارة: نطاق كامل + اتجاه «المالك» (الأقدم
 * أولًا) عبر resolveScope (يصل إليه المدير فقط من رئيسيته). الصفوف تحمل اسم
 * الموظف المسؤول («عند فلان») — والراكد مسند بالتعريف فالاسم موجود دائمًا.
 */
export async function getTeamStaleHome(
  take = 9,
): Promise<{ counts: StaleCounts; rows: StaleRow[]; restCount: number }> {
  const { userId: scopeId, direction } = await resolveScope();
  const all = sortStale(await fetchStale(scopeId), direction);
  const counts = tallyStale(all);
  const rows = all.slice(0, take);
  await fillLastNotes(rows);
  return { counts, rows, restCount: Math.max(0, all.length - rows.length) };
}

export type StaleEmployeeRow = {
  employeeId: string;
  employeeName: string;
  total: number;
  hot: number;
  tiers: { stale: number; abandoned: number; dormant: number };
  /** أقدم راكد (أيام) لدى الموظف. */
  oldest: number;
  /** إجمالي النشط المسند للموظف (مقام النسبة) — مطابق لمقام الحصر. */
  activeCount: number;
};

/**
 * توزيع الراكد على الموظفين لشيت المالك — مرتّب بعدد الحارّ تنازليًا (لا العدد
 * المطلق). يشمل خريطة الحارّ لكل موظف (شارة قسم الدوام). عرض فقط. النطاق يصل
 * إليه المدير فقط من رئيسيته؛ إن استُدعي بلا صلاحية مدير رجع نطاق الجلسة وحده.
 */
export async function getStaleByEmployee(): Promise<{ rows: StaleEmployeeRow[]; hotById: Record<string, number>; activeTotal: number }> {
  const { userId: scopeId } = await resolveScope();
  const stale = await fetchStale(scopeId);

  // النشط المسند لكل موظف (مقام النسبة) — مطابق لمقام الحصر (يشمل ATTEMPTED).
  const active = await prisma.lead.groupBy({
    by: ["assignedToId"],
    where: { assignedToId: { not: null }, isArchived: false, stage: { notIn: STALE_CLOSED_STAGES } },
    _count: { _all: true },
  });
  const activeById = new Map(active.map((a) => [a.assignedToId as string, a._count._all]));
  const activeTotal = active.reduce((s, a) => s + a._count._all, 0);

  const byEmp = new Map<string, StaleEmployeeRow>();
  const hotById: Record<string, number> = {};
  for (const r of stale) {
    const id = r.employeeId;
    if (!id) continue;
    let e = byEmp.get(id);
    if (!e) {
      e = { employeeId: id, employeeName: r.employeeName ?? "—", total: 0, hot: 0, tiers: { stale: 0, abandoned: 0, dormant: 0 }, oldest: 0, activeCount: activeById.get(id) ?? 0 };
      byEmp.set(id, e);
    }
    e.total++;
    if (r.isHot) { e.hot++; hotById[id] = (hotById[id] ?? 0) + 1; }
    if (r.tier === "DORMANT") e.tiers.dormant++;
    else if (r.tier === "ABANDONED") e.tiers.abandoned++;
    else e.tiers.stale++;
    if (r.days > e.oldest) e.oldest = r.days;
  }
  const rows = [...byEmp.values()].sort((a, b) => b.hot - a.hot || b.total - a.total);
  return { rows, hotById, activeTotal };
}
