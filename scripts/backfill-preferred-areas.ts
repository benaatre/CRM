// نقل لمرّة واحدة: preferredDistrict (القديم الموقوف) → preferredAreas (المعتمد).
//
// الخلفية: الاستيراد اليدوي كان يكتب preferredDistrict نصًّا خامًا فقط بلا تطبيع، فبقي
// حيّ بعض العملاء في الحقل القديم وحده. بعد توحيد الحقل صار هؤلاء يظهرون «بلا حي».
//
// القواعد الصارمة:
//   • يُكتب preferredAreas فقط — ولا يُلمس أي حقل آخر إطلاقًا (ولا preferredDistrict نفسه).
//   • الشرط: preferredAreas فاضية تمامًا — من عنده أي قيمة لا يُلمس (الأحدث أولى).
//   • من لا يُطبَّع لحيٍّ معتمد (نتيجة «أخرى») يُترك ولا يُكتب له شيء — بلا تخمين.
//   • التطبيق داخل معاملة واحدة بقائمة معرّفات صريحة مُحتسبة في التجربة الجافة.
//
// التشغيل:
//   npx tsx scripts/backfill-preferred-areas.ts             ← تجربة جافة (افتراضي): جدول بلا كتابة
//   npx tsx scripts/backfill-preferred-areas.ts --execute   ← التنفيذ + سجل تدقيق واحد

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { writeFileSync, mkdirSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { normalizeAreas } from "../src/lib/utils/sheet-parse";
import { ALL_AREAS, shortAreaLabel } from "../src/lib/districts";

const prisma = new PrismaClient();

type Plan = { id: string; name: string; old: string; areas: string[] };

async function main() {
  const execute = process.argv.includes("--execute");

  // المرشّحون: عندهم قيمة قديمة. فحص «فاضية تمامًا» يتم في JS لا في SQL —
  // عمود المصفوفة بلا default، فالصفوف القديمة فيها NULL لا '{}'، وفلتر isEmpty
  // في postgres لا يلتقط NULL إطلاقًا (بينما Prisma تُرجعها [] عند القراءة).
  const rows = await prisma.lead.findMany({
    where: { preferredDistrict: { not: null } },
    select: { id: true, name: true, preferredDistrict: true, preferredAreas: true },
    orderBy: { createdAt: "asc" },
  });
  const candidates = rows.filter((l) => l.preferredAreas.length === 0);

  const plan: Plan[] = [];
  const skipped: { name: string; old: string }[] = [];
  for (const l of candidates) {
    const old = l.preferredDistrict!;
    // «أخرى» ليست حيًّا معتمدًا — تُستبعد فلا يُكتب لصاحبها شيء.
    const areas = normalizeAreas(old).areas.filter((a) => ALL_AREAS.includes(a));
    if (areas.length === 0) { skipped.push({ name: l.name, old }); continue; }
    plan.push({ id: l.id, name: l.name, old, areas });
  }

  const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - [...s].length));
  console.log(`عندهم preferredDistrict: ${rows.length} · منهم preferredAreas فاضية: ${candidates.length}`);
  console.log(`سيُنقلون: ${plan.length} · يُتركون (ما طُبّعوا لحيٍّ معتمد): ${skipped.length}\n`);
  console.log(`${pad("اسم العميل", 26)}${pad("القيمة القديمة", 28)}ما سيُكتب`);
  console.log("─".repeat(90));
  for (const p of plan) {
    console.log(`${pad(p.name, 26)}${pad(`«${p.old}»`, 28)}${p.areas.map(shortAreaLabel).join(" · ")}`);
  }
  if (skipped.length > 0) {
    console.log("\nمتروكون بلا كتابة:");
    for (const s of skipped) console.log(`  ${pad(s.name, 26)}«${s.old}»`);
  }

  if (!execute) {
    console.log(`\n🔍 تجربة جافة — ما انكتب شيء. للتنفيذ: npx tsx scripts/backfill-preferred-areas.ts --execute`);
    return;
  }
  if (plan.length === 0) { console.log("\nما فيه ما يُنقل."); return; }

  // لقطة قبلية للتراجع اليدوي — قبل أي كتابة. (scripts/out مُستثنى من git.)
  const snapshot = plan.map((p) => {
    const row = rows.find((r) => r.id === p.id)!;
    return { id: row.id, name: row.name, preferredAreas: row.preferredAreas, preferredDistrict: row.preferredDistrict };
  });
  mkdirSync("scripts/out", { recursive: true });
  const snapPath = `scripts/out/backfill-preferred-areas-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(snapPath, JSON.stringify(snapshot, null, 2), "utf8");
  console.log(`\n📸 لقطة قبلية (${snapshot.length} صفًا): ${snapPath}`);

  console.log("\n⚠️ تطبيق فعلي داخل معاملة…");
  const ids = plan.map((p) => p.id); // قائمة معرّفات صريحة — لا شرط عام عند الكتابة
  const written = await prisma.$transaction(async (tx) => {
    let n = 0;
    for (const p of plan) {
      // حارس داخل المعاملة: يُعاد فحص «فاضية» على المعرّف نفسه (لو عبّاه أحد بيننا لا يُلمس).
      // الفحص في JS لا في where — لأجل NULL مقابل '{}' الموضّح أعلاه.
      const cur = await tx.lead.findUnique({ where: { id: p.id }, select: { preferredAreas: true } });
      if (!cur || cur.preferredAreas.length > 0) continue;
      await tx.lead.update({ where: { id: p.id }, data: { preferredAreas: p.areas } });
      n++;
    }
    console.log(`عدد الصفوف المكتوبة قبل COMMIT: ${n} (من ${ids.length} معرّفًا)`);
    // أي فرق عن الخطة = حالة غير متوقّعة → ROLLBACK ووقوف، لا COMMIT جزئي.
    if (n !== ids.length) throw new Error(`⛔ وقوف: العدد ${n} ≠ الخطة ${ids.length} — تراجعت المعاملة، ما انكتب شيء.`);
    await tx.auditLog.create({
      data: {
        action: "lead.preferredAreasBackfilled",
        entity: "lead",
        summary: `نقل لمرّة واحدة: preferredDistrict → preferredAreas لـ${n} عميلًا (الحقل القديم موقوف الكتابة؛ لم يُمس أي حقل آخر)`,
      },
    });
    return n;
  });
  console.log(`✅ COMMIT — كُتب ${written} صفًا + سجل تدقيق واحد.`);

  // التحقق في JS لنفس سبب NULL أعلاه (count بفلتر isEmpty يعطي رقمًا مضلّلًا).
  const all = await prisma.lead.findMany({ select: { preferredAreas: true } });
  console.log(`التحقق: صار عند ${all.filter((l) => l.preferredAreas.length > 0).length} عميلًا قيمة في preferredAreas (من ${all.length}).`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
