"use server";

import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

/** تعيين رمز PIN جديد عبر رمز الدعوة (token) — عامّ، لا يتطلب جلسة. */
export async function setPinByToken(token: string, pin: string): Promise<{ ok: boolean; error?: string }> {
  if (!token) return { ok: false, error: "رابط غير صالح" };
  if (!/^\d{4,6}$/.test(pin)) return { ok: false, error: "الرمز لازم ٤–٦ أرقام" };
  const u = await prisma.user.findFirst({
    where: { pinResetToken: token, pinResetExp: { gt: new Date() } },
    select: { id: true },
  });
  if (!u) return { ok: false, error: "الرابط منتهي أو غير صالح — اطلب دعوة جديدة" };
  await prisma.user.update({
    where: { id: u.id },
    data: { pinHash: bcrypt.hashSync(pin, 10), pinResetToken: null, pinResetExp: null },
  });
  return { ok: true };
}
