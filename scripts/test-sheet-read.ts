// اختبار التعرّف التلقائي + توحيد الأرقام + معاينة الشيت الفعلي. للعرض فقط.
// التشغيل: npx tsx scripts/test-sheet-read.ts
import { readFileSync } from "node:fs";

const SHEET_ID = "1D8kx9THle1KDJVftcHWKfvrXPrKtUdDBVKCbpoGZbd0";

async function main() {
  const env = readFileSync(".env.local", "utf8");
  const m = env.match(/^GOOGLE_SERVICE_ACCOUNT_KEY=(.*)$/m);
  if (m) process.env.GOOGLE_SERVICE_ACCOUNT_KEY = m[1].trim();

  const { readSheetValues, listSheetTabs } = await import("../src/lib/google-sheets");
  const { parseRows, detectColumns, isSaudiMobile } = await import("../src/lib/utils/sheet-parse");
  const { normalizePhone } = await import("../src/lib/value-normalize");

  // ١) توحيد الأرقام بصيغ مختلفة → لازم كلها 05XXXXXXXX
  console.log("=== ١) توحيد الأرقام ===");
  for (const raw of ["0501234567", "501234567", "966501234567", "+966501234567", "00966501234567", "050 123 4567", "05-01-234-567"]) {
    console.log(`  "${raw}" → "${normalizePhone(raw)}"  (جوال صالح: ${isSaudiMobile(raw)})`);
  }

  // ٢) تفادي التكرار: صيغتان لنفس الرقم توحّدان لنفس القيمة
  console.log("=== ٢) تفادي التكرار ===");
  const a = normalizePhone("0501234567"), b = normalizePhone("966501234567");
  console.log(`  "0501234567" == "966501234567" ? ${a === b} (${a})`);

  // ٣) تعرّف تلقائي بالمحتوى على شيت وهمي بعناوين بلا معنى
  console.log("=== ٣) تعرّف تلقائي (عناوين بلا معنى) ===");
  const synth = [
    ["Column 1", "Column 2", "Column 3", "Column 4", "Column 5"],
    ["غلا علي", "0501234567", "كاش", "سكن", "حي النرجس"],
    ["Ahmed", "966502345678", "تمويل بنكي مدعوم", "استثمار", "حي الملقا"],
    ["فهد", "+966503456789", "{كاش:true}", "سكن", "الياسمين"],
    ["Sara", "0504-567-890", "تمويل بنكي غير مدعوم", "استثمار", "حي الورود"],
    ["نوره", "505678901", "كاش + تمويل بنكي", "سكن", "حي الربيع"],
  ];
  const det = detectColumns(synth[0], synth.slice(1));
  console.log("  الأعمدة المكتشفة:", JSON.stringify(det.cols));
  const parsed = parseRows(synth, { limit: 5 });
  for (const l of parsed.leads) {
    console.log(`  صف ${l.row}: ${l.name} | ${l.phone} | ${l.purchaseMethod} | ${l.purchaseGoal} | ${l.district} | valid=${l.valid}`);
  }

  // ٤) الشيت الفعلي: فحص كل التبويبات (عناوين + أعمدة مكتشفة + عيّنة)
  console.log("=== ٤) الشيت الفعلي — فحص كل التبويبات ===");
  try {
    const tabs = await listSheetTabs(SHEET_ID);
    for (const t of tabs) {
      console.log(`\n### تبويب "${t.title}" (gid=${t.gid}, صفوف=${t.rowCount})`);
      const values = await readSheetValues(SHEET_ID, { gid: t.gid });
      const { header, cols, leads, totalDataRows } = parseRows(values, { limit: 3 });
      console.log("  العناوين:", JSON.stringify(header));
      console.log("  الأعمدة المكتشفة:", JSON.stringify(cols), "| صفوف بيانات:", totalDataRows);
      for (const l of leads) {
        console.log(`  صف ${l.row}: اسم="${l.name}" | جوال=${l.phone} | طريقة=${l.purchaseMethod} | هدف=${l.purchaseGoal} | حي=${l.district}`);
      }
    }
  } catch (e) {
    console.error("  ✗ خطأ:", (e as Error).message);
  }
}

main();
