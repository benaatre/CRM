# مشاريع السلطان — نظام CRM عقاري

تطبيق Next.js 15 إنتاجي لإدارة مبيعات شركة **مشاريع السلطان**. عربي بالكامل، RTL، ثيم أوبسيديان داكن، لهجة سعودية.

> **الحالة:** كل المراحل مكتملة — المصادقة + RBAC، العملاء (جدول/كانبان/درج)، لوحة التحكم، المشاريع والوحدات، الحجوزات والتمويل، التحليلات + المساعد الذكي، الاستيراد، الفريق والتوزيع، الإعدادات. خارطة المراحل في [`sultan-crm-nextjs-spec.md`](./sultan-crm-nextjs-spec.md). دليل العمل في [`CLAUDE.md`](./CLAUDE.md).

## الميزات

- **المصادقة:** دخول مالك/مدير وموظف برمز PIN (Auth.js v5)، صلاحيات مطبّقة على الخادم.
- **العملاء:** جدول بفلاتر/بحث، كانبان ٩ مراحل بالسحب، درج تفاصيل + سجل متابعات.
- **لوحة التحكم:** مؤشرات Bento + فلتر فترة + متابعات اليوم + قمع المبيعات + أداء الموظفين.
- **المشاريع والوحدات:** بطاقات + فلتر أسعار + تفاصيل الوحدات.
- **الحجوزات والتمويل:** شريط تقدّم البيع + بنوك سعودية + رفض تمويل.
- **التحليلات:** تحصيل ومبيعات + مؤشرات احترافية + قمع + قنوات + مساعد ذكي «اسأل بياناتك».
- **الإدارة:** استيراد CSV/Excel، توزيع العملاء، إدارة الفريق، إعدادات الشركة وفال.

## التقنيات

Next.js 15 (App Router) · TypeScript · Tailwind v4 · shadcn/ui · Prisma · PostgreSQL · Auth.js (NextAuth v5) · Anthropic API.

## التشغيل محليًا

```bash
# 1) المتطلبات: Node.js 18.18+ (يفضّل 20+) و PostgreSQL
npm install                 # يثبّت الحزم + يشغّل prisma generate تلقائيًا

# 2) جهّز متغيّرات البيئة
cp .env.example .env        # ثم عبّئ القيم الحقيقية
npx auth secret             # يولّد AUTH_SECRET

# 3) طبّق المخطط على قاعدة بيانات محلية
npm run db:migrate          # prisma migrate dev (تطوير)

# 4) شغّل
npm run dev                 # http://localhost:3000
```

## متغيّرات البيئة

انظر [`.env.example`](./.env.example):

| المتغيّر | الوصف |
|----------|-------|
| `DATABASE_URL` | رابط PostgreSQL (اتصال مجمّع/pooler لوقت التشغيل) |
| `DIRECT_URL` | اتصال مباشر للترحيلات (مع Neon = نفس الرابط بدون `-pooler`؛ غير ذلك = نفس `DATABASE_URL`) |
| `AUTH_SECRET` | سر تشفير جلسات Auth.js (`npx auth secret`) |
| `AUTH_URL` | رابط الموقع في الإنتاج |
| `AUTH_TRUST_HOST` | `true` خلف بروكسي Hostinger |
| `ANTHROPIC_API_KEY` | مفتاح المساعد الذكي «اسأل بياناتك» (خادم فقط) |
| `ANTHROPIC_MODEL` | موديل المساعد (اختياري، الافتراضي `claude-sonnet-4-6`) |

## النشر على Hostinger (Node hosting)

1. **قاعدة البيانات:** أنشئ PostgreSQL من hPanel، وخذ رابط الاتصال إلى `DATABASE_URL`.
2. **متغيّرات البيئة:** أضِف `DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL`, `AUTH_TRUST_HOST=true`, `ANTHROPIC_API_KEY` في إعدادات التطبيق (لا ترفع `.env`).
3. **التثبيت:** `npm install` — يشغّل `prisma generate` تلقائيًا عبر `postinstall`.
4. **الترحيلات:** شغّل مرة على قاعدة الإنتاج:
   ```bash
   npm run db:deploy        # = prisma migrate deploy
   ```
5. **البناء والتشغيل:**
   ```bash
   npm run build            # = prisma generate && next build
   npm start                # next start (يستمع على متغيّر PORT الذي يحقنه Hostinger)
   ```

> **ملاحظة:** `npm start` يستمع تلقائيًا على المنفذ من `process.env.PORT` الذي توفّره Hostinger. ما يحتاج تعديل.

## السكربتات

| الأمر | الوظيفة |
|------|---------|
| `npm run dev` | تطوير |
| `npm run build` | توليد Prisma + بناء |
| `npm start` | تشغيل الإنتاج |
| `npm run db:migrate` | ترحيل تطويري |
| `npm run db:deploy` | ترحيل الإنتاج |
| `npm run db:studio` | متصفح قاعدة البيانات |
| `npm run lint` | فحص ESLint |

## البنية

```
src/app/        صفحات + route handlers
src/lib/        prisma.ts · utils.ts
prisma/         schema.prisma
docs/design-reference/  المرجع البصري (لا يُنفّذ كـ HTML ثابت)
```
