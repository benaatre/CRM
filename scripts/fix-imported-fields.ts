// التصحيح المجمّع لحقول عملاء سناب الداخلين بالدفعات القديمة (2026-07-25):
//   ١) أسعار وهمية (2000/2026000 من نص حملة «شهر 6/2026 - 2») ← تصفير + ملاحظة تدقيق
//   ٢) هدف شراء غلط (لُقط من formName «استثمار – يونيو» / adSquadName «سكن او استثمار») ← من عمود الفورم الحقيقي
//   ٣) طريقة/حي — أي فرق عن إعادة الحساب بالمصنّف المصلح (استبعاد الأعمدة الإعلانية + قفل السعر)
//
// المنهج: لكل عميل سناب اليوم يُطابَق صفه بالجوال المطبّع (آخر ٩ أرقام) ويُعاد حساب حقوله
// من الشيت بالمصنّف الحالي — الشيت هو المرجع. من لا يُطابَق يُتخطى بتنبيه (لا تخمين).
//
// التشغيل:
//   npx tsx scripts/fix-imported-fields.ts             ← dry-run (افتراضي): (الحقل: قديم ← جديد) بلا كتابة
//   npx tsx scripts/fix-imported-fields.ts --execute   ← التطبيق + سجل تدقيق واحد ملخّص

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { PrismaClient } from "@prisma/client";
import { readSheetValues, resolveTabByGid } from "../src/lib/google-sheets";
import { extractGid } from "../src/lib/utils/sheet";
import { parseRowsByContent, type ParsedLead } from "../src/lib/utils/sheet-parse";
import { normalizePhone } from "../src/lib/value-normalize";

const prisma = new PrismaClient();
const PRICE_NOTE = "تصفير سعر وهمي (التُقط من نص إعلاني قبل قفل السعر) — الفورم بلا سؤال سعر";

