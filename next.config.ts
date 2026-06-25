import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // مطلوب لـ Hostinger Node.js — يبني خادمًا مستقلًّا في .next/standalone
  output: "standalone",
  // جذر تتبّع الملفات = مجلد المشروع (يمنع التباس تعدّد lockfiles ويضمن
  // أن server.js يطلع في .next/standalone/server.js).
  outputFileTracingRoot: process.cwd(),
  // معرّف بناء متغيّر لكل نشر — يمنع خطأ Server Actions القديمة بعد التحديث.
  generateBuildId: async () => {
    return Date.now().toString();
  },
};

export default nextConfig;
