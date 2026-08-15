import "server-only";

import { Channel, FollowUpType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser, isManager } from "@/lib/auth-guards";
import { duplicateLeadIds } from "@/lib/phone-dupe";
import { dayStartKSA, weekStartKSA, KSA_OFFSET_MS, DAY_MS, parseRiyadhLocal } from "@/lib/ksa-time";
import { formatTime, formatDate, lastSeenAgo, ONLINE_THRESHOLD_MS } from "@/lib/format";
import { getAuditLog, inferFollowupLeads, resolveAuditNames } from "@/lib/data/audit";
import { channelLabel } from "@/lib/labels";
import { ksaDayKey } from "@/lib/ksa-time";

/**
 * طبقة بيانات «لوحة المالك» (المرجع owner-final-structure.html).
 *
 * الدلالات منسوخة حرفيًا من getDashboard (lib/data/dashboard.ts) — نفس شروط
 * كل رقم — لكن بفترة نطاقية {gte, lt} بدل Period أحادي الحد، ومع فترة سابقة
 * مكافئة لحساب الدلتا. ملف مستقل عمدًا: صفر لمس للوحات القائمة (رجوع أي
 * مرحلة بكوميتها وحدها).
 */

// نفس ثوابت dashboard.ts حرفيًا (غير مُصدَّرة هناك — لا نعدّل ملفًا حيًّا لأجل export).
const VISIT_TYPES = [FollowUpType.VISIT_PROJECT, FollowUpType.VISIT_OFFICE];
const LIVE_OR_BOOKED: Prisma.LeadWhereInput = {
  OR: [{ isArchived: false }, { stage: { in: ["RESERVED", "CLOSED_WON"] } }],
};

export type OwnerPeriod = "all" | "today" | "yesterday" | "week" | "month" | "custom";

export const ownerPeriodLabels: Record<OwnerPeriod, string> = {
  all: "الكل",
  today: "اليوم",
  yesterday: "أمس",
  week: "أسبوع",
  month: "شهر",
  custom: "من ← إلى",
};

/** fallback لكل فلتر افتراضيه: الأرقام «الكل» والبقية «اليوم». */
export function normalizeOwnerPeriod(p: string | undefined, fallback: OwnerPeriod = "today"): OwnerPeriod {
  return p && p in ownerPeriodLabels ? (p as OwnerPeriod) : fallback;
}

/** بداية الشهر (١ الشهر ٠٠:٠٠ بتوقيت الرياض) — على نمط weekStartKSA. */
function monthStartKSA(ref: Date = new Date()): Date {
  const k = new Date(ref.getTime() + KSA_OFFSET_MS);
  return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), 1) - KSA_OFFSET_MS);
}

export type OwnerRange = {
  period: OwnerPeriod;
  /** الفترة الحالية [gte, lt). */
  gte: Date;
  lt: Date;
  /** الفترة السابقة المكافئة للدلتا [prevGte, prevLt). */
  prevGte: Date;
  prevLt: Date;
  /** مفتاحا النطاق المخصص كما وصلا (لتثبيت الفلتر بالواجهة). */
  fromKey: string | null;
  toKey: string | null;
};

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * حلّ الفترة والفترة السابقة المكافئة.
 *
 * قاعدة الدلتا: مقارنة **مدد متساوية** — الفترات الجارية (اليوم/أسبوع/شهر) تُقارن
 * بالجزء المنقضي نفسه من الفترة السابقة (لا يوم كامل مقابل نصف يوم فتنحاز الدلتا
 * سالبًا صباحًا). «أمس» والنطاق المخصص فترات مكتملة فتُقارن بمثلها قبلها مباشرة.
 */
