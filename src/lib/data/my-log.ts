import "server-only";

// صفحة «سجلّي» للموظف — نشاطه هو فقط + تقرير يومه.
//
// الأمن (الأهم): الهوية من الجلسة حصرًا — userId يمرَّر من requireUser() في الصفحة،
// وكل استعلام هنا مفلتر به على الخادم (createdBy/userId/sellerId/toUserId = هو).
// المصادر جداول المجال مباشرة (FollowUp · Activity · Booking · Reassignment) لا سجل
// التدقيق النصّي — فلا تتسرب سجلات تذكر موظفًا آخر ولا أسباب السحب منه ولا عمليات
// المالك (التوزيع الجماعي/الكشف/الأمان) بأي حال: الاستلام يُقرأ من Reassignment
// (toUserId=هو) ويُعرض بعبارة عامة «استلمت عميلًا جديدًا» بلا سبب ولا مصدر.
import { FollowUpResult, FollowUpType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeAchievement, type FuRow } from "@/lib/data/leaderboard";
import { followUpResultLabels } from "@/lib/labels";
import { DAY_MS, dayStartKSA, weekStartKSA } from "@/lib/ksa-time";

const HOUR_MS = 3_600_000;
const PAGE_SIZE = 40;

export type MyLogPeriod = "today" | "yesterday" | "week";

export type MyLogEvent = {
  at: Date;
  icon: string;
  text: string;
  leadId: string | null;
  leadName: string | null;
};

export type MyDayReport = {
  followups: number;      // متابعات مسجّلة (اتصال/واتساب/زيارة…)
  firstContacts: number;  // عملاء جدد تواصل معهم أول مرة
  dueCount: number;       // مواعيد استحقت في الفترة
  fulfilled: number;      // أنجزها في وقتها
  missed: number;         // فاتته
  visitsDone: number;     // زيارات تمّت
  bookings: number;       // حجوزات
  points: number;         // نقاط الفترة (دالة النقاط المعتمدة نفسها — سقف وأوزان اللوحة)
};

export type MyLogDay = { key: string; label: string; events: MyLogEvent[] };

export type MyDailyLog = {
  period: MyLogPeriod;
  report: MyDayReport;
  days: MyLogDay[];
  page: number;
  hasMore: boolean;
};

function rangeFor(period: MyLogPeriod, now: Date): { start: Date; end: Date } {
  const today = dayStartKSA(now);
  if (period === "yesterday") return { start: new Date(today.getTime() - DAY_MS), end: today };
  // «الأسبوع» = الأحد ٠٠:٠٠ الرياض حتى الآن — نفس نافذة لوحة الأسبوع ولوحة التحكم.
  if (period === "week") return { start: weekStartKSA(now), end: new Date(now.getTime() + 1) };
  return { start: today, end: new Date(now.getTime() + 1) };
}

/** عنوان اليوم: «اليوم الجمعة ٢٥ يوليو» / «أمس …» / «الجمعة ٢٥ يوليو». */
function dayLabel(d: Date, now: Date): string {
  const fmt = new Intl.DateTimeFormat("ar-SA-u-nu-arab", { timeZone: "Asia/Riyadh", weekday: "long", day: "numeric", month: "long" });
  const key = dayStartKSA(d).getTime();
  const today = dayStartKSA(now).getTime();
  const prefix = key === today ? "اليوم " : key === today - DAY_MS ? "أمس " : "";
  return prefix + fmt.format(d);
}

const VISIT_DONE: FollowUpResult[] = [FollowUpResult.INTERESTED_VISITED, FollowUpResult.NOT_INTERESTED_VISITED];

/** أيقونة المتابعة حسب نتيجتها/نوعها. */
function fuIcon(type: FollowUpType, result: FollowUpResult): string {
  if (result === FollowUpResult.INTERESTED_VISIT_SCHEDULED || result === FollowUpResult.VISIT_NO_SHOW_RESCHEDULED) return "🏠";
  if (VISIT_DONE.includes(result)) return "🏠";
  if (result === FollowUpResult.BOOKED) return "🤝";
  if (type === FollowUpType.WHATSAPP) return "💬";
  if (type === FollowUpType.VISIT_PROJECT || type === FollowUpType.VISIT_OFFICE) return "🏠";
  return "📞";
}

/**
 * سجل الموظف وتقرير فترته — كل شيء مفلتر بهويته من الجلسة (لا يقبل معرّفًا خارجيًا).
 */
