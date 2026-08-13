/**
 * زرع حوكمة الدوام — المقر الرئيسي + إعدادات الدوام الافتراضية.
 *
 * idempotent بالكامل (upsert بمعرّفات ثابتة) ولا يمسّ أي بيانات أخرى:
 * لا Lead، ولا User، ولا Settings العامة. باقي المشاريع يضيفها المالك من
 * لوحة «حوكمة الدوام».
 *
 * التشغيل بعد تطبيق ترحيل 20260813120000_attendance_geofence:
 *   npx tsx scripts/seed-attendance.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const hq = await prisma.attendanceLocation.upsert({
    where: { id: "hq-benaat" },
    update: {},
    create: {
      id: "hq-benaat",
      name: "بنائات العقارية — المقر الرئيسي",
      type: "HQ",
      lat: 24.6293171869003,
      lng: 46.54915313836879,
      radiusMeters: 150,
      isActive: true,
    },
  });
  console.log(`  موقع: ${hq.name} (${hq.radiusMeters}م)`);

  const settings = await prisma.attendanceSettings.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });
  console.log(
    `  إعدادات الدوام: من ${settings.workStartMinutes} إلى ${settings.workEndMinutes} دقيقة، حد التأخير ${settings.lateThresholdMinutes} دقيقة`,
  );
}

main()
  .then(() => console.log("تم زرع حوكمة الدوام."))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
