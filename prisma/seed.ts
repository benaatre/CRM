import {
  PrismaClient,
  Role,
  Channel,
  LeadStage,
  Priority,
  ProjectStatus,
  UnitType,
  UnitStatus,
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
