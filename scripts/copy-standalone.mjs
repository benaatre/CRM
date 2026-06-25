// نسخ الأصول داخل خرج الـ standalone بعد البناء (postbuild)،
// ثم نسخ البناء كاملاً إلى مجلد تشغيل Hostinger وعمل restart عبر Passenger.
// عابر للأنظمة: يتخطّى خطوة النشر تلقائيًا في التطوير المحلي (ويندوز).
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const standalone = ".next/standalone";

if (!existsSync(standalone)) {
  console.error("✗ ما لقيت .next/standalone — تأكد أن next.config فيه output: 'standalone'.");
  process.exit(1);
}

// ===== ١) نسخ الأصول داخل standalone =====
if (existsSync("public")) {
  cpSync("public", `${standalone}/public`, { recursive: true });
  console.log("✓ نُسخ public → .next/standalone/public");
}
if (existsSync(".next/static")) {
  mkdirSync(`${standalone}/.next`, { recursive: true });
  cpSync(".next/static", `${standalone}/.next/static`, { recursive: true });
  console.log("✓ نُسخ .next/static → .next/standalone/.next/static");
}

// ===== ٢) نسخ البناء كاملاً إلى مجلد تشغيل Hostinger + إعادة التشغيل =====
const appDir = process.env.HOSTINGER_APP_DIR || "/home/u616466986/nodejs";

if (!existsSync(appDir)) {
  // تطوير محلي: مجلد التشغيل غير موجود — نتخطّى النشر بدون خطأ.
  console.log(`ℹ️  مجلد التشغيل غير موجود (${appDir}) — تخطّي النسخ والـ restart (تطوير محلي).`);
} else if (path.resolve(appDir) === path.resolve(standalone)) {
  // البناء يتم داخل نفس مجلد التشغيل — لا حاجة للنسخ.
  console.log("ℹ️  مجلد التشغيل هو نفسه مجلد البناء — لا حاجة للنسخ.");
} else {
  console.log(`→ نشر البناء إلى مجلد التشغيل: ${appDir}`);

  // حذف نظيف: نمسح بناء .next القديم فقط (نُبقي node_modules و tmp).
  const appNext = path.join(appDir, ".next");
  if (existsSync(appNext)) {
    rmSync(appNext, { recursive: true, force: true });
    console.log("🧹 حُذف البناء القديم: .next في مجلد التشغيل");
  }

  // .next/standalone مكتفٍ ذاتيًا (server.js + .next/server + node_modules + public + static).
  // ننسخ محتواه كاملاً إلى مجلد التشغيل.
  cpSync(standalone, appDir, { recursive: true });
  console.log("✓ نُسخ البناء الكامل إلى مجلد التشغيل");

  // المس tmp/restart.txt لإجبار Passenger على إعادة تشغيل العملية.
  const tmpDir = path.join(appDir, "tmp");
  mkdirSync(tmpDir, { recursive: true });
  const restartFile = path.join(tmpDir, "restart.txt");
  writeFileSync(restartFile, String(Date.now())); // إنشاء/تحديث الملف = إشارة restart لـ Passenger
  console.log(`✓ تم لمس ${restartFile} — Passenger سيعيد تشغيل التطبيق`);
}

console.log("postbuild: تمّ ✅");
