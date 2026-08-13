/**
 * زرع مواقع المشاريع العشرة — قائمة المالك النهائية (٢٠٢٦-٠٨-١٣).
 *
 * سكربت مستقل عن `seed-attendance.ts` (المقر + الإعدادات): ذاك يزرع أساس النظام،
 * وهذا يزرع المشاريع — فتشغيل أحدهما لا يمسّ الآخر.
 *
 * idempotent: upsert بمعرّفات ثابتة (`proj-*`) فلا يتكرر صف مهما أعدت التشغيل.
 * و`update: {}` مقصود — نفس نمط `hq-benaat`: لو عدّل المالك نصف قطر أو إحداثيات
 * من لوحة «حوكمة الدوام»، إعادة تشغيل السكربت **لا تدهس تعديله**. لتغيير موقع
 * قائم: عدّله من اللوحة، لا من هنا.
 *
 * لا يمسّ `hq-benaat` ولا أي جدول آخر.
 *
 * التشغيل: npx tsx scripts/seed-attendance-projects.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const projects = [
  { id: "proj-sr82",    name: "السلطان ريزيدنس 82",        lat: 24.633180,  lng: 46.583154,  radiusMeters: 400 },
  { id: "proj-sr79",    name: "السلطان ريزيدنس 79",        lat: 24.609628,  lng: 46.514778,  radiusMeters: 150 },
  { id: "proj-sr76",    name: "السلطان ريزيدنس 76",        lat: 24.609125,  lng: 46.504542,  radiusMeters: 150 },
  { id: "proj-sr72-80", name: "السلطان ريزيدنس 72 و 80",   lat: 24.617498,  lng: 46.508162,  radiusMeters: 300 },
  { id: "proj-sr77",    name: "السلطان ريزيدنس 77",        lat: 24.620735,  lng: 46.522926,  radiusMeters: 300 },
  { id: "proj-sr71",    name: "السلطان ريزيدنس 71",        lat: 24.612312,  lng: 46.512175,  radiusMeters: 150 },
  { id: "proj-sr73",    name: "السلطان ريزيدنس 73",        lat: 24.627401,  lng: 46.568893,  radiusMeters: 150 },
  { id: "proj-sr75",    name: "السلطان ريزيدنس 75",        lat: 24.610147,  lng: 46.507298,  radiusMeters: 150 },
  { id: "proj-sr78",    name: "السلطان ريزيدنس 78",        lat: 24.665744,  lng: 46.518784,  radiusMeters: 150 },
  { id: "proj-sr81",    name: "السلطان ريزيدنس 81",        lat: 24.643193,  lng: 46.509619,  radiusMeters: 150 },
];

async function main() {
  console.log("زرع مواقع المشاريع…");

  for (const p of projects) {
    const row = await prisma.attendanceLocation.upsert({
      where: { id: p.id },
      update: {},
      create: { ...p, type: "PROJECT", isActive: true },
    });
    console.log(`  ${row.id} — ${row.name} (${row.radiusMeters}م)`);
  }

  const total = await prisma.attendanceLocation.count();
  console.log(`\nإجمالي مواقع الدوام الآن: ${total}`);
}

main()
  .then(() => console.log("تم."))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
