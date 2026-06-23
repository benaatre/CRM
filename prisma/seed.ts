import {
  PrismaClient,
  Role,
  Channel,
  LeadStage,
  Priority,
  ProjectStatus,
  UnitType,
  UnitStatus,
  PurchaseGoal,
  PurchaseMethod,
} from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const hash = (pin: string) => bcrypt.hashSync(pin, 10);

const users = [
  { name: "سلطان — المالك", phone: "0500000001", role: Role.OWNER, pin: "1234", targetDeals: 0 },
  { name: "مدير المبيعات", phone: "0500000002", role: Role.ADMIN, pin: "0001", targetDeals: 0 },
  { name: "خالد العتيبي", phone: "0500000003", role: Role.EMPLOYEE, pin: "0002", targetDeals: 10 },
  { name: "نورة القحطاني", phone: "0500000004", role: Role.EMPLOYEE, pin: "0003", targetDeals: 8 },
  { name: "فهد الدوسري", phone: "0500000005", role: Role.EMPLOYEE, pin: "0004", targetDeals: 8 },
];

async function main() {
  console.log("تهيئة البيانات التجريبية…");

  // 1) المستخدمون (idempotent عبر phone)
  const u: Record<string, string> = {};
  for (const x of users) {
    const row = await prisma.user.upsert({
      where: { phone: x.phone },
      update: { name: x.name, role: x.role, pinHash: hash(x.pin), targetDeals: x.targetDeals, active: true },
      create: { name: x.name, phone: x.phone, role: x.role, pinHash: hash(x.pin), targetDeals: x.targetDeals, active: true },
    });
    u[x.phone] = row.id;
    console.log(`  مستخدم: ${x.name} (${x.role}) — PIN ${x.pin}`);
  }
  const khaled = u["0500000003"], noura = u["0500000004"], fahad = u["0500000005"];

  // 2) مشروع + وحدات (كلها متاحة — لا حجوزات)
  const project = await prisma.project.upsert({
    where: { id: "seed-project-79" },
    update: { name: "مشروع السلطان 79", district: "حي النرجس", status: ProjectStatus.AVAILABLE, priceMin: 690000, priceMax: 1250000, falLicense: "1200000000" },
    create: { id: "seed-project-79", name: "مشروع السلطان 79", district: "حي النرجس", status: ProjectStatus.AVAILABLE, priceMin: 690000, priceMax: 1250000, falLicense: "1200000000" },
  });
  const units = [
    { number: "A-101", type: UnitType.APARTMENT, floor: "1", area: 145, price: 720000 },
    { number: "A-102", type: UnitType.APARTMENT, floor: "1", area: 160, price: 790000 },
    { number: "G-001", type: UnitType.GROUND_FLOOR_APARTMENT, floor: "أرضي", area: 180, price: 850000 },
    { number: "P-501", type: UnitType.PENTHOUSE, floor: "5", area: 240, price: 1250000 },
  ];
  for (const un of units) {
    await prisma.unit.upsert({
      where: { projectId_number: { projectId: project.id, number: un.number } },
      update: { type: un.type, floor: un.floor, area: un.area, price: un.price, status: UnitStatus.AVAILABLE },
      create: { ...un, status: UnitStatus.AVAILABLE, projectId: project.id },
    });
  }

  // 3) مسح كل بيانات العملاء (حجوزات + متابعات + نشاطات + عملاء)
  await prisma.booking.deleteMany({});
  await prisma.followUp.deleteMany({});
  await prisma.activity.deleteMany({});
  await prisma.lead.deleteMany({});

  // 4) ٩ عملاء جدد — كلهم NEW، بحقول كاملة، بدون متابعات وبدون المرحلة الأولى
  const demo: {
    name: string; phone: string; channel: Channel; priority: Priority;
    goal: PurchaseGoal; method: PurchaseMethod; priceMin: number; priceMax: number; area: string; seller: string;
  }[] = [
    { name: "عبدالله الشمري", phone: "0551111111", channel: Channel.WHATSAPP, priority: Priority.HIGH, goal: PurchaseGoal.RESIDENCE, method: PurchaseMethod.CASH, priceMin: 700000, priceMax: 900000, area: "حي النرجس", seller: khaled },
    { name: "ريم الحربي", phone: "0552222222", channel: Channel.TIKTOK, priority: Priority.MEDIUM, goal: PurchaseGoal.INVESTMENT, method: PurchaseMethod.BANK_FINANCE, priceMin: 750000, priceMax: 1000000, area: "حي الياسمين", seller: khaled },
    { name: "ماجد السبيعي", phone: "0553333333", channel: Channel.META, priority: Priority.HIGH, goal: PurchaseGoal.RESIDENCE, method: PurchaseMethod.BANK_FINANCE, priceMin: 800000, priceMax: 900000, area: "حي العقيق", seller: khaled },
    { name: "سارة العنزي", phone: "0554444444", channel: Channel.AQAR, priority: Priority.HIGH, goal: PurchaseGoal.INVESTMENT, method: PurchaseMethod.BANK_FINANCE, priceMin: 700000, priceMax: 800000, area: "ظهرة لبن", seller: noura },
    { name: "تركي المطيري", phone: "0555555555", channel: Channel.REFERRAL, priority: Priority.LOW, goal: PurchaseGoal.RESIDENCE, method: PurchaseMethod.CASH_AND_FINANCE, priceMin: 600000, priceMax: 800000, area: "المهدية", seller: noura },
    { name: "هند الزهراني", phone: "0556666666", channel: Channel.VISIT, priority: Priority.MEDIUM, goal: PurchaseGoal.RESIDENCE, method: PurchaseMethod.CASH, priceMin: 1100000, priceMax: 1300000, area: "حي الملقا", seller: noura },
    { name: "منى الغامدي", phone: "0557777777", channel: Channel.GOOGLE, priority: Priority.MEDIUM, goal: PurchaseGoal.BOTH, method: PurchaseMethod.BANK_FINANCE, priceMin: 800000, priceMax: 1100000, area: "حي القيروان", seller: fahad },
    { name: "فيصل الرشيد", phone: "0558888888", channel: Channel.WHATSAPP, priority: Priority.HIGH, goal: PurchaseGoal.RESIDENCE, method: PurchaseMethod.BANK_FINANCE, priceMin: 750000, priceMax: 850000, area: "حي الربيع", seller: fahad },
    { name: "بدر القرني", phone: "0559999999", channel: Channel.META, priority: Priority.LOW, goal: PurchaseGoal.INVESTMENT, method: PurchaseMethod.CASH, priceMin: 500000, priceMax: 650000, area: "لبن الشرقي", seller: fahad },
  ];

  for (const d of demo) {
    await prisma.lead.create({
      data: {
        name: d.name, phone: d.phone, channel: d.channel, stage: LeadStage.NEW, priority: d.priority,
        projectId: project.id, assignedToId: d.seller, createdById: d.seller,
        purchaseGoal: d.goal, purchaseMethod: d.method,
        priceMin: d.priceMin, priceMax: d.priceMax, preferredAreas: [d.area],
        attempts: 0, isArchived: false,
      },
    });
  }
  console.log(`  عملاء: ${demo.length} عميل — كلهم «جديد»، بحقول كاملة، بدون متابعات وبدون مرحلة أولى`);

  // 5) إعدادات الشركة (singleton)
  await prisma.settings.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton", companyName: "مشاريع السلطان", falLicense: "1200000000" },
  });
  console.log("  إعدادات الشركة");

  console.log("خلصت البذرة.");
}

main()
  .catch((e) => { console.error("فشلت البذرة:", e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