export function resolveOwnerRange(p: OwnerPeriod, fromKey?: string, toKey?: string): OwnerRange {
  const now = new Date();
  const today = dayStartKSA(now);

  // «الكل» = بلا حصر فترة (من فجر البيانات) — ولا فترة سابقة تُقارن فالدلتا تُخفى.
  if (p === "all") {
    const epoch = new Date(0);
    return { period: p, gte: epoch, lt: now, prevGte: epoch, prevLt: epoch, fromKey: null, toKey: null };
  }

  if (p === "custom" && fromKey && toKey && DAY_KEY.test(fromKey) && DAY_KEY.test(toKey) && fromKey <= toKey) {
    const gte = parseRiyadhLocal(fromKey);
    const lt = new Date(parseRiyadhLocal(toKey).getTime() + DAY_MS);
    const span = lt.getTime() - gte.getTime();
    return { period: p, gte, lt, prevGte: new Date(gte.getTime() - span), prevLt: gte, fromKey, toKey };
  }

  if (p === "yesterday") {
    const gte = new Date(today.getTime() - DAY_MS);
    return { period: p, gte, lt: today, prevGte: new Date(gte.getTime() - DAY_MS), prevLt: gte, fromKey: null, toKey: null };
  }

  const start = p === "week" ? weekStartKSA(now) : p === "month" ? monthStartKSA(now) : today;
  const elapsed = now.getTime() - start.getTime();
  const prevStart =
    p === "week"
      ? new Date(start.getTime() - 7 * DAY_MS)
      : p === "month"
        ? monthStartKSA(new Date(start.getTime() - DAY_MS))
        : new Date(start.getTime() - DAY_MS);
  // الشهر السابق قد يكون أقصر من المنقضي — الحد الأعلى لا يتجاوز نهايته.
  const prevLt = new Date(Math.min(prevStart.getTime() + elapsed, start.getTime()));
  return { period: p === "custom" ? "today" : p, gte: start, lt: now, prevGte: prevStart, prevLt, fromKey: null, toKey: null };
}

export type OwnerKpiCard = { value: number; delta: number | null };

export type OwnerKpis = {
  range: OwnerRange;
  unassigned: OwnerKpiCard;
  totalClients: OwnerKpiCard;
  /** نسبة مئوية، ودلتاها بنقاط مئوية. */
  conversion: OwnerKpiCard;
  closedWon: OwnerKpiCard;
  visits: OwnerKpiCard;
  bookings: OwnerKpiCard;
};

/** عدّادات نافذة واحدة — نفس شروط getDashboard حرفيًا (منظور المدير: بلا نطاق موظف). */
async function windowCounts(gte: Date, lt: Date, dupIds: Set<string>) {
  const createdIn = { createdAt: { gte, lt } };
  const [total, unassigned, bookings, visits, closedWon] = await Promise.all([
    prisma.lead.count({ where: { ...createdIn, ...LIVE_OR_BOOKED } }),
    // «غير موزّعين» الموحّد: بلا موظف + «جديد» + غير مؤرشف + ليس مكررًا معلّقًا.
    prisma.lead.count({
      where: {
        assignedToId: null,
        stage: "NEW",
        isArchived: false,
        ...createdIn,
        ...(dupIds.size ? { id: { notIn: [...dupIds] } } : {}),
      },
    }),
    prisma.booking.count({ where: createdIn }),
    prisma.followUp.count({ where: { type: { in: VISIT_TYPES }, ...createdIn } }),
    // «صفقات مقفولة» بوقت الإقفال (updatedAt كوكيل) — نفس عرف dashboard.ts.
    prisma.lead.count({ where: { stage: "CLOSED_WON", updatedAt: { gte, lt } } }),
  ]);
  const conversion = visits > 0 ? Math.round((bookings / visits) * 100) : 0;
  return { total, unassigned, bookings, visits, closedWon, conversion };
}

/* ===================== متابعات الفترة — القائمة الصفّية للمالك ===================== */

export type OwnerFuStatus = "late" | "soon" | "next" | "done";

export type OwnerFollowupRow = {
  leadId: string;
  name: string;
  phone: string;
  /** لحظة الموعد (ISO — العميل يعرضها بالرياض عبر النصوص الجاهزة). */
  atIso: string;
  timeText: string;
  /** يظهر تاريخ اليوم فقط حين الفترة أوسع من يوم واحد. */
  dayText: string | null;
  kind: "followup" | "visit";
  note: string | null;
  employeeName: string | null;
  status: OwnerFuStatus;
  /** «تمّت» — وقت المتابعة المنجزة. */
  doneTimeText: string | null;
  /** «متأخّر» — الدقائق منذ الموعد. */
  lateMinutes: number | null;
};

