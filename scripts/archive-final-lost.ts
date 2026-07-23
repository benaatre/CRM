/**
 * نقل الموجودين للأرشيف — عملاء CLOSED_LOST سببهم «غير مهتم بالعقارات نهائيًا»
 * (NOT_INTERESTED_FINAL) أو «مسوّق» (NOT_INTERESTED_MARKETER) وغير مؤرشفين.
 *
 * ⚠️ الوضع الافتراضي dry-run: يطبع العدد والتوزيع حسب الموظف فقط — صفر كتابة.
 *    التنفيذ الفعلي (isArchived=true مع الإبقاء على assignedToId) بعلم --execute حصرًا.
 *
 * التشغيل:
 *   npx tsx scripts/archive-final-lost.ts             ← معاينة (dry-run)
 *   npx tsx scripts/archive-final-lost.ts --execute   ← تنفيذ فعلي
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const REASONS = ["NOT_INTERESTED_FINAL", "NOT_INTERESTED_MARKETER"] as const;

async function main() {
  const execute = process.argv.includes("--execute");

  const targets = await prisma.lead.findMany({
    where: {
      stage: "CLOSED_LOST",
      isArchived: false,
      followUps: { some: { result: { in: [...REASONS] } } },
    },
    select: {
      id: true,
      assignedTo: { select: { name: true } },
      followUps: {
        where: { result: { in: [...REASONS] } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { result: true },
      },
    },
  });

  // التوزيع حسب الموظف + حسب السبب.
  const byEmployee = new Map<string, number>();
  const byReason = new Map<string, number>();
  for (const l of targets) {
    const emp = l.assignedTo?.name ?? "(بلا موظف)";
    byEmployee.set(emp, (byEmployee.get(emp) ?? 0) + 1);
    const r = l.followUps[0]?.result ?? "?";
    byReason.set(r, (byReason.get(r) ?? 0) + 1);
  }

  console.log(`\n${execute ? "⚠️ تنفيذ فعلي" : "🔍 معاينة (dry-run)"} — مرشّحون للأرشفة: ${targets.length}\n`);
  console.log("حسب السبب:");
  for (const [r, n] of byReason) console.log(`  ${r === "NOT_INTERESTED_FINAL" ? "غير مهتم نهائيًا" : "مسوّق"}: ${n}`);
  console.log("\nحسب الموظف (يبقى الانتساب كما هو):");
  for (const [emp, n] of [...byEmployee.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${emp}: ${n}`);

  if (!execute) {
    console.log("\nما تغيّر شيء — للتنفيذ الفعلي أعد التشغيل بعلم --execute");
    return;
  }

  // التنفيذ: أرشفة فقط — assignedToId لا يُمسّ (نحتاج نعرف عملاء مين).
  const res = await prisma.lead.updateMany({
    where: { id: { in: targets.map((t) => t.id) } },
    data: { isArchived: true },
  });
  console.log(`\n✅ أُرشف ${res.count} عميل (الانتساب محفوظ).`);
}

main()
  .catch((e) => { console.error("FATAL:", e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
