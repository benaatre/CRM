// نسخ الأصول داخل خرج الـ standalone بعد البناء (postbuild)، ثم إعادة تشغيل Passenger.
// على الخادم يُبنى التطبيق داخل مجلد التشغيل نفسه (public_html = PassengerAppRoot)، فلا نسخ مطلوب —
// يكفي لمس tmp/restart.txt. عابر للأنظمة: يتخطّى إعادة التشغيل تلقائيًا في التطوير المحلي (ويندوز).
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
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

// ===== ١ب) إشارة إعادة التشغيل داخل الحمولة نفسها (حادثة 2026-07-27) =====
// النشر يستبدل محتوى public_html بالكامل بحمولة الـstandalone، فأي شيء يكتبه هذا
// السكربت على المسار المطلق (الخطوة ٢) يُمحى قبل أن تراه Passenger — ولهذا بقي
// tmp/ مفقودًا وصارت إعادة التشغيل عرَضية: نشرة 14:08 ظلّت على القرص ٢٥ دقيقة
// والعملية القديمة تخدم كودًا قديمًا. الحل: نجعل tmp/restart.txt جزءًا من الحمولة،
// فينسخه النشر مع الكود لا قبله، بطابع زمني جديد كل بناء ⇒ Passenger ترى تغيّرًا
// حقيقيًا بعد اكتمال النشر فتعيد التشغيل حتمًا، ويبقى PassengerRestartDir صالحًا.
mkdirSync(`${standalone}/tmp`, { recursive: true });
writeFileSync(`${standalone}/tmp/restart.txt`, String(Date.now()));
console.log("✓ أُدرج tmp/restart.txt في الحمولة — إشارة إعادة تشغيل تصل مع الكود");

// ===== ٢) إعادة تشغيل Passenger (بلا نسخ — البناء يتمّ داخل مجلد التشغيل نفسه) =====
// مجلد تشغيل Passenger = PassengerAppRoot للدومين (public_html). على الخادم يُبنى التطبيق داخله
// مباشرة، فالبناء ينزل في .next هناك ولا حاجة لأي نسخ؛ يكفي لمس tmp/restart.txt (= PassengerRestartDir)
// لتُعيد Passenger تشغيل العملية. يمكن تجاوز المسار عبر HOSTINGER_APP_DIR.
const appDir = process.env.HOSTINGER_APP_DIR || "/home/u616466986/domains/crm.benaatre.com/public_html";

if (!existsSync(appDir)) {
  // تطوير محلي (ويندوز): مجلد تشغيل Passenger غير موجود — نتخطّى إعادة التشغيل بدون خطأ.
  console.log(`ℹ️  تشغيل محلي — مجلد تشغيل Passenger غير موجود (${appDir})، نتخطّى إعادة التشغيل.`);
} else {
  // تشغيل على الخادم: البناء نزل في .next داخل مجلد التشغيل. نكتفي بإشارة إعادة التشغيل لـ Passenger.
  const tmpDir = path.join(appDir, "tmp");
  mkdirSync(tmpDir, { recursive: true });
  const restartFile = path.join(tmpDir, "restart.txt");
  writeFileSync(restartFile, String(Date.now())); // إنشاء/تحديث الملف = إشارة restart لـ Passenger
  console.log(`✓ نشر على الخادم — لُمس ${restartFile}، Passenger سيعيد تشغيل التطبيق.`);
}

console.log("postbuild: تمّ ✅");
