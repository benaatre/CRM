import type { NextAuthConfig } from "next-auth";

// إعداد متوافق مع الحافة (Edge) — يُستخدم في middleware.
// لا يستورد Prisma ولا bcrypt (محصورة في auth.ts على بيئة Node).
// مقارنة الأدوار بالنصوص لتفادي استيراد enum من @prisma/client داخل الحافة.
const MANAGER_ROLES = ["OWNER", "ADMIN"];

export const authConfig = {
  pages: {
    signIn: "/login",
  },
  // مدة الجلسة ٧ أيام (بدل افتراضي ٣٠ يومًا) — تقليص نافذة أي توكن مسرّب/قديم.
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60 },
  trustHost: true,
  providers: [], // يُضاف مزوّد PIN في auth.ts
  callbacks: {
    // حماية المسارات على الخادم + التوجيه حسب الدور.
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const role = auth?.user?.role;
      const { pathname } = nextUrl;

      // صفحة الدخول عامة — وإذا كان داخلًا، حوّله للوحة.
      if (pathname.startsWith("/login")) {
        if (isLoggedIn) {
          return Response.redirect(new URL("/dashboard", nextUrl));
        }
        return true;
      }

      // صفحة تعيين الـ PIN عبر رابط الدعوة — عامة (الرمز هو التحقق).
      if (pathname.startsWith("/reset-pin")) return true;

      // منطقة المدير فقط.
      if (pathname.startsWith("/admin")) {
        if (!isLoggedIn) return false; // → يُحوّل لصفحة الدخول
        if (!role || !MANAGER_ROLES.includes(role)) {
          return Response.redirect(new URL("/dashboard", nextUrl));
        }
        return true;
      }

      // بقية الصفحات المحميّة.
      if (!isLoggedIn) return false; // → يُحوّل لصفحة الدخول
      return true;
    },

    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.role = user.role;
        // وقت إنشاء هذه الجلسة — يُقارَن لاحقًا بـ sessionsValidFrom لإبطال الجلسات القديمة
        token.loginAt = Date.now();
      }
      return token;
    },

    session({ session, token }) {
      if (token && session.user) {
        session.user.id = (token.id ?? "") as string;
        if (token.role) {
          session.user.role = token.role as typeof session.user.role;
        }
        if (typeof token.loginAt === "number") {
          session.user.loginAt = token.loginAt;
        }
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
