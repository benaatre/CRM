// تصحيح أسماء عملاء سناب الداخلين باسم الحملة (خلل التقاط عمود الاسم — 2026-07-25).
//
// المعيار: عملاء اليوم (بتوقيت الرياض) من مصدر «سناب شات» الذين اسمهم نص حملة
// («اعلان/إعلان …»). يُطابَق كل عميل بصفه في الشيت عبر الجوال المطبّع (آخر ٩ أرقام)
// ويُصحَّح اسمه من عمودي الاسم الحقيقيين (رؤوس first/last — الاكتشاف الجديد).
// من لا يُطابَق (جوال فارغ/فوضوي): اسمه «عميل سناب — يحتاج مراجعة» + ملاحظة.
//
// التشغيل:
//   npx tsx scripts/fix-imported-names.ts             ← dry-run (افتراضي): (الحالي ← الصحيح) بلا كتابة
//   npx tsx scripts/fix-imported-names.ts --execute   ← التصحيح الفعلي + سجل تدقيق واحد ملخّص

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { PrismaClient } from "@prisma/client";
import { readSheetValues, resolveTabByGid } from "../src/lib/google-sheets";
import { extractGid } from "../src/lib/utils/sheet";
import { analyzeColumns } from "../src/lib/utils/sheet-parse";
import { normalizePhone } from "../src/lib/value-normalize";

const prisma = new PrismaClient();

/** اسم مركّب من أعمدة الاسم المكتشفة (رؤوس first/last) — نفس ما سيدخله المصنّف المصلح. */
function nameFromRow(row: string[], nameCols: number[]): string {
  return nameCols
    .map((c) => String(row[c] ?? "").trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  const execute = process.argv.includes("--execute");

  // ١) رابط شيت سناب من القاعدة (بالورقة المثبتة).
  const link = await prisma.sheetLink.findFirst({
    where: { source: { name: { contains: "سناب" } } },
    select: { sheetId: true, sheetUrl: true, sourceId: true, source: { select: { name: true } } },
  });
  if (!link) throw new Error("ما فيه رابط شيت لمصدر سناب في القاعدة");
  const gid = extractGid(link.sheetUrl);
  if (gid == null) throw new Error("رابط سناب بلا gid — ثبّت الورقة أولًا");

  // ٢) قراءة الورقة + اكتشاف عمودي الاسم بالمنطق المصلح (رؤوس name/first/last بعد الاستبعادات).
  const tab = await resolveTabByGid(link.sheetId, gid);
  const values = await readSheetValues(link.sheetId, { tab: tab.title });
  const header = (values[0] ?? []).map(String);
  const data = values.slice(1);
  const roles = analyzeColumns(header, data);
  const nameCols = roles.map((r, i) => (r.nameHeader ? i : -1)).filter((i) => i >= 0);
  const colLetter = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `#${i + 1}`);
  console.log(`الورقة: «${tab.title}» (${data.length} صفًا) · أعمدة الاسم المكتشفة: ${nameCols.map((c) => `${colLetter(c)} (${header[c]})`).join(" + ") || "لا شيء!"}`);
  if (nameCols.length === 0) throw new Error("ما اكتُشف عمود اسم بالرؤوس — راجع الورقة قبل التصحيح");

  // ٣) خريطة: آخر ٩ أرقام من الجوال المطبّع ← الاسم الصحيح من عمودي الاسم.
  const nameByPhone9 = new Map<string, string>();
  for (const row of data) {
    for (const cell of row) {
      const p = normalizePhone(String(cell ?? ""));
      if (/^05\d{8}$/.test(p)) {
        const proper = nameFromRow(row, nameCols);
        if (proper) nameByPhone9.set(p.slice(-9), proper);
        break;
      }
    }
  }
  console.log(`صفوف بجوال صالح واسم: ${nameByPhone9.size}\n`);

  // ٤) المستهدفون: عملاء اليوم (الرياض) من مصدر سناب باسم حملة («اعلان/إعلان …»).
  const KSA_MS = 3 * 3_600_000;
  const k = new Date(Date.now() + KSA_MS);
  const dayStart = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - KSA_MS);
  const targets = await prisma.lead.findMany({
    where: {
      sourceId: link.sourceId,
      createdAt: { gte: dayStart },
      OR: [{ name: { startsWith: "اعلان" } }, { name: { startsWith: "إعلان" } }],
    },
    select: { id: true, name: true, phone: true, notes: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(`المستهدفون (عملاء سناب اليوم باسم الحملة): ${targets.length}`);

  const FALLBACK = "عميل سناب — يحتاج مراجعة";
  const plan = targets.map((t) => {
    const key = normalizePhone(t.phone).slice(-9);
    const proper = key.length === 9 ? nameByPhone9.get(key) : undefined;
    return { id: t.id, phone: t.phone || "—", from: t.name, to: proper ?? FALLBACK, matched: !!proper, notes: t.notes };
  });

  for (const p of plan) {
    console.log(`  ${p.matched ? "✓" : "⚠"} [${p.phone}] «${p.from.slice(0, 40)}…» ← «${p.to}»`);
  }
  const matched = plan.filter((p) => p.matched).length;
  console.log(`\nالملخص: ${matched} يُصحَّح من الشيت · ${plan.length - matched} بلا مطابقة ← «${FALLBACK}» + ملاحظة`);

  if (!execute) {
    console.log("\n🔍 dry-run — ما انكتب شيء. للتنفيذ: npx tsx scripts/fix-imported-names.ts --execute");
    return;
  }

  // ٥) التنفيذ الفعلي.
  console.log("\n⚠️ تصحيح فعلي…");
  let fixed = 0, flagged = 0;
  for (const p of plan) {
    await prisma.lead.update({
      where: { id: p.id },
      data: {
        name: p.to,
        ...(p.matched
          ? {}
          : { notes: [p.notes, "الاسم الأصلي من الشيت ما انطابق (جوال فارغ/فوضوي) — راجع صفه يدويًا"].filter(Boolean).join(" · ") }),
      },
    });
    if (p.matched) fixed++; else flagged++;
  }
  await prisma.auditLog.create({
    data: {
      action: "lead.importedNamesFixed",
      entity: "lead",
      summary: `تصحيح خلل التقاط الاسم (اسم الحملة بدل العميل): صُحّح ${fixed} من الشيت (عمودا الاسم) + ${flagged} بلا مطابقة وُسموا «${FALLBACK}»`,
    },
  });
  console.log(`✅ صُحّح ${fixed} · وُسم للمراجعة ${flagged} + سجل تدقيق واحد.`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
