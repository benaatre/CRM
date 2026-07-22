/**
 * scripts/verify-followup-counts.ts — تحقّق (قراءة فقط) أن نظام «لم يتم الرد» يعتمد متابعات «لم يرد»
 * فقط: العدّاد = متابعات النتيجة «لم يرد» حصريًا، والعميل يخرج فورًا لو آخر متابعة نتيجتها ليست «لم يرد».
 * يطبع لعشرة عملاء: إجمالي المتابعات · منها «لم يرد» · نتيجة آخر متابعة · مشمول؟ · السبب.
 *
 * التشغيل: npx tsx --env-file=.env scripts/verify-followup-counts.ts
 */
import { PrismaClient } from "@prisma/client";
import {
  getNoResponseConfig, noResponseBaseline, noResponseState, escalationCategory, CATEGORY_LABEL, noAnswerStats,
  NO_ANSWER_RESULTS,
} from "../src/lib/no-response-escalation";

const prisma = new PrismaClient();

async function main() {
  const now = new Date();
  const config = getNoResponseConfig();

  const pool = await prisma.lead.findMany({
    where: { assignedToId: { not: null }, isArchived: false, stage: { in: ["NEW", "ATTEMPTED"] }, manualAssignedAt: null, reassignCount: { lt: 3 } },
    select: { id: true, name: true, assignedAt: true },
  });
  if (pool.length === 0) { console.log("ما فيه عملاء في النطاق."); return; }
  const sample = [...pool].sort(() => Math.random() - 0.5).slice(0, 10);

  console.log(`نتائج «لم يرد» المعتمدة: ${NO_ANSWER_RESULTS.join(" · ")}`);
  console.log("=".repeat(116));
  console.log("العميل             | إجمالي | لم يرد | نتيجة آخر متابعة        | مشمول؟ | السبب / الفئة·الحالة·متأخر");
  console.log("-".repeat(116));

  for (const l of sample) {
    const fus = await prisma.followUp.findMany({ where: { leadId: l.id }, select: { result: true, createdAt: true } });
    const stats = noAnswerStats(fus.map((f) => ({ result: f.result, createdAt: f.createdAt })), l.assignedAt);
    const baseline = noResponseBaseline(l.assignedAt, stats.lastNoAnswerAt, config.activationDate);
    const { state, daysSince } = noResponseState(stats.noAnswerCount, baseline, now, config);
    const cat = escalationCategory(stats.noAnswerCount, config);

    const detail = stats.included
      ? (fus.length === 0 ? "لا متابعات — يعتمد وقت الإسناد" : `${CATEGORY_LABEL[cat]} · ${state} · ${Math.floor(daysSince)}ي`)
      : `رد العميل (${stats.lastResult}) → خرج`;

    console.log(
      `${l.name.slice(0, 18).padEnd(18)} | ${String(fus.length).padStart(6)} | ${String(stats.noAnswerCount).padStart(6)} | ${(stats.lastResult ?? "—").slice(0, 22).padEnd(22)} | ${stats.included ? "نعم ✅" : "لا ❌"}  | ${detail}`,
    );
  }
  console.log("=".repeat(116));
  console.log("القاعدة: العدّاد = متابعات «لم يرد» فقط · آخر متابعة نتيجتها غير «لم يرد» ⟵ يخرج من النظام والعدّادات.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
