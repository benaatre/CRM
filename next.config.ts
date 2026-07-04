import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // مطلوب لـ Hostinger Node.js — يبني خادمًا مستقلًّا في .next/standalone
  output: "standalone",
  // جذر تتبّع الملفات = مجلد المشروع (يمنع التباس تعدّد lockfiles ويضمن
  // أن server.js يطلع في .next/standalone/server.js).
  outputFileTracingRoot: process.cwd(),
  // معرّف بناء ثابت مربوط بالـcommit — يمنع ChunkLoadError بعد النشر (نفس الكود = نفس المعرّف).
  // Hostinger يوفّر SOURCE_COMMIT عند النشر من GitHub؛ وإلا "stable" (أفضل من timestamp متغيّر).
  generateBuildId: async () => process.env.SOURCE_COMMIT || process.env.GIT_SHA || "stable",
};

export default nextConfig;
