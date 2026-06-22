import "server-only";

import { prisma } from "@/lib/prisma";

export type AppSettings = {
  companyName: string;
  falLicense: string | null;
  phone: string | null;
  autoAssign: boolean;
  googleSheetUrl: string | null;
  lastSyncAt: Date | null;
  notify: { followupBeforeHours: number; staleHours: number };
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
    googleSheetUrl: s.googleSheetUrl,
    lastSyncAt: s.lastSyncAt,
    notify: {
      followupBeforeHours: (s.notifyConfig as { followupBeforeHours?: number } | null)?.followupBeforeHours ?? 2,
      staleHours: (s.notifyConfig as { staleHours?: number } | null)?.staleHours ?? 48,
    },
  };
}
