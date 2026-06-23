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
  PurchaseGoal,
  PurchaseMethod,
  FirstContactStage,
  FollowUpType,
  FollowUpResult,
  FollowUpSection,
} from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const hash = (pin: string) => bcrypt.hashSync(pin, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const daysAhead = (n: number) => new Date(Date.now() + n * 86_400_000);

// المستخدمون التجريبيون (الرمز PIN بين قوسين).
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

  // 2) مشروع + وحدات (idempotent — مع إعادة ضبط الحالة/السعر كل تشغيل)
  const project = await prisma.project.upsert({
    where: { id: "seed-project-79" },
    update: { name: "مشروع السلطان 79", district: "حي النرجس", status: ProjectStatus.AVAILABLE, priceMin: 690000, priceMax: 1250000, falLicense: "1200000000" },
    create: { id: "seed-project-79", name: "مشروع السلطان 79", district: "حي النرجس", status: ProjectStatus.AVAILABLE, priceMin: 690000, priceMax: 1250000, falLicense: "1200000000" },
  });

  const units = [
    { number: "A-101", type: UnitType.APARTMENT, floor: "1", area: 145, price: 720000, status: UnitStatus.AVAILABLE },
    { number: "A-102", type: UnitType.APARTMENT, floor: "1", area: 160, price: 790000, status: UnitStatus.RESERVED },
    { number: "G-001", type: UnitType.GROUND_FLOOR_APARTMENT, floor: "أرضي", area: 180, price: 850000, status: UnitStatus.AVAILABLE },
    { number: "P-501", type: UnitType.PENTHOUSE, floor: "5", area: 240, price: 1250000, status: UnitStatus.SOLD },
  ];
  for (const un of units) {
    await prisma.unit.upsert({
      where: { projectId_number: { projectId: project.id, number: un.number } },
      update: { type: un.type, floor: un.floor, area: un.area, price: un.price, status: un.status },
      create: { ...un, projectId: project.id },
    });
  }

  // 3) العملاء التجريبيون — حذف القديم (cascade) ثم إنشاء كامل الحقول، يغطّي كل المراحل.
  type Demo = {
    name: string; phone: string; channel: Channel; stage: LeadStage; priority: Priority;
    goal: PurchaseGoal; method: PurchaseMethod; first: FirstContactStage; firstDays: number;
    seller: string; archived?: boolean; attempts?: number; priceMin?: number; priceMax?: number;
  };
  const demo: Demo[] = [
    { name: "عبدالله الشمري", phone: "0551111111", channel: Channel.WHATSAPP, stage: LeadStage.NEW, priority: Priority.HIGH, goal: PurchaseGoal.RESIDENCE, method: PurchaseMethod.CASH, first: FirstContactStage.NO_ANSWER, firstDays: 1, seller: khaled, attempts: 1, priceMin: 700000, priceMax: 900000 },
    { name: "تركي المطيري", phone: "0555555555", channel: Channel.REFERRAL, stage: LeadStage.ATTEMPTED, priority: Priority.LOW, goal: PurchaseGoal.RESIDENCE, method: PurchaseMethod.CASH_AND_FINANCE, first: FirstContactStage.NO_ANSWER, firstDays: 3, seller: fahad, attempts: 2, priceMin: 600000, priceMax: 800000 },
    { name: "ريم الحربي", phone: "0552222222", channel: Channel.TIKTOK, stage: LeadStage.INTERESTED, priority: Priority.MEDIUM, goal: PurchaseGoal.INVESTMENT, method: PurchaseMethod.BANK_FINANCE, first: FirstContactStage.CONTACTED, firstDays: 3, seller: khaled, attempts: 3, priceMin: 750000, priceMax: 1000000 },
    { name: "منى الغامدي", phone: "0557777777", channel: Channel.GOOGLE, stage: LeadStage.FOLLOW_UP_LATER, priority: Priority.MEDIUM, goal: PurchaseGoal.BOTH, method: PurchaseMethod.BANK_FINANCE, first: FirstContactStage.CONTACTED, firstDays: 6, seller: khaled, attempts: 2, priceMin: 800000, priceMax: 1100000 },
    { name: "ماجد السبيعي", phone: "0553333333", channel: Channel.META, stage: LeadStage.VIEWING, priority: Priority.HIGH, goal: PurchaseGoal.RESIDENCE, method: PurchaseMethod.BANK_FINANCE, first: FirstContactStage.CONTACTED, firstDays: 4, seller: noura, attempts: 2, priceMin: 800000, priceMax: 900000 },
    { name: "سارة العنزي", phone: "0554444444", channel: Channel.AQAR, stage: LeadStage.NEGOTIATION, priority: Priority.HIGH, goal: PurchaseGoal.INVESTMENT, method: PurchaseMethod.BANK_FINANCE, first: FirstContactStage.CONTACTED, firstDays: 5, seller: noura, attempts: 3, priceMin: 700000, priceMax: 800000 },
    { name: "فيصل الرشيد", phone: "0558888888", channel: Channel.WHATSAPP, stage: LeadStage.RESERVED, priority: Priority.HIGH, goal: PurchaseGoal.RESIDENCE, method: PurchaseMethod.BANK_FINANCE, first: FirstContactStage.CONTACTED, firstDays: 8, seller: noura, archived: true, attempts: 4, priceMin: 750000, priceMax: 850000 },
    { name: "هند الزهراني", phone: "0556666666", channel: Channel.VISIT, stage: LeadStage.CLOSED_WON, priority: Priority.MEDIUM, goal: PurchaseGoal.RESIDENCE, method: PurchaseMethod.CASH, first: FirstContactStage.CONTACTED, firstDays: 12, seller: fahad, archived: true, attempts: 5, priceMin: 1100000, priceMax: 1300000 },
    { name: "بدر القرني", phone: "0559999999", channel: Channel.META, stage: LeadStage.CLOSED_LOST, priority: Priority.LOW, goal: PurchaseGoal.INVESTMENT, method: PurchaseMethod.CASH, first: FirstContactStage.NOT_SUITABLE, firstDays: 10, seller: fahad, attempts: 2, priceMin: 500000, priceMax: 650000 },
  ];

  await prisma.lead.deleteMany({ where: { phone: { in: demo.map((d) => d.phone) } } });

  const id: Record<string, string> = {};
  for (const d of demo) {
    const lead = await prisma.lead.create({
      data: {
        name: d.name, phone: d.phone, channel: d.channel, stage: d.stage, priority: d.priority,
        projectId: project.id, assignedToId: d.seller, createdById: d.seller,
        purchaseGoal: d.goal, purchaseMethod: d.method,
        firstContactStage: d.first, firstContactDate: daysAgo(d.firstDays), firstContactAt: daysAgo(d.firstDays),
        isArchived: d.archived ?? false, attempts: d.attempts ?? 0,
        priceMin: d.priceMin ?? null, priceMax: d.priceMax ?? null,
        lastContact: daysAgo(1),
      },
    });
    id[d.phone] = lead.id;
  }
  console.log(`  عملاء: ${demo.length} عميل يغطّون كل المراحل (بحقول كاملة)`);

  // 4) متابعات حقيقية لـ ٣ عملاء (تصاعدية) — ريم / ماجد / سارة
  const fu = (
    leadId: string, createdBy: string, days: number, type: FollowUpType, result: FollowUpResult,
    section: FollowUpSection, stageAfter: LeadStage, note: string, nextDate?: Date,
  ) => prisma.followUp.create({ data: { leadId, createdBy, type, result, section, stageAfter, note, nextDate, createdAt: daysAgo(days) } });

  // ريم — مهتم
  await fu(id["0552222222"], khaled, 3, FollowUpType.CALL, FollowUpResult.NOT_ANSWERED_SCHEDULED, FollowUpSection.NO_ANSWER, LeadStage.ATTEMPTED, "اتصلت — ما رد");
  await fu(id["0552222222"], khaled, 2, FollowUpType.CALL, FollowUpResult.INTERESTED_SENT_INFO, FollowUpSection.INTERESTED, LeadStage.INTERESTED, "اتصلت — رد — مهتم");
  await fu(id["0552222222"], khaled, 1, FollowUpType.WHATSAPP, FollowUpResult.INTERESTED_SENT_INFO, FollowUpSection.INTERESTED, LeadStage.INTERESTED, "أرسلت له واتساب");

  // ماجد — زار المشروع
  await fu(id["0553333333"], noura, 4, FollowUpType.CALL, FollowUpResult.INTERESTED_SENT_INFO, FollowUpSection.INTERESTED, LeadStage.INTERESTED, "اتصلت — رد — مهتم");
  await fu(id["0553333333"], noura, 2, FollowUpType.VISIT_PROJECT, FollowUpResult.INTERESTED_SCHEDULED, FollowUpSection.INTERESTED, LeadStage.FOLLOW_UP_LATER, "جدّلت له زيارة", daysAhead(1));
  await fu(id["0553333333"], noura, 1, FollowUpType.VISIT_PROJECT, FollowUpResult.INTERESTED_VISITED, FollowUpSection.INTERESTED, LeadStage.VIEWING, "زار المشاريع: مشروع السلطان 79");

  // سارة — تفاوض
  await fu(id["0554444444"], noura, 5, FollowUpType.CALL, FollowUpResult.INTERESTED_SENT_INFO, FollowUpSection.INTERESTED, LeadStage.INTERESTED, "اتصلت — رد — مهتم");
  await fu(id["0554444444"], noura, 3, FollowUpType.VISIT_OFFICE, FollowUpResult.INTERESTED_VISITED, FollowUpSection.INTERESTED, LeadStage.INTERESTED, "زار الشركة");
  await fu(id["0554444444"], noura, 1, FollowUpType.CALL, FollowUpResult.FOLLOW_UP_SCHEDULED, FollowUpSection.INTERESTED, LeadStage.NEGOTIATION, "لا يزال يفكر — جدّل متابعة", daysAhead(2));
  console.log("  متابعات: ٣ عملاء (ريم/ماجد/سارة) بسجلات حقيقية في FollowUp");

  // 5) حجوزات للعملاء المؤرشفين (فيصل محجوز / هند مباع)
  const unit = async (number: string) =>
    (await prisma.unit.findFirst({ where: { projectId: project.id, number }, select: { id: true } }))!;
  const uA102 = await unit("A-102");
  const uP501 = await unit("P-501");

  await prisma.booking.create({
    data: {
      leadId: id["0558888888"], unitId: uA102.id, sellerId: noura,
      nationality: Nationality.SAUDI, nationalId: "1045678901", phone: "0558888888",
      paymentMethod: PaymentMethod.BANK_FINANCE, bankName: SaudiBank.RAJHI,
      deposit: 30000, price: 790000, discount: 20000, finalPrice: 770000,
      stage: BookingStage.VALUATION, deliveryStatus: DeliveryStatus.PENDING,
    },
  });
  await prisma.booking.create({
    data: {
      leadId: id["0556666666"], unitId: uP501.id, sellerId: fahad,
      nationality: Nationality.SAUDI, nationalId: "1098765432", phone: "0556666666",
      paymentMethod: PaymentMethod.CASH,
      deposit: 50000, price: 1250000, discount: 50000, finalPrice: 1200000,
      collected: 1200000, stage: BookingStage.SOLD, deliveryStatus: DeliveryStatus.DELIVERED,
    },
  });
  console.log("  حجوزات: فيصل (محجوز A-102) + هند (مباع P-501)");

  // 6) إعدادات الشركة (singleton)
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
