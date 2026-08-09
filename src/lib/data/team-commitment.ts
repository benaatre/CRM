import "server-only";

import { prisma } from "@/lib/prisma";
import { ksaTodayStart } from "@/lib/auto-distribute";
import { DAY_MS } from "@/lib/ksa-time";

/**
 * «متابعات الموظفين» — التزام الموظف بمواعيده (اتصالات nextFollowup + زيارات visitAt معًا).
 * التعريفات المعتمدة (مراجعة 2026-08-09):
 * - أنجز = نشاطه المسجّل في النافذة (كل صفوف FollowUp ومنها «تم الزيارة» type=VISIT_*).
 * - فاته = عملاء (وحدة واحدة للعميل) لهم موعد مضى وقته في النافذة ولا نشاط بعد وقته.
 *   الزيارة المنجزة يستحيل أن تُحسب فوتًا: إتمامها يمسح visitAt ويُخرج العميل من VISIT_SCHEDULED.
 * - المواعيد المستقبلية لا تُحسب إطلاقًا (سقف النوافذ lt: الآن).
 */

export type FuWindow = "today" | "yesterday" | "all";

export const FU_WINDOWS: { key: FuWindow; label: string }[] = [
  { key: "today", label: "اليوم" },
  { key: "yesterday", label: "أمس" },
  { key: "all", label: "الإجمالي" },
];

export const normalizeFuWindow = (v: string | undefined): FuWindow =>
  v === "yesterday" || v === "all" ? v : "today";

export type CommitmentStats = { done: number; missed: number; lastAt: Date | null };

const CLOSED = ["CLOSED_WON", "CLOSED_LOST"] as const;

/** إحصاءات الالتزام لكل موظف — ٣ استعلامات مفهرسة (createdBy / nextFollowup / leadId). */
export async function getTeamCommitment(w: FuWindow, now: Date = new Date()): Promise<Map<string, CommitmentStats>> {
  const dayStart = ksaTodayStart(now);
  const yStart = new Date(dayStart.getTime() - DAY_MS);

  // نافذة الاستحقاق («فاته») — ماضٍ فقط، لا مواعيد مستقبلية أبدًا.
  const dueGte = w === "today" ? dayStart : w === "yesterday" ? yStart : null;
  const dueLt = w === "yesterday" ? dayStart : now;
  const winDue = dueGte ? { gte: dueGte, lt: dueLt } : { lt: dueLt };
  // نافذة النشاط («أنجز») — «الإجمالي» بلا حد.
  const winAct = w === "all" ? undefined
    : w === "today" ? { gte: dayStart, lt: now }
      : { gte: yStart, lt: dayStart };

  // ١) أنجز + آخر نشاط — groupBy واحد على فهرس createdBy.
  const doneByEmp = await prisma.followUp.groupBy({
    by: ["createdBy"],
    where: winAct ? { createdAt: winAct } : {},
    _count: { _all: true },
    _max: { createdAt: true },
  });

  // ٢) المستحق — موعد اتصال حان وقته، أو موعد زيارة معلّق حان وقته (بقاؤه في المرحلة = لم يُنفَّذ).
  const due = await prisma.lead.findMany({
    where: {
      isArchived: false,
      stage: { notIn: [...CLOSED] },
      assignedTo: { role: "EMPLOYEE", active: true },
      OR: [
        { nextFollowup: winDue },
        { stage: "VISIT_SCHEDULED", visitAt: winDue },
      ],
    },
    select: { id: true, assignedToId: true, nextFollowup: true, visitAt: true, stage: true },
  });

  // ٣) آخر متابعة لكل مستحق — groupBy واحد على فهرس leadId (لا N+1).
  const lastByLead = due.length
    ? await prisma.followUp.groupBy({
        by: ["leadId"],
        where: { leadId: { in: due.map((l) => l.id) } },
        _max: { createdAt: true },
      })
    : [];
  const lastMap = new Map(lastByLead.map((r) => [r.leadId, r._max.createdAt]));

  const stats = new Map<string, CommitmentStats>();
  const row = (id: string) => {
    const r = stats.get(id) ?? { done: 0, missed: 0, lastAt: null };
    stats.set(id, r);
    return r;
  };

  for (const g of doneByEmp) {
    const r = row(g.createdBy);
    r.done = g._count._all;
    r.lastAt = g._max.createdAt;
  }

  const inWin = (d: Date | null): d is Date =>
    !!d && d < dueLt && (!dueGte || d >= dueGte);
  for (const l of due) {
    if (!l.assignedToId) continue;
    // مواعيد العميل داخل النافذة (اتصال و/أو زيارة) — العميل وحدة واحدة مهما تعددت (لا ازدواج).
    const dues: Date[] = [
      ...(inWin(l.nextFollowup) ? [l.nextFollowup] : []),
      ...(l.stage === "VISIT_SCHEDULED" && inWin(l.visitAt) ? [l.visitAt] : []),
    ];
    const last = lastMap.get(l.id) ?? null;
    // فاته ⟺ يوجد موعد بلا نشاط بعد وقته (النشاط بعد الاستحقاق = وفاء ولو بلا موعد جديد).
    if (dues.some((d) => !last || last < d)) row(l.assignedToId).missed++;
  }

  return stats;
}
