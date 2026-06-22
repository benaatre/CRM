import { PrismaClient, Prisma } from "@prisma/client";

// عميل Prisma كـ singleton — يمنع فتح اتصالات متعددة أثناء التطوير (HMR)
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// هل الخطأ «عابر» (تعذّر الوصول للخادم)؟ يحصل مع صحوة Neon البارد.
function isTransient(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientInitializationError) return true;
  const code = (e as { code?: string })?.code;
  if (code === "P1001" || code === "P1002" || code === "P1017") return true;
  const msg = (e as Error)?.message ?? "";
  return /can't reach database|connection.*(closed|refused|reset)|ECONNREFUSED|ETIMEDOUT/i.test(msg);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const base =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = base;
}

// إعادة محاولة تلقائية للأخطاء العابرة فقط (تعالج صحوة Neon — أول طلب بعد النوم).
// النوع المُصدَّر يبقى PrismaClient حتى يتوافق بقية الكود (cast آمن: نفس البنية وقت التشغيل).
export const prisma = base.$extends({
  query: {
    async $allOperations({ args, query }) {
      let lastErr: unknown;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          return await query(args);
        } catch (e) {
          lastErr = e;
          if (!isTransient(e) || attempt === 3) throw e;
          await sleep(700 * (attempt + 1)); // 0.7s → 1.4s → 2.1s
        }
      }
      throw lastErr;
    },
  },
}) as unknown as PrismaClient;
