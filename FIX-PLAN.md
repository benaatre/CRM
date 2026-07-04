# خطة تنفيذ إصلاحات التدقيق — «مشاريع السلطان CRM»

- **التاريخ:** 2026-07-02 · **المرجع:** `AUDIT-2026-07.md` (٤٤ مشكلة)
- **الحالة:** خطة مكتوبة فقط — لم يُنفَّذ أي إصلاح. كل بند يُنفَّذ بعد موافقتك دفعةً بدفعة.
- **الطريقة:** كل بند كُتب بعد قراءة الملف الفعلي (لا تخمين). المقتطفات «الحالية» منسوخة من الكود.

## ملخص سريع

| | العدد | الأرقام |
|---|---|---|
| بنود تحتاج **قرارك** قبل التنفيذ | **٢٢** | #1 #2 #4 #5 #6 #7 #8 #9 #11 #14 #18 #20 #22 #25 #28 #31 #33 #34 #35 #36 #40 #44 |
| تحتاج **مخطط Prisma** (مؤكّد) | **١** | #28 (فهارس + onDelete) — بعد الـbaseline فقط |
| مخطط Prisma **مشروط بخيارك** | ٢ | #6 (خيار حقول القفل) · #22 (حقل dedup اختياري) |
| تحتاج **backfill بيانات إنتاج** (UPDATE، ليس مخططاً) | ١ | #1 (`collected = collectedAmount`) |
| بقية البنود | كود فقط، بلا مخطط ولا قرار | — |

---

## البنود التفصيلية (بالترتيب الرقمي)

### #1 — حقل `collected` لا يُكتب أبداً → تقارير التحصيل صفر (شدّة: 🔴 حرجة · دفعة ج)
- **الملفات:** `src/lib/actions/bookings.ts:102-105,189,296` · `src/lib/data/analytics.ts:104,342,378,555` · `src/lib/data/ai-context.ts:22` · `src/lib/data/bookings.ts:114` · `src/lib/data/leads.ts:155,164` (الكانبان يقرأ `collectedAmount`)
- **الكود الحالي:**
```ts
// bookings.ts:102-105 — الإنشاء يحسب في collectedAmount فقط
const totalAfterDiscount = finalPrice + (vatAmount ?? 0);
const collectedAmount = deposit ?? 0;
const remainingAmount = totalAfterDiscount - collectedAmount;
// bookings.ts:189 (createBooking) — collected لا يظهر إطلاقاً
collectedAmount, remainingAmount,
// bookings.ts:296 (createCashSales)
collectedAmount: price, remainingAmount: 0,
// analytics.ts:104 — كل التحليلات تقرأ الحقل الميت
const coll = num(b.collected);
```
- **الكود المقترح (الخيار أ — بلا مخطط):**
```ts
// bookings.ts:189 (createBooking)
collectedAmount, remainingAmount,
collected: collectedAmount, // توحيد: المحصّل = العربون عند الإنشاء
// bookings.ts:296 (createCashSales)
collectedAmount: price, remainingAmount: 0,
collected: price, // كاش فوري = محصّل كاملاً
// بديل مكافئ: تحويل كل قراءات analytics/ai-context/data-bookings من
// `collected` إلى `collectedAmount` — لكن كتابة الحقلين أقل ملفات متأثرة.
```
- **مخطط Prisma:** لا (الحقلان موجودان: `schema.prisma:472,474`)
- **قرار مطلوب من المالك:** **نعم** — (أ) إصلاح سريع: كتابة `collected = collectedAmount` عند الإنشاء (التوصية الآن)؛ (ب) لاحقاً: نموذج `Payment` فعلي لتسجيل دفعات متعددة (يحتاج مخططاً — يؤجَّل). **⚠️ إضافةً لأي خيار: الصفوف الموجودة بالإنتاج فيها `collected=0`** — يلزم **UPDATE لمرة واحدة على بيانات الإنتاج** (`UPDATE "Booking" SET collected = "collectedAmount" WHERE collected = 0`) — هذا لمس بيانات إنتاجية يحتاج موافقتك الصريحة، وهو **ليس** تغيير مخطط.
- **المخاطر:** بدون الـbackfill تبقى التقارير القديمة خاطئة رغم الإصلاح؛ لو نُفّذ الـbackfill على حجز سبق تسجيل دفعات يدوية عليه (لا يوجد حالياً) يُستبدل. الخيار (ب) لاحقاً يحتاج ترحيل بيانات من الحقلين.

### #2 — `bulkDelete` يحرّر وحدات مباعة ويحذف حجوزات SOLD (شدّة: 🔴 حرجة · دفعة أ)
- **الملفات:** `src/lib/actions/leads.ts:263-280`
- **الكود الحالي:**
```ts
export async function bulkDelete(ids: string[]): Promise<ActionResult> {
  try {
    const user = await requireManagerAction(); // OWNER/ADMIN فقط — يرفض الموظف
    if (ids.length === 0) return { ok: false, error: "ما فيه عملاء محدّدين" };
    // حرّر وحدات أي حجوزات لهؤلاء العملاء قبل الحذف (الحجز يُحذف تلقائيًا cascade).
    const bks = await prisma.booking.findMany({ where: { leadId: { in: ids } }, select: { unitId: true } });
    const unitIds = bks.map((b) => b.unitId);
    await prisma.$transaction([
      ...(unitIds.length ? [prisma.unit.updateMany({ where: { id: { in: unitIds } }, data: { status: "AVAILABLE" } })] : []),
      prisma.lead.deleteMany({ where: { id: { in: ids } } }),
    ]);
```
- **الكود المقترح:**
```ts
    // امنع حذف عميل له بيع مكتمل — البيع سجل مالي لا يُمحى بحذف جماعي.
    const soldBks = await prisma.booking.findMany({
      where: { leadId: { in: ids }, stage: { in: ["SOLD", "DELIVERED"] } },
      select: { lead: { select: { name: true } } },
    });
    if (soldBks.length) {
      const names = [...new Set(soldBks.map((b) => b.lead.name))].join("، ");
      return { ok: false, error: `ما نقدر نحذف: عندهم مبيعات مسجّلة (${names}) — ألغِ البيع أول أو استثنِهم` };
    }
    // حرّر وحدات الحجوزات غير المباعة فقط قبل الحذف (الحجز يُحذف cascade).
    const bks = await prisma.booking.findMany({ where: { leadId: { in: ids } }, select: { unitId: true } });
```
- **مخطط Prisma:** لا
- **قرار مطلوب من المالك:** **نعم** — الخيارات: (١) **منع الحذف كليًا** لأي عميل له حجز `SOLD/DELIVERED` مع رسالة بالأسماء (التوصية — أبسط وأأمن؛ الحذف الجماعي عملية تنظيف، والبيع لازم يُلغى بوعي عبر مسار الحجوزات). (٢) السماح بالحذف مع إبقاء الوحدة `SOLD` والاحتفاظ بالحجز — لكن هذا يتطلب فك cascade (تغيير مخطط `Booking.leadId` إلى nullable + `onDelete: SetNull`) ويترك حجوزات يتيمة بلا عميل.
- **المخاطر:** يمس مسار حذف جماعي يستخدمه المالك — بعد التعديل، حذف قائمة فيها مشترٍ واحد يفشل بالكامل (سلوك مقصود لكن لازم توضيحه بالرسالة). لا يغيّر سلوك العملاء بلا حجوزات أو بحجوزات `RESERVATION`. التحقق: (أ) حذف عميل بحجز RESERVATION → يُحذف وترجع الوحدة AVAILABLE، (ب) حذف عميل بحجز SOLD → رسالة رفض باسمه والوحدة تبقى SOLD، (ج) التحليلات (`salesValue`) لا تتغير بعد محاولة الحذف.

### #3 — تصعيد صلاحيات في `team.ts`: أدمن يستولي على حساب المالك (شدّة: 🔴 حرجة · دفعة ب)
- **الملفات:** `src/lib/actions/team.ts:72-112` (`updateEmployee`)، `team.ts:115-124` (`inviteEmployee`)، `team.ts:147-156` (`toggleEmployeeActive`)
- **الكود الحالي:**
```ts
export async function updateEmployee(userId: string, formData: FormData): Promise<ActionResult> {
  try {
    await requireManager();
    // ...
    const role = (String(formData.get("role") ?? "EMPLOYEE") as Role);
    // ...
    const pin = String(formData.get("pin") ?? "").trim();
    // ...
    await prisma.user.update({
      where: { id: userId },
      data: {
        name, phone, email, role, targetDeals, maxClients, staffNotes, active,
        ...(pin ? { pinHash: bcrypt.hashSync(pin, 10) } : {}),
```
- **الكود المقترح:**
```ts
    const actor = await requireManager();
    // (١) الأدوار المسموح إسنادها من الفورم: موظف/أدمن فقط — OWNER لا يُمنح من الواجهة أبدًا.
    const roleRaw = String(formData.get("role") ?? "EMPLOYEE");
    if (!["EMPLOYEE", "ADMIN"].includes(roleRaw)) return { ok: false, error: "دور غير مسموح" };
    const role = roleRaw as Role;
    // (٢) حساب المالك لا يعدّله إلا مالك (يشمل الاسم/الإيميل/الـPIN/التعطيل).
    const target = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!target) return { ok: false, error: "الموظف غير موجود" };
    if (target.role === "OWNER" && actor.role !== "OWNER")
      return { ok: false, error: "حساب المالك ما يعدّله إلا المالك" };
    const finalRole = target.role === "OWNER" ? target.role : role; // لا تنزيل لمالك من الفورم
    // ... prisma.user.update({ data: { ..., role: finalRole, ... } })
    // (٣) تسجيل تدقيق لتغيير الدور/الـPIN:
    if (finalRole !== target.role || pin) {
      await logAudit(prisma, {
        userId: actor.id, action: "user.securityChange", entity: "user", entityId: userId,
        summary: `${finalRole !== target.role ? `تغيير دور إلى ${finalRole}` : ""}${pin ? " + تغيير PIN" : ""}`,
      });
    }
```
نفس الحارس (فحص `target.role === "OWNER" && actor.role !== "OWNER"`) يُضاف لـ`toggleEmployeeActive` (السطر 147 — حاليًا `update` مباشر بلا أي فحص للهدف) ولـ`inviteEmployee` (السطر 115 — الدعوة تعيّن PIN جديدًا فهي مكافئة لتغييره). ملاحظة: `team.ts` لا يستورد `logAudit` حاليًا — يُضاف `import { logAudit } from "@/lib/audit";`.
- **مخطط Prisma:** لا
- **قرار مطلوب من المالك:** لا — سدّ ثغرة صريح بلا بدائل معقولة (الأدمن ما له مصلحة مشروعة في تعديل حساب المالك أو منح OWNER).
- **المخاطر:** يمس شاشة إدارة الفريق `/admin` — لو الفورم الحالي يعرض خيار OWNER في قائمة الأدوار لازم يُشال من الواجهة أيضًا (وإلا يظهر خطأ «دور غير مسموح» للمالك نفسه؛ لو المالك يحتاج ترقية أحد لمالك مستقبلًا يكون استثناء `actor.role === "OWNER"` في القائمة البيضاء). التحقق: (أ) دخول كأدمن ومحاولة تعديل المالك → رفض، (ب) الأدمن يعدّل موظفًا عاديًا → يشتغل كالسابق، (ج) سطر `user.securityChange` يظهر في سجل التدقيق بعد تغيير PIN.

