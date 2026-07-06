import "server-only";

import { FollowUpType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guards";
import { ksaTodayStart } from "@/lib/auto-distribute";
import { formatDate } from "@/lib/format";

const VISIT_TYPES = [FollowUpType.VISIT_PROJECT, FollowUpType.VISIT_OFFICE];
// نتائج «غير مهتم» المنظّمة (بعد توحيد الأسباب) — النهائي الفعلي، بلا الانسحاب الناعم.
const NOT_INTERESTED_RESULTS = [
  "NOT_INTERESTED_LOCATION", "NOT_INTERESTED_PRICE", "NOT_INTERESTED_SPACE", "NOT_INTERESTED_FINAL",
] as const;

const DAY_MS = 86_400_000;

export type ActivityRow = {
  id: string;
  name: string;
  received: number;      // استقبل (Reassignment.toUserId — initial + timeout)
  lateLost: number;      // تأخّر/فات منه (Reassignment.fromUserId, reason=timeout)
  followups: number;     // متابعات (FollowUp.createdBy)
  visits: number;        // زيارات (FollowUp نوع زيارة)
  bookings: number;      // حجوزات (Booking.sellerId)
  notInterested: number; // غير مهتم (FollowUp نتيجة NOT_INTERESTED_*)
};

export type ReassignEvent = {
  leadName: string;
  fromName: string; // من فات منه العميل
  toName: string;   // من استلمه بعده
  at: Date;
};

export type ActivityReport = {
  periodLabel: string;
  rows: ActivityRow[];
  reassigns: ReassignEvent[];
};

/** نطاق الفترة: يوم محدّد (YYYY-MM-DD) → يوم السعودية · all → الإجمالي · غير ذلك → اليوم. */
function rangeFor(opts: { day?: string; all?: boolean }, now: Date): { range: { gte: Date; lt: Date } | null; label: string } {
  if (opts.day && /^\d{4}-\d{2}-\d{2}$/.test(opts.day)) {
    const start = ksaTodayStart(new Date(`${opts.day}T12:00:00Z`));
    return { range: { gte: start, lt: new Date(start.getTime() + DAY_MS) }, label: formatDate(start) };
  }
  if (opts.all) return { range: null, label: "الإجمالي" };
  const start = ksaTodayStart(now);
  return { range: { gte: start, lt: new Date(start.getTime() + DAY_MS) }, label: "اليوم" };
}

/**
 * تقرير نشاط الفريق للمالك فقط. يعيد استخدام Reassignment (initial/timeout) + FollowUp + Booking.
 * لا يعيد حساب مهلة التأخّر — يقرأ ما كتبه الـsweep (Reassignment reason=timeout).
 */
export async function getActivityReport(opts: { day?: string; all?: boolean } = {}, now: Date = new Date()): Promise<ActivityReport> {
  const user = await requireUser();
  if (user.role !== "OWNER") return { periodLabel: "", rows: [], reassigns: [] }; // المالك فقط

  const { range, label } = rangeFor(opts, now);
  const inRange = range ?? undefined;              // للجداول ذات createdAt
  const cf = inRange ? { createdAt: inRange } : {}; // اختصار

  const [emps, users, received, lateLost, followupsByEmp, visitsByEmp, bookingsByEmp, notIntByEmp, reassignRows] = await Promise.all([
    prisma.user.findMany({ where: { role: "EMPLOYEE", active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.user.findMany({ select: { id: true, name: true } }),
    prisma.reassignment.groupBy({ by: ["toUserId"], where: { ...cf }, _count: { _all: true } }),
    prisma.reassignment.groupBy({ by: ["fromUserId"], where: { reason: "timeout", ...cf }, _count: { _all: true } }),
    prisma.followUp.groupBy({ by: ["createdBy"], where: { ...cf }, _count: { _all: true } }),
    prisma.followUp.groupBy({ by: ["createdBy"], where: { type: { in: VISIT_TYPES }, ...cf }, _count: { _all: true } }),
    prisma.booking.groupBy({ by: ["sellerId"], where: { ...cf }, _count: { _all: true } }),
    prisma.followUp.groupBy({ by: ["createdBy"], where: { result: { in: [...NOT_INTERESTED_RESULTS] }, ...cf }, _count: { _all: true } }),
    prisma.reassignment.findMany({
      where: { reason: "timeout", ...cf },
      select: { fromUserId: true, toUserId: true, createdAt: true, lead: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  // تحويل نتيجة groupBy إلى Map<userId, count> حسب المفتاح.
  const toMap = (arr: { _count: { _all: number } }[], key: string) => {
    const m = new Map<string, number>();
    for (const r of arr) {
      const id = (r as Record<string, unknown>)[key];
      if (typeof id === "string") m.set(id, r._count._all);
    }
    return m;
  };
  const recv = toMap(received, "toUserId");
  const late = toMap(lateLost, "fromUserId");
  const fu = toMap(followupsByEmp, "createdBy");
  const vis = toMap(visitsByEmp, "createdBy");
  const bk = toMap(bookingsByEmp, "sellerId");
  const ni = toMap(notIntByEmp, "createdBy");

  const rows: ActivityRow[] = emps
    .map((e) => ({
      id: e.id,
      name: e.name,
      received: recv.get(e.id) ?? 0,
      lateLost: late.get(e.id) ?? 0,
      followups: fu.get(e.id) ?? 0,
      visits: vis.get(e.id) ?? 0,
      bookings: bk.get(e.id) ?? 0,
      notInterested: ni.get(e.id) ?? 0,
    }))
    .sort((a, b) => b.received - a.received || b.followups - a.followups);

  const reassigns: ReassignEvent[] = reassignRows.map((r) => ({
    leadName: r.lead.name,
    fromName: r.fromUserId ? nameOf.get(r.fromUserId) ?? "—" : "—",
    toName: r.toUserId ? nameOf.get(r.toUserId) ?? "—" : "—",
    at: r.createdAt,
  }));

  return { periodLabel: label, rows, reassigns };
}
