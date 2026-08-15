/**
 * زرع دوام محدد افتراضي (٩:٠٠ صباحًا / ٨ ساعات) لكل مستخدم غير OWNER ما له
 * `AttendanceSchedule` بعد — upsert آمن يعاد تشغيله بلا أثر جانبي، ولا يلمس
 * دوامًا ضبطه المالك.
 *
 * التشغيل:
 *   npx tsx scripts/seed-attendance-v2.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_START_MINUTES = 540; // ٩:٠٠ صباحًا
const DEFAULT_SHIFT_MINUTES = 480; // ٨ ساعات

/** الجهات الثلاث الافتراضية للدفعة الثالثة — تُزرع مرة ولا تتكرر (مطابقة بالاسم). */
const DEFAULT_AUTHORIZERS = ["الإدارة", "الموارد البشرية", "محمد وجيه"];

async function seedAuthorizers() {
  const existing = await prisma.attendanceAuthorizer.findMany({ select: { label: true } });
  const have = new Set(existing.map((a) => a.label));
  let added = 0;
  for (let i = 0; i < DEFAULT_AUTHORIZERS.length; i++) {
    const label = DEFAULT_AUTHORIZERS[i];
    if (have.has(label)) continue;
    await prisma.attendanceAuthorizer.create({ data: { label, sortOrder: i } });
    added++;
  }
  console.log(`جهات الإذن: ${added} جديدة (${existing.length} كانت موجودة).\n`);
}

async function main() {
  await seedAuthorizers();

  const users = await prisma.user.findMany({
    where: { role: { not: "OWNER" } },
    select: { id: true, name: true, active: true },
    orderBy: { name: "asc" },
  });

  let created = 0;
  for (const u of users) {
    const res = await prisma.attendanceSchedule.upsert({
      where: { userId: u.id },
      update: {}, // موجود → لا نغيّر ما ضبطه المالك
      create: {
        userId: u.id,
        startMinutes: DEFAULT_START_MINUTES,
        shiftMinutes: DEFAULT_SHIFT_MINUTES,
      },
    });
    if (res.startMinutes === DEFAULT_START_MINUTES && res.shiftMinutes === DEFAULT_SHIFT_MINUTES) {
      created++;
    }
    console.log(`- ${u.name}${u.active ? "" : " (موقوف)"}: ${res.startMinutes / 60}:00 / ${res.shiftMinutes / 60} ساعات`);
  }

  console.log(`\nتم: ${users.length} مستخدم — دوام افتراضي أو قائم لكل واحد (منهم ${created} على الافتراضي).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
