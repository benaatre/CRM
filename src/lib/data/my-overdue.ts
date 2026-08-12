import "server-only";

import type { LeadStage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guards";
import { dayStartKSA, DAY_MS } from "@/lib/ksa-time";

/**
 * متأخرات الموظف — **قراءة فقط، محصورة بنطاقه وحده** (`assignedToId` من الجلسة،
 * لا يقبل معرّفًا خارجيًا). استثناء معلن ومعتمد: دالة جديدة بدل توسيع
 * `getDashboard.followupsToday` لأن تلك مشتركة مع لوحة المالك ورفع `take` فيها
 * كان سيغيّر شاشته — وعدّادات مبنية على ٨ صفوف محمّلة تكذب.
 *
 * «المتأخر» هنا = موعد متابعة حان قبل **بداية يوم الرياض** الحالي. متأخرات اليوم
 * نفسه تعيش في قسم «متابعات اليوم» بشارتها الحمراء — فلا فلتر «فات اليوم» هنا.
 */

export type OverdueBucket = "all" | "yesterday" | "week" | "month" | "older";

export const OVERDUE_BUCKETS: { key: OverdueBucket; label: string }[] = [
  { key: "all", label: "الكل" },
  { key: "yesterday", label: "فات أمس" },
  { key: "week", label: "خلال أسبوع" },
  { key: "month", label: "خلال شهر" },
  { key: "older", label: "أكثر من شهر" },
];

export const normalizeBucket = (v: string | undefined): OverdueBucket =>
  v === "yesterday" || v === "week" || v === "month" || v === "older" ? v : "all";

export type OverdueRow = {
  id: string;
  name: string;
  phone: string;
  stage: LeadStage;
  projectName: string | null;
  nextFollowup: Date;
  /** أيام التأخير بحدود يوم الرياض (١ = أمس). */
  daysLate: number;
};

export type MyOverdue = {
  bucket: OverdueBucket;
  /** عدّاد كل شريحة — على كل متأخرات الموظف لا على المعروض. */
  counts: Record<OverdueBucket, number>;
  /** صفوف الشريحة المختارة (الأقدم أولًا) — محدودة بـ`take`. */
  rows: OverdueRow[];
  /** إجمالي الشريحة المختارة (قد يفوق المعروض). */
  total: number;
};

const CLOSED: LeadStage[] = ["CLOSED_WON", "CLOSED_LOST"];

/** حدود الشريحة بالتواريخ (بيوم الرياض) — الحد الأعلى حصري دائمًا. */
function rangeOf(bucket: OverdueBucket, dayStart: number): { gte?: Date; lt: Date } {
  const d = (n: number) => new Date(dayStart - n * DAY_MS);
  if (bucket === "yesterday") return { gte: d(1), lt: d(0) };
  if (bucket === "week") return { gte: d(7), lt: d(1) };
  if (bucket === "month") return { gte: d(30), lt: d(7) };
  if (bucket === "older") return { lt: d(30) };
  return { lt: d(0) };
}

export async function getMyOverdue(bucket: OverdueBucket, take = 6): Promise<MyOverdue> {
  const user = await requireUser();
  const dayStart = dayStartKSA().getTime();

  // النطاق ثابت: عملاء هذا المستخدم فقط، غير مؤرشفين، ومراحلهم مفتوحة.
  const base = {
    assignedToId: user.id,
    isArchived: false,
    stage: { notIn: CLOSED },
  };

  const [allDates, rowsRaw] = await Promise.all([
    // العدّادات: إسقاط خفيف (عمود واحد) على كل متأخراته ثم تجميع بالذاكرة —
    // فرق الأيام تعبير محسوب لا يقبله groupBy في Prisma.
    prisma.lead.findMany({
      where: { ...base, nextFollowup: { lt: new Date(dayStart) } },
      select: { nextFollowup: true },
    }),
    prisma.lead.findMany({
      where: { ...base, nextFollowup: rangeOf(bucket, dayStart) },
      orderBy: { nextFollowup: "asc" }, // الأقدم أولًا
      take,
      select: {
        id: true, name: true, phone: true, stage: true, nextFollowup: true,
        project: { select: { name: true } },
      },
    }),
  ]);

  const daysLateOf = (at: Date) => Math.max(1, Math.round((dayStart - dayStartKSA(at).getTime()) / DAY_MS));

  const counts: Record<OverdueBucket, number> = { all: 0, yesterday: 0, week: 0, month: 0, older: 0 };
  for (const l of allDates) {
    if (!l.nextFollowup) continue;
    const n = daysLateOf(l.nextFollowup);
    counts.all++;
    if (n === 1) counts.yesterday++;
    else if (n <= 7) counts.week++;
    else if (n <= 30) counts.month++;
    else counts.older++;
  }

  return {
    bucket,
    counts,
    total: counts[bucket],
    rows: rowsRaw.map((l) => ({
      id: l.id,
      name: l.name,
      phone: l.phone,
      stage: l.stage,
      projectName: l.project?.name ?? null,
      nextFollowup: l.nextFollowup as Date,
      daysLate: daysLateOf(l.nextFollowup as Date),
    })),
  };
}