/**
 * قائمة مواعيد الفترة للمالك — الحالة محسوبة على الخادم (لا حساب موزّعًا بالعميل):
 * - تمّت: آخر متابعة على العميل وقعت بعد وقت الموعد (نفس منطق teamFollowupsToday —
 *   الأحدث كافٍ لأنه الأقصى زمنيًا).
 * - متأخّر: فات وقته بلا متابعة بعده.
 * - قرب موعده: خلال ساعة من الآن.
 * - قادمة: أبعد من ساعة.
 * الموعد من `Lead.nextFollowup` (المصدر الحي المعتمد) + زيارة مؤكدة من `Lead.visitAt`.
 */
export async function getOwnerFollowups(p: OwnerPeriod, fromKey?: string, toKey?: string) {
  const user = await requireUser();
  if (!isManager(user.role)) throw new Error("لوحة المالك للمالك/المدير فقط");

  const range = resolveOwnerRange(p, fromKey, toKey);
  const { gte, lt } = range;
  const now = new Date();
  const multiDay = lt.getTime() - gte.getTime() > DAY_MS;

  const leads = await prisma.lead.findMany({
    where: {
      isArchived: false,
      stage: { notIn: ["CLOSED_WON", "CLOSED_LOST"] },
      OR: [{ nextFollowup: { gte, lt } }, { visitAt: { gte, lt } }],
    },
    select: {
      id: true,
      name: true,
      phone: true,
      nextFollowup: true,
      visitAt: true,
      assignedTo: { select: { name: true, role: true } },
      // الأحدث أولًا: [0] يحسم الإنجاز، وأول ملاحظة غير فارغة تُعرض تحت الاسم.
      followUps: { orderBy: { createdAt: "desc" }, take: 5, select: { note: true, createdAt: true } },
    },
  });

  const rows: OwnerFollowupRow[] = [];
  for (const l of leads) {
    const latest = l.followUps[0] ?? null;
    const note = l.followUps.find((f) => f.note && f.note.trim())?.note?.trim() ?? null;
    // المالك لا يظهر كموظف مُسند (نفس قاعدة toMini في dashboard.ts).
    const employeeName = l.assignedTo && l.assignedTo.role !== "OWNER" ? l.assignedTo.name : null;

    const appts: { at: Date; kind: "followup" | "visit" }[] = [];
    if (l.nextFollowup && l.nextFollowup >= gte && l.nextFollowup < lt) appts.push({ at: l.nextFollowup, kind: "followup" });
    // زيارة بنفس لحظة المتابعة = موعد واحد لا اثنان.
    if (l.visitAt && l.visitAt >= gte && l.visitAt < lt && l.visitAt.getTime() !== l.nextFollowup?.getTime())
      appts.push({ at: l.visitAt, kind: "visit" });

    for (const a of appts) {
      const done = latest !== null && latest.createdAt >= a.at;
      const late = !done && a.at <= now;
      const soon = !done && !late && a.at.getTime() - now.getTime() <= 3_600_000;
      rows.push({
        leadId: l.id,
        name: l.name,
        phone: l.phone,
        atIso: a.at.toISOString(),
        timeText: formatTime(a.at),
        dayText: multiDay ? formatDate(a.at) : null,
        kind: a.kind,
        note,
        employeeName,
        status: done ? "done" : late ? "late" : soon ? "soon" : "next",
        doneTimeText: done && latest ? formatTime(latest.createdAt) : null,
        lateMinutes: late ? Math.max(1, Math.floor((now.getTime() - a.at.getTime()) / 60_000)) : null,
      });
    }
  }

  rows.sort((a, b) => a.atIso.localeCompare(b.atIso));
  return { range, rows };
}

/* ===================== التحليلات ===================== */

export type OwnerChannelRow = { channel: Channel; label: string; count: number };

