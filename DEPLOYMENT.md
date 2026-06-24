# النشر على Hostinger — مشاريع السلطان CRM

تطبيق **Next.js 15** (output: `standalone`) + **Prisma/PostgreSQL** + **Auth.js v5**.

---

## خطوات النشر على Hostinger

١. في لوحة Hostinger → **Node.js Web Apps → Create**.
٢. **Node.js version:** `20.x`.
٣. **Entry point / Start command:** `node .next/standalone/server.js`.
٤. **Build command:** `npm run build`
   - يشغّل: `prisma generate` ← `next build` ← `postbuild` (ينسخ `public` و`.next/static` داخل `.next/standalone`).
٥. **Port:** `3000` (الخادم المستقل يقرأ متغيّر `PORT` تلقائيًا).
٦. أضف **كل متغيّرات البيئة** (انظر القسم التالي) في إعدادات التطبيق.
٧. شغّل الترحيلات على قاعدة الإنتاج (مرة واحدة بعد أول بناء):
   ```
   npm run db:deploy        # = prisma migrate deploy
   ```
   (اختياري) بذرة بيانات تجريبية: `npm run db:seed`.

---

## متغيّرات البيئة المطلوبة

> **مهم:** التطبيق يستخدم **Auth.js v5** الذي يقرأ `AUTH_SECRET` و`AUTH_URL` (وليس `NEXTAUTH_SECRET`/`NEXTAUTH_URL`). استخدم الأسماء التالية بالضبط:

```env
# قاعدة البيانات (PostgreSQL)
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require
DIRECT_URL=postgresql://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require

# Auth.js v5 (الجلسات)
AUTH_SECRET=سر_عشوائي_طويل            # ولّده بـ:  npx auth secret
AUTH_URL=https://your-domain.com      # رابط الموقع (مطلوب خلف بروكسي Hostinger)
AUTH_TRUST_HOST=true                  # ضروري خلف بروكسي Hostinger

# المساعد الذكي (Anthropic) — خادمي فقط
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-6     # اختياري

# مزامنة Google Sheet (cron) — اختياري
SYNC_SECRET=سر_عشوائي_للمزامنة

# المنفذ (يحقنه Hostinger عادةً) — الافتراضي 3000
# PORT=3000
```

- `DATABASE_URL`: اتصال وقت التشغيل (مع pooler إن وُجد، مثل Neon `-pooler`).
- `DIRECT_URL`: اتصال مباشر للترحيلات (`prisma migrate`). مع Neon = نفس الرابط بدون لاحقة `-pooler`؛ غير ذلك = نفس `DATABASE_URL`.

---

## ملاحظات مهمّة

1. **محرّك Prisma على Linux:** نفّذ `npm run build` **على خادم Hostinger نفسه** (لا ترفع `node_modules` من ويندوز)، حتى يولّد `prisma generate` محرّك Linux الصحيح داخل `.next/standalone`. إن اضطررت للبناء على نظام مختلف، أضف الهدف للمولّد في `prisma/schema.prisma`:
   ```prisma
   generator client {
     provider      = "prisma-client-js"
     binaryTargets = ["native", "debian-openssl-3.0.x"]
   }
   ```

2. **الـ standalone يحتاج الأصول المنسوخة:** خطوة `postbuild` تنسخ `public/` و`.next/static/` داخل `.next/standalone/` تلقائيًا (سكربت عابر للأنظمة `scripts/copy-standalone.mjs`). بدونها تظهر الصفحات بلا CSS/صور.

3. **`output: standalone`:** يبني خادمًا مكتفيًا ذاتيًا في `.next/standalone/server.js` بأقل تبعيات — مناسب لـ Hostinger Node. الإعداد مضبوط في `next.config.ts` مع `outputFileTracingRoot` لضمان صحة المسار.

4. **الترحيلات:** استخدم `npm run db:deploy` (= `prisma migrate deploy`) على الإنتاج — لا تستخدم `migrate dev`.

5. **cron للمزامنة (اختياري):** اضبط مهمة دورية على Hostinger:
   ```
   curl "https://your-domain.com/api/sync-sheet?secret=YOUR_SYNC_SECRET"
   ```

---

## التحقّق المحلي (تم)

```
npm run build      # prisma generate + next build + postbuild → EXIT 0
# ينتج: .next/standalone/server.js + public + .next/static داخله
node .next/standalone/server.js   # تشغيل محلي للتجربة (مع .env)
```
