// نسخ الأصول المطلوبة داخل خرج الـ standalone بعد البناء (postbuild).
// يكافئ: cp -r public .next/standalone/public
//        cp -r .next/static .next/standalone/.next/static
// لكن عابر للأنظمة (يعمل على Windows محليًا و Linux على Hostinger).
import { cpSync, existsSync, mkdirSync } from "node:fs";

const standalone = ".next/standalone";

if (!existsSync(standalone)) {
  console.error("✗ ما لقيت .next/standalone — تأكد أن next.config فيه output: 'standalone'.");
  process.exit(1);
}

// public (لو موجود)
if (existsSync("public")) {
  cpSync("public", `${standalone}/public`, { recursive: true });
  console.log("✓ نُسخ public → .next/standalone/public");
}

// .next/static (الأصول الثابتة المُولّدة)
if (existsSync(".next/static")) {
  mkdirSync(`${standalone}/.next`, { recursive: true });
  cpSync(".next/static", `${standalone}/.next/static`, { recursive: true });
  console.log("✓ نُسخ .next/static → .next/standalone/.next/static");
}

console.log("postbuild: جاهز للتشغيل بـ node .next/standalone/server.js");