async function main() {
  const execute = process.argv.includes("--execute");

  const link = await prisma.sheetLink.findFirst({
    where: { source: { name: { contains: "سناب" } } },
    select: { sheetId: true, sheetUrl: true, sourceId: true },
  });
  if (!link) throw new Error("ما فيه رابط شيت سناب");
  const tab = await resolveTabByGid(link.sheetId, extractGid(link.sheetUrl)!);
  const values = await readSheetValues(link.sheetId, { tab: tab.title });

  // إعادة الحساب بالمصنّف المصلح — ثم خريطة بالجوال.
  const parsed = parseRowsByContent(values);
  const hasPriceCol = parsed.columnRoles.some((r) => r.priceHeader);
  console.log(`الورقة «${tab.title}» (${parsed.totalDataRows} صفًا) · عمود سعر بالرأس: ${hasPriceCol ? "نعم" : "لا — أي سعر بالقاعدة وهمي"}`);
  // الجوال قد يتكرر بصفوف تاريخية (إرسال قديم وجديد) — الأحدث (الأخير بالورقة) هو المرجع.
  const byPhone9 = new Map<string, ParsedLead>();
  for (const l of parsed.leads) {
    if (/^05\d{8}$/.test(l.phone)) byPhone9.set(l.phone.slice(-9), l);
  }

  const KSA_MS = 3 * 3_600_000;
  const k = new Date(Date.now() + KSA_MS);
  const dayStart = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - KSA_MS);
  const leads = await prisma.lead.findMany({
    where: { sourceId: link.sourceId, createdAt: { gte: dayStart } },
    select: { id: true, name: true, phone: true, purchaseGoal: true, purchaseMethod: true, preferredAreas: true, priceMin: true, priceMax: true, notes: true },
    orderBy: { createdAt: "asc" },
  });

  type Change = { id: string; name: string; sets: Record<string, unknown>; diffs: string[]; addPriceNote: boolean };
  const plan: Change[] = [];
  let unmatched = 0;

  for (const l of leads) {
    const p9 = normalizePhone(l.phone).slice(-9);
    const sheet = p9.length === 9 ? byPhone9.get(p9) : undefined;
    if (!sheet) {
      if (l.priceMin != null || l.priceMax != null) {
        // بلا صف مطابق لكن سعره وهمي مؤكد (الورقة بلا عمود سعر) — يُصفَّر مع الملاحظة.
        plan.push({ id: l.id, name: l.name, sets: { priceMin: null, priceMax: null }, diffs: [`سعر: ${l.priceMin ?? "—"}/${l.priceMax ?? "—"} ← تصفير (بلا صف مطابق)`], addPriceNote: true });
      } else unmatched++;
      continue;
    }

    const sets: Record<string, unknown> = {};
    const diffs: string[] = [];
    let addPriceNote = false;

    // السعر: الورقة بلا عمود سعر ← المرجع دائمًا قيم المصنّف المصلح (null هنا).
    const wantMin = hasPriceCol ? sheet.priceMin : null;
    const wantMax = hasPriceCol ? sheet.priceMax : null;
    if ((l.priceMin ?? null) !== wantMin || (l.priceMax ?? null) !== wantMax) {
      sets.priceMin = wantMin; sets.priceMax = wantMax;
      diffs.push(`سعر: ${l.priceMin ?? "—"}/${l.priceMax ?? "—"} ← ${wantMin ?? "—"}/${wantMax ?? "—"}`);
      if (wantMin == null && wantMax == null) addPriceNote = true;
    }
    // الهدف — من عمود الفورم الحقيقي (بالمحتوى).
    if ((l.purchaseGoal ?? null) !== (sheet.purchaseGoal ?? null)) {
      sets.purchaseGoal = sheet.purchaseGoal;
      diffs.push(`هدف: ${l.purchaseGoal ?? "—"} ← ${sheet.purchaseGoal ?? "—"}`);
    }
    // الطريقة.
    if ((l.purchaseMethod ?? null) !== (sheet.purchaseMethod ?? null)) {
      sets.purchaseMethod = sheet.purchaseMethod;
      diffs.push(`طريقة: ${l.purchaseMethod ?? "—"} ← ${sheet.purchaseMethod ?? "—"}`);
    }
    // الحي: لو الشيت يحدد أحياء والقاعدة تخالفها.
    const dbAreas = (l.preferredAreas ?? []).filter((a) => a !== "أخرى").sort().join("|");
    const shAreas = sheet.areas.filter((a) => a !== "أخرى").sort().join("|");
    if (shAreas && dbAreas !== shAreas) {
      sets.preferredAreas = sheet.areas;
      diffs.push(`حي: «${dbAreas || "—"}» ← «${shAreas}»`);
    }

    if (diffs.length > 0) plan.push({ id: l.id, name: l.name, sets, diffs, addPriceNote });
  }

  console.log(`عملاء سناب اليوم: ${leads.length} · يحتاجون تصحيحًا: ${plan.length} · بلا مطابقة (سليمون): ${unmatched}\n`);
  for (const c of plan) console.log(`  «${c.name}» → ${c.diffs.join(" · ")}`);

  if (!execute) {
    console.log(`\n🔍 dry-run — ما انكتب شيء. للتنفيذ: npx tsx scripts/fix-imported-fields.ts --execute`);
    return;
  }

  console.log("\n⚠️ تطبيق فعلي…");
  for (const c of plan) {
    const lead = leads.find((l) => l.id === c.id)!;
    await prisma.lead.update({
      where: { id: c.id },
      data: {
        ...c.sets,
        ...(c.addPriceNote && !(lead.notes ?? "").includes(PRICE_NOTE)
          ? { notes: [lead.notes, PRICE_NOTE].filter(Boolean).join(" · ") }
          : {}),
      },
    });
  }
  await prisma.auditLog.create({
    data: {
      action: "lead.importedFieldsFixed",
      entity: "lead",
      summary: `تصحيح مجمّع لحقول عملاء سناب (${plan.length} عميلًا): تصفير أسعار وهمية + هدف/طريقة/حي من أعمدة الفورم الحقيقية (الشيت هو المرجع — المصنّف بعد استبعاد الأعمدة الإعلانية وقفل السعر)`,
    },
  });
  console.log(`✅ صُحّح ${plan.length} عميلًا + سجل تدقيق واحد.`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
