import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // مطلوب لـ Hostinger Node.js — يبني خادمًا مستقلًّا في .next/standalone
  output: "standalone",
  // جذر تتبّع الملفات = مجلد المشروع (يمنع التباس تعدّد lockfiles ويضمن
  // أن server.js يطلع في .next/standalone/server.js).
  outputFileTracingRoot: process.cwd(),
  // لا نضبط generateBuildId يدويًا: Next يولّد معرّفًا فريدًا لكل بناء تلقائيًا.
  // معرّف فريد لكل نشرة = مسار _next/static/<buildId>/ فريد ⇒ كاش immutable صحيح
  // ⇒ لا يخدم المتصفّح مانيفستًا قديمًا يشير إلى chunks محذوفة (سبب ChunkLoadError).
  // تجنّبنا قيمة ثابتة ("stable") لأنها تكسر خاصية الـimmutable، وتجنّبنا الاعتماد على
  // SOURCE_COMMIT/git وقت البناء لأنهما غير مضمونَين في بيئة Hostinger.
};

export default nextConfig;
