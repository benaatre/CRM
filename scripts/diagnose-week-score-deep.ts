/**
 * scripts/diagnose-week-score-deep.ts — تشخيص أعمق (قراءة فقط) لبنود الدرجة المشبوهة:
 *  ١) «مهتمون ×5»: هل هي انتقالات حقيقية لمهتم أم متابعات «بلا تغيير مرحلة» على عميل مهتم أصلًا؟
 *  ٢) «التغطية»: بسط ومقام غير متجانسين (بسط > مقام).
 *  ٣) «سرعة الاستجابة»: عملاء أُعيد إسنادهم ومعهم firstContactAt قديم → يُعدّون «ما رد عليهم» أبدًا.
 *
 * التشغيل: npx tsx --env-file=.env scripts/diagnose-week-score-deep.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const KSA = 3 * 3_600_000;
const KEEP_STAGE = ["NO_ANSWER_INTERESTED", "BANK_CHECK", "ON_HOLD"];

function weekStartKSA(ref: Date): Date {
  const k = new Date(ref.getTime() + KSA);
  return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() - k.getUTCDay(), 0, 0, 0) - KSA);
}

async function main() {
  const now = new Date();
  const weekStart = weekStartKSA(now);
  const weekEnd = new Date(weekStart.getTime() + 7 * 86_400_000);
  const emps = await prisma.user.findMany({ where: { role: "EMPLOYEE", active: true }, select: { id: true, name: true } });
  const nameById = new Map(emps.map((e) => [e.id, e.name]));

  // ===== ١) تفكيك «مهتمون ×5» =====
  const fus = await prisma.followUp.findMany({
    where: { createdAt: { gte: weekStart, lt: weekEnd }, stageAfter: "INTERESTED" },
    orderBy: { createdAt: "asc" },
    select: { id: true, createdBy: true, createdAt: true, leadId: true, result: true },
  });
  const leadIds = [...new Set(fus.map((f) => f.leadId))];
  // مرحلة العميل قبل الأسبوع = stageAfter لآخر متابعة قبل بداية الأسبوع (وإلا: بلا تاريخ).
  const priorFus = await prisma.followUp.findMany({
    where: { leadId: { in: leadIds }, createdAt: { lt: weekStart } },
    orderBy: { createdAt: "desc" },
    select: { leadId: true, stageAfter: true, createdAt: true },
  });
  const priorStage = new Map<string, string | null>();
  for (const f of priorFus) if (!priorStage.has(f.leadId)) priorStage.set(f.leadId, f.stageAfter);

  console.log("=".repeat(96));
  console.log("١) بند «مهتمون ×٥» — هل هو انتقال حقيقي؟");
  console.log("=".repeat(96));
  type Bucket = { real: Set<string>; keepStage: Set<string>; alreadyInterested: Set<string>; total: Set<string> };
  const byEmp = new Map<string, Bucket>();
  for (const f of fus) {
    let b = byEmp.get(f.createdBy);
    if (!b) { b = { real: new Set(), keepStage: new Set(), alreadyInterested: new Set(), total: new Set() }; byEmp.set(f.createdBy, b); }
    b.total.add(f.leadId);
    const was = priorStage.get(f.leadId) ?? null;
    if (KEEP_STAGE.includes(f.result)) b.keepStage.add(f.leadId);
    else if (was === "INTERESTED") b.alreadyInterested.add(f.leadId);
    else b.real.add(f.leadId);
  }
  console.log("الموظف           | يُحتسب | انتقال فعلي | «بلا تغيير مرحلة» | كان مهتمًا أصلًا | نقاط زائدة");
  console.log("-".repeat(96));
  for (const [id, b] of byEmp) {
    // الفريد يُحتسب مرة واحدة — نُصنّف العميل بأقوى تصنيف (انتقال فعلي يغلب).
    const real = b.real;
    const keep = new Set([...b.keepStage].filter((x) => !real.has(x)));
    const already = new Set([...b.alreadyInterested].filter((x) => !real.has(x) && !keep.has(x)));
    const inflated = keep.size + already.size;
    console.log(
      `${(nameById.get(id) ?? id).padEnd(16)} | ${String(b.total.size).padStart(6)} | ${String(real.size).padStart(11)} | ` +
      `${String(keep.size).padStart(17)} | ${String(already.size).padStart(16)} | ${String(inflated * 5).padStart(10)}`,
    );
  }

  // تفصيل نتائج الـstageAfter=INTERESTED
  const byResult = new Map<string, number>();
  for (const f of fus) byResult.set(f.result, (byResult.get(f.result) ?? 0) + 1);
  console.log("\nتفصيل النتائج التي كتبت stageAfter=INTERESTED هذا الأسبوع:");
  for (const [r, n] of [...byResult].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${r.padEnd(28)} ${String(n).padStart(4)}${KEEP_STAGE.includes(r) ? "   ← «بلا تغيير مرحلة»" : ""}`);
  }

  // ===== ٢) التغطية: بسط/مقام =====
  console.log("\n" + "=".repeat(96));
  console.log("٢) التغطية — تجانس البسط والمقام");
  console.log("=".repeat(96));
  const weekAll = await prisma.followUp.findMany({
    where: { createdAt: { gte: weekStart, lt: weekEnd } },
    select: { createdBy: true, leadId: true },
  });
  const allLeadIds = [...new Set(weekAll.map((f) => f.leadId))];
  const leadInfo = await prisma.lead.findMany({
    where: { id: { in: allLeadIds } },
    select: { id: true, assignedToId: true, isArchived: true, stage: true },
  });
  const info = new Map(leadInfo.map((l) => [l.id, l]));
  const denom = await prisma.lead.groupBy({
    by: ["assignedToId"],
    where: { assignedToId: { not: null }, isArchived: false, stage: { notIn: ["CLOSED_WON", "CLOSED_LOST"] } },
    _count: { _all: true },
  });
  const denomMap = new Map(denom.map((g) => [g.assignedToId as string, g._count._all]));
  console.log("الموظف           | البسط (كما يُحسب) | منهم مؤرشف/مقفول (خارج المقام) | المقام | التغطية");
  console.log("-".repeat(96));
  for (const e of emps) {
    const mine = new Set(weekAll.filter((f) => f.createdBy === e.id && info.get(f.leadId)?.assignedToId === e.id).map((f) => f.leadId));
    const outside = [...mine].filter((id) => {
      const l = info.get(id)!;
      return l.isArchived || l.stage === "CLOSED_WON" || l.stage === "CLOSED_LOST";
    }).length;
    const d = denomMap.get(e.id) ?? 0;
    if (mine.size === 0 && d === 0) continue;
    const pct = d > 0 ? Math.min(100, Math.round((mine.size / d) * 100)) : 0;
    console.log(`${e.name.padEnd(16)} | ${String(mine.size).padStart(17)} | ${String(outside).padStart(30)} | ${String(d).padStart(6)} | ${String(pct).padStart(6)}%${mine.size > d ? "  ❌ بسط > مقام" : ""}`);
  }

  // ===== ٣) سرعة الاستجابة =====
  console.log("\n" + "=".repeat(96));
  console.log("٣) سرعة الاستجابة — عملاء الأسبوع المُسنَدون وحالة firstContactAt");
  console.log("=".repeat(96));
  const wk = await prisma.lead.findMany({
    where: { assignedAt: { gte: weekStart, lt: weekEnd }, assignedToId: { not: null } },
    select: { id: true, assignedToId: true, assignedAt: true, firstContactAt: true, reassignCount: true },
  });
  const g = new Map<string, typeof wk>();
  for (const l of wk) { const a = g.get(l.assignedToId!); if (a) a.push(l); else g.set(l.assignedToId!, [l]); }
  console.log("الموظف           | مُسنَدون | ردّ عليهم | firstContactAt أقدم من الإسناد (يُعدّ إهمالًا للأبد) | بلا تواصل | متوسط ساعات");
  console.log("-".repeat(96));
  for (const [id, rows] of g) {
    const responded = rows.filter((l) => l.firstContactAt && l.firstContactAt >= l.assignedAt!);
    const stale = rows.filter((l) => l.firstContactAt && l.firstContactAt < l.assignedAt!).length;
    const none = rows.filter((l) => !l.firstContactAt).length;
    const avg = responded.length
      ? Math.round((responded.reduce((s, l) => s + (l.firstContactAt!.getTime() - l.assignedAt!.getTime()), 0) / responded.length / 3_600_000) * 10) / 10
      : null;
    console.log(`${(nameById.get(id) ?? id).padEnd(16)} | ${String(rows.length).padStart(7)} | ${String(responded.length).padStart(9)} | ${String(stale).padStart(52)} | ${String(none).padStart(9)} | ${String(avg ?? "—").padStart(11)}`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
