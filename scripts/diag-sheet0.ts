// تشخيص أعمدة الحي/طريقة الشراء في Sheet0 — قراءة فقط، بدون حفظ.
import { readFileSync } from "node:fs";

async function main() {
  const env = readFileSync(".env.local", "utf8");
  const m = env.match(/^GOOGLE_SERVICE_ACCOUNT_KEY=(.*)$/m);
  if (m) process.env.GOOGLE_SERVICE_ACCOUNT_KEY = m[1].trim();

  const SHEET_ID = "1D8kx9THle1KDJVftcHWKfvrXPrKtUdDBVKCbpoGZbd0";
  const { readSheetValues } = await import("../src/lib/google-sheets");
  const { cleanValue } = await import("../src/lib/utils/sheet-parse");

  const values = await readSheetValues(SHEET_ID, { gid: 2066983452 });
  const header = values[0] ?? [];
  console.log("عدد الأعمدة:", header.length, "| صفوف بيانات:", values.length - 1);
  console.log("عناوين S..X (18..23):", JSON.stringify([18, 19, 20, 21, 22, 23].map((i) => header[i] ?? "")));

  console.log("\n=== خام T/U/V/W (19..22) لأول 18 صف — قبل التنظيف ===");
  for (let r = 1; r <= 18 && r < values.length; r++) {
    const row = values[r] ?? [];
    const raw = (i: number) => JSON.stringify(row[i] ?? "");
    console.log(`صف ${r + 1}: T=${raw(19)} U=${raw(20)} V=${raw(21)} W=${raw(22)}`);
  }

  // كل قيم الأحياء/طريقة الشراء الفريدة في الأعمدة 19..23 (بعد التنظيف)
  console.log("\n=== كل القيم الفريدة في الأعمدة 19..23 (بعد التنظيف) ===");
  const uniq = new Map<string, number>();
  for (let r = 1; r < values.length; r++) {
    const row = values[r] ?? [];
    for (let c = 19; c <= 23; c++) {
      const v = cleanValue(row[c] ?? "");
      if (v) uniq.set(v, (uniq.get(v) ?? 0) + 1);
    }
  }
  const sorted = [...uniq.entries()].sort((a, b) => b[1] - a[1]);
  console.log("عدد القيم الفريدة:", sorted.length);
  for (const [v, n] of sorted.slice(0, 60)) console.log(`  (${n})  "${v}"`);

  // مقارنة: القيمة الخام في U/V مقابل تصنيف classifyRow
  const { classifyRow, classifyCell } = await import("../src/lib/utils/sheet-parse");
  console.log("\n=== فحص سقوط الأحياء في أول 55 صف ===");
  let dropped = 0; const dropRows: number[] = [];
  for (let r = 1; r <= 55 && r < values.length; r++) {
    const row = values[r] ?? [];
    const cells = row.map((x) => cleanValue(x)).filter(Boolean);
    const rawHasDistrict = cells.some((x) => /(^|\s)حي(\s|$)/.test(x.replace(/[أإآ]/g, "ا")));
    const res = classifyRow(row, r + 1);
    if (rawHasDistrict && !res.district) { dropped++; dropRows.push(r + 1); }
  }
  console.log(`أحياء سقطت في أول 55 صف: ${dropped}`, dropRows.length ? `(صفوف: ${dropRows.join(", ")})` : "");

  console.log("\n=== معاينة كاملة بعد الإصلاحات (أول 20 صف) ===");
  for (let r = 1; r <= 20 && r < values.length; r++) {
    const row = values[r] ?? [];
    const res = classifyRow(row, r + 1);
    console.log(`صف ${r + 1}: اسم="${res.name}" | جوال=${res.phone} | طريقة=${res.purchaseMethod ?? "—"} | حي=${res.district ?? "—"} | هدف=${res.purchaseGoal ?? "—"} | valid=${res.valid}`);
  }
  // فحص تصنيف قيم مهمة
  console.log("\n=== تصنيف قيم مفردة ===");
  for (const t of ["حي المهدية", "الاثنين معاً", "الاستثمار", "للسكن", "تمويل بنكي", "كاش"]) {
    console.log(`  "${t}" → ${JSON.stringify(classifyCell(t))}`);
  }

  // صفوف فيها هدف فعلي — لإثبات التقاطه بعد الإصلاح
  console.log("\n=== صفوف فيها هدف (أول 10) ===");
  let shown = 0;
  const stat = { withGoal: 0, withDistrict: 0, withMethod: 0, total: 0 };
  for (let r = 1; r < values.length; r++) {
    const res = classifyRow(values[r] ?? [], r + 1);
    if (!res.valid) continue;
    stat.total++;
    if (res.purchaseGoal) stat.withGoal++;
    if (res.district) stat.withDistrict++;
    if (res.purchaseMethod) stat.withMethod++;
    if (res.purchaseGoal && shown < 10) {
      shown++;
      console.log(`صف ${r + 1}: اسم="${res.name}" | جوال=${res.phone} | طريقة=${res.purchaseMethod ?? "—"} | حي=${res.district ?? "—"} | هدف=${res.purchaseGoal}`);
    }
  }
  console.log(`\n=== إحصاء كل الصفوف الصالحة (${stat.total}) ===`);
  console.log(`  بطريقة شراء: ${stat.withMethod} | بحي: ${stat.withDistrict} | بهدف: ${stat.withGoal}`);
}

main();
