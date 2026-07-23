import "server-only";

import type { LeadStage } from "@prisma/client";
import { FollowUpType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { scopeForUser, getOwnerIds } from "@/lib/data/leads";
import { ksaTodayStart } from "@/lib/auto-distribute";
import { duplicateLeadIds } from "@/lib/phone-dupe";

const VISIT_TYPES = [FollowUpType.VISIT_PROJECT, FollowUpType.VISIT_OFFICE];
// المتوقّع من اللمسات (متابعات) لكل عميل عند حساب نسبة النشاط.
const TOUCH_TARGET = 2;

export type Period = "24h" | "48h" | "72h" | "week" | "all";

export const periodLabels: Record<Period, string> = {
  "24h": "آخر ٢٤ ساعة",
  "48h": "آخر ٤٨ ساعة",
  "72h": "آخر ٧٢ ساعة",
  week: "آخر أسبوع",
  all: "الكل",
};

export function normalizePeriod(p: string | undefined): Period {
  return p && p in periodLabels ? (p as Period) : "all";
}

function sinceFor(period: Period): Date | null {
  const hours: Record<Period, number | null> = {
    "24h": 24,
    "48h": 48,
    "72h": 72,
    week: 168,
    all: null,
  };
  const h = hours[period];
  return h ? new Date(Date.now() - h * 3_600_000) : null;
}

export type MiniLead = {
  id: string;
  name: string;
  phone: string;
  stage: LeadStage;
  budget: number | null;
  createdAt: Date;
  nextFollowup: Date | null;
  assignedToName: string | null;
};

export type TeamRow = {
  id: string;
  name: string;
  total: number;
  attempts: number;
  visits: number;
  bookings: number;
  closed: number;
  target: number;
  activityRate: number; // نسبة النشاط (لمسات نحو الهدف)
  progress: number | null; // % نحو الهدف
};

export type RecentSale = {
  id: string;
  leadName: string;
  phone: string | null;
  projectName: string | null;
  unitNumber: string;
  sellerName: string | null;
  finalPrice: number;
};

/** موعد اليوم لشريط الموظف: متابعة (من nextFollowup) أو زيارة (متابعة نوع زيارة بموعد اليوم). */
export type TodayAppointment = { leadId: string; name: string; at: Date; kind: "followup" | "visit" };

/** صف «متابعات اليوم للفريق» (للمالك/المدير): مواعيد اليوم لكل موظف وحالتها. */
export type TeamFollowupsRow = { id: string; name: string; total: number; done: number; remaining: number; missed: number };

export type DashboardData = {
  manager: boolean;
  kpis: {
    totalClients: number;
    newInPeriod: number;
    unassigned: number;
    bookings: number;
    visits: number;
    closedWon: number;
    conversion: number;
  };
  followupsToday: MiniLead[];
  waitingFirstContact: MiniLead[];
  waitingCount: number; // إجمالي «لم يتم التواصل» (NEW + مُسند)
  recentSales: RecentSale[];
  funnel: { stage: LeadStage; count: number }[];
  sentiment: InterestSentiment;
  team: TeamRow[];
  /** مواعيد اليوم للموظف (الشريط المتحرك) — فارغة دائمًا للمدير. */
  todayAppointments: TodayAppointment[];
  /** «متابعات اليوم للفريق» — فارغة دائمًا للموظف. */
  teamFollowupsToday: TeamFollowupsRow[];
};

// «مشاعر الاهتمام» — كتلة محسوبة منفصلة عن القمع (لا تلمس FUNNEL/funnelStages).
export type InterestSentiment = {
  interested: {
    total: number;      // مجموع الأربعة أدناه
    interested: number;  // INTERESTED
    viewed: number;      // VIEWING (زار)
    negotiating: number; // NEGOTIATION (تفاوض)
    followUpLater: number; // FOLLOW_UP_LATER المهتم فقط (section آخر متابعة = INTERESTED)
  };
  notInterested: {
    total: number;      // CLOSED_LOST + الانسحاب الناعم
    closedLost: number;  // CLOSED_LOST
    softDecline: number; // FOLLOW_UP_LATER بـ section=NOT_INTERESTED
    // تفصيل الأسباب من آخر متابعة منظّمة (بعد ٥-ب)؛ القديمة/الناعمة = غير محدّد.
    reasons: { location: number; price: number; space: number; visited: number; bank: number; marketer: number; other: number; final: number; unspecified: number };
  };
};

/**
 * تجميع «مشاعر الاهتمام» ضمن نفس نطاق المستخدم/الفترة.
 * الفصل الدقيق لـ«موعد لاحق»: يعتمد على section آخر متابعة لكل عميل — يُجلب باستعلام
 * واحد (leadId IN …) ويُختزل بالذاكرة (بلا N+1). محصور بعملاء FOLLOW_UP_LATER/CLOSED_LOST فقط.
 */
async function computeInterestSentiment(scope: Prisma.LeadWhereInput): Promise<InterestSentiment> {
  const [stageGrp, splitLeads] = await Promise.all([
    prisma.lead.groupBy({ by: ["stage"], where: scope, _count: { _all: true } }),
    prisma.lead.findMany({
      where: { ...scope, stage: { in: ["FOLLOW_UP_LATER", "CLOSED_LOST"] } },
      select: { id: true, stage: true },
    }),
  ]);
  const cnt = (s: LeadStage) => stageGrp.find((g) => g.stage === s)?._count._all ?? 0;

  // آخر متابعة لكل عميل في (موعد لاحق/مقفول-خسارة): استعلام واحد ثم أول ظهور = الأحدث (desc).
  const ids = splitLeads.map((l) => l.id);
  const fus = ids.length
    ? await prisma.followUp.findMany({
        where: { leadId: { in: ids } },
        orderBy: { createdAt: "desc" },
        select: { leadId: true, section: true, result: true },
      })
    : [];
  const latest = new Map<string, { section: string | null; result: string }>();
  for (const f of fus) if (!latest.has(f.leadId)) latest.set(f.leadId, { section: f.section, result: f.result });

  // موعد لاحق: انسحاب ناعم = آخر متابعة section=NOT_INTERESTED؛ الباقي مهتم (افتراض آمن للغامض).
  const fulLeads = splitLeads.filter((l) => l.stage === "FOLLOW_UP_LATER");
  const fulSoft = fulLeads.filter((l) => latest.get(l.id)?.section === "NOT_INTERESTED");
  const fulInterested = fulLeads.length - fulSoft.length;

  const interested = cnt("INTERESTED");
  const viewed = cnt("VIEWING");
  const negotiating = cnt("NEGOTIATION");

  // أسباب «غير مهتم»: تُعدّ من آخر نتيجة منظّمة عبر عملاء CLOSED_LOST + الانسحاب الناعم.
  // مجموع الأسباب = notInterested.total (اتساق). القديم/الناعم بلا سبب منظّم = unspecified.
  const lostLeads = splitLeads.filter((l) => l.stage === "CLOSED_LOST");
  const reasons = { location: 0, price: 0, space: 0, visited: 0, bank: 0, marketer: 0, other: 0, final: 0, unspecified: 0 };
  const tally = (leadId: string) => {
    switch (latest.get(leadId)?.result) {
      case "NOT_INTERESTED_LOCATION": reasons.location++; break;
      case "NOT_INTERESTED_PRICE": reasons.price++; break;
      case "NOT_INTERESTED_SPACE": reasons.space++; break;
      case "NOT_INTERESTED_VISITED": reasons.visited++; break;
      case "NOT_INTERESTED_BANK": reasons.bank++; break;
      case "NOT_INTERESTED_MARKETER": reasons.marketer++; break;
      case "NOT_INTERESTED_OTHER": reasons.other++; break;
      case "NOT_INTERESTED_FINAL": reasons.final++; break;
      default: reasons.unspecified++;
    }
  };
  for (const l of lostLeads) tally(l.id);
  for (const l of fulSoft) tally(l.id);

  return {
    interested: {
      total: interested + viewed + negotiating + fulInterested,
      interested, viewed, negotiating, followUpLater: fulInterested,
    },
    notInterested: {
      total: lostLeads.length + fulSoft.length,
      closedLost: lostLeads.length,
      softDecline: fulSoft.length,
      reasons,
    },
  };
}

const CLOSED: LeadStage[] = ["CLOSED_WON", "CLOSED_LOST"];

/**
 * عدّادات «الحالة الحية» (الإجمالي/القمع): المؤرشف مستثنى — إلا المحجوز/المباع،
 * فهو مؤرشف بحكم الحجز (ينتقل لتبويب «تم الحجز/الشراء») وعموداه في القمع تاريخيان.
 * بدون هذا كان المؤرشفون (١٦٧ «غير مهتم نهائيًا» مثلًا) يظلون محسوبين في القمع والبطاقات.
 */
const LIVE_OR_BOOKED: Prisma.LeadWhereInput = {
  OR: [{ isArchived: false }, { stage: { in: ["RESERVED", "CLOSED_WON"] } }],
};

export async function getDashboard(period: Period): Promise<DashboardData> {
  const { user, where, manager } = await scopeForUser();
  const ownerIds = await getOwnerIds();
  const since = sinceFor(period);
  const inPeriod = since ? { gte: since } : undefined;
  // «لم يتم التواصل»: جديد + مُسند لموظف فعلي (المُسند لمالك = غير موزّع).
  // نستخدم AND بدل مفتاح assignedToId مباشر حتى لا يُلغى نطاق الموظف القادم من `where`
  // (لو كتبناه مباشرة يتجاوز {assignedToId: user.id} فيتسرّب للموظف عملاء زملائه).
  // م-٢: isArchived:false — يطابق شارة صفحة العملاء (getNotContactedCount) حرفيًا.
  const waitingWhere = {
    ...where,
    stage: "NEW" as const,
    isArchived: false,
    AND: [
      { assignedToId: { not: null } },
      ...(ownerIds.length ? [{ assignedToId: { notIn: ownerIds } }] : []),
    ],
  };

  const bookingScope = manager ? {} : { sellerId: user.id };
  // الزيارات تُحسب من جدول FollowUp (نوع زيارة) — للموظف: ما أنشأه هو.
  const fuVisitScope = manager ? {} : { createdBy: user.id };

  // فلتر الفترة على createdAt — يُطبَّق على كل المؤشرات (فاضي = الكل).
  const periodFilter = inPeriod ? { createdAt: inPeriod } : {};

  // «غير موزّعين» يستثني المكررين المعلّقين (جوالهم مكرر) — يظهرون في قائمة المكررين لا هنا.
  // م-٣: التعريف الموحّد (يطابق محرك التوزيع وأزرار التوزيع اليدوي):
  // بلا موظف + مرحلة «جديد» + غير مؤرشف + ليس مكررًا معلّقًا.
  const dupIds = manager ? await duplicateLeadIds() : new Set<string>();
  const unassignedWhere = {
    assignedToId: null,
    stage: "NEW" as const,
    isArchived: false,
    ...periodFilter,
    ...(dupIds.size ? { id: { notIn: [...dupIds] } } : {}),
  };

  const [
    totalClients,
    unassigned,
    bookings,
    visits,
    closedWon,
  ] = await Promise.all([
    prisma.lead.count({ where: { ...where, ...periodFilter, ...LIVE_OR_BOOKED } }),
    manager ? prisma.lead.count({ where: unassignedWhere }) : Promise.resolve(0),
    prisma.booking.count({ where: { ...bookingScope, ...periodFilter } }),
    prisma.followUp.count({ where: { type: { in: VISIT_TYPES }, ...fuVisitScope, ...periodFilter } }),
    // م-٣: «صفقات مقفولة» تُفلتر بوقت الإقفال (updatedAt كوكيل — نفس عرف دورة البيع
    // في التحليلات) لا بتاريخ إنشاء العميل — صفقة اليوم لعميل عمره شهر تظهر في «٢٤ ساعة».
    prisma.lead.count({ where: { ...where, stage: "CLOSED_WON", ...(inPeriod ? { updatedAt: inPeriod } : {}) } }),
  ]);

  // م-٣: الصيغة الموحّدة الوحيدة لمعدل التحويل في النظام = الحجوزات ÷ الزيارات.
  const conversion = visits > 0 ? Math.round((bookings / visits) * 100) : 0;
  const newInPeriod = totalClients;

  // آخر الصفقات المقفولة (تم البيع)
  const salesRaw = await prisma.booking.findMany({
    where: { ...bookingScope, stage: "SOLD" },
    orderBy: { updatedAt: "desc" },
    take: 4,
    include: {
      lead: { select: { name: true } },
      unit: { select: { number: true, project: { select: { name: true } } } },
      seller: { select: { name: true } },
    },
  });
  const recentSales = salesRaw.map((b) => ({
    id: b.id,
    leadName: b.lead.name,
    phone: b.phone,
    projectName: b.unit.project?.name ?? null,
    unitNumber: b.unit.number,
    sellerName: b.seller?.name ?? null,
    finalPrice: b.finalPrice.toNumber(),
  }));

  // متابعات اليوم = المتأخرة + بقية اليوم (حتى نهاية يوم السعودية) — #44.
  const ksaDayEnd = new Date(ksaTodayStart(new Date()).getTime() + 86_400_000);
  const followupsRaw = await prisma.lead.findMany({
    where: { ...where, stage: { notIn: CLOSED }, nextFollowup: { lt: ksaDayEnd } },
    orderBy: [{ priority: "asc" }, { nextFollowup: "asc" }],
    take: 8,
    include: { assignedTo: { select: { name: true, role: true } } },
  });

  // ليدات تنتظر أول تواصل (NEW + مُسند) + العدد الكلي
  const [waitingRaw, waitingCount] = await Promise.all([
    prisma.lead.findMany({
      where: waitingWhere,
      orderBy: { createdAt: "asc" },
      take: 8,
      include: { assignedTo: { select: { name: true, role: true } } },
    }),
    prisma.lead.count({ where: waitingWhere }),
  ]);

  const toMini = (l: (typeof followupsRaw)[number]): MiniLead => ({
    id: l.id,
    name: l.name,
    phone: l.phone,
    stage: l.stage,
    budget: l.budget ? l.budget.toNumber() : null,
    createdAt: l.createdAt,
    nextFollowup: l.nextFollowup,
    assignedToName: l.assignedTo && l.assignedTo.role !== "OWNER" ? l.assignedTo.name : null,
  });

  // قمع المبيعات — م-٣: كل المراحل التسع (مجموع الأشرطة = إجمالي العملاء)
  // ويتبع فلتر الفترة مثل بقية مؤشرات الشاشة (كان all-time بجانب KPIs مفلترة).
  const grouped = await prisma.lead.groupBy({
    by: ["stage"],
    where: { ...where, ...periodFilter, ...LIVE_OR_BOOKED },
    _count: { _all: true },
  });
  const countByStage = new Map(grouped.map((g) => [g.stage, g._count._all]));
  const funnelStages: LeadStage[] = [
    "NEW",
    "ATTEMPTED",
    "INTERESTED",
    "FOLLOW_UP_LATER",
    "VIEWING",
    "NEGOTIATION",
    "RESERVED",
    "CLOSED_WON",
    "CLOSED_LOST",
  ];
  const funnel = funnelStages.map((stage) => ({
    stage,
    count: countByStage.get(stage) ?? 0,
  }));

  // مشاعر الاهتمام — نفس نطاق المستخدم + فلتر الفترة، والمؤرشف مستثنى (مراحلها كلها غير محجوزة،
  // فيكفي isArchived:false): بطاقتا «مهتمين/غير مهتمين» وتفصيل الأسباب = الحالة الحية فقط.
  const sentiment = await computeInterestSentiment({ ...where, ...periodFilter, isArchived: false });

  // أداء الموظفين (للمدير فقط) — م-٣: يتبع فلتر الفترة مثل بقية الشاشة (كان all-time).
  let team: TeamRow[] = [];
  if (manager) {
    const [emps, byTotal, byClosed, byFollowUps, byVisits, byBookings] =
      await Promise.all([
        prisma.user.findMany({
          where: { role: "EMPLOYEE", active: true },
          select: { id: true, name: true, targetDeals: true },
          orderBy: { name: "asc" },
        }),
        prisma.lead.groupBy({ by: ["assignedToId"], where: { ...periodFilter }, _count: { _all: true } }),
        prisma.lead.groupBy({ by: ["assignedToId"], where: { stage: "CLOSED_WON", ...(inPeriod ? { updatedAt: inPeriod } : {}) }, _count: { _all: true } }),
        prisma.followUp.groupBy({ by: ["createdBy"], where: { ...periodFilter }, _count: { _all: true } }),
        prisma.followUp.groupBy({ by: ["createdBy"], where: { type: { in: VISIT_TYPES }, ...periodFilter }, _count: { _all: true } }),
        prisma.booking.groupBy({ by: ["sellerId"], where: { ...periodFilter }, _count: { _all: true } }),
      ]);

    const leadMap = (arr: { assignedToId: string | null; _count: { _all: number } }[]) =>
      new Map(arr.map((r) => [r.assignedToId, r._count._all]));
    const fuMap = (arr: { createdBy: string; _count: { _all: number } }[]) =>
      new Map(arr.map((r) => [r.createdBy, r._count._all]));

    const totalMap = leadMap(byTotal);
    const closedMap = leadMap(byClosed);
    const followUpsMap = fuMap(byFollowUps);
    const visitsMap = fuMap(byVisits);
    const bookingsMap = new Map(byBookings.map((r) => [r.sellerId, r._count._all]));

    team = emps.map((e) => {
      const total = totalMap.get(e.id) ?? 0;
      const totalFu = followUpsMap.get(e.id) ?? 0;
      const visits = visitsMap.get(e.id) ?? 0;
      const attempts = Math.max(0, totalFu - visits); // المحاولات = متابعات غير الزيارات
      const closed = closedMap.get(e.id) ?? 0;
      return {
        id: e.id,
        name: e.name,
        total,
        attempts,
        visits,
        bookings: bookingsMap.get(e.id) ?? 0,
        closed,
        target: e.targetDeals,
        // نسبة النشاط = (محاولات + زيارات) ÷ (عدد العملاء × الهدف لكل عميل).
        activityRate: total > 0 ? Math.min(100, Math.round((totalFu / (total * TOUCH_TARGET)) * 100)) : 0,
        progress: e.targetDeals > 0 ? Math.round((closed / e.targetDeals) * 100) : null,
      };
    });
  }

  // ===== مواعيد اليوم (بتوقيت الرياض) — الشريط للموظف · جدول الفريق للمدير =====
  const dayStart = ksaTodayStart(new Date());
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);

  let todayAppointments: TodayAppointment[] = [];
  if (!manager) {
    const [fuLeads, visitFus] = await Promise.all([
      prisma.lead.findMany({
        where: { assignedToId: user.id, isArchived: false, stage: { notIn: CLOSED }, nextFollowup: { gte: dayStart, lt: dayEnd } },
        select: { id: true, name: true, nextFollowup: true },
      }),
      prisma.followUp.findMany({
        where: { type: { in: VISIT_TYPES }, nextDate: { gte: dayStart, lt: dayEnd }, lead: { assignedToId: user.id, isArchived: false } },
        select: { leadId: true, nextDate: true, lead: { select: { name: true } } },
      }),
    ]);
    todayAppointments = [
      ...fuLeads.map((l) => ({ leadId: l.id, name: l.name, at: l.nextFollowup as Date, kind: "followup" as const })),
      ...visitFus.map((f) => ({ leadId: f.leadId, name: f.lead.name, at: f.nextDate as Date, kind: "visit" as const })),
    ].sort((a, b) => a.at.getTime() - b.at.getTime());
  }

  let teamFollowupsToday: TeamFollowupsRow[] = [];
  if (manager) {
    // استعلامان مجمّعان فقط: مواعيد اليوم + متابعات اليوم على عملائها — الحساب بالذاكرة (لا N+1).
    const apptLeads = await prisma.lead.findMany({
      where: {
        nextFollowup: { gte: dayStart, lt: dayEnd }, isArchived: false, stage: { notIn: CLOSED },
        assignedTo: { role: "EMPLOYEE", active: true },
      },
      select: { id: true, assignedToId: true, nextFollowup: true, assignedTo: { select: { name: true } } },
    });
    const fusToday = apptLeads.length
      ? await prisma.followUp.findMany({
          where: { leadId: { in: apptLeads.map((l) => l.id) }, createdAt: { gte: dayStart, lt: dayEnd } },
          select: { leadId: true, createdAt: true },
        })
      : [];
    const nowMs = Date.now();
    const byEmp = new Map<string, TeamFollowupsRow>();
    for (const l of apptLeads) {
      const id = l.assignedToId as string;
      const row = byEmp.get(id) ?? { id, name: l.assignedTo?.name ?? "—", total: 0, done: 0, remaining: 0, missed: 0 };
      row.total++;
      const at = (l.nextFollowup as Date).getTime();
      // «تمّت» = سُجّلت متابعة جديدة على العميل بعد وقت الموعد · «فائتة» = مضى وقتها بلا متابعة.
      const done = fusToday.some((f) => f.leadId === l.id && f.createdAt.getTime() >= at);
      if (done) row.done++;
      else if (at <= nowMs) row.missed++;
      else row.remaining++;
      byEmp.set(id, row);
    }
    teamFollowupsToday = [...byEmp.values()].sort((a, b) => b.missed - a.missed || b.total - a.total);
  }

  return {
    manager,
    kpis: { totalClients, newInPeriod, unassigned, bookings, visits, closedWon, conversion },
    followupsToday: followupsRaw.map(toMini),
    waitingFirstContact: waitingRaw.map(toMini),
    waitingCount,
    recentSales,
    funnel,
    sentiment,
    team,
    todayAppointments,
    teamFollowupsToday,
  };
}
