import "server-only";

import { prisma } from "@/lib/prisma";

export type AppSettings = {
  companyName: string;
  falLicense: string | null;
  phone: string | null;
  autoAssign: boolean;
};

/** يرجّع إعدادات الشركة (سجل singleton) — ينشئه إن ما كان موجودًا. */
export async function getSettings(): Promise<AppSettings> {
  const s = await prisma.settings.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });
  return {
    companyName: s.companyName,
    falLicense: s.falLicense,
    phone: s.phone,
    autoAssign: s.autoAssign,
  };
}
