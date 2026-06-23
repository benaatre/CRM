// تقرير سريع عن بيانات العملاء — للتشخيص. التشغيل: npx tsx prisma/stats.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const total = await prisma.lead.count();
  const byStage = await prisma.lead.groupBy({ by: ["stage"], _count: { _all: true } });
  const withGoal = await prisma.lead.count({ where: { purchaseGoal: { not: null } } });
  const withMethod = await prisma.lead.count({ where: { purchaseMethod: { not: null } } });
  const withFirstStage = await prisma.lead.count({ where: { firstContactStage: { not: null } } });
  const archived = await prisma.lead.count({ where: { isArchived: true } });
  const followUps = await prisma.followUp.count();
  const leadsWithFollowUps = (await prisma.followUp.findMany({ distinct: ["leadId"], select: { leadId: true } })).length;
  const bookings = await prisma.booking.count();

  console.log("================ تقرير بيانات العملاء ================");
  console.log(`إجمالي العملاء:            ${total}`);
  console.log(`منهم مؤرشف (محجوز/شراء):   ${archived}`);
  console.log("— العملاء حسب المرحلة —");
  for (const g of byStage.sort((a, b) => b._count._all - a._count._all)) {
    console.log(`   ${g.stage.padEnd(16)} ${g._count._all}`);
  }
  console.log("— اكتمال الحقول —");
  console.log(`   purchaseGoal:        ${withGoal}/${total}`);
  console.log(`   purchaseMethod:      ${withMethod}/${total}`);
  console.log(`   firstContactStage:   ${withFirstStage}/${total}`);
  console.log("— المتابعات —");
  console.log(`   سجلات FollowUp:      ${followUps}`);
  console.log(`   عملاء عندهم متابعات: ${leadsWithFollowUps}`);
  console.log(`   حجوزات:              ${bookings}`);
  console.log("======================================================");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
