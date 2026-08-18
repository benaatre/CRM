// إكمال حمولة Next standalone بعد البناء (postbuild) لنشر Hostinger Node.
//
// نموذج Hostinger: البناء يُنتج .next/standalone، ثم النشر يُسطّح محتواه إلى public_html
// (PassengerAppRoot). فالمطلوب من postbuild شيئان فقط:
//   ١) إكمال الحمولة: next لا يُدرج public/ ولا .next/static داخل standalone تلقائيًا.
//   ٢) إشارة إعادة تشغيل *داخل الحمولة* (tmp/restart.txt) بطابع زمني جديد كل بناء —
//      فينسخها النشر مع الكود، وتصل Passenger بعد اكتمال النشر فتعيد التشغيل حتمًا.
//
// لا نكتب شيئًا على المسار المطلق لـ public_html أثناء البناء (حادثة 2026-08-18):
// تلك الكتابة تُمحى بالنشر (عديمة الأثر — بشهادة النسخة السابقة نفسها)، وتُنشئ
// public_html/tmp وتلمس مجلد التطبيق الحيّ أثناء نافذة بناء/فحص Hostinger، فتتعارض مع
// فحص «standalone output» ⇒ فشل متقطّع للبناء («no standalone output») ⇒ Hostinger
// يتخطّى النشر وتبقى الحمولة القديمة تخدم. الاعتماد كليًا على إشارة الحمولة (الخطوة ٢).
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";

const standalone = ".next/standalone";

if (!existsSync(standalone)) {
  console.error("✗ ما لقيت .next/standalone — تأكد أن next.config فيه output: 'standalone'.");
  process.exit(1);
}

// تحقّق صريح أن خادم standalone أُنتج فعلًا — يظهر بالسجل ويكشف مبكرًا أي «no standalone output».
if (!existsSync(`${standalone}/server.js`)) {
  console.error("✗ ما لقيت .next/standalone/server.js — البناء ما أنتج خادم standalone. أوقف قبل نشر حمولة ناقصة.");
  process.exit(1);
}
console.log("✓ خادم standalone موجود: .next/standalone/server.js");

// ===== ١) إكمال حمولة standalone (نسخ، لا نقل — نُبقي .next/static في مكانه الأصلي أيضًا) =====
if (existsSync("public")) {
  cpSync("public", `${standalone}/public`, { recursive: true });
  console.log("✓ نُسخ public → .next/standalone/public");
}
if (existsSync(".next/static")) {
  mkdirSync(`${standalone}/.next`, { recursive: true });
  cpSync(".next/static", `${standalone}/.next/static`, { recursive: true });
  console.log("✓ نُسخ .next/static → .next/standalone/.next/static");
}

// ===== ٢) إشارة إعادة التشغيل داخل الحمولة نفسها =====
// تُنسخ مع الكود عند النشر، بطابع زمني جديد كل بناء ⇒ Passenger ترى تغيّرًا بعد اكتمال
// النشر فتعيد التشغيل على الكود الجديد حتمًا. لا لمس لأي مسار مطلق خارج الحمولة.
mkdirSync(`${standalone}/tmp`, { recursive: true });
writeFileSync(`${standalone}/tmp/restart.txt`, String(Date.now()));
console.log("✓ أُدرج tmp/restart.txt في الحمولة — إشارة إعادة تشغيل تصل مع الكود بعد النشر");

console.log("postbuild: تمّ ✅");