### #4 — `cancelBooking` يلغي حجزًا مباعًا/مسلَّمًا ويحذف تاريخ البيع (شدّة: 🔴 حرجة · دفعة أ)
- **الملفات:** `src/lib/actions/bookings.ts:332-361` (و`assertBookingAccess` في 48-63 يرجّع `stage` جاهزة)
- **الكود الحالي:**
```ts
export async function cancelBooking(bookingId: string, reason?: string): Promise<ActionResult> {
  try {
    const { user, booking } = await assertBookingAccess(bookingId);

    await prisma.$transaction(async (tx) => {
      await tx.unit.update({ where: { id: booking.unitId }, data: { status: "AVAILABLE" } });
      await tx.lead.update({ where: { id: booking.leadId }, data: { stage: "NEGOTIATION", isArchived: false } });
      // ...
      await tx.booking.delete({ where: { id: bookingId } }); // يحذف أحداث الحجز تلقائيًا (cascade)
    });
```
- **الكود المقترح:**
```ts
    const { user, booking } = await assertBookingAccess(bookingId);
    // حارس: البيع المكتمل ما يُلغى من هنا — إلغاؤه يحذف السجل المالي نهائيًا (cascade على BookingEvent).
    if ((["SOLD", "DELIVERED"] as BookingStage[]).includes(booking.stage) && user.role !== "OWNER") {
      return { ok: false, error: "هذا بيع مكتمل — إلغاؤه للمالك فقط" };
    }
    // (لو اختير الرفض المطلق: احذف شرط user.role وارفض دائمًا برسالة «رجّع المرحلة أول ثم ألغِ»)
```
- **مخطط Prisma:** لا (الخيار الجذري — مرحلة `CANCELLED` بدل الحذف — يحتاج إضافة قيمة للـenum، لكنه خارج نطاق هذه الدفعة ومقترح في التقرير كميزة)
- **قرار مطلوب من المالك:** **نعم** — الخيارات: (١) **رفض مطلق** لإلغاء `SOLD/DELIVERED` — من يريد الإلغاء يرجّع المرحلة عبر `updateBookingStage` أولًا (أثر واضح في `BookingEvent`) ثم يلغي. (٢) سماح للمالك فقط — أسرع تشغيليًا لكن الحذف يبقى نهائيًا حتى للمالك. التوصية: **الخيار (١)** الآن لأنه يحفظ أثر التراجع في الأحداث، مع تبنّي مرحلة `CANCELLED` لاحقًا كحل جذري. (تنبيه تنسيق مع #9: لو اخترت هنا الرفض المطلق، لازم في #9 نسمح بالرجوع من SOLD بمسار نظيف — وإلا ما يبقى أي طريق للتراجع عن بيع خاطئ. التوصية المتسقة: #4 خيار ٢ «مالك فقط» + #9 خيار ١ «منع الرجوع»، أو #4 خيار ١ + #9 خيار ٢.)
- **المخاطر:** يمس مسار إلغاء الحجوزات اليومي — الحجوزات غير المباعة لا تتأثر إطلاقًا. `assertBookingAccess` يرجّع `stage` أصلًا فلا استعلام إضافي. التحقق: (أ) إلغاء حجز RESERVATION يشتغل كالسابق، (ب) إلغاء حجز SOLD يرجّع الرسالة ولا يمس الوحدة/العميل.

### #5 — `getBookings` يكشف كل الحجوزات ببيانات حساسة لأي موظف (شدّة: 🔴 حرجة · دفعة ب)
- **الملفات:** `src/lib/data/bookings.ts:72-149` (`getBookings`)، `src/components/bookings/bookings-list.tsx:19,30` (فلتر «حجوزاتي/الكل» client-side)
- **الكود الحالي:**
```ts
/** كل الحجوزات مرئية للجميع (الفلترة «حجوزاتي/الكل» على العميل). */
export async function getBookings(): Promise<BookingsData> {
  const user = await requireUser();
  const manager = user.role === "OWNER" || user.role === "ADMIN";

  const rows = await prisma.booking.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      lead: { select: { name: true } },
      unit: { select: { number: true, project: { select: { name: true } } } },
      seller: { select: { name: true } },
```
- **الكود المقترح:**
```ts
// الخيار (١) — حصر الموظف بحجوزاته (الأبسط والأكثر أمانًا):
  const rows = await prisma.booking.findMany({
    where: manager ? {} : { sellerId: user.id },
    orderBy: { createdAt: "desc" },
    // ... include كما هو
  });
  // ملاحظة: الـKPIs (deposits/salesValue) تصير حينها «أرقام الموظف» لا الشركة — سلوك متسق مع الحصر.

// الخيار (٢) — خط مبيعات مشترك مع حجب الحقول الحساسة عن غير البائع:
  const mine = manager || b.sellerId === user.id;
  const cards: BookingCard[] = rows.map((b) => ({
    id: b.id, sellerId: b.sellerId, leadName: b.lead.name,
    phone: mine ? b.phone : null,
    nationalId: mine ? b.nationalId : null,
    deposit: mine ? dec(b.deposit) : null,
    // ... وكذلك discount/finalPrice/collected/installments، والـKPIs المالية للمدير فقط
  }));
```
- **مخطط Prisma:** لا
- **قرار مطلوب من المالك:** **نعم** — الخيارات: (١) **حصر الموظف بحجوزاته** — يختفي زر «كل الحجوزات» للموظف، وأرقام KPI تعكس أداءه فقط. (٢) إبقاء «خط المبيعات المشترك» مع تصفير `nationalId/phone/secondaryPhone` وكل المبالغ لغير بائعها. التوصية: **الخيار (١)** — رؤية توفّر الوحدات متاحة أصلًا عبر `/projects`، فلا حاجة تشغيلية لكشف حجوزات الزملاء؛ والخيار (٢) جهد أكبر وسطح خطأ أوسع.
- **المخاطر:** يغيّر ما يشوفه الموظف في `/bookings` جذريًا — لازم إبلاغ الفريق. مع الخيار (١) يُخفى فلتر «الكل/حجوزاتي» لغير المدير. التحقق: موظف يشوف حجوزاته فقط؛ المدير يشوف الكل كالسابق.

### #6 — لا حدّ لمحاولات PIN + صفحة الدخول تكشف قائمة المستخدمين (شدّة: 🟠 عالية · دفعة ب)
- **الملفات:** `src/auth.ts:18-37` (authorize)، `src/app/login/page.tsx:18-29` (كشف القائمة)، `src/app/login/actions.ts:9-33`
- **الكود الحالي:**
```ts
// src/auth.ts:24-30 — لا عدّاد، لا قفل، لا تسجيل للفشل
const user = await prisma.user.findUnique({ where: { id: userId } });
if (!user || !user.active || !user.pinHash) return null;

const ok = await bcrypt.compare(pin, user.pinHash);
if (!ok) return null;

await prisma.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } });
```
- **الكود المقترح:**
```ts
// الخيار (١) — حقول بالمخطط (الأمتن، يصمد بعد إعادة تشغيل الخادم):
// prisma: failedAttempts Int @default(0) · lockedUntil DateTime?
if (user.lockedUntil && user.lockedUntil > new Date()) return null; // مقفول مؤقتًا
const ok = await bcrypt.compare(pin, user.pinHash);
if (!ok) {
  const attempts = user.failedAttempts + 1;
  await prisma.user.update({
    where: { id: user.id },
    data: { failedAttempts: attempts, ...(attempts >= 5 ? { lockedUntil: new Date(Date.now() + 15 * 60_000), failedAttempts: 0 } : {}) },
  });
  await logAudit(prisma, { userId: user.id, action: "login.failed", entity: "user", entityId: user.id, summary: `محاولة دخول فاشلة (${attempts}/5)` });
  return null;
}
await prisma.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date(), failedAttempts: 0, lockedUntil: null } });

// الخيار (٢) — بلا تغيير مخطط: عدّاد في الذاكرة (module-level Map) — يصفَّر عند إعادة التشغيل:
const fails = new Map<string, { n: number; until: number }>();
const f = fails.get(userId);
if (f && f.until > Date.now()) return null;
// ... عند الفشل: n+1، وعند n>=5: until = Date.now()+15*60_000 ثم صفّر n
```
- **مخطط Prisma:** **نعم (للخيار ١ فقط)** — `failedAttempts Int @default(0)` + `lockedUntil DateTime?` على `User`. **ينتظر الـbaseline.** الخيار (٢) بلا مخطط ويشتغل فورًا.
- **قرار مطلوب من المالك:** **نعم** — (١) حقول Prisma (يصمد ويظهر بالتقارير — بعد الـbaseline)؛ (٢) عدّاد in-memory الآن (يتصفّر مع إعادة التشغيل؛ مقبول لأن النشر instance واحد). التوصية: **الخيار (٢) فورًا + تسجيل `login.failed` في AuditLog**، ثم الترقية للخيار (١) مع أول ترحيل. قرار فرعي: إخفاء قائمة المستخدمين من صفحة الدخول (بديل: جوال + PIN — تغيير UX)؟ وحل وسط: إبقاء القائمة + رفع حد PIN الأدنى لـ٦ أرقام (تعديل regex في `login/actions.ts:17` و`team.ts:24,97` و`settings.ts:89`) — مع قرار: فرض التحديث على الرموز القديمة أم الجديدة فقط.
- **المخاطر:** يمس مسار الدخول نفسه — خطأ فيه يقفل الجميع. القفل ١٥ دقيقة قد يزعج موظفًا نسي رمزه (المدير يعيّن له PIN من `/admin` ويُصفَّر العدّاد عند التغيير). التحقق: ٥ محاولات خاطئة → السادسة ترفض حتى برمز صحيح؛ دخول ناجح يصفّر العدّاد.

### #7 — معادلات مالية بلا تحقّق + ضريبة غير موحّدة + تسمية `includesVAT` مضلّلة (شدّة: 🟠 عالية · دفعة ج)
- **الملفات:** `src/lib/actions/bookings.ts:73-105` (createBooking) · `bookings.ts:284-297` (createCashSales)
- **الكود الحالي:**
```ts
const price = numOf(formData, "price");
if (!price || price <= 0) return { ok: false, error: "اكتب سعر الشقة" };
const discount = numOf(formData, "discount") ?? 0;
const deposit = numOf(formData, "deposit");
const finalPrice = price - discount; // ممكن يطلع سالب بصمت
// ...
const taxAmount = subjectToTax ? Math.round(finalPrice * 0.05) : null; // تُخزَّن ولا تدخل المتبقي
const includesVAT = String(formData.get("includesVAT") ?? "") === "yes";
const vatAmount = includesVAT ? Math.round(finalPrice * 0.15) : null;  // تُضاف فوق السعر
const totalAfterDiscount = finalPrice + (vatAmount ?? 0);
const collectedAmount = deposit ?? 0;
const remainingAmount = totalAfterDiscount - collectedAmount; // ممكن سالب لو العربون > الإجمالي
```
- **الكود المقترح:**
```ts
if (discount < 0 || discount > price)
  return { ok: false, error: "الخصم لازم يكون بين صفر وسعر الشقة" };
if (deposit != null && deposit < 0)
  return { ok: false, error: "العربون ما يصير سالب" };
const finalPrice = price - discount;
// المعادلة الموحّدة: الإجمالي = بعد الخصم + VAT (+ ضريبة التصرفات لو قرّرتم دخولها)
const totalAfterDiscount = finalPrice + (vatAmount ?? 0); // + (taxAmount ?? 0) حسب القرار
const collectedAmount = deposit ?? 0;
if (collectedAmount > totalAfterDiscount)
  return { ok: false, error: "العربون أكبر من إجمالي المبلغ" };
const remainingAmount = totalAfterDiscount - collectedAmount;
// createCashSales: توحيد نفس المعادلة
```
- **مخطط Prisma:** لا
- **قرار مطلوب من المالك:** **نعم** — قراران: (١) هل تدخل ضريبة التصرفات ٥٪ في `remainingAmount` مثل VAT؟ (التوصية: **لا** — معلومة عرض فقط لأنها تُسدَّد للهيئة لا للشركة، مع توثيق ذلك)؛ (٢) دلالة `includesVAT`: الرياضيات تضيف ١٥٪ **فوق** السعر بينما الاسم يوحي أن السعر شاملها — التوصية: **إبقاء الرياضيات** وتعديل التسمية بالواجهة إلى «يُضاف VAT 15%».
- **المخاطر:** لو عُكست دلالة VAT تتغيّر مبالغ الحجوزات الجديدة وتتناقض مع القديمة؛ التحقّقات الجديدة قد ترفض نماذج كانت تمرّ (سلوك مقصود — يلزم تنبيه الموظفين). (تنسيق مع #17: هذا البند = قواعد المال؛ #17 = حراسة NaN/التواريخ — بلا تعارض.)

### #8 — إعادة الإسناد اليدوي لا تصفّر `assignedAt` → سحب فوري ظالم (شدّة: 🟠 عالية · دفعة د)
- **الملفات:** `src/lib/actions/leads.ts:250` (bulkReassign) · `leads.ts:430-439` (transferLeads) · `leads.ts:511-515` (reassignLead) · مقارنةً بـ`auto-distribute.ts:302-312,333-335`
- **الكود الحالي:**
```ts
// leads.ts:250 — bulkReassign
await prisma.lead.updateMany({ where: { id: { in: ids } }, data: { assignedToId: toUserId } });
// leads.ts:439 — transferLeads (وضع "full")
await tx.lead.updateMany({ where: { id: { in: ids } }, data: { assignedToId: toUserId } });
// leads.ts:512-515 — reassignLead
prisma.lead.update({ where: { id: leadId }, data: { assignedToId: toUserId } }),
// auto-distribute.ts:304-305 — السحب يعتمد assignedAt القديم
assignedAt: { not: null, lte: cutoff },
contactedAt: null,
```
- **الكود المقترح (الخيار الموصى به):**
```ts
// في المواضع الثلاثة (bulkReassign / transferLeads-full / reassignLead):
data: { assignedToId: toUserId, assignedAt: new Date(), contactedAt: null },
// assignedAt=now: يبدأ عدّاد SLA من لحظة النقل — الموظف الجديد ياخذ مهلته كاملة
// contactedAt=null: تواصُل الموظف السابق ما يحسب للجديد
```
- **مخطط Prisma:** لا
- **قرار مطلوب من المالك:** **نعم** — هل الإسناد اليدوي يدخل دورة إعادة التوجيه التلقائي؟ (أ) `assignedAt: new Date()` + `contactedAt: null` — يدخل الدورة بمهلة جديدة (**التوصية**: قرار المدير بالنقل لا يعفي الموظف الجديد من التواصل)؛ (ب) `assignedAt: null` — النقل اليدوي «قرار إداري محمي» خارج الدورة. تصفير `contactedAt` عنصر ثانٍ من القرار.
- **المخاطر:** الخيار (أ) قد يسحب عميلاً نقله المدير عمداً إذا تأخّر الموظف (مقصود لكن قد يفاجئ)؛ الخيار (ب) يفتح ثغرة عملاء لا يُتابَعون أبداً. `transferLeads` بوضع "fresh" يصفّر حقول التواصل لكن لا يلمس `assignedAt` — يشمله الإصلاح.

### #9 — `stageIndex` لا يُحدَّث + رجوع من SOLD يترك العميل مؤرشفًا (شدّة: 🟠 عالية · دفعة ح)
- **الملفات:** `src/lib/actions/bookings.ts:364-400` (`updateBookingStage`)، `src/lib/data/bookings.ts:128`، `src/lib/labels.ts:156-164` (`bookingStageOrder`)
- **الكود الحالي:**
```ts
// bookings.ts:369-380 — stage يتغيّر لكن stageIndex يبقى قيمة الإنشاء (0 أو 5) للأبد
    await prisma.$transaction(async (tx) => {
      await tx.booking.update({ where: { id: bookingId }, data: { stage } });
      // ...
      if (stage === BookingStage.SOLD || stage === BookingStage.DELIVERED) {
        await tx.unit.update({ where: { id: booking.unitId }, data: { status: "SOLD" } });
        await tx.lead.update({ where: { id: booking.leadId }, data: { stage: "CLOSED_WON" } });
      } else {
        // الرجوع من SOLD → RESERVED للوحدة، لكن العميل يبقى CLOSED_WON + isArchived
        await tx.unit.update({ where: { id: booking.unitId }, data: { status: "RESERVED" } });
      }
```
- **الكود المقترح:**
```ts
import { bookingStageOrder } from "@/lib/labels";

    const { user, booking } = await assertBookingAccess(bookingId);
    if (booking.stage === stage) return { ok: true };
    // منع الرجوع من بيع/تسليم لمرحلة أدنى — التراجع الصحيح عبر إلغاء الحجز (#4).
    const SOLD_STAGES: BookingStage[] = [BookingStage.SOLD, BookingStage.DELIVERED];
    if (SOLD_STAGES.includes(booking.stage) && !SOLD_STAGES.includes(stage)) {
      return { ok: false, error: "الحجز مباع — ما يمدي يرجع لمرحلة سابقة. لو البيع اتلغى استخدم «إلغاء الحجز»" };
    }

    await prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: bookingId },
        data: { stage, stageIndex: bookingStageOrder.indexOf(stage) }, // يتزامن مع كل نقل
      });
```
- **مخطط Prisma:** لا (اختياري لاحقاً: `UPDATE` لمرة واحدة لمواءمة `stageIndex` القائم مع `stage`)
- **قرار مطلوب من المالك:** **نعم** — الرجوع من SOLD: (١) **منعه** (المقتطف أعلاه) ← **التوصية**: التراجع عن بيع حدث مالي يستحق مسارًا صريحًا (٢) السماح به مع تنظيف كامل. **مترابط مع قرار #4** — انظر ملاحظة التنسيق هناك: لا تختَر «منع» في الاثنين معاً وإلا ما يبقى مسار تراجع عن بيع خاطئ.
- **المخاطر:** منخفضة. الواجهة تحسب الشريط من `stage` مباشرة فلا كسر بصري؛ حظر الرجوع قد يفاجئ مستخدماً اعتاد سحب الشريط للخلف — الرسالة توجّهه.

### #10 — توزيع «طريقة الشراء» يسقط القيمتين المعتمدتين (شدّة: 🟠 عالية · دفعة ج)
- **الملفات:** `src/lib/data/analytics.ts:488` · `prisma/schema.prisma:93-99`
- **الكود الحالي:**
```ts
const byMethod = distFrom(myLeads.map((l) => ({ key: l.purchaseMethod ?? "NONE" })), ["CASH", "BANK_FINANCE", "CASH_AND_FINANCE", "NONE"]);
```
- **الكود المقترح:**
```ts
import { PurchaseMethod } from "@prisma/client";
// اشتقاق المفاتيح من الـenum نفسه — أي قيمة جديدة تظهر تلقائياً بلا نسيان
const byMethod = distFrom(
  myLeads.map((l) => ({ key: l.purchaseMethod ?? "NONE" })),
  [...Object.keys(PurchaseMethod), "NONE"],
);
```
- **مخطط Prisma:** لا
- **قرار مطلوب من المالك:** لا (labels عربية للقيمتين موجودة في `labels.ts`)
- **المخاطر:** شبه معدومة؛ الرسم يطول بصفّين والنِّسب ترجع تجمع ١٠٠٪.

### #11 — استطلاع مركز الإشعارات كل ٥ ثوانٍ يسحب الإعدادات كاملة (نغمات base64) + كتابة upsert (شدّة: 🟠 عالية · دفعة هـ)
- **الملفات:** `src/components/layout/notification-center.tsx:9,70-89` · `src/lib/actions/notifications.ts:58-69` · `src/lib/data/notifications-config.ts:57-63,89-105`
- **الكود الحالي:**
```ts
// notification-center.tsx:9 + 70-74 — كل ٥ ثوانٍ: الإعدادات كاملة + الإشعارات
const POLL_MS = 5000;
async function tick() {
  const [conf, res] = await Promise.all([
    fetchPlaybackConfig().catch(() => null),   // يرجّع كل fileUrl (base64 حتى ~1.3MB)
    getNotifications().catch(() => null),
  ]);
// notifications-config.ts:59-62 — يُنفَّذ داخل fetchPlaybackConfig كل نبضة:
const [rows, sounds, settings] = await Promise.all([
  prisma.notificationSetting.findMany(),
  prisma.soundAsset.findMany({ orderBy: [{ isBuiltIn: "desc" }, { createdAt: "asc" }] }),
  prisma.settings.upsert({ where: { id: "singleton" }, update: {}, create: { id: "singleton" }, select: { masterVolume: true, globalMute: true } }),
]);
```
- **الكود المقترح:**
```ts
// notification-center.tsx — الإعدادات مرة عند التحميل + كل ٥ دقائق؛ الإشعارات وحدها في النبضة
const POLL_MS = 15_000;          // ← قرار المالك
const CONFIG_MS = 5 * 60_000;
useEffect(() => {
  let alive = true;
  const loadCfg = () => fetchPlaybackConfig().then((c) => { if (alive) cfg.current = c; }).catch(() => {});
  loadCfg();
  const t = setInterval(loadCfg, CONFIG_MS);
  return () => { alive = false; clearInterval(t); };
}, []);
async function tick() {
  const res = await getNotifications().catch(() => null);
  // ... البقية كما هي
}
// notifications.ts — إرجاع نغمات الأحداث المفعّلة فقط + الافتراضية:
const usedIds = new Set(cfg.events.filter((e) => e.soundEnabled && e.soundId).map((e) => e.soundId!));
// notifications-config.ts — قراءة بلا كتابة: upsert → findUnique + افتراضيات (80 / false)
// + تخطّي ensureNotificationDefaults() في مسار fetchPlaybackConfig (تكفي في لوحة الإعدادات)
```
- **مخطط Prisma:** لا
- **قرار مطلوب من المالك:** **نعم** — فترة استطلاع الإشعارات: (أ) ٥ث (فورية قصوى)، (ب) **١٥ث — التوصية** (تأخير غير محسوس + قصّ ⅔ الطلبات)، (ج) ٣٠ث.
- **المخاطر:** منخفضة — تغيير نغمة يصل للمتصفحات المفتوحة خلال ≤٥ دقائق؛ سباق نادر يسقط للصوت الافتراضي؛ حذف upsert آمن (الصف singleton يُنشأ من مسارات الإعدادات).

### #12 — مؤقّتات polling مكدّسة بلا إيقاف عند إخفاء التبويب (شدّة: 🟠 عالية · دفعة هـ)
- **الملفات:** `notification-center.tsx:88` (٥ث) · `notification-bell.tsx:24-28` (١٥ث) · `heartbeat.tsx:7-12` (٦٠ث) · `chat-view.tsx:11,40-49` (٥ث) · `bookings-list.tsx:23-26` (٣٠ث) · `auto-refresh.tsx:9-12` (٣٠ث)
- **الكود الحالي:**
```ts
// النمط المتكرر في الستة (مثال notification-bell.tsx:24-28):
useEffect(() => {
  load();
  const t = setInterval(load, 15000);
  return () => clearInterval(t);
}, []);
```
- **الكود المقترح:**
```ts
// ملف جديد src/lib/use-visible-polling.ts — hook مشترك يوقف الاستطلاع عند إخفاء التبويب
"use client";
import { useEffect, useRef } from "react";

/** ينفّذ fn فورًا ثم كل ms — ويتوقف كليًا عندما يكون التبويب مخفيًا، ويستأنف (بنداء فوري) عند الرجوع. */
export function useVisiblePolling(fn: () => void | Promise<void>, ms: number) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => { void fnRef.current(); timer = setInterval(() => void fnRef.current(), ms); };
    const stop = () => { clearInterval(timer); timer = undefined; };
    const onVis = () => (document.visibilityState === "visible" ? start() : stop());
    onVis();
    document.addEventListener("visibilitychange", onVis);
    return () => { stop(); document.removeEventListener("visibilitychange", onVis); };
  }, [ms]);
}

// مثال: notification-bell.tsx → useVisiblePolling(load, 15000);
// bookings-list / auto-refresh → useVisiblePolling(() => router.refresh(), 30000)
```
- **مخطط Prisma:** لا
- **قرار مطلوب من المالك:** لا (توحيد الجرس/المركز بـContext تحسين لاحق اختياري)
- **المخاطر:** منخفضة — نداء فوري عند رجوع التبويب فلا تفوت تحديثات؛ `chat-view` يقرأ `activePeer` عبر `fnRef` فلا stale closure. الـheartbeat يتوقف للتبويب المخفي → «متصل الآن» يعكس التواجد الفعلي (مرغوب لكنه تغيير دلالة).

### #13 — الشات يتجمّد بعد ٢٠٠ رسالة (يجلب الأقدم لا الأحدث) (شدّة: 🟠 عالية · دفعة هـ)
- **الملفات:** `src/lib/actions/chat.ts:51-56`
- **الكود الحالي:**
```ts
const rows = await prisma.chatMessage.findMany({
  where,
  select: { id: true, body: true, senderId: true, createdAt: true, sender: { select: { name: true } } },
  orderBy: { createdAt: "asc" },
  take: 200,
});
```
- **الكود المقترح:**
```ts
// آخر ٢٠٠ رسالة (الأحدث) ثم عكس الترتيب للعرض تصاعديًا
const rows = (await prisma.chatMessage.findMany({
  where,
  select: { id: true, body: true, senderId: true, createdAt: true, sender: { select: { name: true } } },
  orderBy: { createdAt: "desc" },
  take: 200,
})).reverse();
```
- **مخطط Prisma:** لا (الفهارس الموجودة تخدم `desc` بنفس الكفاءة)
- **قرار مطلوب من المالك:** لا
- **المخاطر:** شبه معدومة — نفس الشكل قبل ٢٠٠ رسالة؛ بعده يعرض أحدث ٢٠٠ (الصحيح).

### #14 — جدول العملاء والكانبان بلا ترقيم server-side (شدّة: 🟠 عالية · دفعة هـ)
- **الملفات:** `src/lib/data/leads.ts:218-250` (`getLeads`) · `src/app/api/leads/route.ts:31-32` · `src/components/leads/leads-view.tsx:25,64-66` · `src/components/leads/kanban-board.tsx:32`
- **الكود الحالي:**
```ts
// data/leads.ts:244-249 — كل الصفوف المطابقة + include (بلا take)
const leads = await prisma.lead.findMany({
  where: { ...where, ...(and.length ? { AND: and } : {}) },
  orderBy: [{ createdAt: "desc" }],
  include: rowInclude,
});
// leads-view.tsx:25,64-66 — الترقيم بعد التنزيل الكامل
const PAGE_SIZE = 12;
const pageRows = rows.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);
```
- **الكود المقترح (مرحلي):**
```ts
// المرحلة ١ (فوري): سقف أمان
const MAX_ROWS = 500;
const leads = await prisma.lead.findMany({ where: fullWhere, orderBy: [{ createdAt: "desc" }], include: rowInclude, take: MAX_ROWS });

// المرحلة ٢ (الجدول): take/skip + العدد الإجمالي — التوقيع يتغيّر
export async function getLeads(filters: LeadFilters = {}, page?: { skip: number; take: number })
  : Promise<{ rows: LeadRow[]; total: number }> {
  const [leads, total] = await Promise.all([
    prisma.lead.findMany({ where: fullWhere, orderBy: [{ createdAt: "desc" }], include: rowInclude,
      ...(page ? { skip: page.skip, take: page.take } : { take: MAX_ROWS }) }),
    prisma.lead.count({ where: fullWhere }),
  ]);
  return { rows: leads.map(toRow), total };
}
// المرحلة ٣ (الكانبان): جلب لكل عمود take: 50 + groupBy للعدّ → «٥٠ من ١٣٢»
```
- **مخطط Prisma:** لا (فهرس `Lead.createdAt` من #28 يخدم الترتيب)
- **قرار مطلوب من المالك:** **نعم** — (أ) سقف سريع `take: 500` فقط، (ب) ترقيم كامل (جدول + كانبان + تعديل «تحديد الكل» — يوم-يومين عمل). **التوصية: مرحلي** — السقف فوراً ضمن هذه الدفعة، والترقيم الكامل مهمة مستقلة قبل ~١٠٠٠ عميل.
- **المخاطر:** متوسطة — تغيير توقيع `getLeads` يمس كل مستهلكي `useLeads`؛ «تحديد الكل» تعتمد على وجود كل الصفوف بالذاكرة؛ السقف قد يُخفي عملاء قدامى فوق الـ٥٠٠ — يُعرض تنبيه «النتائج مقصوصة» مع العدّ الحقيقي.

### #15 — أخطاء Prisma خام تظهر بالواجهة العربية (شدّة: 🟡 متوسطة · دفعة و)
- **الملفات:** `src/lib/actions/leads.ts:171-173` (و~٤٠ catch مماثل)، `src/components/leads/leads-view.tsx:82`، **جديد:** `src/lib/action-error.ts`
- **الكود الحالي:**
```ts
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
// leads-view.tsx:82 — الرسالة تظهر في alert()
      if (!res.ok && res.error) alert(res.error);
```
- **الكود المقترح:**
```ts
// جديد: src/lib/action-error.ts
import { Prisma } from "@prisma/client";

const P_MESSAGES: Record<string, string> = {
  P2002: "فيه سجل بنفس البيانات موجود مسبقًا",
  P2025: "السجل ما هو موجود — يمكن انحذف قبل شوي، حدّث الصفحة",
  P2003: "ما نقدر ننفّذ العملية — فيه بيانات مرتبطة بهذا السجل",
  P1001: "تعذّر الاتصال بقاعدة البيانات — حاول بعد شوي",
  P1002: "الاتصال بقاعدة البيانات تأخّر — حاول بعد شوي",
};

/** يحوّل أي خطأ لرسالة سعودية آمنة للواجهة، ويسجّل التفاصيل الكاملة server-side. */
export function toUserError(e: unknown, context?: string): string {
  console.error(`[action]${context ? ` ${context}` : ""}`, e);
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    return P_MESSAGES[e.code] ?? "صار خطأ في قاعدة البيانات — حاول مرة ثانية";
  }
  const msg = e instanceof Error ? e.message : "";
  if (/[؀-ۿ]/.test(msg)) return msg; // رسائلنا العربية تمرّ كما هي
  return "صار خطأ غير متوقّع — حاول مرة ثانية";
}

// الاستخدام: } catch (e) { return { ok: false, error: toUserError(e, "lead.updateStage") }; }
```
- **مخطط Prisma:** لا
- **قرار مطلوب من المالك:** لا
- **المخاطر:** منخفضة جداً. التطبيق على ~٤٠ إجراء **مسح ميكانيكي**. فحص `[؀-ۿ]` يُبقي رسائلنا العربية المقصودة.

### #16 — كاست enum من FormData بلا فحص (شدّة: 🟡 متوسطة · دفعة و)
- **الملفات:** `src/lib/actions/bookings.ts:79-92,165,281`، `src/lib/actions/projects.ts:45,102`، `src/lib/actions/leads.ts:57`، **جديد:** `src/lib/parse-enum.ts`
- **الكود الحالي:**
```ts
    const paymentMethod = (String(formData.get("paymentMethod") ?? "CASH") as PaymentMethod);
    const bankRaw = String(formData.get("bankName") ?? "");
    const bankName = bankRaw ? (bankRaw as SaudiBank) : null;
```
- **الكود المقترح:**
```ts
// جديد: src/lib/parse-enum.ts
/** يقرأ قيمة enum بأمان: يرجّعها لو ضمن القيم المسموحة، وإلا fallback (أو null). */
export function parseEnum<T extends Record<string, string>>(
  enumObj: T,
  raw: unknown,
  fallback?: T[keyof T],
): T[keyof T] | null {
  const v = String(raw ?? "").trim();
  if (v && v in enumObj) return v as T[keyof T];
  return fallback ?? null;
}

// bookings.ts:
    const paymentMethod = parseEnum(PaymentMethod, formData.get("paymentMethod"), PaymentMethod.CASH)!;
    const bankName = parseEnum(SaudiBank, formData.get("bankName"));
    const cashPaymentType = parseEnum(CashPaymentType, formData.get("cashPaymentType"));
```
- **مخطط Prisma:** لا
- **قرار مطلوب من المالك:** لا — توحيد مع النمط الموجود أصلاً في `followups` route.
- **المخاطر:** منخفضة. قيمة خاطئة كانت ترمي خطأ Prisma — الآن تسقط لـfallback/null بصمت؛ للحقول الإجبارية يبقى فحص «اختر البنك» بعدها.

### #17 — numOf يمرّر NaN + تواريخ غير صالحة (شدّة: 🟡 متوسطة · دفعة و)
- **الملفات:** `src/lib/actions/bookings.ts:39-42,85-92`
- **الكود الحالي:**
```ts
// "1.2.3" → Number = NaN يمرّ للحسابات
const numOf = (fd: FormData, key: string): number | null => {
  const v = String(fd.get(key) ?? "").replace(/[^\d.]/g, "");
  return v ? Number(v) : null;
};
const checkDateRaw = String(formData.get("expectedCheckDate") ?? "");
const expectedCheckDate = checkDateRaw ? new Date(checkDateRaw) : null; // Invalid Date يصل Prisma
```
- **الكود المقترح:**
```ts
/** رقم مالي آمن: null لو فارغ؛ يرمي رسالة عربية لو غير صالح أو سالب. */
const numOf = (fd: FormData, key: string, label: string): number | null => {
  const raw = String(fd.get(key) ?? "").trim();
  if (!raw) return null;
  const n = Number(raw.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n) || n < 0) throw new Error(`قيمة «${label}» غير صحيحة`);
  return n;
};
/** تاريخ آمن: null لو فارغ؛ يرمي رسالة عربية لو غير صالح. */
const dateOf = (fd: FormData, key: string, label: string): Date | null => {
  const raw = String(fd.get(key) ?? "").trim();
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new Error(`تاريخ «${label}» غير صحيح`);
  return d;
};
```
- **مخطط Prisma:** لا
- **قرار مطلوب من المالك:** لا
- **المخاطر:** منخفضة. **تنسيق صريح مع #7:** هذا البند = حراسة NaN/Invalid Date/السالب فقط؛ قواعد المال (`discount ≤ price`…) في #7. الرسائل المرمية تلتقطها catch وتصل عربية (تتكامل مع #15).

### #18 — «غير مهتم — الموقع/المساحة/السعر» تنقل العميل لـ«تفاوض» (شدّة: 🟡 متوسطة · دفعة ح)
- **الملفات:** `src/lib/labels.ts:286-288` (يُستهلك في `followups/route.ts:76`)
- **الكود الحالي:**
```ts
  NOT_INTERESTED_LOCATION: "NEGOTIATION",
  NOT_INTERESTED_SPACE: "NEGOTIATION",
  NOT_INTERESTED_PRICE: "NEGOTIATION",
  NOT_INTERESTED_FINAL: "CLOSED_LOST",
```
- **الكود المقترح:** لا كود قبل قرارك — قرار تجاري بحت:
```ts
// الخيار ١ — إبقاء الحالي (الاعتراض = فرصة تفاوض) + توثيق النية بتعليق
// الخيار ٢ — نقلها لـ ATTEMPTED (محايد، يبقى مفتوحاً بلا إيحاء تقدّم زائف)
// الخيار ٣ — CLOSED_LOST (يخرج من الكانبان النشط ومن دورة إعادة التوجيه)
```
- **مخطط Prisma:** لا
- **قرار مطلوب من المالك:** **نعم** — جوهر المشكلة تناقض العرض: «غير مهتم» بالمتابعات لكنه «تفاوض» بالكانبان، ويبقى داخل دورة إعادة التوجيه. إن كانت فلسفتكم «الاعتراض بداية التفاوض» فالخيار ١ + توثيق يكفي، وإلا الخيار ٢ أصدق (الخيار ٣ قاسٍ لأن اعتراض السعر قابل للحل).
- **المخاطر:** الخيار ٢/٣ يغيّر مسار عملاء مستقبليين فقط (لا أثر رجعي) — يُبلَّغ الفريق. مرتبط بـ#19 لو اختير الخيار ٣.

### #19 — حلقة السحب لا تستثني `CLOSED_LOST` (شدّة: 🟡 متوسطة · دفعة د)
- **الملفات:** `src/lib/auto-distribute.ts:12,302-312`
- **الكود الحالي:**
```ts
const ADVANCED_STAGES = ["RESERVED", "CLOSED_WON"] as const;
// ... where: stage: { notIn: [...ADVANCED_STAGES] }
```
- **الكود المقترح:**
```ts
// المراحل المُستثناة من إعادة التوجيه: حجز/بيع + مقفول-خسارة (انتهى، ما له داعي يتنقّل)
const ADVANCED_STAGES = ["RESERVED", "CLOSED_WON", "CLOSED_LOST"] as const;
```
- **مخطط Prisma:** لا · **قرار مطلوب من المالك:** لا
- **المخاطر:** شبه معدومة. عميل وُسم `CLOSED_LOST` بالغلط يُرجَع يدوياً (متسق مع بقية المراحل المقفولة).

### #20 — متابعة الزيارة لا تُعتبر «تواصلاً» → موظف قابل العميل ثم يُسحب منه (شدّة: 🟡 متوسطة · دفعة د)
- **الملفات:** `src/app/api/leads/[id]/followups/route.ts:77,113`
- **الكود الحالي:**
```ts
const bumpsAttempt = type === "CALL" || type === "WHATSAPP";
// «تواصل» يوقف عدّاد إعادة التوجيه: متابعة مكالمة/واتساب أو تحديد موعد قادم.
if (bumpsAttempt || nextDate) await markContacted(tx, id);
```
- **الكود المقترح (التوصية — أي متابعة مسجّلة = تواصل):**
```ts
const bumpsAttempt = type === "CALL" || type === "WHATSAPP"; // عدّاد المحاولات يبقى للمكالمات/واتساب فقط
// أي متابعة مسجّلة دليل تعامل فعلي مع العميل → توقف عدّاد إعادة التوجيه
await markContacted(tx, id);
// البديل الأضيق: const isContact = bumpsAttempt || type === "VISIT_PROJECT" || type === "VISIT_OFFICE";
```
- **مخطط Prisma:** لا
- **قرار مطلوب من المالك:** **نعم** — (أ) أي متابعة = تواصل (**التوصية**؛ `attempts` يظل للمكالمات فلا يتأثر)؛ (ب) الزيارات فقط تُضاف — أضيق لكن يُبقي نوع `OTHER` ثغرة سحب.
- **المخاطر:** الخيار (أ) يفتح باباً نظرياً للتحايل (متابعة «أخرى» شكلية) — لكن التسجيل أثر مرئي للمدير؛ الوضع الحالي أسوأ (سحب ظالم بعد اجتماع حقيقي).

### #21 — التوزيع التلقائي يتجاهل `maxClients` كلياً (شدّة: 🟡 متوسطة · دفعة د)
- **الملفات:** `src/lib/auto-distribute.ts:68-84` (presentParticipants) · `197-209` (availableParticipants) · مقارنةً بـ`team.ts:161-173`
- **الكود الحالي:**
```ts
const users = await db.user.findMany({
  where: { id: { in: settings.distOrder }, active: true },
  select: { id: true, availabilityPaused: true, pauseUntil: true },
});
const ok = new Set(
  users
    .filter((u) => !u.availabilityPaused || (u.pauseUntil != null && u.pauseUntil <= now))
    .map((u) => u.id),
);
```
- **الكود المقترح (في الدالتين):**
```ts
const users = await db.user.findMany({
  where: { id: { in: settings.distOrder }, active: true },
  select: { id: true, availabilityPaused: true, pauseUntil: true, maxClients: true,
            _count: { select: { assignedLeads: { where: { isArchived: false } } } } },
});
const ok = new Set(
  users
    .filter((u) => !u.availabilityPaused || (u.pauseUntil != null && u.pauseUntil <= now))
    // من بلغ حدّه الأقصى (maxClients) يخرج من الدور — نفس منطق التوزيع اليدوي
    .filter((u) => u.maxClients == null || u._count.assignedLeads < u.maxClients)
    .map((u) => u.id),
);
```
- **مخطط Prisma:** لا (`User.maxClients` موجود)
- **قرار مطلوب من المالك:** لا للمبدأ؛ تنبيه سلوكي: عند امتلاء الكل تتراكم العملاء «بلا موزَّع» حتى تُفرَّغ السعات — وهذا غرض الحد أصلاً.
- **المخاطر:** كلفة `_count` لكل مشارك (استعلام join واحد — مقبول)؛ دفعة كبيرة قد تتجاوز الحد ما لم يُتتبَّع الحمل محلياً داخل الحلقة — يُحدَّث العدّاد المحلي في نفس الدفعة.

### #22 — `reassignCount` بلا سقف → ping-pong أبدي (شدّة: 🟡 متوسطة · دفعة د)
- **الملفات:** `src/lib/auto-distribute.ts:302-312,332-337` · `prisma/schema.prisma:383`
- **الكود الحالي:**
```ts
await tx.lead.update({
  where: { id: lead.id },
  data: { assignedToId: toUserId, assignedAt: now, reassignCount: { increment: 1 } },
});
```
- **الكود المقترح:**
```ts
const MAX_REASSIGNS = 3; // سقف التنقّلات التلقائية قبل التصعيد للمالك
// في where حلقة overdue:
reassignCount: { lt: MAX_REASSIGNS },
// وبعد جلب overdue — تصعيد من بلغ السقف (مرة واحدة، مع dedup عبر Notification الموجود):
const capped = await prisma.lead.findMany({
  where: { assignedToId: { not: null }, assignedAt: { not: null, lte: cutoff },
           contactedAt: null, isArchived: false,
           stage: { notIn: [...ADVANCED_STAGES] }, reassignCount: { gte: MAX_REASSIGNS } },
  select: { id: true, name: true },
});
if (capped.length) await notify(prisma, await ownerIds(prisma), "dist.capped",
  "عملاء تجاوزوا حد إعادة التوجيه",
  `${capped.length} عميل تنقّل ${MAX_REASSIGNS} مرات بلا تواصل — يحتاجون تدخّلك`);
```
- **مخطط Prisma:** لا للسقف — **نعم اختيارياً** لمنع تكرار إشعار التصعيد (`reassignCapNotified Boolean`)؛ التوصية للمرحلة الأولى: dedup بفحص إشعار سابق بنفس الرابط (بلا مخطط).
- **قرار مطلوب من المالك:** **نعم** — (١) قيمة السقف (التوصية **٣**)؛ (٢) سلوك البلوغ: (أ) **يبقى مع آخر موظف** + إشعار للمالك (**التوصية**) (ب) يرجع «بلا موزَّع» — لكن `distributeUnassignedPass` سيلتقطه ويعيد توزيعه فوراً ما لم يُستثنَ (منطق إضافي).
- **المخاطر:** عميل بلغ السقف وموظفه خامل = عالق حتى تدخّل المالك — الإشعار جزء لا يتجزأ؛ يلزم dedup حتى لا يتكرر الإشعار كل جولة كرون.

### #23 — `normalizePurchaseMethod` يفقد تمييز مدعوم/غير مدعوم (شدّة: 🟡 متوسطة · دفعة ج)
- **الملفات:** `src/lib/value-normalize.ts:27-42` · `src/lib/utils/sheet-parse.ts:54-66` (المرجع الصحيح)
- **الكود الحالي:**
```ts
const hasCash = /كاش|نقد/.test(s);
const hasFinance = /تمويل|بنك/.test(s);
if (hasCash && hasFinance) return "CASH_AND_FINANCE";
if (s.includes("الاثنين") || s === "both") return "CASH_AND_FINANCE";
if (hasCash) return "CASH";
if (hasFinance) return "BANK_FINANCE";
return null;
```
- **الكود المقترح (محاذاة مع `sheet-parse.ts` — فحص «غير مدعوم» قبل «مدعوم»):**
```ts
if (hasCash && hasFinance) return "CASH_AND_FINANCE";
if (s.includes("الاثنين") || s === "both") return "CASH_AND_FINANCE";
if (hasFinance && /غير مدعوم/.test(s)) return "BANK_FINANCE_UNSUPPORTED";
if (hasFinance && /مدعوم/.test(s)) return "BANK_FINANCE_SUPPORTED";
if (hasCash) return "CASH";
if (hasFinance) return "BANK_FINANCE"; // تمويل مجرّد بلا تحديد → القديم (توافق)
return null;
```
- **مخطط Prisma:** لا · **قرار مطلوب من المالك:** لا (ملاحظة اختيارية: إعادة تصنيف المستوردين سابقاً backfill منفصل بقرارك)
- **المخاطر:** منخفضة؛ انزياح عدّ `BANK_FINANCE` للقيم الجديدة في الاستيرادات القادمة.

### #24 — `reservedValue` يحسب المسلَّمة ضمن «المحجوز غير المباع» (شدّة: 🟡 متوسطة · دفعة ج)
- **الملفات:** `src/lib/data/analytics.ts:109,125`
- **الكود الحالي:**
```ts
if (b.stage !== "SOLD") reservedValue += final;
// ...
if (b.stage !== "SOLD") row.reservedValue += final;
```
- **الكود المقترح:**
```ts
// «محجوز» = ليس بيعاً مكتملاً — DELIVERED بيع مكتمل مثل SOLD (نفس منطق لوحة الحجوزات)
if (b.stage !== "SOLD" && b.stage !== "DELIVERED") reservedValue += final;
```
- **مخطط Prisma:** لا · **قرار مطلوب من المالك:** لا
- **المخاطر:** «القيمة المحجوزة» ستنخفض بمقدار الوحدات المسلَّمة — انخفاض صحيح، يُبلَّغ حتى لا يُفهم كخلل.

### #25 — هشاشة `lastRowSynced` المعتمد على رقم الصف (شدّة: 🟡 متوسطة · دفعة ح)
- **الملفات:** `src/lib/sheet-sync-google.ts:51-54,92-97`، `src/app/api/sync-sheets/route.ts:18-21`
- **الكود الحالي:**
```ts
    const endRow = opts?.limit != null ? link.lastRowSynced + opts.limit + 1 : undefined;
    const parsed = parseRowsByContent(values, { startDataIndex: link.lastRowSynced, limit: opts?.limit });
    // حذف صف من الشيت = المؤشر يتخطّى صفًا جديدًا للأبد
    const newLastRow = link.lastRowSynced + leads.length;
```
- **الكود المقترح (الخيار ٢ — إعادة مسح كاملة دورية):**
```ts
// sync-sheets/route.ts — بارامتر full=1 يعيد المسح من الصف الأول (فحص الجوال يمنع التكرار):
  const full = url.searchParams.get("full") === "1";
  const res = await syncAllSheetLinks({ ...(limit != null ? { limit } : {}), full });

// sheet-sync-google.ts:
export async function syncSheetLink(link: LinkWithSource, opts?: { limit?: number; full?: boolean }) {
    const startIndex = opts?.full ? 0 : link.lastRowSynced;
    const parsed = parseRowsByContent(values, { startDataIndex: startIndex, limit: opts?.limit });
    // في الجولة الكاملة لا نرجّع المؤشّر للخلف:
    const newLastRow = Math.max(link.lastRowSynced, startIndex + leads.length);

// كرون إضافي ليلي (٣ فجرًا): curl ".../api/sync-sheets?secret=…&full=1"
```
- **مخطط Prisma:** لا
- **قرار مطلوب من المالك:** **نعم** — (١) توثيق «الشيت append-only» + تحذير بالواجهة (يعتمد انضباط بشري) (٢) **إعادة مسح كاملة ليلية** ← **التوصية** (تلتقط أي صف ضائع خلال ٢٤ ساعة وdedup الجوال يمنع التكرار) (٣) checksum لكل صف (تعقيد غير مبرّر حالياً).
- **المخاطر:** الجولة الكاملة تقرأ حتى ١٠٬٠٠٠ صف — تُشغَّل ليلاً؛ الصفوف غير الصالحة تُعاد معالجتها كل جولة كاملة (skipped يرتفع — غير ضار).

### #26 — سباق `distPointer` + استعلامات لكل صف في `runSheetSync` (شدّة: 🟡 متوسطة · دفعة ح)
- **الملفات:** `src/lib/sheet-sync.ts:132-170`، `src/lib/auto-distribute.ts:141-156`
- **الكود الحالي:**
```ts
// داخل حلقة الصفوف: كل صف = getDistSettings (upsert!) + presentParticipants + update للمؤشر
    let assignedToId: string | null = await pickInitialAssignee(prisma);
// auto-distribute.ts:152-155 — قراءة المؤشر ثم كتابته في خطوتين غير ذرّيتين:
  const picked = pickRotation(settings.distOrder, new Set(present), settings.distPointer);
  if (!picked) return null;
  await db.settings.update({ where: { id: "singleton" }, data: { distPointer: picked.pointer } });
```
- **الكود المقترح:**
```ts
// (أ) في runSheetSync: حمّل الإعدادات والمتواجدين مرة واحدة للدفعة، وتتبّع المؤشر محلياً
//     (نفس نمط distributeUnassignedPass)، واكتب المؤشر مرة في النهاية.
// (ب) ضد تزامن كرونين: تقدّم ذرّي (تفاؤلي) للمؤشر داخل pickInitialAssignee:
const rows = await db.$queryRaw<{ distPointer: number }[]>`
  UPDATE "Settings" SET "distPointer" = ${picked.pointer}
  WHERE "id" = 'singleton' AND "distPointer" = ${settings.distPointer}
  RETURNING "distPointer"`;
if (rows.length === 0) return null; // كرون آخر سبقنا — تخطَّ بدل إسناد مزدوج
```
- **مخطط Prisma:** لا (يُتحقق من اسم الجدول الفعلي قبل التنفيذ)
- **قرار مطلوب من المالك:** لا — لكن **يتوقف على قرار #34**: لو أُقر إيقاف المسار القديم، يُحذف `runSheetSync` كاملاً ويبقى فقط الإصلاح الذرّي (ب) في `pickInitialAssignee` (يستدعيه `createLead` أيضاً).
- **المخاطر:** متوسطة-منخفضة. التعارض النادر يُسقط الإسناد لتلك الجولة (يبقى غير موزّع وتلتقطه `distributeUnassignedPass`) — أهون من عميلين لنفس الموظف.

### #27 — التحليلات تقرأ جداول كاملة للذاكرة (شدّة: 🟡 متوسطة · دفعة هـ)
- **الملفات:** `src/lib/data/analytics.ts:77-82` (getAnalytics) · `473-482` (getEmployeeDeepAnalysis) · `551-557` (getAllProjectsFinance)
- **الكود الحالي:**
```ts
const [allLeads, fuByType, employees, myBookings] = await Promise.all([
  prisma.lead.findMany({
    select: { assignedToId: true, stage: true, isArchived: true, purchaseGoal: true, purchaseMethod: true, createdAt: true, firstContactAt: true, nextFollowup: true, lastContact: true, name: true, phone: true },
  }),                                                    // ← كل عملاء النظام
  // ...
]);
const myLeads = allLeads.filter((l) => l.assignedToId === userId);   // التصفية في JS
```
- **الكود المقترح (نمط تمثيلي — يُطبَّق على الدوال الثلاث):**
```ts
const [myLeads, fuByType, myBookings, teamStageGroups] = await Promise.all([
  prisma.lead.findMany({ where: { assignedToId: userId }, select: { /* بلا name/phone */ } }),
  prisma.followUp.groupBy({ by: ["type"], where: { createdBy: userId }, _count: { _all: true } }),
  prisma.booking.findMany({ where: { sellerId: userId }, select: { stage: true } }),
  prisma.lead.groupBy({ by: ["assignedToId", "stage"], where: { assignedToId: { in: empIds } }, _count: { _all: true } }),
]);
// متوسط سرعة الرد للفريق عبر استعلام خام واحد:
const [{ avg_h }] = await prisma.$queryRaw<[{ avg_h: number | null }]>`
  SELECT AVG(EXTRACT(EPOCH FROM ("firstContactAt" - "createdAt")) / 3600) AS avg_h
  FROM "Lead" WHERE "assignedToId" = ANY(${empIds}) AND "firstContactAt" IS NOT NULL
    AND "firstContactAt" >= "createdAt"`;
```
- **مخطط Prisma:** لا · **قرار مطلوب من المالك:** لا (يُقسَّم على دفعات مراجعة)
- **المخاطر:** **الأرقام يجب أن تطابق المخرجات القديمة حرفياً** — مقارنة جنباً-إلى-جنب (JSON قبل/بعد) قبل حذف الكود القديم، خصوصاً الحواف: `firstContactAt < createdAt`، العملاء المُسندون لغير النشطين، والتقريب.

### #28 — فجوات مخطط: فهارس ناقصة + `onDelete` + فهرس/قيد جوال العميل (شدّة: 🟡 متوسطة · دفعة ز)
- **الملفات:** `prisma/schema.prisma` (Lead / FollowUp / Booking / Notification / AuditLog / SheetLink) · حارس الحذف التطبيقي: `src/lib/actions/sources.ts:48-50`
- **الكود الحالي:**
```prisma
model Lead {
  phone        String            // ← بلا unique ولا index
  @@index([stage]) @@index([assignedToId]) @@index([nextFollowup])
  @@index([isArchived]) @@index([assignedAt]) @@index([sourceId])   // ← لا createdAt
}
model FollowUp     { @@index([leadId]) @@index([createdBy]) }        // ← لا createdAt
model Booking      { @@index([stage]) @@index([sellerId]) @@index([leadId]) } // ← لا createdAt
model Notification { @@index([userId, read]) @@index([createdAt]) }  // ← الاستعلام الأهم userId+createdAt
model AuditLog     { @@index([createdAt]) @@index([action]) }        // ← لا userId
model SheetLink    { source LeadSource @relation(fields: [sourceId], references: [id]) } // ← بلا onDelete صريح
```
- **الكود المقترح:**
```prisma
model Lead {
  @@index([createdAt])   // orderBy الجدول/الكانبان + تقارير الفترات
  @@index([phone])       // كشف التكرار (phoneVariants IN) + البحث بالرقم
}
model FollowUp { @@index([createdAt]) }
model Booking  { @@index([createdAt]) }
model Notification {
  @@index([userId, createdAt])  // استعلام الجرس/المركز كل نبضة
  // يبقى @@index([userId, read]) — ويُحذف @@index([createdAt]) المفرد (مغطّى)
}
model AuditLog { @@index([userId]) }
model SheetLink {
  source LeadSource @relation(fields: [sourceId], references: [id], onDelete: Restrict) // صريح وموثّق
}
```
- **مخطط Prisma:** **نعم** — فهارس + توثيق `Restrict` (non-breaking على مستوى البيانات). **⛔ تحذير إلزامي: لا يُنشأ أي ترحيل قبل ترحيل baseline** (الانحراف القائم موثّق) — وإلا `migrate dev/deploy` قد يحاول إعادة بناء جداول قائمة.
- **قرار مطلوب من المالك:** **نعم** — جوال العميل: (أ) `@unique` (منع التكرار نهائياً — لكن **الإنتاج قد يحتوي مكررات وصيغاً غير موحّدة**، فالترحيل سيفشل قبل التنظيف؛ ويمنع حالة مشروعة: نفس الرقم عميل قديم خاسر + جديد)، (ب) **`@@index([phone])` فقط + فحص تطبيقي (#31) — التوصية**، والقيد الفريد خطوة لاحقة شرطها تطبيع + دمج المكررات (سكربت مستقل). `SheetLink.source`: التوصية `Restrict` صريح (حارس `deleteSource` التطبيقي يسبقه برسالة ودّية؛ `Cascade` مرفوض — يسحب روابط حيّة بصمت).
- **المخاطر:** متوسطة — أي ترحيل قبل الـbaseline خطر على الإنتاج؛ إنشاء الفهارس يقفل الكتابة لحظياً (حجم البيانات الحالي صغير — غير مؤثر)؛ حذف فهرس `Notification.createdAt` المفرد بعد التأكد أنه لا يخدم استعلاماً آخر (الفحص الحالي: لا يوجد).

### #29 — createLead بلا try/catch + فشل الإشعارات بعد الحفظ يُظهر خطأً زائفًا (شدّة: 🟡 متوسطة · دفعة و)
- **الملفات:** `src/lib/actions/leads.ts:48-143`، `src/lib/actions/bookings.ts:221-237`، **جديد:** `notifyBestEffort` في `src/lib/notifications/emit.ts`
- **الكود الحالي:**
```ts
// leads.ts:48-49 — كامل الدالة بلا try/catch: أي رمية = خطأ Next خام للواجهة
export async function createLead(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
// leads.ts:129-139 — بعد نجاح prisma.lead.create: فشل هنا يُظهر خطأ رغم أن العميل انحفظ
  await logAudit(prisma, { userId: user.id, action: "lead.created", ... });
  if (assignedToId && assignedToId !== user.id) {
    await emitNotification({ eventKey: "lead_assigned", ... });
  }
```
- **الكود المقترح:**
```ts
/** آثار جانبية بعد الـcommit (إشعار/تدقيق): فشلها يُسجَّل ولا يُفشل العملية. */
export async function notifyBestEffort(context: string, fn: () => Promise<unknown>): Promise<void> {
  try { await fn(); } catch (e) { console.error(`[post-commit] ${context}`, e); }
}

// createLead: تغليف كامل الجسم بـ try/catch (يرجع toUserError من #15) + عزل ما بعد الحفظ:
    await notifyBestEffort("lead.created", () => logAudit(prisma, { ... }));
    if (assignedToId && assignedToId !== user.id) {
      await notifyBestEffort("lead.assigned", () => emitNotification({ ... }));
    }
// createBooking: نفس التغليف حول emitNotification و notify تجاوز الخصم
```
- **مخطط Prisma:** لا · **قرار مطلوب من المالك:** لا
- **المخاطر:** منخفضة. يمنع «خطأ ظاهر → إعادة محاولة → عميل مكرر». لا تُعزل عمليات **داخل** `$transaction` (تبقى ذرّية).

### #30 — المساعد بلا حدود مدخلات ولا timeout (شدّة: 🟡 متوسطة · دفعة و)
- **الملفات:** `src/app/api/assistant/route.ts:23-28,49-68`، `src/app/api/analyze-lead/route.ts:78-88`، `src/lib/google-sheets.ts:38,64`
- **الكود الحالي:**
```ts
    question = String(body?.question ?? "").trim();  // لا حد للطول
    // ...
    const res = await fetch("https://api.anthropic.com/v1/messages", {  // بلا timeout
```
- **الكود المقترح:**
```ts
    question = String(body?.question ?? "").trim().slice(0, 2000);
    history = body.history.filter(...).slice(-8)
      .map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      signal: AbortSignal.timeout(30_000),
      // ...
    });
// analyze-lead: نفس signal · google-sheets.ts: { timeout: 30_000 } لطلبات googleapis
```
- **مخطط Prisma:** لا · **قرار مطلوب من المالك:** لا (الحدود قابلة للتعديل لاحقاً)
- **المخاطر:** منخفضة. `TimeoutError` يلتقطه catch الموجود (analyze-lead يسقط للتقدير الحسابي).

### #31 — تطبيع الجوال غائب في الإنشاء/التعديل اليدوي (شدّة: 🟡 متوسطة · دفعة ز)
- **الملفات:** `src/lib/actions/leads.ts:52-55` (createLead) · `leads.ts:340` (updateLead) · الأدوات: `src/lib/value-normalize.ts:49-70`
- **الكود الحالي:**
```ts
// createLead — يخزّن الخام (يقبل 5XXXXXXXX بلا صفر و966...)
const phone = String(formData.get("phone") ?? "").trim();
if (!/^\d{9,10}$/.test(phone.replace(/\s/g, "")))
  return { ok: false, error: "رقم جوال غير صحيح" };
// updateLead — تنظيف أرقام فقط بلا تطبيع:
...(data.phone ? { phone: data.phone.replace(/[^\d]/g, "") } : {}),
```
- **الكود المقترح:**
```ts
import { normalizePhone, phoneVariants } from "@/lib/value-normalize";

// createLead — توحيد الصيغة + فحص التكرار قبل الإنشاء (app-level):
const phone = normalizePhone(String(formData.get("phone") ?? ""));
if (!/^05\d{8}$/.test(phone))
  return { ok: false, error: "رقم الجوال غير صحيح — لازم يكون بصيغة 05XXXXXXXX" };
const dup = await prisma.lead.findFirst({
  where: { phone: { in: phoneVariants(phone) } },   // يلتقط الصيغ القديمة بالقاعدة
  select: { id: true, name: true },
});
if (dup) return { ok: false, error: `الرقم مسجّل مسبقًا للعميل «${dup.name}»` };

// updateLead — نفس التطبيع والتحقق قبل الكتابة
```
- **مخطط Prisma:** لا — **الجزء البرمجي يعمل فوراً بلا مخطط**؛ البند في دفعة ز فقط لأنه مكمّل لقرار #28 (فهرس `phone` يسرّعه، وقرار unique-لاحقاً يعتمد عليه).
- **قرار مطلوب من المالك:** **نعم** — فحص التكرار: (أ) **يمنع الإنشاء برسالة — التوصية** (متسق مع المزامنة)، (ب) يحذّر ويسمح (زر «أضف على أي حال»).
- **المخاطر:** منخفضة — النمط `05XXXXXXXX` يرفض أرقاماً غير سعودية كانت تمرّ (لو فيه عملاء بأرقام خليجية يلزم استثناء)؛ البيانات القديمة غير المطبّعة تُلتقط عند الإدخال الجديد لكن لا تُوحَّد بأثر رجعي (سكربت التطبيع = متطلب مسبق للقيد الفريد).

### #32 — `?stages=` بلا تحقق + `new Date` بلا فحص في الفلاتر (شدّة: 🟡 متوسطة · دفعة و)
- **الملفات:** `src/lib/lead-filters.ts:1,27`، `src/app/api/leads/route.ts:25-31`، `followups/route.ts:74`
- **الكود الحالي:**
```ts
import type { LeadStage } from "@prisma/client";
  const stages = (sp.stages ? sp.stages.split(",").filter(Boolean) : []) as LeadStage[];
// followups/route.ts:74
  const nextDate = body.nextDate ? new Date(body.nextDate) : null;
```
- **الكود المقترح:**
```ts
import { LeadStage } from "@prisma/client"; // قيمة runtime لا نوع فقط
  const stages = (sp.stages ? sp.stages.split(",").filter(Boolean) : [])
    .filter((s): s is LeadStage => s in LeadStage);

// followups/route.ts:
  let nextDate: Date | null = null;
  if (body.nextDate) {
    nextDate = new Date(body.nextDate);
    if (Number.isNaN(nextDate.getTime())) {
      return NextResponse.json({ error: "تاريخ المتابعة غير صحيح" }, { status: 400 });
    }
  }
```
- **مخطط Prisma:** لا · **قرار مطلوب من المالك:** لا
- **المخاطر:** منخفضة جداً — تغيير `import type` إلى `import` يجعل `lead-filters.ts` يعتمد قيمة runtime (يُستورد في مكوّنات عميل — enum بريزما كائن JS عادي، يستحق فحص build). قيمة خاطئة تُتجاهل بصمت بدل شاشة 500 — وهذا المطلوب.

### #33 — توحيد عرض العملة على الكامل (شدّة: ⚪ منخفضة · دفعة ح)
- **الملفات:** `src/lib/format.ts:56-65`، `units-grid.tsx:81-88`، `projects-view.tsx:50-51,145`، `bookings-list.tsx:40-41`، `kanban-board.tsx:153-154`، `dashboard-view.tsx:225`، `projects/[id]/page.tsx:58-59`، `CLAUDE.md:27`
- **الكود الحالي:**
```ts
export function formatCurrency(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${formatNumberShort(n)} ر.س`;   // ٦٩٠ك / ١.٢م
}
```
```md
5. **السعودي:** العملة `ر.س`، اختصار الأرقام (٦٩٠ك / ١.٢م)، رقم ترخيص فال (REGA) بالواجهة، أسماء بنوك سعودية.
```
- **الكود المقترح:**
```ts
// في المكوّنات الستة: استبدال ميكانيكي formatCurrency → formatCurrencyFull (+ تحديث import)
```
```md
5. **السعودي:** العملة `ر.س` بالقيمة الكاملة بفواصل (١٬٢٥٠٬٠٠٠ ر.س) — لا اختصار للمبالغ؛ اختصار (٦٩٠ك/١.٢م) للأعداد غير المالية فقط عند الضيق، رقم ترخيص فال (REGA) بالواجهة، أسماء بنوك سعودية.
```
- **مخطط Prisma:** لا
- **قرار مطلوب من المالك:** **نعم** — بطاقات KPI الضيقة قد يكسرها رقم مثل ٤٥٬٦٥٠٬٠٠٠ ر.س: (١) **كامل في كل مكان** (مع تصغير خط البطاقات/`tabular-nums`) ← **التوصية** (٢) كامل إلا بطاقات KPI في اللوحات (استثناء موثّق).
- **المخاطر:** بصرية فقط — فحص عرض البطاقات على الجوال بعد التبديل.

### #34 — نظاما مزامنة شيت حيّان بسرّين وتسمية مضلّلة (شدّة: ⚪ منخفضة · دفعة ح)
- **الملفات:** `src/lib/sheet-sync.ts` (القديم CSV)، `src/lib/sheet-sync-google.ts` (الجديد API)، `api/sync-sheet` (SYNC_SECRET)، `api/sync-sheets` (CRON_SECRET)، `settings.ts:50-65`، `settings-form.tsx:98,105-134`، `DEPLOYMENT.md:43,72`، `.env.example:23-25`
- **الكود الحالي:**
```ts
// settings.ts:50-53 — الاسم يوحي بالنظام الجديد لكنه يشغّل القديم (CSV العام + توزيع تلقائي)
export async function syncGoogleSheet(): Promise<SyncResult> {
  try {
    await requireManager();
    const res = await runSheetSync();
```
- **الكود المقترح (الخيار ١):**
```ts
// (أ) إزالة قسم SheetSync من settings-form.tsx وحذف أكشن syncGoogleSheet.
// (ب) /api/sync-sheet يصير 410 خلال فترة سماح (يكشف أي cron قديم لسّه شغال):
export async function GET() {
  return NextResponse.json(
    { ok: false, error: "هذا المسار متوقّف — استخدم /api/sync-sheets (روابط الشيت من صفحة التوزيع)" },
    { status: 410 },
  );
}
// (ج) بعد شهر: حذف route + sheet-sync.ts + SYNC_SECRET، وتحديث DEPLOYMENT.md
```
- **مخطط Prisma:** لا (حقلا `Settings.googleSheetUrl/lastSyncAt` يبقيان مهجورين — تنظيفهما لاحقاً اختياري)
- **قرار مطلوب من المالك:** **نعم** — (١) **إيقاف القديم مع فترة سماح 410** ← **التوصية** (الجديد multi-source وdedup أدق؛ فارق التوزيع التلقائي يعوّضه `distributeUnassignedPass`) (٢) إبقاء الاثنين + وسم «قديم» (٣) حذف فوري (يكسر أي cron قائم بصمت).
- **المخاطر:** متوسطة تشغيلياً: **تحديث cron في Hostinger قبل الإيقاف** + نقل رابط الإعدادات القديم كـ`SheetLink`. **ترابط مع #26:** لو أُقر، `runSheetSync` يختفي ويتقلّص نطاق #26.

### #35 — سكربتات `*-sheet0` بمعرّف إنتاجي و`redo-sheet0` يحذف عملاء (شدّة: ⚪ منخفضة · دفعة أ)
- **الملفات:** `scripts/redo-sheet0.ts:14-31`، `scripts/diag-sheet0.ts:9-13`، `scripts/preview-sheet0.ts:4-5`، `scripts/test-sheet-read.ts:5`
- **الكود الحالي:**
```ts
// scripts/redo-sheet0.ts:15-24 — معرّف شيت إنتاجي hardcoded + حذف فعلي من القاعدة
const values = await readSheetValues("1D8kx9THle1KDJVftcHWKfvrXPrKtUdDBVKCbpoGZbd0", { gid: 2066983452 });
// ...
const del = await prisma.lead.deleteMany({ where: { sourceId: meta.id, phone: { in: phones }, assignedToId: null } });
```
- **الكود المقترح:**
```bash
# التوصية: حذف الأربعة نهائيًا — غرضها (إصلاح دفعة Sheet0 لمرة واحدة) انتهى:
git rm scripts/redo-sheet0.ts scripts/diag-sheet0.ts scripts/preview-sheet0.ts scripts/test-sheet-read.ts
```
```ts
// البديل (لو قررت الإبقاء): حارس تأكيد + المعرّف وسيط:
const SHEET_ID = process.argv[2];
if (!SHEET_ID) { console.error("الاستخدام: npx tsx scripts/redo-sheet0.ts <SHEET_ID> --yes-delete"); process.exit(1); }
if (!process.argv.includes("--yes-delete")) { console.error("⚠️ هذا السكربت يحذف عملاء — أضف --yes-delete"); process.exit(1); }
```
- **مخطط Prisma:** لا
- **قرار مطلوب من المالك:** **نعم** — (١) حذف نهائي (التوصية — التاريخ محفوظ في git) (٢) إبقاء خارج git + حارس.
- **المخاطر:** لا يمس أي منطق تشغيلي — لا تُستورد من `src/` (تحقق: grep بلا نتائج + build يمر).

### #36 — سرّ الكرون في query string يتسجّل باللوقات (شدّة: ⚪ منخفضة · دفعة ب)
- **الملفات:** `api/auto-distribute/route.ts:12-16`، `api/sync-sheets/route.ts:13-16`، `api/notify-scheduled/route.ts:11-14`، `api/sync-sheet/route.ts:9-12`
- **الكود الحالي:**
```ts
export async function GET(req: Request) {
  const secret = new URL(req.url).searchParams.get("secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: "غير مصرّح" }, { status: 401 });
  }
```
- **الكود المقترح:**
```ts
// helper مشترك جديد src/lib/cron-auth.ts — مقارنة ثابتة الزمن + هيدر أولًا مع fallback مؤقت:
import { timingSafeEqual } from "crypto";

export function isCronAuthorized(req: Request, envSecret: string | undefined): boolean {
  if (!envSecret) return false;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const query = new URL(req.url).searchParams.get("secret"); // fallback مؤقت — يُشال بعد الانتقال
  const provided = bearer ?? query;
  if (!provided) return false;
  const a = Buffer.from(provided), b = Buffer.from(envSecret);
  return a.length === b.length && timingSafeEqual(a, b);
}
// أمر cron الجديد: curl -s -H "Authorization: Bearer $CRON_SECRET" https://crm.benaatre.com/api/auto-distribute
```
- **مخطط Prisma:** لا
- **قرار مطلوب من المالك:** **نعم** — (١) **دعم مزدوج مؤقت** ثم إزالة query بعد تحديث كرونات Hostinger/cron-job.org (التوصية — صفر انقطاع) (٢) هيدر فقط فوراً — يكسر الكرونات لحظة النشر حتى تُحدَّث يدوياً.
- **المخاطر:** يمس ٤ مهام كرون خارجية — أي تأخير مع الخيار (٢) = توقف مزامنة/توزيع بصمت (401). فحص الطول قبل `timingSafeEqual` إلزامي (يرمي عند اختلافه).

### #37 — `updateMyPin` يغيّر الرمز بلا تأكيد الرمز الحالي وبلا تدقيق (شدّة: ⚪ منخفضة · دفعة ب)
- **الملفات:** `src/lib/actions/settings.ts:85-97`
- **الكود الحالي:**
```ts
export async function updateMyPin(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const pin = String(formData.get("pin") ?? "").trim();
    if (!/^\d{4,6}$/.test(pin)) return { ok: false, error: "الرمز لازم ٤–٦ أرقام" };
    await prisma.user.update({ where: { id: user.id }, data: { pinHash: bcrypt.hashSync(pin, 10) } });
    return { ok: true };
```
- **الكود المقترح:**
```ts
    const currentPin = String(formData.get("currentPin") ?? "").trim();
    const pin = String(formData.get("pin") ?? "").trim();
    if (!/^\d{4,6}$/.test(pin)) return { ok: false, error: "الرمز لازم ٤–٦ أرقام" };
    // تأكيد الرمز الحالي — جلسة مفتوحة على جهاز مشترك ما تكفي للاستيلاء.
    const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { pinHash: true } });
    if (!dbUser?.pinHash || !bcrypt.compareSync(currentPin, dbUser.pinHash)) {
      return { ok: false, error: "الرمز الحالي غلط" };
    }
    await prisma.user.update({ where: { id: user.id }, data: { pinHash: bcrypt.hashSync(pin, 10) } });
    await logAudit(prisma, { userId: user.id, action: "user.pinChanged", entity: "user", entityId: user.id, summary: "غيّر رمز الدخول (PIN) الخاص به" });
```
(+ إضافة حقل «الرمز الحالي» في فورم الإعدادات بنفس الـPR، و`import { logAudit }`.)
- **مخطط Prisma:** لا · **قرار مطلوب من المالك:** لا (حالة حافة: مستخدم `pinHash = null` — يُسمح بالتعيين الأول بلا رمز حالي)
- **المخاطر:** منخفضة — تعديل الفورم إلزامي بنفس الدفعة وإلا يفشل التغيير دائماً.

### #38 — notify-scheduled يبتلع الأخطاء ويرجّع ok:true دائمًا (شدّة: ⚪ منخفضة · دفعة و)
- **الملفات:** `src/app/api/notify-scheduled/route.ts:16-21`
- **الكود الحالي:**
```ts
  const [followupDue, idle] = await Promise.all([
    runFollowupDueCheck().catch(() => 0),
    runIdleEmployeeCheck().catch(() => 0),
  ]);
  return NextResponse.json({ ok: true, followupDue, idle });
```
- **الكود المقترح:**
```ts
  const results = await Promise.allSettled([runFollowupDueCheck(), runIdleEmployeeCheck()]);
  const names = ["followupDue", "idle"] as const;
  const counts = { followupDue: 0, idle: 0 };
  const failed: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") counts[names[i]] = r.value;
    else { failed.push(names[i]); console.error(`[notify-scheduled] ${names[i]}`, r.reason); }
  });
  if (counts.followupDue > 0 || counts.idle > 0) revalidatePath("/", "layout");
  return NextResponse.json(
    { ok: failed.length === 0, ...counts, ...(failed.length ? { failed } : {}) },
    { status: failed.length ? 500 : 200 },
  );
```
- **مخطط Prisma:** لا · **قرار مطلوب من المالك:** لا
- **المخاطر:** شبه معدومة — 500 عند الفشل يجعل مراقب الكرون يلتقط التوقّف؛ `allSettled` يعزل الفحصين.

### #39 — `markAllRead` يعيد توليد الـlayout كاملًا مع كل فتح للجرس (شدّة: ⚪ منخفضة · دفعة هـ)
- **الملفات:** `src/lib/actions/notifications.ts:30-35`
- **الكود الحالي:**
```ts
  await prisma.notification.updateMany({ where: { userId: user.id, read: false }, data: { read: true } });
  revalidatePath("/", "layout");
  return { ok: true };
```
- **الكود المقترح:**
```ts
  await prisma.notification.updateMany({ where: { userId: user.id, read: false }, data: { read: true } });
  return { ok: true }; // حالة القراءة client-side (الجرس يصفّر تفاؤلياً) — لا حاجة لأي revalidate
```
- **مخطط Prisma:** لا · **قرار مطلوب من المالك:** لا
- **المخاطر:** شبه معدومة — لا صفحة server-rendered تعرض عدّاد غير المقروء.

### #40 — heartbeat يكتب كل دقيقة + انهيار P2025 لمستخدم محذوف (شدّة: ⚪ منخفضة · دفعة هـ)
- **الملفات:** `src/app/api/heartbeat/route.ts:8-13` · `heartbeat.tsx:7-12` · عتبة online: `chat.ts:18` (`ONLINE_MS = 5 * 60 * 1000`)
- **الكود الحالي:**
```ts
  await prisma.user.update({ where: { id: session.user.id }, data: { lastSeenAt: new Date() } });
// heartbeat.tsx:10 — كل ٦٠ ثانية
const t = setInterval(ping, 60000);
```
- **الكود المقترح:**
```ts
// route.ts — updateMany لا يرمي عند غياب الصف:
  await prisma.user.updateMany({ where: { id: session.user.id }, data: { lastSeenAt: new Date() } });

// heartbeat.tsx — كل دقيقتين + إيقاف عند إخفاء التبويب (hook #12):
const HEARTBEAT_MS = 2 * 60_000;
export function Heartbeat() {
  useVisiblePolling(() => { fetch("/api/heartbeat", { method: "POST" }).catch(() => {}); }, HEARTBEAT_MS);
  return null;
}
```
- **مخطط Prisma:** لا
- **قرار مطلوب من المالك:** **نعم** — فترة النبضة: (أ) دقيقة (كما هي)، (ب) **دقيقتان — التوصية** (تحت عتبة online = ٥ دقائق فلا يتغيّر «متصل الآن» عملياً + نصف الكتابات)، (ج) ٥ دقائق (يرفرف على الحد — غير منصوح). لا نغيّر `ONLINE_MS`.
- **المخاطر:** منخفضة — مع hook #12 يتحوّل «غير متصل» بعد ٥ دقائق من إخفاء التبويب (أصدق من الحالي).

### #41 — تصفير `distPointer` إلى 0 مع بدء الدوران من `pointer+1` = تخطّي الموظف الأول (شدّة: ⚪ منخفضة · دفعة د)
- **الملفات:** `src/lib/actions/distribution.ts:105-106` · `src/lib/auto-distribute.ts:87-95`
- **الكود الحالي:**
```ts
// auto-distribute.ts — الدوران يبدأ من pointer+1
  for (let i = 1; i <= order.length; i++) {
    const idx = (pointer + i) % order.length;
// distribution.ts:105-106 — الحفظ يصفّر لـ0 → أول اختيار يقع على order[1]
        distPointer: order.length > 0 ? 0 : 0,
```
- **الكود المقترح:**
```ts
// المؤشّر يشير لآخر من استلم — نضبطه على «آخر القائمة» حتى يكون أول
// اختيار بعد الحفظ هو order[0] (pointer+1 تلتف للصفر)
distPointer: order.length > 0 ? order.length - 1 : 0,
```
- **مخطط Prisma:** لا · **قرار مطلوب من المالك:** لا (خطأ off-by-one صريح؛ التعبير `? 0 : 0` بلا معنى أصلاً)
- **المخاطر:** شبه معدومة — أثره فقط في أول عميل بعد كل حفظ إعدادات.

### #42 — «وزّعهم الآن» اليدوي يوزّع على الموظفين الموقوفين (شدّة: ⚪ منخفضة · دفعة د)
- **الملفات:** `src/lib/actions/team.ts:161-173` (`loadEmployees` — تستخدمها distributeUnassigned/distributeCustom/distributeLeastLoaded)
- **الكود الحالي:**
```ts
async function loadEmployees(): Promise<LoadedEmployee[]> {
  const emps = await prisma.user.findMany({
    where: { role: "EMPLOYEE", active: true },
    select: { id: true, name: true, maxClients: true, _count: { select: { assignedLeads: { where: { isArchived: false } } } } },
    orderBy: { name: "asc" },
  });
```
- **الكود المقترح:**
```ts
async function loadEmployees(): Promise<LoadedEmployee[]> {
  const now = new Date();
  const emps = await prisma.user.findMany({
    where: {
      role: "EMPLOYEE", active: true,
      // استثناء الموقوفين عن الاستقبال — إلا من انتهت مدة إيقافه
      OR: [
        { availabilityPaused: false },
        { availabilityPaused: true, pauseUntil: { not: null, lte: now } },
      ],
    },
    select: { id: true, name: true, maxClients: true, _count: { select: { assignedLeads: { where: { isArchived: false } } } } },
    orderBy: { name: "asc" },
  });
```
- **مخطط Prisma:** لا · **قرار مطلوب من المالك:** لا (ملاحظة: `distributeCustom` بالاسم — يُفضَّل إظهار الموقوف بوسم «موقوف» بدل الإخفاء الصامت؛ المدير يلغي الإيقاف لو احتاج التجاوز)
- **المخاطر:** منخفضة — الموقوف يختفي من جدول التوزيع المخصّص.

### #43 — إعادة محاولة Prisma تشمل الكتابات → خطر تنفيذ مزدوج (شدّة: ⚪ منخفضة · دفعة هـ)
- **الملفات:** `src/lib/prisma.ts:29-45`
- **الكود الحالي:**
```ts
    async $allOperations({ args, query }) {
      let lastErr: unknown;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          return await query(args);
        } catch (e) {
          lastErr = e;
          if (!isTransient(e) || attempt === 3) throw e;   // ← يعيد حتى create/update
          await sleep(700 * (attempt + 1));
        }
      }
```
- **الكود المقترح:**
```ts
// القراءات: تُعاد لأي خطأ عابر. الكتابات: فقط لأخطاء «ما قبل الاتصال» (الخادم لم يستلم شيئًا → آمنة).
const READ_OPS = new Set([
  "findMany", "findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow",
  "count", "aggregate", "groupBy", "queryRaw", "findRaw", "aggregateRaw",
]);

function isPreConnect(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientInitializationError) return true;
  const code = (e as { code?: string })?.code;
  return code === "P1001" || code === "P1002";
}

    async $allOperations({ operation, args, query }) {
      let lastErr: unknown;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          return await query(args);
        } catch (e) {
          lastErr = e;
          const retryable = READ_OPS.has(operation) ? isTransient(e) : isPreConnect(e);
          if (!retryable || attempt === 3) throw e;
          await sleep(700 * (attempt + 1));
        }
      }
      throw lastErr;
    },
```
- **مخطط Prisma:** لا · **قرار مطلوب من المالك:** لا (صحوة Neon الباردة تظل مغطّاة حتى للكتابات — `P1001/P1002` = الاستعلام ما وصل)
- **المخاطر:** منخفضة — كتابة تفشل بقطع-بعد-الإرسال ترجع خطأ بدل إعادة تنفيذ (مقصود: أفضل من عميل مكرر).

### #44 — dedup «قرب موعد متابعة» بلا userId + «متابعات اليوم» متأخرة-فقط (شدّة: ⚪ منخفضة · دفعة و)
- **الملفات:** `src/lib/notifications/scheduled.ts:38-41`، `src/lib/data/dashboard.ts:157-162` (`ksaTodayStart` جاهزة في `auto-distribute.ts:24-28`)
- **الكود الحالي:**
```ts
// scheduled.ts — الرابط فقط: بعد إعادة التوجيه، إشعار الموظف القديم يمنع الجديد
    const recent = await prisma.notification.findFirst({
      where: { type: "followup_due", link, createdAt: { gte: new Date(now.getTime() - windowMs - 3_600_000) } },
      select: { id: true },
    });
// dashboard.ts — «متابعات اليوم» فعلياً = المتأخرة حتى اللحظة فقط
    where: { ...where, stage: { notIn: CLOSED }, nextFollowup: { lte: new Date() } },
```
- **الكود المقترح:**
```ts
// scheduled.ts — dedup بالمستخدم + الرابط معاً:
      where: {
        type: "followup_due", link, userId: l.assignedToId,
        createdAt: { gte: new Date(now.getTime() - windowMs - 3_600_000) },
      },

// dashboard.ts — «المتأخرة + بقية اليوم» بحدود يوم السعودية:
import { ksaTodayStart } from "@/lib/auto-distribute";
  const ksaDayEnd = new Date(ksaTodayStart(new Date()).getTime() + 86_400_000);
    where: { ...where, stage: { notIn: CLOSED }, nextFollowup: { lt: ksaDayEnd } },
```
- **مخطط Prisma:** لا
- **قرار مطلوب من المالك:** **نعم** — دلالة «متابعات اليوم»: (١) المتأخرة فقط (الحالي، العنوان مضلّل) (٢) اليوم فقط (يخفي المتأخر — خطر) (٣) **المتأخرة + بقية اليوم** ← **التوصية**.
- **المخاطر:** منخفضة — إشعار «مكرر» واحد للموظف الجديد بعد إعادة التوجيه (السلوك الصحيح)؛ البطاقة محدودة `take: 8` أصلاً.

---

## دفعات التنفيذ (بالترتيب المعتمد)

كل دفعة: تنفيذ → `tsc + build` نظيفين → مراجعتك على localhost → موافقتك → اللي بعدها. **لا git push إلا بإذنك.**

| الدفعة | البنود | قرارات مطلوبة قبلها | ملاحظات |
|--------|--------|---------------------|---------|
| **أ — منع فقدان البيانات** (كود فقط) | #35, #2, #4 | #35، #2، #4 | لا مخطط. #4 قراره مترابط مع #9 (دفعة ح) — يُقرّران معاً. |
| **ب — الأمان** (كود فقط) | #3, #5, #6, #37, #36 | #5، #6، #36 | #6 يُنفَّذ بالخيار البرمجي (in-memory) الآن؛ خيار الحقول ينتظر الـbaseline. |
| **ج — دقّة المال** (كود فقط) | #1, #7, #10, #23, #24 | #1 (+ إذن backfill الإنتاج)، #7 | باكفيل #1 أمر UPDATE واحد على الإنتاج — تشغّله أنت بعد مراجعته. |
| **د — صحّة التوزيع** (كود فقط) | #8, #19, #20, #21, #22, #41, #42 | #8، #20، #22 | — |
| **هـ — الأداء والتكلفة** (كود فقط) | #11, #12, #13, #14, #27, #39, #40, #43 | #11، #14، #40 | #12 (hook) يُنفَّذ أولاً لأن #40 يستخدمه. #27 يُراجع بمقارنة أرقام قبل/بعد. |
| **و — المتانة ومعالجة الأخطاء** (كود فقط) | #15, #16, #17, #29, #30, #32, #38, #44 | #44 | #15 (toUserError) يُنفَّذ أولاً لأن #17/#29 يعتمدونه. #17 منسّق مع #7 (بلا تعارض). |
| **⚙️ baseline migration — منفصلة** | تسوية تاريخ الهجرات (الخطة السابقة: توليد دلتا على فرع Neon + `migrate resolve --applied` على الإنتاج) | إذن صريح لكل خطوة | **شرط مسبق لدفعة ز.** بلا أي DDL على الإنتاج. |
| **ز — مخطط القاعدة** (بعد الـbaseline فقط) | #28, #31 | #28 (unique مقابل index)، #31 | #31 جزؤه البرمجي بلا مخطط ويمكن تقديمه؛ هو هنا لاكتماله مع قرار #28. |
| **ح — تلميع واتساق** | #33 (+ تحديث CLAUDE.md), #34, #25, #26, #18, #9 | #33، #34، #25، #18، #9 | #26 نطاقه يتقلّص لو أُقر إيقاف المسار القديم في #34. |

### ترابطات مهمة بين البنود
- **#4 ↔ #9:** لا تختَر «منع مطلق» في الاثنين معاً — لازم يبقى مسار واحد للتراجع عن بيع خاطئ.
- **#34 → #26:** قرار إيقاف مسار المزامنة القديم يحذف `runSheetSync` ويقلّص #26.
- **#12 → #40، #11:** الـhook المشترك يُبنى أولاً.
- **#15 → #17، #29:** دالة `toUserError` تُبنى أولاً.
- **#28 ↔ #31:** فحص التكرار التطبيقي (#31) متطلب مسبق لأي قيد فريد مستقبلي (#28).
- **baseline → ز:** لا ترحيل جديد قبل تسوية التاريخ.

---
*خطة مكتوبة فقط — لم يُنفَّذ أي تعديل كود أو قاعدة. كل دفعة تنتظر موافقتك.*
