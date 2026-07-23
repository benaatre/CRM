/**
 * تصحيح الموزَّعين من حوض «لم يتم الرد» بوضع «بمحتواه» (_full) قبل إصلاح تصفير المرحلة:
 * وُزّعوا وبقيت مرحلتهم ATTEMPTED فظهروا عند الموظف الجديد كمتعثرين قدامى.
 *
 * الاستهداف (الشروط الثلاثة معًا):
 *   - آخر Reassignment للعميل توزيعٌ من الحوض بلاحقة _full (reason يبدأ بـ manual_redistribute وينتهي بـ _full)
 *   - stage حاليًا ATTEMPTED
 *   - صفر متابعات بعد آخر assignedAt (الموظف الجديد ما لمسه بعد — لا نصفّر شغلًا فعليًا)
 *
 * ⚠️ dry-run افتراضي: يطبع العدد والأسماء والتوزيع حسب الموظف — صفر كتابة.
 *    التنفيذ الفعلي (stage=NEW فقط) بعلم --execute حصرًا.
 *
 * التشغيل:
 *   npx tsx scripts/reset-pool-distributed-stage.ts             ← معاينة
 *   npx tsx scripts/reset-pool-distributed-stage.ts --execute   ← تنفيذ
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const execute = process.argv.includes("--execute");

  const candidates = await prisma.lead.findMany({
    where: { stage: "ATTEMPTED", assignedToId: { not: null }, isArchived: false },
    select: {
      id: true,
      name: true,
      assignedAt: true,
      assignedTo: { select: { name: true } },
      // آخر تحويل بأي نوع — لو كان توزيع حوض _full فهو هدفنا.
      reassignments: { orderBy: { createdAt: "desc" }, take: 1, select: { reason: true, toUserId: true } },
      // آخر متابعة — لو بعد آخر إسناد فالموظف لمسه (نستثنيه).
      followUps: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
    },
  });

  const targets = candidates.filter((l) => {
    const last = l.reassignments[0];
    if (!last || last.toUserId === null) return false; // آخر حدث سحب لا توزيع
    if (!last.reason.startsWith("manual_redistribute") || !last.reason.endsWith("_full")) return false;
    const lastFu = l.followUps[0]?.createdAt ?? null;
    const touched = l.assignedAt != null && lastFu != null && lastFu > l.assignedAt;
    return !touched; // صفر متابعات بعد آخر إسناد
  });

  const byEmployee = new Map<string, { names: string[] }>();
  for (const l of targets) {
    const emp = l.assignedTo?.name ?? "(بلا موظف)";
    const g = byEmployee.get(emp) ?? { names: [] };
    g.names.push(l.name);
    byEmployee.set(emp, g);
  }

  console.log(`\n${execute ? "⚠️ تنفيذ فعلي" : "🔍 معاينة (dry-run)"} — مرشّحون لإرجاع «جديد»: ${targets.length}\n`);
  for (const [emp, g] of [...byEmployee.entries()].sort((a, b) => b[1].names.length - a[1].names.length)) {
    console.log(`${emp} (${g.names.length}):`);
    for (const n of g.names) console.log(`  · ${n}`);
  }

  if (!execute) {
    console.log("\nما تغيّر شيء — للتنفيذ الفعلي أعد التشغيل بعلم --execute");
    return;
  }

  const res = await prisma.lead.updateMany({
    where: { id: { in: targets.map((t) => t.id) } },
    data: { stage: "NEW" },
  });
  console.log(`\n✅ رجع ${res.count} عميل لمرحلة «جديد» (بلا مساس بأي شيء آخر).`);
}

main()
  .catch((e) => { console.error("FATAL:", e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