/** أداء المنصّات — عملاء الفترة مجمّعين بالقناة (نفس groupBy التحليلات لكن بفترة). */
export async function getOwnerChannels(p: OwnerPeriod, fromKey?: string, toKey?: string) {
  const user = await requireUser();
  if (!isManager(user.role)) throw new Error("لوحة المالك للمالك/المدير فقط");

  const range = resolveOwnerRange(p, fromKey, toKey);
  const grouped = await prisma.lead.groupBy({
    by: ["channel"],
    where: { createdAt: { gte: range.gte, lt: range.lt } },
    _count: { _all: true },
  });
  const rows: OwnerChannelRow[] = grouped
    .map((g) => ({ channel: g.channel, label: channelLabel(g.channel), count: g._count._all }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);
  return { range, rows };
}

export type OwnerTrendPoint = {
  dayKey: string;
  /** اسم اليوم بالعربي (أحد/إثنين…). */
  dayLabel: string;
  leads: number;
  bookings: number;
};

/** اتجاه الأسبوع — سلسلة يومية (٧ أيام رياض تنتهي اليوم): عملاء جدد + حجوزات. */
export async function getOwnerWeekTrend(): Promise<OwnerTrendPoint[]> {
  const user = await requireUser();
  if (!isManager(user.role)) throw new Error("لوحة المالك للمالك/المدير فقط");

  const today = dayStartKSA();
  const start = new Date(today.getTime() - 6 * DAY_MS);
  // لا date_trunc في Prisma groupBy — نجلب الطوابع فقط (نطاق أسبوع) ونجمّع بمفتاح يوم الرياض.
  const [leads, bookings] = await Promise.all([
    prisma.lead.findMany({ where: { createdAt: { gte: start } }, select: { createdAt: true } }),
    prisma.booking.findMany({ where: { createdAt: { gte: start } }, select: { createdAt: true } }),
  ]);

  const fmt = new Intl.DateTimeFormat("ar-SA", { calendar: "gregory", timeZone: "Asia/Riyadh", weekday: "short" });
  const points: OwnerTrendPoint[] = [];
  for (let t = start.getTime(); t <= today.getTime(); t += DAY_MS) {
    const d = new Date(t);
    points.push({ dayKey: ksaDayKey(d), dayLabel: fmt.format(d), leads: 0, bookings: 0 });
  }
  const byKey = new Map(points.map((pt) => [pt.dayKey, pt]));
  for (const l of leads) byKey.get(ksaDayKey(l.createdAt)) && byKey.get(ksaDayKey(l.createdAt))!.leads++;
  for (const b of bookings) byKey.get(ksaDayKey(b.createdAt)) && byKey.get(ksaDayKey(b.createdAt))!.bookings++;
  return points;
}

export type OwnerTeamFuRow = { id: string; name: string; total: number; done: number; remaining: number; missed: number };

/**
 * «متابعات كل موظف» بفترة — نفس دلالات teamFollowupsToday (dashboard.ts) حرفيًا:
 * الموعد من nextFollowup، «تمّت» = متابعة بعد وقت الموعد، «فائتة» = مضى بلا متابعة.
 * فرق وحيد معلن: للفترات الماضية تُحتسب متابعة لاحقة (بعد نهاية الفترة) إنجازًا —
 * وإلا ظهر «أمس» كله فائتًا حتى لو أُنجز صباح اليوم.
 */
export async function getOwnerTeamFollowups(p: OwnerPeriod, fromKey?: string, toKey?: string) {
  const user = await requireUser();
  if (!isManager(user.role)) throw new Error("لوحة المالك للمالك/المدير فقط");

  const range = resolveOwnerRange(p, fromKey, toKey);
  const { gte, lt } = range;
  const apptLeads = await prisma.lead.findMany({
    where: {
      nextFollowup: { gte, lt },
      isArchived: false,
      stage: { notIn: ["CLOSED_WON", "CLOSED_LOST"] },
      assignedTo: { role: "EMPLOYEE", active: true },
    },
    select: { id: true, assignedToId: true, nextFollowup: true, assignedTo: { select: { name: true } } },
  });
  const fus = apptLeads.length
    ? await prisma.followUp.findMany({
        where: { leadId: { in: apptLeads.map((l) => l.id) }, createdAt: { gte } },
        select: { leadId: true, createdAt: true },
      })
    : [];

  const nowMs = Date.now();
  const byEmp = new Map<string, OwnerTeamFuRow>();
  for (const l of apptLeads) {
    const id = l.assignedToId as string;
    const row = byEmp.get(id) ?? { id, name: l.assignedTo?.name ?? "—", total: 0, done: 0, remaining: 0, missed: 0 };
    row.total++;
    const at = (l.nextFollowup as Date).getTime();
    const done = fus.some((f) => f.leadId === l.id && f.createdAt.getTime() >= at);
    if (done) row.done++;
    else if (at <= nowMs) row.missed++;
    else row.remaining++;
    byEmp.set(id, row);
  }
  return { range, rows: [...byEmp.values()].sort((a, b) => b.missed - a.missed || b.total - a.total) };
}

/* ===================== معدّل النشاط (User.lastSeenAt) ===================== */

export type OwnerActivityState = "online" | "recent" | "idle";

export type OwnerActivityRow = {
  id: string;
  name: string;
  state: OwnerActivityState;
  /** «متصل الآن» / «منذ ١٢ دقيقة» … — من lastSeenAgo. */
  agoText: string;
  /** عرض شريط الحداثة (٪) — تمثيل بصري لقِدم آخر نبضة، لا مقياس مُخترع. */
  recencyPct: number;
};

/**
 * نشاط الموظفين داخل النظام — من نبضة `User.lastSeenAt` (heartbeat كل دقيقتين،
 * «متصل» = خلال ٥ دقائق: نفس عتبة getTeamPresence والتوزيع التلقائي).
 */
export async function getOwnerActivity(): Promise<OwnerActivityRow[]> {
  const user = await requireUser();
  if (!isManager(user.role)) throw new Error("لوحة المالك للمالك/المدير فقط");

  const users = await prisma.user.findMany({
    where: { role: { in: ["EMPLOYEE", "ADMIN"] }, active: true },
    select: { id: true, name: true, lastSeenAt: true },
  });
  const now = Date.now();
  const rows = users.map((u) => {
    const ms = u.lastSeenAt ? now - u.lastSeenAt.getTime() : Infinity;
    const state: OwnerActivityState = ms <= ONLINE_THRESHOLD_MS ? "online" : ms <= 3_600_000 ? "recent" : "idle";
    const recencyPct =
      ms <= ONLINE_THRESHOLD_MS ? 100 : ms <= 15 * 60_000 ? 70 : ms <= 3_600_000 ? 45 : ms <= 3 * 3_600_000 ? 25 : 8;
    return { id: u.id, name: u.name, state, agoText: lastSeenAgo(u.lastSeenAt), recencyPct };
  });
  // المتصل أولًا ثم الأحدث ظهورًا.
  const orderKey = (r: OwnerActivityRow) => (r.state === "online" ? 0 : r.state === "recent" ? 1 : 2);
  rows.sort((a, b) => orderKey(a) - orderKey(b) || a.name.localeCompare(b.name, "ar"));
  return rows;
}

/* ===================== سجل التدقيق الحي ===================== */

export type OwnerAuditKind =
  | "visit" | "nego" | "call" | "won" | "pull" | "newlead" | "booking" | "interested"
  | "followup" | "admin" | "crit" | "other";

export type OwnerAuditRow = {
  id: string;
  kind: OwnerAuditKind;
  badge: string;
  employeeName: string | null;
  clientName: string | null;
  clientPhone: string | null;
  /** معرّف مؤكد فقط (حُلّ لعميل قائم) — يبني سهم فتح الملف. */
  leadId: string | null;
  desc: string;
  whenText: string;
};

const CUID_ALL = /\bc[a-z0-9]{24}\b/g;

/**
 * تصنيف الشارة — امتداد قاموس v3 (‎/m owner-home) بأنواع المرجع الثمانية:
 * اتصال/تفاوض/بيع/مهتم تُستدل من نص summary العربي (AuditLog.action لا يميّزها —
 * نفس نمط «زيارة» المعتمد على الإنتاج)، والباقي من action مباشرة.
 */
function ownerAuditBadge(action: string, summary: string): { badge: string; kind: OwnerAuditKind } {
  if (action === "followup.added") {
    if (/زيار/.test(summary)) return { badge: "زيارة", kind: "visit" };
    if (/تفاوض/.test(summary)) return { badge: "تفاوض", kind: "nego" };
    if (/اتصل|اتصال|لم يرد|ما رد|واتساب/.test(summary)) return { badge: "اتصال", kind: "call" };
    return { badge: "متابعة", kind: "followup" };
  }
  if (action === "followup.edited") return { badge: "تعديل", kind: "followup" };
  if (action === "lead.stage" || action === "lead.firstStage") {
    if (/تفاوض/.test(summary)) return { badge: "تفاوض", kind: "nego" };
    if (/بيع|مقفول/.test(summary)) return { badge: "بيع", kind: "won" };
    if (/مهتم/.test(summary)) return { badge: "مهتم", kind: "interested" };
    if (/زيار/.test(summary)) return { badge: "زيارة", kind: "visit" };
    return { badge: "مرحلة", kind: "followup" };
  }
  if (action.startsWith("booking.")) {
    if (/دفعة/.test(summary)) return { badge: "دفعة", kind: "booking" };
    if (/بيع|بيعت|SOLD/.test(summary)) return { badge: "بيع", kind: "won" };
    return { badge: "حجز", kind: "booking" };
  }
  if (/Pull/i.test(action)) return { badge: "سحب", kind: "pull" };
  if (/warned/i.test(action)) return { badge: "إنذار", kind: "crit" };
  if (/distributed/i.test(action)) return { badge: "توزيع", kind: "admin" };
  if (action === "lead.reassigned" || action === "lead.transferred") return { badge: "نقل", kind: "admin" };
  if (action === "lead.created" || action === "lead.arrivedFromSheet") return { badge: "عميل جديد", kind: "newlead" };
  if (action === "lead.recovered") return { badge: "استرجاع", kind: "admin" };
  if (action.includes("archive")) return { badge: "أرشفة", kind: "admin" };
  if (action.startsWith("REVEAL") || action.startsWith("HIDE") || action.includes("security")) return { badge: "أمان", kind: "crit" };
  if (action.includes("delete")) return { badge: "حذف", kind: "crit" };
  return { badge: "إجراء", kind: "other" };
}

/** آخر عمليات السجل بأسماء وجوالات محلولة — نفس مسار v3 (استدلال + حلّ) + الجوال. */
export async function getOwnerAudit(limit = 30): Promise<OwnerAuditRow[]> {
  const user = await requireUser();
  if (!isManager(user.role)) throw new Error("لوحة المالك للمالك/المدير فقط");

  const entries = await getAuditLog({ limit });
  const inferred = await inferFollowupLeads(entries);
  const names = await resolveAuditNames(entries, Object.values(inferred));

  return entries.map((e) => {
    // المعرّف المؤكد فقط (نفس قاعدة v3): معرّف حُلّ فعلًا لعميل قائم — وإلا لا سهم.
    let leadId: string | null = null;
    for (const id of e.summary.match(CUID_ALL) ?? []) {
      if (names.leadNames[id]) { leadId = id; break; }
    }
    if (!leadId) {
      const inf = inferred[e.id];
      if (inf && names.leadNames[inf]) leadId = inf;
    }
    const { badge, kind } = ownerAuditBadge(e.action, e.summary);
    const desc = e.summary
      .replace(CUID_ALL, (id) => names.leadNames[id] ?? names.userNames[id] ?? "عنصر محذوف")
      .replace(/العميل\s*=\s*/g, "");
    return {
      id: e.id,
      kind,
      badge,
      employeeName: e.userName ?? (e.userId ? null : "النظام"),
      clientName: leadId ? names.leadNames[leadId] : null,
      clientPhone: leadId ? (names.leadPhones[leadId] ?? null) : null,
      leadId,
      desc,
      whenText: lastSeenAgo(e.createdAt),
    };
  });
}

export async function getOwnerKpis(p: OwnerPeriod, fromKey?: string, toKey?: string): Promise<OwnerKpis> {
  const user = await requireUser();
  if (!isManager(user.role)) throw new Error("لوحة المالك للمالك/المدير فقط");

  const range = resolveOwnerRange(p, fromKey, toKey);
  const dupIds = await duplicateLeadIds();
  const all = range.period === "all";
  const [cur, prev] = await Promise.all([
    windowCounts(range.gte, range.lt, dupIds),
    // «الكل» بلا فترة سابقة — لا استعلام ثانيًا ولا دلتا.
    all ? null : windowCounts(range.prevGte, range.prevLt, dupIds),
  ]);

  return {
    range,
    // «غير موزّعين» لحظة انتظار لا اتجاه — المرجع يعرض «ينتظرون» بلا دلتا.
    unassigned: { value: cur.unassigned, delta: null },
    totalClients: { value: cur.total, delta: prev ? cur.total - prev.total : null },
    conversion: { value: cur.conversion, delta: prev ? cur.conversion - prev.conversion : null },
    closedWon: { value: cur.closedWon, delta: prev ? cur.closedWon - prev.closedWon : null },
    visits: { value: cur.visits, delta: prev ? cur.visits - prev.visits : null },
    bookings: { value: cur.bookings, delta: prev ? cur.bookings - prev.bookings : null },
  };
}
