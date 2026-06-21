import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

// يستخدم الإعداد المتوافق مع الحافة فقط (بدون Prisma/bcrypt).
export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  // يطبّق الحماية على كل المسارات عدا الأصول الثابتة و API.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)"],
};
