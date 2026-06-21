import {
  PrismaClient,
  Role,
  Channel,
  LeadStage,
  Priority,
  ProjectStatus,
  UnitType,
  UnitStatus,
  PaymentMethod,
  SaudiBank,
  Nationality,
  BookingStage,
  DeliveryStatus,
} from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const hash = (pin: string) => bcrypt.hashSync(pin, 10);

// المستخدمون التجريبيون (الرمز PIN بين قوسين).
const users = [
  { name: "سلطان — المالك", phone: "0500000001", role: Role.OWNER, pin: "1234", targetDeals: 0 },
  { name: "مدير المبيعات", phone: "0500000002", role: Role.ADMIN, pin: "0001", targetDeals: 0 },
  { name: "خالد العتيبي", phone: "0500000003", role: Role.EMPLOYEE, pin: "0002", targetDeals: 10 },
  { name: "نورة القحطاني", phone: "0500000004", role: Role.EMPLOYEE, pin: "0003", targetDeals: 8 },
  { name: "فهد الدوسري", phone: "0500000005", role: Role.EMPLOYEE, pin: "0004", targetDeals: 8 },
];

async function main() {
  console.log("⏳ تهيئة البيانات التجريبية…");

  // 1) المستخدمون (idempotent عبر phone)
  const created: Record<string, string> = {};
  for (const u of users) {
    const row = await prisma.user.upsert({
      where: { phone: u.phone },
      update: {
        name: u.name,
        role: u.role,
        pinHash: hash(u.pin),
        targetDeals: u.targetDeals,
        active: true,
      },
      create: {
        name: u.name,
        phone: u.phone,
        role: u.role,
        pinHash: hash(u.pin),
        targetDeals: u.targetDeals,
        active: true,
      },
    });
    created[u.phone] = row.id;
    console.log(`  ✅ ${u.name} (${u.role}) — PIN ${u.pin}`);
  }

  // 2) مشروع تجريبي + وحدات (idempotent عبر الاسم/الرقم)
  const project = await prisma.project.upsert({
    where: { id: "seed-project-79" },
    update: {},
    create: {
      id: "seed-project-79",
      name: "مشروع السلطان 79",
      district: "حي النرجس",
      status: ProjectStatus.AVAILABLE,
      priceMin: 690000,
      priceMax: 1250000,
      falLicense: "1200000000",
    },
  });

  const units = [
    { number: "A-101", type: UnitType.APARTMENT, floor: "1", area: 145, price: 720000, status: UnitStatus.AVAILABLE },
    { number: "A-102", type: UnitType.APARTMENT, floor: "1", area: 160, price: 790000, status: UnitStatus.RESERVED },
    { number: "G-001", type: UnitType.GROUND_FLOOR_APARTMENT, floor: "أرضي", area: 180, price: 850000, status: UnitStatus.AVAILABLE },
    { number: "P-501", type: UnitType.PENTHOUSE, floor: "5", area: 240, price: 1250000, status: UnitStatus.SOLD },
  ];
  for (const u of units) {
    await prisma.unit.upsert({
      where: { projectId_number: { projectId: project.id, number: u.number } },
      update: {},
      create: { ...u, projectId: project.id },
    });
  }

  // 3) عملاء تجريبيون موزّعون على الموظفين (فقط إذا ما فيه عملاء — لتفادي التكرار)
  const leadCount = await prisma.lead.count();
  if (leadCount === 0) {
    const khaled = created["0500000003"];
    const noura = created["0500000004"];
    const fahad = created["0500000005"];

    await prisma.lead.createMany({
      data: [
        { name: "عبدالله الشمري", phone: "0551111111", channel: Channel.WHATSAPP, stage: LeadStage.NEW, priority: Priority.HIGH, projectId: project.id, assignedToId: khaled },
        { name: "ريم الحربي", phone: "0552222222", channel: Channel.TIKTOK, stage: LeadStage.INTERESTED, priority: Priority.MEDIUM, projectId: project.id, assignedToId: khaled },
        { name: "ماجد السبيعي", phone: "0553333333", channel: Channel.META, stage: LeadStage.VIEWING, priority: Priority.HIGH, projectId: project.id, assignedToId: noura },
        { name: "سارة العنزي", phone: "0554444444", channel: Channel.AQAR, stage: LeadStage.NEGOTIATION, priority: Priority.HIGH, projectId: project.id, assignedToId: noura },
        { name: "تركي المطيري", phone: "0555555555", channel: Channel.REFERRAL, stage: LeadStage.ATTEMPTED, priority: Priority.LOW, projectId: project.id, assignedToId: fahad },
        { name: "هند الزهراني", phone: "0556666666", channel: Channel.VISIT, stage: LeadStage.CLOSED_WON, priority: Priority.MEDIUM, projectId: project.id, assignedToId: fahad },
      ],
    });
    console.log("  ✅ 6 عملاء تجريبيين موزّعين على الموظفين");
  } else {
    console.log(`  ℹ️ يوجد ${leadCount} عميل — تخطّيت إضافة عملاء تجريبيين`);
  }

  // 4) حجوزات تجريبية (فقط إذا ما فيه حجوزات)
  const bookingCount = await prisma.booking.count();
  if (bookingCount === 0) {
    const noura = created["0500000004"];
    const fahad = created["0500000005"];
    const findLead = (name: string) =>
      prisma.lead.findFirst({ where: { name }, select: { id: true, phone: true } });
    const findUnit = (number: string) =>
      prisma.unit.findFirst({ where: { projectId: project.id, number }, select: { id: true } });

    const [sara, hind, majed] = await Promise.all([
      findLead("سارة العنزي"),
      findLead("هند الزهراني"),
      findLead("ماجد السبيعي"),
    ]);
    const [uA102, uP501, uG001] = await Promise.all([
      findUnit("A-102"),
      findUnit("P-501"),
      findUnit("G-001"),
    ]);

    if (sara && uA102) {
      await prisma.booking.create({
        data: {
          leadId: sara.id, unitId: uA102.id, sellerId: noura,
          nationality: Nationality.SAUDI, nationalId: "1045678901", phone: sara.phone,
          paymentMethod: PaymentMethod.BANK_FINANCE, bankName: SaudiBank.RAJHI,
          deposit: 30000, price: 790000, discount: 20000, finalPrice: 770000,
          stage: BookingStage.VALUATION, deliveryStatus: DeliveryStatus.PENDING,
        },
      });
    }
    if (hind && uP501) {
      await prisma.booking.create({
        data: {
          leadId: hind.id, unitId: uP501.id, sellerId: fahad,
          nationality: Nationality.SAUDI, nationalId: "1098765432", phone: hind.phone,
          paymentMethod: PaymentMethod.CASH,
          deposit: 50000, price: 1250000, discount: 50000, finalPrice: 1200000,
          collected: 1200000, stage: BookingStage.SOLD, deliveryStatus: DeliveryStatus.DELIVERED,
        },
      });
    }
    if (majed && uG001) {
      await prisma.booking.create({
        data: {
          leadId: majed.id, unitId: uG001.id, sellerId: noura,
          nationality: Nationality.RESIDENT, nationalId: "2087654321", phone: majed.phone,
          paymentMethod: PaymentMethod.BANK_FINANCE, bankName: SaudiBank.ALINMA,
          deposit: 25000, price: 850000, discount: 0, finalPrice: 850000,
          stage: BookingStage.PAPERWORK, deliveryStatus: DeliveryStatus.PENDING,
          financeRejected: true,
        },
      });
      await prisma.unit.update({ where: { id: uG001.id }, data: { status: UnitStatus.RESERVED } });
    }
    console.log("  ✅ 3 حجوزات تجريبية (منها واحد رفض تمويل + واحد مباع)");
  } else {
    console.log(`  ℹ️ يوجد ${bookingCount} حجز — تخطّيت الحجوزات التجريبية`);
  }

  console.log("✅ خلصت البذرة.");
}

main()
  .catch((e) => {
    console.error("❌ فشلت البذرة:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
