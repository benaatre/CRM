// فحص هوية قاعدة البيانات المستهدفة — يطبع «المضيف فقط» من DATABASE_URL
// الحالي (البيئة ثم .env) دون كشف أي سر. الغرض: قفل التباس القواعد الذي
// ضلّل قياس صباح 2026-08-25 (قياس أرقام «إنتاج» على قاعدة التطوير).
//
//   node scripts/check-db-target.mjs
//
// أي قياس أرقام إنتاج يكون عبر السيرفر — أو بعد التأكد هنا أن المضيف إنتاج.
import { readFileSync } from "fs";

/** الوسوم المعروفة — مضيف جديد يظهر «غير معروف» حتى يُسجَّل هنا. */
const KNOWN = [
  { prefix: "ep-flat-dew", label: "🧪 تطوير (dev)" },
  { prefix: "ep-spring-cherry", label: "🚨 إنتاج (production)" },
];

let url = process.env.DATABASE_URL ?? null;
let source = "process.env";
if (!url) {
  try {
    for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*DATABASE_URL\s*=\s*(.*)\s*$/);
      if (m) {
        url = m[1].replace(/^["']|["']$/g, "");
        source = ".env";
      }
    }
  } catch {
    /* لا .env — الحكم أدناه */
  }
}

if (!url) {
  console.error("لا DATABASE_URL في البيئة ولا في .env");
  process.exit(1);
}

let host;
try {
  host = new URL(url).hostname;
} catch {
  // صيغة غير قياسية — استخراج يدوي للمضيف فقط، بلا لمس بيانات الاعتماد.
  host = url.match(/@([^/:?]+)/)?.[1] ?? null;
}
if (!host) {
  console.error("تعذّر استخراج المضيف من DATABASE_URL");
  process.exit(1);
}

const tag = KNOWN.find((k) => host.startsWith(k.prefix))?.label ?? "⚠️ غير معروف — سجّله في KNOWN";
console.log(`المضيف (${source}): ${host}`);
console.log(`الهوية: ${tag}`);
