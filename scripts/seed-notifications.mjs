// بذر إعدادات الإشعارات + النغمات المدمجة (idempotent) + تحقّق. لمرة واحدة محليًا.
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const BUILTIN = [
  { name: "تنبيه ناعم", fileUrl: "/sounds/soft.wav" },
  { name: "جرس", fileUrl: "/sounds/bell.wav" },
  { name: "نغمة نجاح", fileUrl: "/sounds/success.wav" },
  { name: "تنبيه عاجل", fileUrl: "/sounds/urgent.wav" },
  { name: "نقرة", fileUrl: "/sounds/click.wav" },
  { name: "دينق", fileUrl: "/sounds/ding.wav" },
];
const EVENTS = [
  { eventKey: "new_lead_from_sheet", audience: "MANAGERS" },
  { eventKey: "lead_assigned", audience: "ASSIGNED" },
  { eventKey: "lead_reassigned", audience: "MANAGERS_AND_ASSIGNED" },
  { eventKey: "employee_idle", audience: "MANAGERS" },
  { eventKey: "followup_due", audience: "ASSIGNED" },
  { eventKey: "employee_paused", audience: "MANAGERS" },
  { eventKey: "unit_booked_sold", audience: "ALL" },
];

if ((await prisma.soundAsset.count({ where: { isBuiltIn: true } })) === 0) {
  await prisma.soundAsset.createMany({ data: BUILTIN.map((s) => ({ ...s, isBuiltIn: true })), skipDuplicates: true });
}
if ((await prisma.notificationSetting.count()) === 0) {
  const soft = await prisma.soundAsset.findFirst({ where: { fileUrl: "/sounds/soft.wav" }, select: { id: true } });
  await prisma.notificationSetting.createMany({ data: EVENTS.map((e) => ({ ...e, soundId: soft?.id ?? null })), skipDuplicates: true });
}

const sounds = await prisma.soundAsset.count();
const events = await prisma.notificationSetting.count();
const rows = await prisma.notificationSetting.findMany({ select: { eventKey: true, audience: true } });
console.log(`SoundAssets: ${sounds} | NotificationSettings: ${events}`);
console.log(rows.map((r) => `  ${r.eventKey} → ${r.audience}`).join("\n"));
await prisma.$disconnect();
