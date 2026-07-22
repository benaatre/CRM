import type { Role } from "@prisma/client";
import type { DefaultSession } from "next-auth";

// توسيع أنواع Auth.js لإضافة id والدور (role) إلى الجلسة والـ JWT.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      /// وقت إنشاء الجلسة (ms) — لإبطال «الخروج من كل الأجهزة»
      loginAt?: number;
    } & DefaultSession["user"];
  }

  interface User {
    role?: Role;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: Role;
    /// وقت إنشاء الجلسة (ms) — يُقارَن بـ sessionsValidFrom للإبطال
    loginAt?: number;
  }
}
