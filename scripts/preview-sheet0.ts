// معاينة فقط لتبويب Sheet0 بالتصنيف المحتوائي — بدون حفظ. npx tsx scripts/preview-sheet0.ts
import { readFileSync } from "node:fs";

const SHEET_ID = "1D8kx9THle1KDJVftcHWKfvrXPrKtUdDBVKCbpoGZbd0";
const GID = 2066983452; // Sheet0

async function main() {
  const env = readFileSync(".env.local", "utf8");
  const m = env.match(/^GOOGLE_SERVICE_ACCOUNT_KEY=(.*)$/m);
  if (m) process.env.GOOGLE_SERVICE_ACCOUNT_KEY = m[1].trim();

  const { readSheetValues } = await import("../src/lib/google-sheets");
  const { parseRowsByContent } = await import("../src/lib/utils/sheet-parse");

  const values = await readSheetValues(SHEET_ID, { gid: GID });
  const { leads, totalDataRows } = parseRowsByContent(values, { limit: 15 });

  console.log("إجمالي صفوف البيانات:", totalDataRows);
  console.log("--- أول ١٥ صف (تصنيف محتوائي، معاينة فقط) ---");
  console.log("صف | الاسم | الرقم | طريقة الشراء | الحي | الهدف | صالح");
  for (const l of leads) {
    console.log(`${l.row} | ${l.name} | ${l.phone} | ${l.purchaseMethod ?? "—"} | ${l.district ?? "—"} | ${l.purchaseGoal ?? "—"} | ${l.valid ? "✓" : "✗ " + l.skip}`);
  }
}

main();
