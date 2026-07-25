// سكربت التراجع عن حادثة استيراد الشيت (2026-07-25) — حذف آمن للدفعة الغلط.
//
// المعيار (حصري — الشروط كلها معًا):
//   ١) له سجل تدقيق lead.arrivedFromSheet بتاريخ اليوم (بتوقيت الرياض)
//   ٢) createdAt اليوم
//   ٣) صفر متابعات
//   ٤) غير مُسند لأي موظف
//   ٥) صفر حجوزات
// أي عميل لُمس بين الحصر والتنفيذ يسقط من المعيار تلقائيًا (الشروط تُعاد داخل الحذف نفسه).
//
// التشغيل:
//   npx tsx scripts/rollback-sheet-import.ts             ← dry-run (افتراضي): عدّ + عينة أسماء، صفر كتابة
//   npx tsx scripts/rollback-sheet-import.ts --execute   ← الحذف الفعلي (deleteMany) + سجل تدقيق واحد ملخّص
//
// الحذف فعلي لا أرشفة — بيانات غلط مو عملاء حقيقيين. المتابعات/النشاطات تُحذف بالتتالي (onDelete: Cascade).

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// بداية يوم الحادثة بتوقيت الرياض — ثابت مقصود (لا اليوم الجاري) حتى لو شُغّل السكربت لاحقًا.
const DAY_START = new Date("2026-07-25T00:00:00+03:00");

async function main() {
  const execute = process.argv.includes("--execute");

  // ١) معرّفات العملاء الذين أدخلتهم المزامنة اليوم — من سجل التدقيق (مصدر الحقيقة).
  const auditRows = await prisma.auditLog.findMany({
    where: { action: "lead.arrivedFromSheet", createdAt: { gte: DAY_START } },
    select: { entityId: true },
  });
  const arrivedIds = [...new Set(auditRows.map((r) => r.entityId).filter((x): x is string => !!x))];
  console.log(`سجلات lead.arrivedFromSheet اليوم: ${auditRows.length} (معرّفات فريدة: ${arrivedIds.length})`);
  if (arrivedIds.length === 0) {
    console.log("ما فيه شيء يُحذف.");
    return;
  }

  // ٢) المطابقون لكامل المعيار الآن (اللمس بعد الدخول يُسقط العميل من الاستهداف).
  const targetWhere = {
    id: { in: arrivedIds },
    createdAt: { gte: DAY_START },
    assignedToId: null,
    followUps: { none: {} },
    bookings: { none: {} },
  } as const;

  const targets = await prisma.lead.findMany({
    where: targetWhere,
    select: { id: true, name: true, phone: true, source: true, stage: true },
    orderBy: { createdAt: "asc" },
  });

  const excluded = arrivedIds.length - targets.length;
  console.log(`\nالمستهدفون للحذف: ${targets.length}`);
  if (excluded > 0) console.log(`⚠️ مستثنون (لُمسوا بعد الدخول — إسناد/متابعة/حجز): ${excluded} — يُتركون كما هم`);
  const bySource = new Map<string, number>();
  for (const t of targets) bySource.set(t.source ?? "؟", (bySource.get(t.source ?? "؟") ?? 0) + 1);
  console.log("حسب المصدر:", [...bySource.entries()].map(([s, n]) => `${s}=${n}`).join(" · "));
  console.log("\nعينة (أول ١٥):");
  for (const t of targets.slice(0, 15)) console.log(`  - ${t.name} (${t.phone}) [${t.stage}]`);

  if (!execute) {
    console.log(`\n🔍 dry-run — ما انحذف شيء. للحذف الفعلي: npx tsx scripts/rollback-sheet-import.ts --execute`);
    return;
  }

  // ٣) الحذف الفعلي — نفس الشروط داخل deleteMany نفسه (من تغيّرت حالته بين العدّ والحذف ينجو).
  console.log(`\n⚠️ حذف فعلي لـ ${targets.length} عميل…`);
  const res = await prisma.lead.deleteMany({ where: targetWhere });
  await prisma.auditLog.create({
    data: {
      action: "lead.sheetImportRolledBack",
      entity: "lead",
      summary: `تراجع حادثة استيراد الشيت (2026-07-25): حُذف ${res.count} عميل أدخلتهم المزامنة خطأ (قراءة المستند كله بدل ورقة CRM) — المعيار: سجل arrivedFromSheet اليوم + صفر متابعات + غير مُسند + صفر حجوزات`,
    },
  });
  console.log(`✅ حُذف ${res.count} عميل + سجل تدقيق ملخّص واحد.`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
