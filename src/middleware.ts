import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

// يستخدم الإعداد المتوافق مع الحافة فقط (بدون Prisma/bcrypt).
export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  // يطبّق الحماية على كل المسارات عدا الأصول الثابتة و API.
  // نستثني ~offline (صفحة عدم الاتصال) — بلا امتداد فتحتاج استثناءً صريحًا.
  // sw.js و /icons/* و /manifest.webmanifest تُستثنى تلقائيًا عبر قاعدة الامتداد (\\.[\\w]+$).
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|~offline|.*\\.[\\w]+$).*)"],
};
