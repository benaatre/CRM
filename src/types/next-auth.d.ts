import type { Role } from "@prisma/client";
import type { DefaultSession } from "next-auth";

// توسيع أنواع Auth.js لإضافة id والدور (role) إلى الجلسة والـ JWT.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
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
  }
}