export async function getMyDailyLog(userId: string, period: MyLogPeriod, page: number): Promise<MyDailyLog> {
  const now = new Date();
  const { start, end } = rangeFor(period, now);
  const range = { gte: start, lt: end };

  const [fus, stageActs, bookings, received, firstContacts, fulfillWindow] = await Promise.all([
    // متابعاته هو (createdBy = هويته من الجلسة).
    prisma.followUp.findMany({
      where: { createdBy: userId, createdAt: range },
      select: { leadId: true, type: true, result: true, nextDate: true, createdAt: true, stageAfter: true },
      orderBy: { createdAt: "desc" },
    }),
    // تغييرات المراحل التي أجراها هو.
    prisma.activity.findMany({
      where: { userId, type: "STAGE_CHANGE", createdAt: range },
      select: { leadId: true, note: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    // حجوزاته هو.
    prisma.booking.findMany({
      where: { sellerId: userId, createdAt: range },
      select: { leadId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    // استلام عملاء جدد (إليه) — بعبارة عامة، بلا أسباب ولا ذكر غيره.
    prisma.reassignment.findMany({
      where: { toUserId: userId, createdAt: range },
      select: { leadId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    // عملاء جدد تواصل معهم أول مرة (أول تواصل تسجّل في الفترة وهم عملاؤه).
    prisma.lead.count({ where: { assignedToId: userId, firstContactAt: range } }),
    // نافذة إنجاز المواعيد: متابعاته حول أوقات الاستحقاق (±ساعة → +٢٤ساعة).
    prisma.followUp.findMany({
      where: { createdBy: userId, createdAt: { gte: new Date(start.getTime() - HOUR_MS), lte: now } },
      select: { leadId: true, createdAt: true },
    }),
  ]);

  // ===== تقرير الفترة =====
  // المواعيد المستحقة: جدولها هو واستحقت داخل الفترة وقبل الآن.
  const dueList = fus.filter((f) => f.nextDate && f.nextDate >= start && f.nextDate < end && f.nextDate <= now);
  const byLead = new Map<string, number[]>();
  for (const f of fulfillWindow) {
    const arr = byLead.get(f.leadId);
    if (arr) arr.push(f.createdAt.getTime()); else byLead.set(f.leadId, [f.createdAt.getTime()]);
  }
  const fulfilled = dueList.filter((d) => {
    const due = (d.nextDate as Date).getTime();
    return (byLead.get(d.leadId) ?? []).some((c) => c >= due - HOUR_MS && c <= due + 24 * HOUR_MS);
  }).length;
  const dueCount = dueList.length;

  const fuRows: FuRow[] = fus.map((f) => ({ createdBy: userId, createdAt: f.createdAt, result: f.result, leadId: f.leadId, nextDate: f.nextDate, stageAfter: f.stageAfter }));
  const { achievement: points } = computeAchievement(fuRows, bookings.length);

  const report: MyDayReport = {
    followups: fus.length,
    firstContacts,
    dueCount,
    fulfilled,
    missed: Math.max(0, dueCount - fulfilled),
    visitsDone: fus.filter((f) => VISIT_DONE.includes(f.result)).length,
    bookings: bookings.length,
    points,
  };

  // ===== الخط الزمني =====
  const leadIds = new Set<string>();
  for (const x of [...fus, ...stageActs, ...bookings, ...received]) leadIds.add(x.leadId);
  const leads = leadIds.size
    ? await prisma.lead.findMany({ where: { id: { in: [...leadIds] } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(leads.map((l) => [l.id, l.name]));
  const nameOf = (id: string) => nameById.get(id) ?? "عميل";

  const events: MyLogEvent[] = [
    ...fus.map((f) => ({
      at: f.createdAt,
      icon: fuIcon(f.type, f.result),
      text: `سجّلت متابعة: ${followUpResultLabels[f.result] ?? f.result}`,
      leadId: f.leadId, leadName: nameOf(f.leadId),
    })),
    ...stageActs.map((a) => ({
      at: a.createdAt,
      icon: "🔀",
      text: a.note ?? "غيّرت مرحلة العميل",
      leadId: a.leadId, leadName: nameOf(a.leadId),
    })),
    ...bookings.map((b) => ({
      at: b.createdAt,
      icon: "🤝",
      text: "سجّلت حجزًا",
      leadId: b.leadId, leadName: nameOf(b.leadId),
    })),
    ...received.map((r) => ({
      at: r.createdAt,
      icon: "📥",
      text: "استلمت عميلًا جديدًا",
      leadId: r.leadId, leadName: nameOf(r.leadId),
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  const safePage = Math.max(1, page);
  const slice = events.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const hasMore = events.length > safePage * PAGE_SIZE;

  // تجميع بعناوين الأيام («اليوم الجمعة ٢٥ يوليو»).
  const days: MyLogDay[] = [];
  for (const e of slice) {
    const key = dayStartKSA(e.at).toISOString();
    const last = days[days.length - 1];
    if (last && last.key === key) last.events.push(e);
    else days.push({ key, label: dayLabel(e.at, now), events: [e] });
  }

  return { period, report, days, page: safePage, hasMore };
}

// ===================== آخر متابعاتي (رئيسية الموظف v2) =====================

export type MyRecentFollowUp = {
  id: string;
  result: FollowUpResult;
  createdAt: Date;
  leadId: string;
  leadName: string;
  /** توسعة v3 (شاشة المتابعات): الملاحظة وشارة الموعد القادم وزر التعديل. */
  note: string | null;
  nextDate: Date | null;
};

/**
 * آخر متابعات الموظف مطلقًا (رئيسية الموظف + تبويب «السجل» في شاشة المتابعات) —
 * قراءة خالصة، مفلترة بهوية الجلسة حصرًا كبقية الملف (createdBy من requireUser).
 * توسعة v3 المعلنة: skip للترقيم البسيط + note/nextDate للعرض والتعديل.
 */
export async function getMyRecentFollowups(userId: string, take = 5, skip = 0): Promise<MyRecentFollowUp[]> {
  const rows = await prisma.followUp.findMany({
    where: { createdBy: userId },
    orderBy: { createdAt: "desc" },
    take,
    skip,
    select: { id: true, result: true, createdAt: true, note: true, nextDate: true, leadId: true, lead: { select: { name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    result: r.result,
    createdAt: r.createdAt,
    note: r.note,
    nextDate: r.nextDate,
    leadId: r.leadId,
    leadName: r.lead.name,
  }));
}
