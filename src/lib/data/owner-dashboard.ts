import "server-only";

import { FollowUpType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser, isManager } from "@/lib/auth-guards";
import { duplicateLeadIds } from "@/lib/phone-dupe";
import { dayStartKSA, weekStartKSA, KSA_OFFSET_MS, DAY_MS, parseRiyadhLocal } from "@/lib/ksa-time";

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

export type OwnerPeriod = "today" | "yesterday" | "week" | "month" | "custom";

export const ownerPeriodLabels: Record<OwnerPeriod, string> = {
  today: "اليوم",
  yesterday: "أمس",
  week: "أسبوع",
  month: "شهر",
  custom: "من ← إلى",
};

export function normalizeOwnerPeriod(p: string | undefined): OwnerPeriod {
  return p && p in ownerPeriodLabels ? (p as OwnerPeriod) : "today";
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

export async function getOwnerKpis(p: OwnerPeriod, fromKey?: string, toKey?: string): Promise<OwnerKpis> {
  const user = await requireUser();
  if (!isManager(user.role)) throw new Error("لوحة المالك للمالك/المدير فقط");

  const range = resolveOwnerRange(p, fromKey, toKey);
  const dupIds = await duplicateLeadIds();
  const [cur, prev] = await Promise.all([
    windowCounts(range.gte, range.lt, dupIds),
    windowCounts(range.prevGte, range.prevLt, dupIds),
  ]);

  return {
    range,
    // «غير موزّعين» لحظة انتظار لا اتجاه — المرجع يعرض «ينتظرون» بلا دلتا.
    unassigned: { value: cur.unassigned, delta: null },
    totalClients: { value: cur.total, delta: cur.total - prev.total },
    conversion: { value: cur.conversion, delta: cur.conversion - prev.conversion },
    closedWon: { value: cur.closedWon, delta: cur.closedWon - prev.closedWon },
    visits: { value: cur.visits, delta: cur.visits - prev.visits },
    bookings: { value: cur.bookings, delta: cur.bookings - prev.bookings },
  };
}
