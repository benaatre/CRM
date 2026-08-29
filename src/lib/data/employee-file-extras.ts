import "server-only";

import { FollowUpResult, LeadStage, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { KSA_OFFSET_MS, DAY_MS, ksaDayKey } from "@/lib/ksa-time";
import { splitOvertime, currentMonthKSA } from "@/lib/attendance-logic";
import { getEmployeeFile, getEmployeeDayTimeline, getAttendanceSettings, getAllLocations } from "@/lib/data/attendance";
import { effectiveConfigFor } from "@/lib/attendance-config";
import { getLeaveBalance, LEAVE_LABEL, calendarDays } from "@/lib/data/leaves";
import { toArabicDigits, formatTime, ONLINE_THRESHOLD_MS } from "@/lib/format";
import { stageLabels } from "@/lib/labels";
import type { EFBundle, EFDayCard, EFEvent, EFLogDay, EFStripMark, EFStripSeg, EFLeaveReq, EFInsight } from "@/components/employee-file/types";

/**
 * قراءات ملف الموظف الكامل (/employees/[id]) التي لا يغطيها السطح القائم —
 * كلها **قراءة فقط** بمدى حر {fromKey,toKey}. لا تكرار لمنطق موجود:
 * • أيام السجل تأتي حصريًا من getEmployeeFile (المنطق المعتمد) عبر getFileDaysRange.
 * • «التزام المواعيد» يطبّق معادلة my-log الحرفية (نافذة −١س → +٢٤س) على مدى حر.
 * • زيارات CRM بنفس تعريف my-log: INTERESTED_VISITED + NOT_INTERESTED_VISITED.
 */

export type RangeKeys = { fromKey: string; toKey: string };

const VISIT_DONE: FollowUpResult[] = [FollowUpResult.INTERESTED_VISITED, FollowUpResult.NOT_INTERESTED_VISITED];
const HOUR_MS = 3_600_000;

/** بداية اليوم KSA (UTC) لمفتاح يوم. */
export function ksaStartOfKey(key: string): Date {
  return new Date(Date.parse(`${key}T00:00:00Z`) - KSA_OFFSET_MS);
}
/** نهاية اليوم KSA (بداية اليوم التالي). */
export function ksaEndOfKey(key: string): Date {
  return new Date(ksaStartOfKey(key).getTime() + DAY_MS);
}
export function addDaysKey(key: string, days: number): string {
  return new Date(Date.parse(`${key}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** مدى الفلتر الموحّد (أسبوع = ٧ أيام لليوم · شهر = الشهر الحالي حتى اليوم · ٩٠ يوم). */
export function periodRange(p: "w" | "m" | "q", now = new Date()): RangeKeys {
  const todayKey = ksaDayKey(now);
  if (p === "w") return { fromKey: addDaysKey(todayKey, -6), toKey: todayKey };
  if (p === "q") return { fromKey: addDaysKey(todayKey, -89), toKey: todayKey };
  const month = currentMonthKSA(now);
  return { fromKey: `${month}-01`, toKey: todayKey };
}

/** مفاتيح الأشهر (YYYY-MM) التي يغطيها المدى — مرتبة تصاعديًا. */
export function monthsOfRange(r: RangeKeys): string[] {
  const months: string[] = [];
  let m = r.fromKey.slice(0, 7);
  const last = r.toKey.slice(0, 7);
  while (m <= last && months.length < 5) {
    months.push(m);
    const [y, mo] = m.split("-").map(Number);
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  }
  return months;
}

export type FileDay = NonNullable<Awaited<ReturnType<typeof getEmployeeFile>>>["days"][number];

/**
 * أيام السجل لمدى حر — بالمنطق المعتمد حرفيًا: getEmployeeFile لكل شهر يغطيه
 * المدى ثم قصّ المفاتيح. الحد ٩٢ يومًا (٤ أشهر) يفرضه المستدعي.
 */
export async function getFileDaysRange(userId: string, r: RangeKeys): Promise<FileDay[]> {
  const months = monthsOfRange(r);
  const files = await Promise.all(months.map((m) => getEmployeeFile(userId, m)));
  const days = files.flatMap((f) => f?.days ?? []);
  return days
    .filter((d) => d.key >= r.fromKey && d.key <= r.toKey)
    .sort((a, b) => (a.key < b.key ? 1 : -1)); // الأحدث أولًا (نمط الملف)
}

export type AttendanceRangeKpis = {
  workDays: number;
  totalMinutes: number;
  confirmedMinutes: number;
  unconfirmedMinutes: number;
  leaveDays: number;
  absentDays: number;
  lateDays: number;
  /** دوام ÷ (دوام + غياب) — الأيام المستحقة فقط (العطل/الإجازات/القادم خارج المقام). */
  compliancePct: number | null;
  confirmPct: number | null;
};

/** مؤشرات الدوام من أيام السجل المعتمدة نفسها — لا حساب موازٍ. */
export function attendanceKpisOf(days: FileDay[]): AttendanceRangeKpis {
  const worked = days.filter((d) => d.status === "COMPLETED" || d.status === "PARTIAL" || d.status === "OPEN");
  const absent = days.filter((d) => d.status === "ABSENT");
  const leave = days.filter((d) => d.status === "LEAVE");
  const totalMinutes = days.reduce((s, d) => s + d.workedMinutes, 0);
  const unconfirmedMinutes = days.reduce((s, d) => s + (d.unconfirmedMinutes ?? 0), 0);
  const confirmedMinutes = Math.max(0, totalMinutes - unconfirmedMinutes);
  const due = worked.length + absent.length;
  return {
    workDays: worked.length,
    totalMinutes,
    confirmedMinutes,
    unconfirmedMinutes,
    leaveDays: leave.length,
    absentDays: absent.length,
    lateDays: days.filter((d) => d.late).length,
    compliancePct: due > 0 ? Math.round((worked.length / due) * 100) : null,
    confirmPct: totalMinutes > 0 ? Math.round((confirmedMinutes / totalMinutes) * 100) : null,
  };
}

/** توزيع ساعة أول بصمة (٨ص→٢م، ٧ سلال) — من AttendanceDay.firstCheckInAt الحقيقي. */
export async function getCheckinHistogram(userId: string, r: RangeKeys): Promise<number[]> {
  const rows = await prisma.attendanceDay.findMany({
    where: { userId, date: { gte: new Date(`${r.fromKey}T00:00:00Z`), lte: new Date(`${r.toKey}T00:00:00Z`) }, firstCheckInAt: { not: null } },
    select: { firstCheckInAt: true },
  });
  const buckets = new Array<number>(7).fill(0);
  for (const row of rows) {
    const ksaHour = Math.floor(((row.firstCheckInAt!.getTime() + KSA_OFFSET_MS) % DAY_MS) / HOUR_MS);
    const idx = Math.min(6, Math.max(0, ksaHour - 8)); // 8ص..14م — الأطراف تُضم للسلة الطرفية
    buckets[idx] += 1;
  }
  return buckets;
}

export type CrmRangeKpis = {
  followups: number;
  activeLeads: number; // عملاء متمايزون تواصل معهم في المدى
  visits: number;
  bookings: number;
  dueCount: number;
  fulfilled: number;
  apptPct: number | null;
  /** متوسط (أول تواصل − الإسناد) بالدقائق لعملاء أُسندوا في المدى؛ null إن لا عيّنة. */
  firstRespMinutes: number | null;
};

export async function getCrmRangeKpis(userId: string, r: RangeKeys, now = new Date()): Promise<CrmRangeKpis> {
  const start = ksaStartOfKey(r.fromKey);
  const end = ksaEndOfKey(r.toKey);
  const [fus, bookings, fulfillWindow, assigned] = await Promise.all([
    prisma.followUp.findMany({
      where: { createdBy: userId, createdAt: { gte: start, lt: end } },
      select: { leadId: true, result: true, nextDate: true, createdAt: true },
    }),
    prisma.booking.count({ where: { sellerId: userId, createdAt: { gte: start, lt: end } } }),
    // نافذة إنجاز المواعيد — معادلة my-log الحرفية (−١س → +٢٤س حول الاستحقاق).
    prisma.followUp.findMany({
      where: { createdBy: userId, createdAt: { gte: new Date(start.getTime() - HOUR_MS), lte: now } },
      select: { leadId: true, createdAt: true },
    }),
    prisma.lead.findMany({
      where: { assignedToId: userId, assignedAt: { gte: start, lt: end }, firstContactAt: { not: null } },
      select: { assignedAt: true, firstContactAt: true },
    }),
  ]);

  const dueList = fus.filter((f) => f.nextDate && f.nextDate >= start && f.nextDate < end && f.nextDate <= now);
  const byLead = new Map<string, number[]>();
  for (const f of fulfillWindow) {
    const arr = byLead.get(f.leadId);
    if (arr) arr.push(f.createdAt.getTime());
    else byLead.set(f.leadId, [f.createdAt.getTime()]);
  }
  const fulfilled = dueList.filter((d) => {
    const due = (d.nextDate as Date).getTime();
    return (byLead.get(d.leadId) ?? []).some((c) => c >= due - HOUR_MS && c <= due + 24 * HOUR_MS);
  }).length;

  const respSamples = assigned
    .map((l) => (l.assignedAt && l.firstContactAt ? l.firstContactAt.getTime() - l.assignedAt.getTime() : null))
    .filter((v): v is number => v !== null && v >= 0);
  const firstRespMinutes = respSamples.length
    ? Math.round(respSamples.reduce((s, v) => s + v, 0) / respSamples.length / 60_000)
    : null;

  return {
    followups: fus.length,
    activeLeads: new Set(fus.map((f) => f.leadId)).size,
    visits: fus.filter((f) => VISIT_DONE.includes(f.result)).length,
    bookings,
    dueCount: dueList.length,
    fulfilled,
    apptPct: dueList.length > 0 ? Math.round((fulfilled / dueList.length) * 100) : null,
    firstRespMinutes,
  };
}

/** عدد متابعات الموظف لكل يوم KSA داخل المدى. */
export async function getFollowupsByDay(userId: string, r: RangeKeys): Promise<Record<string, number>> {
  const rows = await prisma.followUp.findMany({
    where: { createdBy: userId, createdAt: { gte: ksaStartOfKey(r.fromKey), lt: ksaEndOfKey(r.toKey) } },
    select: { createdAt: true },
  });
  const map: Record<string, number> = {};
  for (const row of rows) {
    const key = ksaDayKey(row.createdAt);
    map[key] = (map[key] ?? 0) + 1;
  }
  return map;
}

/** توزيع ساعات إنشاء المتابعات KSA (٢٤ سلة) — لرؤية «ذروة الإنتاج». */
export async function getFollowupHourHistogram(userId: string, r: RangeKeys): Promise<number[]> {
  const rows = await prisma.followUp.findMany({
    where: { createdBy: userId, createdAt: { gte: ksaStartOfKey(r.fromKey), lt: ksaEndOfKey(r.toKey) } },
    select: { createdAt: true },
  });
  const buckets = new Array<number>(24).fill(0);
  for (const row of rows) {
    buckets[Math.floor(((row.createdAt.getTime() + KSA_OFFSET_MS) % DAY_MS) / HOUR_MS)] += 1;
  }
  return buckets;
}

/** مراحل عملاء الموظف الآن (غير المؤرشفين) — مرتبة تنازليًا. */
export async function getStageDistribution(userId: string): Promise<{ key: string; label: string; count: number }[]> {
  const rows = await prisma.lead.groupBy({
    by: ["stage"],
    where: { assignedToId: userId, isArchived: false },
    _count: { _all: true },
  });
  const ACTIVE: LeadStage[] = [
    LeadStage.INTERESTED, LeadStage.FOLLOW_UP_LATER, LeadStage.VISIT_SCHEDULED,
    LeadStage.VIEWING, LeadStage.NEGOTIATION, LeadStage.RESERVED,
  ];
  return rows
    .filter((row) => ACTIVE.includes(row.stage))
    .map((row) => ({ key: row.stage, label: stageLabels[row.stage] ?? row.stage, count: row._count._all }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 4);
}

/** خط أساس الفريق: متابعات الفريق ÷ ساعاته المؤكّدة داخل المدى (بلا المالك). */
export async function getTeamPerConfirmedHour(r: RangeKeys): Promise<number | null> {
  const start = ksaStartOfKey(r.fromKey);
  const end = ksaEndOfKey(r.toKey);
  const dateFrom = new Date(`${r.fromKey}T00:00:00Z`);
  const dateTo = new Date(`${r.toKey}T00:00:00Z`);
  const [fuCount, daysAgg] = await Promise.all([
    prisma.followUp.count({ where: { createdAt: { gte: start, lt: end }, employee: { role: { not: "OWNER" } } } }),
    prisma.attendanceDay.findMany({
      where: { date: { gte: dateFrom, lte: dateTo }, user: { role: { not: "OWNER" } } },
      select: { userId: true, date: true, unconfirmedMinutes: true },
    }),
  ]);
  // إجمالي دقائق الفريق: مجموع جلسات المدى غير المُبطلة (نفس نافذة اليوم KSA −٣س).
  const sessions = await prisma.attendanceSession.findMany({
    where: { voided: false, startedAt: { gte: start, lt: end }, workedMinutes: { not: null }, user: { role: { not: "OWNER" } } },
    select: { workedMinutes: true },
  });
  const totalMinutes = sessions.reduce((s, x) => s + (x.workedMinutes ?? 0), 0);
  const unconf = daysAgg.reduce((s, d) => s + d.unconfirmedMinutes, 0);
  const confirmedHours = Math.max(0, totalMinutes - unconf) / 60;
  if (confirmedHours < 1) return null;
  return Math.round((fuCount / confirmedHours) * 10) / 10;
}

/** الإعدادات الفعلية للموظف (ملف الموظف الحي) — للحزمة. */
export async function getConfigView(userId: string, now = new Date()) {
  const c = await effectiveConfigFor(userId, undefined, now);
  return {
    mode: c.mode,
    exemptUntilKey: c.exemptUntilKey,
    exemptReason: c.exemptReason,
    verificationPerDay: c.verificationPerDay,
    weekendDays: c.weekendDays,
    outZoneCallEnabled: c.outZoneCallEnabled,
    dayLockEnabled: c.dayLockEnabled,
    notifyMissedCall: c.notifyMissedCall,
    watchFromMinutes: c.watchFromMinutes,
    watchToMinutes: c.watchToMinutes,
    watchAlertFirstSeen: c.watchAlertFirstSeen,
    lateThresholdMinutes: c.lateThresholdMinutes,
    gapCallEnabled: c.gapCallEnabled,
    punchReminderEnabled: c.punchReminderEnabled,
    quietMode: c.quietMode,
    custom: c.custom,
  };
}

/** طلبات إجازة الموظف (المعلّقة أولًا) — لبند العمود الجانبي. */
export async function getUserLeaveRequests(userId: string) {
  return prisma.leaveRequest.findMany({
    where: { userId },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 10,
  });
}

/* ═════════════════ منشئ حزمة ملف الموظف ═════════════════ */

const AR_M = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const AR_DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

/** «٤:١٣» بأرقام عربية من دقائق. */
export function hmAr(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.abs(minutes % 60);
  return toArabicDigits(`${h}:${String(m).padStart(2, "0")}`);
}
function monthLabelAr(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${AR_M[(m ?? 1) - 1]} ${toArabicDigits(y ?? 0)}`;
}
function dayLabelAr(key: string): string {
  const [, m, d] = key.split("-").map(Number);
  return `${toArabicDigits(d ?? 0)} ${AR_M[(m ?? 1) - 1]}`;
}
/** موضع لحظة على مقياس ٨ص→١٠م (٪) — نفس معادلة المرجع. */
function stripPct(dateIso: string): number {
  const t = new Date(dateIso).getTime() + KSA_OFFSET_MS;
  const h = ((t % DAY_MS) + DAY_MS) % DAY_MS / 3_600_000;
  return Math.min(100, Math.max(0, ((h - 8) / 14) * 100));
}
function stripPctOfMinutes(min: number): number {
  return Math.min(100, Math.max(0, ((min / 60 - 8) / 14) * 100));
}

/** بطاقة يوم (الشريط + الأحداث) من DayLogEntry المعتمد — بلا أي بيانات مخترعة. */
function buildDayCard(
  day: FileDay,
  schedule: { startMinutes: number; startWindowEndMinutes: number | null },
  events: EFEvent[],
): EFDayCard {
  const segs: EFStripSeg[] = [];
  const marks: EFStripMark[] = [];
  for (const st of day.stations) {
    const a = stripPct(st.fromIso);
    const b = st.toIso ? stripPct(st.toIso) : stripPct(new Date().toISOString());
    if (b > a) segs.push({ a, b, cls: st.kind === "OUT" ? "unc" : "conf" });
  }
  const first = day.stations[0];
  const last = day.stations[day.stations.length - 1];
  if (first) marks.push({ pct: stripPct(first.fromIso), color: "var(--gold)", label: first.fromText });
  for (const st of day.stations) {
    if (st.kind === "OUT") marks.push({ pct: stripPct(st.fromIso), color: "var(--amber-l)", label: st.fromText });
    else if (st !== first) marks.push({ pct: stripPct(st.fromIso), color: "var(--teal)", label: st.fromText });
  }
  if (last?.toIso && last.toText) marks.push({ pct: stripPct(last.toIso), color: "#82848c", label: last.toText });

  const startText = hmAr(schedule.startMinutes) + (schedule.startMinutes < 720 ? " ص" : " م");
  let state: EFDayCard["state"];
  // الإضافي الذهبي (الدفعة ب): الفصل بالدالة المشتركة حصرًا — لا حساب مكرر.
  const ot = splitOvertime(day.workedMinutes, Math.max(1, day.targetMinutes));
  const done = hmAr(ot.basicMinutes);
  const target = hmAr(day.targetMinutes);
  if (day.status === "OPEN") state = { cls: "ok", text: `جارٍ الآن — ${done} من ${target}`, lock: false };
  else if (day.status === "COMPLETED") state = { cls: "ok", text: `✓ أكمل دوامه — ${done} من ${target} · مقفول`, lock: false };
  else if (day.status === "PARTIAL")
    state = {
      cls: "",
      text: `مقفول${day.checkOutText ? ` · ${day.checkOutText}` : ""}${day.autoEnded ? " — بصمة جديدة = يوم جديد" : ""}`,
      lock: true,
    };
  else if (day.status === "LEAVE") state = { cls: "leave", text: "إجازة معتمدة — مستثنى تلقائيًا", lock: false };
  else if (day.status === "ABSENT") state = { cls: "bad", text: "غياب — بلا أي بصمة", lock: false };
  else state = { cls: "", text: "—", lock: false };

  return {
    key: day.key,
    bigHM: done,
    overtimeHM: ot.overtimeMinutes > 0 ? hmAr(ot.overtimeMinutes) : null,
    metaTop: `من ${startText}${day.checkOutText ? ` · آخر انصراف ${day.checkOutText}` : ""}`,
    state,
    window: {
      a: stripPctOfMinutes(schedule.startMinutes),
      b: stripPctOfMinutes(schedule.startWindowEndMinutes ?? schedule.startMinutes + 60),
    },
    segs,
    marks,
    events,
  };
}

function toLogDay(d: FileDay, todayKey: string): EFLogDay {
  const dow = new Date(`${d.key}T00:00:00Z`).getUTCDay();
  let status: EFLogDay["status"];
  if (d.status === "COMPLETED") status = "full";
  else if (d.status === "PARTIAL") status = "part";
  else if (d.status === "OPEN") status = "open";
  else if (d.status === "LEAVE") status = "leave";
  else if (d.status === "WEEKEND") status = "wk";
  else if (d.status === "PENDING") status = "fut";
  else if (d.status === "UNENFORCED") status = "off";
  else status = "abs";
  const conf = Math.max(0, d.workedMinutes - (d.unconfirmedMinutes ?? 0));
  const denom = Math.max(d.targetMinutes, d.workedMinutes, 1);
  return {
    key: d.key,
    dayNum: dayLabelAr(d.key),
    dayName: AR_DAYS[dow],
    status,
    io: d.checkInText ? `${d.checkInText} ← ${d.checkOutText ?? "…"}` : null,
    hoursHM: d.workedMinutes > 0 ? hmAr(d.workedMinutes) : null,
    confPct: Math.round((conf / denom) * 100),
    uncPct: Math.round(((d.unconfirmedMinutes ?? 0) / denom) * 100),
    locked: d.key < todayKey && (status === "full" || status === "part"),
    leaveTag: status === "leave",
  };
}

function leaveToEF(r: { id: string; type: string; dateFrom: Date; dateTo: Date; reason: string; status: string; createdAt: Date }): EFLeaveReq {
  const fromKey = r.dateFrom.toISOString().slice(0, 10);
  const toKey = r.dateTo.toISOString().slice(0, 10);
  const sameMonth = fromKey.slice(0, 7) === toKey.slice(0, 7);
  const [, m2, d2] = toKey.split("-").map(Number);
  const [, , d1] = fromKey.split("-").map(Number);
  return {
    id: r.id,
    typeLabel: LEAVE_LABEL[r.type] ?? r.type,
    fromKey,
    toKey,
    days: calendarDays(fromKey, toKey),
    rangeText: sameMonth
      ? `${toArabicDigits(d1 ?? 0)}–${toArabicDigits(d2 ?? 0)} ${AR_M[(m2 ?? 1) - 1]}`
      : `${dayLabelAr(fromKey)} — ${dayLabelAr(toKey)}`,
    createdText: formatTime(r.createdAt),
    reason: r.reason,
    status: r.status,
  };
}

export type BundleQuery = {
  p?: string; // w|m|q
  view?: string; // week|month|range
  month?: string;
  from?: string;
  to?: string;
};

/** يجمع كل بيانات ملف الموظف من السطح القائم + قراءات هذا الملف — استدعاء واحد للصفحة. */
export async function buildEmployeeFileBundle(userId: string, q: BundleQuery): Promise<EFBundle | null> {
  const now = new Date();
  const todayKey = ksaDayKey(now);
  const period: "w" | "m" | "q" = q.p === "w" || q.p === "q" ? q.p : "m";
  const curMonth = currentMonthKSA(now);
  const month = /^\d{4}-\d{2}$/.test(q.month ?? "") ? (q.month as string) : curMonth;
  let view: "week" | "month" | "range" = q.view === "week" || q.view === "range" ? q.view : "month";
  let rangeFrom: string | null = null;
  let rangeTo: string | null = null;
  const K = /^\d{4}-\d{2}-\d{2}$/;
  if (view === "range") {
    if (q.from && q.to && K.test(q.from) && K.test(q.to) && q.from <= q.to) {
      rangeFrom = q.from;
      rangeTo = q.to > todayKey ? todayKey : q.to;
      if (calendarDays(rangeFrom, rangeTo) > 92) rangeFrom = addDaysKey(rangeTo, -91); // سقف ٩٢ يومًا
    } else view = "month";
  }

  // memoization — getEmployeeFile ثقيل، والشهر الواحد يُطلب من أكثر من قسم.
  const fileCache = new Map<string, ReturnType<typeof getEmployeeFile>>();
  const fileOf = (m: string) => {
    if (!fileCache.has(m)) fileCache.set(m, getEmployeeFile(userId, m));
    return fileCache.get(m)!;
  };
  const daysOf = async (r: RangeKeys): Promise<FileDay[]> => {
    const files = await Promise.all(monthsOfRange(r).map((m) => fileOf(m)));
    return files
      .flatMap((f) => f?.days ?? [])
      .filter((d) => d.key >= r.fromKey && d.key <= r.toKey)
      .sort((a, b) => (a.key < b.key ? 1 : -1));
  };

  const kpiRange = periodRange(period, now);
  const range14: RangeKeys = { fromKey: addDaysKey(todayKey, -13), toKey: todayKey };
  const logRange: RangeKeys =
    view === "week"
      ? { fromKey: addDaysKey(todayKey, -6), toKey: todayKey }
      : view === "range"
        ? { fromKey: rangeFrom!, toKey: rangeTo! }
        : { fromKey: `${month}-01`, toKey: month === curMonth ? todayKey : `${month}-31` };

  const baseFile = await fileOf(curMonth);
  if (!baseFile) return null;

  const [
    user, timeline, settings, locations, config, teamNav,
    kpiDays, days14, logDaysRaw,
    crm, fusByDay14, fuHours, stagesDist, teamPerHour,
    leaveRows, balance, histogram, todayRow,
  ] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, role: true, active: true, lastSeenAt: true } }),
    getEmployeeDayTimeline(userId, now),
    getAttendanceSettings(),
    getAllLocations(),
    getConfigView(userId, now),
    prisma.user.findMany({ where: { role: { in: ["EMPLOYEE", "ADMIN", "HR", "FINANCE"] }, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    daysOf(kpiRange),
    daysOf(range14),
    daysOf(logRange),
    getCrmRangeKpis(userId, kpiRange, now),
    getFollowupsByDay(userId, range14),
    getFollowupHourHistogram(userId, kpiRange),
    getStageDistribution(userId),
    getTeamPerConfirmedHour(kpiRange),
    getUserLeaveRequests(userId),
    getLeaveBalance(userId),
    getCheckinHistogram(userId, kpiRange),
    prisma.attendanceDay.findUnique({
      where: { userId_date: { userId, date: new Date(`${todayKey}T00:00:00Z`) } },
      select: { lockedAt: true },
    }),
  ]);
  if (!user || user.role === Role.OWNER) return null;

  const att = attendanceKpisOf(kpiDays);

  // بطاقتا اليوم/أمس — أحداث اليوم من الخط الزمني المعتمد، وأمس من مصادر الملف بنفس اليوم.
  const ydayKey = addDaysKey(todayKey, -1);
  const todayDay = baseFile.days.find((d) => d.key === todayKey) ?? null;
  const ydayDay = baseFile.days.find((d) => d.key === ydayKey) ?? null;
  const toneColor: Record<string, string> = {
    gold: "var(--gold)", green: "var(--green-l)", red: "var(--red-l)", amber: "var(--amber-l)", muted: "var(--muted)",
  };
  const todayEvents: EFEvent[] = timeline.timeline.map((e) => ({
    t: e.atText, c: toneColor[e.tone] ?? "var(--muted)", b: e.text, s: "",
  }));
  const ydayEvents: EFEvent[] = [];
  if (ydayDay) {
    for (const st of ydayDay.stations) {
      ydayEvents.push({
        t: st.fromText,
        c: st.kind === "OUT" ? "var(--amber-l)" : st.kind === "PROJECT" ? "var(--blue-l)" : "var(--green-l)",
        b: st.kind === "OUT" ? "خارج النطاق" : st.kind === "PROJECT" ? `زيارة مشروع — ${st.name}` : `داخل النطاق — ${st.name}`,
        s: st.toText ? `حتى ${st.toText}` : "",
      });
    }
    for (const v of baseFile.verifications.filter((v) => v.dayKey === ydayKey)) {
      ydayEvents.push({
        t: v.scheduledAtText,
        c: v.status === "CONFIRMED" ? "var(--green-l)" : v.status === "MISSED" ? "var(--amber-l)" : "var(--muted)",
        b: v.status === "CONFIRMED" ? "نداء تحقق — أكّد موقعه" : v.status === "MISSED" ? "نداء تحقق — فات" : `نداء تحقق — ${v.status}`,
        s: v.respondedAtText ? `ردّ ${v.respondedAtText}` : "",
      });
    }
    ydayEvents.reverse();
  }
  const schedForCard = { startMinutes: baseFile.schedule.startMinutes, startWindowEndMinutes: baseFile.schedule.startWindowEndMinutes };

  // الدوام × الإنجاز — من المتابعات الحقيقية × أيام السجل المعتمدة.
  const fusByDayKpi = await getFollowupsByDay(userId, kpiRange);
  const avgOf = (statuses: string[]): number | null => {
    const list = kpiDays.filter((d) => statuses.includes(d.status));
    if (!list.length) return null;
    const total = list.reduce((s, d) => s + (fusByDayKpi[d.key] ?? 0), 0);
    return Math.round((total / list.length) * 10) / 10;
  };
  const confirmedHours = att.confirmedMinutes / 60;
  const perHourNum = confirmedHours >= 1 ? Math.round((crm.followups / confirmedHours) * 10) / 10 : null;
  const diffPct =
    perHourNum !== null && teamPerHour !== null && teamPerHour > 0
      ? Math.round(((perHourNum - teamPerHour) / teamPerHour) * 100)
      : null;
  const avgFull = avgOf(["COMPLETED"]);
  const avgPartial = avgOf(["PARTIAL", "OPEN"]);
  const avgAbsent = avgOf(["ABSENT"]);

  const insights: EFInsight[] = [];
  if (diffPct !== null) {
    insights.push(
      diffPct >= 0
        ? { tag: "g", title: `إنتاجيته فوق معدل الفريق ${toArabicDigits(Math.abs(diffPct))}٪`, sub: "متابعة لكل ساعة مؤكّدة مقارنة بالفريق في نفس المدى." }
        : { tag: "a", title: `إنتاجيته تحت معدل الفريق ${toArabicDigits(Math.abs(diffPct))}٪`, sub: "متابعة لكل ساعة مؤكّدة مقارنة بالفريق في نفس المدى." },
    );
  }
  if (att.absentDays > 0 && avgFull !== null && avgFull > 0) {
    const lost = Math.round(att.absentDays * avgFull);
    insights.push({
      tag: "a",
      title: `${toArabicDigits(att.absentDays)} أيام غياب ≈ ${toArabicDigits(lost)} متابعة ضائعة`,
      sub: `تقديرًا بمعدل يومه الكامل (${toArabicDigits(avgFull)} متابعة/يوم).`,
    });
  }
  const peakHour = fuHours.reduce((best, v, h) => (v > fuHours[best] ? h : best), 0);
  if (fuHours[peakHour] > 0) {
    const hh = peakHour % 12 === 0 ? 12 : peakHour % 12;
    const ampm = peakHour < 12 ? "ص" : "م";
    insights.push({
      tag: "b",
      title: `أفضل إنتاجه حول الساعة ${toArabicDigits(hh)}${ampm}`,
      sub: "جدولة المتابعات المهمة بهالفترة = أعلى مردود.",
    });
  }

  // ذروة سلال أول بصمة (٨ص→٢م)
  const histPeakIdx = histogram.reduce((best, v, i) => (v > histogram[best] ? i : best), 0);
  const histPeakLabel =
    histogram[histPeakIdx] > 0
      ? `${toArabicDigits(histPeakIdx + 8 > 12 ? histPeakIdx - 4 : histPeakIdx + 8)}${histPeakIdx + 8 >= 12 ? "م" : "ص"}`
      : null;

  const logDays = logDaysRaw.map((d) => toLogDay(d, todayKey));
  const workedCount = logDays.filter((d) => d.status === "full" || d.status === "part" || d.status === "open").length;
  const absCount = logDays.filter((d) => d.status === "abs").length;
  const lvCount = logDays.filter((d) => d.status === "leave").length;
  const logLabel =
    view === "week"
      ? `الأسبوع الحالي — ${dayLabelAr(logRange.fromKey)} إلى ${dayLabelAr(logRange.toKey)}`
      : view === "range"
        ? `مدى مخصص · ${toArabicDigits(logDays.length)} يوم — دوام ${toArabicDigits(workedCount)} · غياب ${toArabicDigits(absCount)}`
        : `${monthLabelAr(month)} — دوام ${toArabicDigits(workedCount)} · غياب ${toArabicDigits(absCount)}${lvCount ? ` · إجازة ${toArabicDigits(lvCount)}` : ""}`;

  const monthOptions = Array.from({ length: 12 }, (_, i) => {
    const [y, m] = curMonth.split("-").map(Number);
    const total = (y ?? 0) * 12 + (m ?? 1) - 1 - i;
    const value = `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
    return { value, label: monthLabelAr(value), current: i === 0 };
  });

  const openRepair = baseFile.repairSessions.find((s) => s.open && !s.voided) ?? null;

  const online = !!user.lastSeenAt && now.getTime() - user.lastSeenAt.getTime() < ONLINE_THRESHOLD_MS;
  const deviceLine = timeline.devices.length
    ? timeline.devices.map((d) => d.detail).join(" · ") + ` · نبض حي — تحديث كل ~دقيقة`
    : "لا جهاز نشط الآن";

  return {
    user: { id: user.id, name: user.name, role: user.role, active: user.active, online },
    period,
    view,
    month,
    rangeFrom,
    rangeTo,
    monthOptions,
    schedule: baseFile.schedule,
    config,
    todayLocked: !!todayRow?.lockedAt,
    globalView: {
      verificationPerDay: settings.verificationPerDay,
      verificationEnabled: settings.verificationEnabled,
      weekendDays: settings.weekendDays,
      maxOutOfZoneMinutes: settings.maxOutOfZoneMinutes,
      lateThresholdMinutes: settings.lateThresholdMinutes,
      heartbeatSeconds: 60,
    },
    radar: { state: timeline.radar.state, locationName: timeline.radar.locationName },
    deviceLine,
    today: todayDay ? buildDayCard(todayDay, schedForCard, todayEvents) : null,
    yesterday: ydayDay ? buildDayCard(ydayDay, schedForCard, ydayEvents) : null,
    todayEvents,
    attKpis: {
      workDays: att.workDays,
      confirmedHM: hmAr(att.confirmedMinutes),
      unconfHM: hmAr(att.unconfirmedMinutes),
      leaveDays: att.leaveDays,
      absentDays: att.absentDays,
      compliancePct: att.compliancePct,
      confirmPct: att.confirmPct,
    },
    histogram,
    histPeakLabel,
    crm: {
      followups: crm.followups,
      activeLeads: crm.activeLeads,
      visits: crm.visits,
      bookings: crm.bookings,
      apptPct: crm.apptPct,
      firstRespHM: crm.firstRespMinutes !== null ? hmAr(crm.firstRespMinutes) : null,
    },
    fus14: Array.from({ length: 14 }, (_, i) => {
      const key = addDaysKey(range14.fromKey, i);
      const dayEntry = days14.find((d) => d.key === key);
      return {
        key,
        dayNum: toArabicDigits(Number(key.slice(8))),
        count: fusByDay14[key] ?? 0,
        off: dayEntry?.status === "ABSENT",
      };
    }),
    stages: stagesDist,
    merge: {
      perHour: perHourNum !== null ? toArabicDigits(String(perHourNum).replace(".", "٫")) : null,
      teamPerHour: teamPerHour !== null ? toArabicDigits(String(teamPerHour).replace(".", "٫")) : null,
      above: diffPct !== null ? diffPct >= 0 : null,
      diffPct,
      avgFull,
      avgPartial,
      avgAbsent,
      insights,
    },
    logDays,
    logLabel,
    openSession: openRepair
      ? { id: openRepair.id, lastProofText: openRepair.lastAliveText, lastProofLocal: openRepair.lastAliveLocal }
      : null,
    repairSessions: baseFile.repairSessions,
    leaves: {
      pending: leaveRows.filter((r) => r.status === "PENDING").map(leaveToEF),
      decided: leaveRows.filter((r) => r.status !== "PENDING").slice(0, 3).map(leaveToEF),
      balance,
    },
    zones: locations.map((l) => ({ id: l.id, name: l.name, active: l.isActive })),
    teamNav,
  };
}
