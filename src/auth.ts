import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { authConfig } from "@/auth.config";

// مزوّد الدخول برمز PIN — يشتغل على بيئة Node (يستخدم Prisma + bcrypt).
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      id: "pin",
      name: "PIN",
      credentials: {
        userId: { label: "المستخدم", type: "text" },
        pin: { label: "الرمز", type: "password" },
      },
      async authorize(credentials) {
        const userId =
          typeof credentials?.userId === "string" ? credentials.userId : "";
        const pin = typeof credentials?.pin === "string" ? credentials.pin : "";
        if (!userId || !pin) return null;

        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user || !user.active || !user.pinHash) return null;

        const ok = await bcrypt.compare(pin, user.pinHash);
        if (!ok) return null;

        await prisma.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } });

        return {
          id: user.id,
          name: user.name,
          role: user.role,
        };
      },
    }),
  ],
});
