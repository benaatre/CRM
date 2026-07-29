/**
 * تصحيح لمرة واحدة — دفعة 2026-07-29 المتضررة:
 * عملاء حُوّلوا «كجديد» (_fresh) لعبير الحربي اليوم قبل إصلاح «الولادة الكاملة»،
 * فبقيت عليهم آثار العهد القديم (firstContact* / nextFollowup / visitAt / الأرشفة).
 *
 * الشروط (كلها معًا):
 *   - آخر إسناد فعلي (toUserId != null) اليوم 2026-07-29 بتوقيت الرياض بسبب لاحقته _fresh
 *   - المستلم: عبير الحربي
 *   - المرحلة ما زالت NEW
 *   - لا متابعات جديدة بعد ذلك الإسناد (ما تحرّك عندها — التصفير آمن)
 *
 * ⚠️ dry-run افتراضيًا (يطبع القائمة فقط). التنفيذ: --execute ثم تأكيد تفاعلي بكتابة yes.
 *    المتابعات التاريخية لا تُمس أبدًا — التصفير على حقول Lead فقط (نفس FRESH_RESET_DATA).
 * التشغيل: npx tsx scripts/reset-fresh-transfers-2026-07-29.ts [--execute]
 */
import { PrismaClient } from "@prisma/client";
import * as readline from "node:readline/promises";

const prisma = new PrismaClient();
const EXECUTE = process.argv.includes("--execute");

// اليوم المستهدف بتوقيت الرياض (+03) — ثابت عمدًا: السكربت لدفعة هذا اليوم حصرًا.
const DAY_START = new Date("2026-07-29T00:00:00+03:00");
const DAY_END = new Date("2026-07-30T00:00:00+03:00");

const FRESH_RESET = {
  firstContactStage: null,
  firstContactDate: null,
  firstContactAt: null,
  nextFollowup: null,
  visitAt: null,
  isArchived: false,
} as const;

async function main() {
  const dbHost = (process.env.DATABASE_URL ?? "").match(/@([^/]+)\//)?.[1] ?? "غير معروف";
  console.log(`القاعدة المتصلة: ${dbHost}`);
  console.log(EXECUTE ? "⚠️ وضع التنفيذ (--execute)" : "وضع المعاينة (dry-run) — لا كتابة\n");

  const abeer = await prisma.user.findFirst({
    where: { name: { contains: "عبير" }, role: "EMPLOYEE" },
    select: { id: true, name: true },
  });
  if (!abeer) { console.error("⛔ ما لقيت موظفة باسم «عبير» — إيقاف."); process.exit(1); }
  console.log(`المستلمة: ${abeer.name} (${abeer.id})\n`);

  // مرشّحون أوليًا: مُسندون لعبير الآن وبمرحلة NEW وعندهم إسناد _fresh اليوم.
  const candidates = await prisma.lead.findMany({
    where: {
      assignedToId: abeer.id,
      stage: "NEW",
      reassignments: {
        some: {
          toUserId: abeer.id,
          reason: { endsWith: "_fresh" },
          createdAt: { gte: DAY_START, lt: DAY_END },
        },
      },
    },
    select: {
      id: true, name: true, phone: true, isArchived: true,
      firstContactStage: true, nextFollowup: true, visitAt: true, assignedAt: true,
      reassignments: { orderBy: { createdAt: "desc" }, where: { toUserId: { not: null } }, take: 1, select: { reason: true, createdAt: true } },
      followUps: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
    },
  });

  // الفلترة الدقيقة: آخر إسناد فعلي هو _fresh اليوم لعبير + لا متابعة بعده.
  const affected = candidates.filter((l) => {
    const lastAssign = l.reassignments[0];
    if (!lastAssign || !lastAssign.reason.endsWith("_fresh")) return false;
    if (lastAssign.createdAt < DAY_START || lastAssign.createdAt >= DAY_END) return false;
    const lastFu = l.followUps[0]?.createdAt ?? null;
    if (lastFu && lastFu > lastAssign.createdAt) return false; // تحرّكت عليه — لا نلمسه
    // متضرر فعلًا: عالق فيه أثر واحد على الأقل من العهد القديم.
    return l.firstContactStage !== null || l.nextFollowup !== null || l.visitAt !== null || l.isArchived;
  });

  console.log(`المرشّحون الأوليون: ${candidates.length} · المتأثرون فعلًا: ${affected.length}\n`);
  for (const l of affected) {
    const stuck = [
      l.firstContactStage ? `أول تواصل=${l.firstContactStage}` : null,
      l.nextFollowup ? "nextFollowup" : null,
      l.visitAt ? "visitAt" : null,
      l.isArchived ? "مؤرشف" : null,
    ].filter(Boolean).join("، ");
    console.log(`- ${l.name} (${l.phone}) — عالق: ${stuck} — إسناد: ${l.reassignments[0].reason}`);
  }

  if (affected.length === 0) { console.log("لا شيء يحتاج تصحيحًا. ✅"); return; }
  if (!EXECUTE) { console.log("\n(معاينة فقط — للتنفيذ أعد التشغيل بـ --execute)"); return; }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`\n⚠️ سيُصفَّر ${affected.length} عميلًا على «${dbHost}». اكتب yes للتأكيد: `);
  rl.close();
  if (answer.trim().toLowerCase() !== "yes") { console.log("أُلغي — لا كتابة."); return; }

  const res = await prisma.lead.updateMany({
    where: { id: { in: affected.map((l) => l.id) } },
    data: FRESH_RESET,
  });
  await prisma.auditLog.createMany({
    data: affected.map((l) => ({
      action: "lead.freshReset",
      entity: "lead",
      entityId: l.id,
      summary: `تصحيح دفعة 2026-07-29: تصفير آثار ما قبل التحويل «كجديد» · العميل=${l.id}`,
    })),
  });
  console.log(`\n✅ صُفّر ${res.count} عميلًا (والمتابعات التاريخية لم تُمس).`);
}

main().finally(() => prisma.$disconnect());
