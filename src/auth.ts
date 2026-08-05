import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { headers } from "next/headers";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { authConfig } from "@/auth.config";

/**
 * حدّ محاولات الدخول — طبقتان بنافذة زمنية منزلقة (in-memory).
 *
 * لماذا طبقتان: حدّ الحساب وحده يترك المهاجم يوزّع محاولاته على عدة حسابات
 * فيبقى تحت السقف في كل واحد منها. حدّ الـIP يقفل المصدر نفسه.
 *
 * لماذا نافذة منزلقة: العدّاد التراكمي بلا نافذة كان يبقى عند سقفه بعد انتهاء
 * القفل، فأي محاولة فاشلة واحدة بعده تعيد القفل فورًا — قفل دائم عمليًا.
 *
 * التخزين في الذاكرة: يصفّر عند إعادة تشغيل الخادم، وكافٍ لنشر instance واحد
 * (Hostinger). نشر عدة نسخ يحتاج مخزنًا مشتركًا.
 */

const WINDOW_MS = 15 * 60_000; // نافذة احتساب المحاولات
const LOCK_MS = 15 * 60_000; // مدة القفل بعد بلوغ السقف
const USER_MAX = 5; // محاولات فاشلة للحساب الواحد
const IP_MAX = 20; // محاولات فاشلة من نفس المصدر (عبر كل الحسابات)
const SWEEP_AT = 500; // حجم يبدأ عنده تنظيف المدخلات المنتهية

type Bucket = {
  /** عدد المحاولات الفاشلة داخل النافذة الحالية */
  n: number;
  /** بداية النافذة — أول محاولة فاشلة فيها */
  firstAt: number;
  /** نهاية القفل (0 = غير مقفول) */
  lockedUntil: number;
};

// مفاتيح خريطة الحسابات = معرّفات مستخدمين حقيقية فقط (انظر ملاحظة الإحصاء
// أدناه)، فحجمها محدود بعدد الفريق. خريطة الـIP هي التي قد تنمو.
const userFails = new Map<string, Bucket>();
const ipFails = new Map<string, Bucket>();

/** يحذف المدخلات التي انقضت نافذتها وقفلها معًا — يمنع نمو الخرائط بلا حدّ. */
function sweep(map: Map<string, Bucket>, now: number): void {
  if (map.size <= SWEEP_AT) return;
  for (const [key, b] of map) {
    if (b.lockedUntil <= now && b.firstAt + WINDOW_MS <= now) map.delete(key);
  }
}

/**
 * هل المفتاح مقفول الآن؟ القفل المنتهي يُمسح بالكامل (لا يبقى العدّاد عند
 * سقفه) — وهذا جوهر إصلاح «القفل الأبدي».
 */
function isLocked(map: Map<string, Bucket>, key: string, now: number): boolean {
  const b = map.get(key);
  if (!b) return false;
  if (b.lockedUntil > now) return true;
  if (b.lockedUntil > 0) {
    map.delete(key); // انتهى القفل → بداية نظيفة
    return false;
  }
  return false;
}

/** يسجّل محاولة فاشلة، ويقفل عند بلوغ السقف. النافذة المنقضية تبدأ من جديد. */
function recordFail(map: Map<string, Bucket>, key: string, now: number, max: number): void {
  const b = map.get(key);
  // بلا مدخل، أو نافذته انقضت → نافذة جديدة بمحاولة واحدة.
  if (!b || b.firstAt + WINDOW_MS <= now) {
    map.set(key, { n: 1, firstAt: now, lockedUntil: max <= 1 ? now + LOCK_MS : 0 });
    return;
  }
  b.n += 1;
  if (b.n >= max) b.lockedUntil = now + LOCK_MS;
}

/** لا مصدر موثوق للعنوان — تُعطَّل طبقة الـIP لهذا الطلب (لا تُحتسب على أي دلو). */
const NO_IP = "NO_IP";

/**
 * عنوان المصدر — من x-real-ip حصرًا.
 *
 * لماذا لا نقرأ x-forwarded-for: اختبار حيّ على إنتاج Hostinger أثبت أن
 * LiteSpeed **يُلحق** قيمة العميل في أول القائمة بدل استبدالها — أرسلنا
 * X-Forwarded-For: 1.2.3.4 فصار هو العنوان المُشتقّ. أي أن المهاجم يملك
 * تغيير مفتاح الحدّ مع كل طلب، فتصير الطبقة بلا قيمة. x-real-ip في نفس
 * الاختبار صمد وبقي العنوان الحقيقي — يكتبه البروكسي ولا يقبل تجاوزًا.
 *
 * غيابه يرجّع NO_IP لا قيمة مشتركة: دلو واحد يجمع كل المستخدمين يعني أن
 * ٢٠ محاولة فاشلة من أي شخص تقفل الفريق كله — تعطيل الطبقة أأمن من ذلك.
 *
 * authorize لا يستقبل الطلب مباشرة، وheaders() متاحة في سياق الخادم —
 * ونحرسها لأنها ترمي خارج سياق طلب.
 */
async function clientIp(): Promise<string> {
  try {
    const h = await headers();
    const real = h.get("x-real-ip")?.trim();
    if (real) return real;
  } catch {
    // خارج سياق طلب
  }
  console.warn("[auth] x-real-ip missing — IP rate-limit layer disabled for this request");
  return NO_IP;
}

// مزوّد الدخول برمز PIN — يشتغل على بيئة Node (يستخدم Prisma + bcrypt).
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      id: "pin",
      name: "PIN",
      credentials: {
        userId: { label: "المستخدم", type: "text" },
        pin: { label: "الرمز", type: "password" },
      },
      async authorize(credentials) {
        const userId =
          typeof credentials?.userId === "string" ? credentials.userId : "";
        const pin = typeof credentials?.pin === "string" ? credentials.pin : "";
        if (!userId || !pin) return null;

        const now = Date.now();
        const ip = await clientIp();
        // بلا عنوان موثوق: تُتخطّى طبقة الـIP كليًا وتبقى طبقة الحساب شغّالة.
        const hasIp = ip !== NO_IP;

        sweep(userFails, now);
        if (hasIp) sweep(ipFails, now);

        // مقفول (حسابًا أو مصدرًا)؟ نرجّع null كأي فشل — الواجهة تعرض نفس
        // الرسالة العامة فلا نكشف سبب الرفض.
        if (isLocked(userFails, userId, now)) return null;
        if (hasIp && isLocked(ipFails, ip, now)) return null;

        const user = await prisma.user.findUnique({ where: { id: userId } });
        // يقبل من عنده كلمة مرور أو PIN (أحدهما يكفي).
        if (!user || !user.active || (!user.pinHash && !user.passwordHash)) {
          // تُحتسب على المصدر فقط، لا على الحساب: معرّف غير موجود يعني مفتاحًا
          // من صنع المهاجم، وإدخاله خريطة الحسابات يفتحها لنمو بلا حدّ.
          // والاحتساب هنا ضروري وإلا صار تخمين المعرّفات بلا سقف.
          if (hasIp) recordFail(ipFails, ip, now, IP_MAX);
          return null;
        }

        // يجرّب كلمة المرور أولًا (المالك/المدير)، ثم يرجع للـPIN — PIN يبقى شغّالًا دائمًا (طريق رجوع، لا قفل خارجي).
        let ok = false;
        if (user.passwordHash) ok = await bcrypt.compare(pin, user.passwordHash);
        if (!ok && user.pinHash) ok = await bcrypt.compare(pin, user.pinHash);
        if (!ok) {
          recordFail(userFails, userId, now, USER_MAX);
          if (hasIp) recordFail(ipFails, ip, now, IP_MAX);
          return null;
        }

        // دخول ناجح يصفّر الطبقتين معًا
        userFails.delete(userId);
        if (hasIp) ipFails.delete(ip);

        await prisma.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } });

        return {
          id: user.id,
          name: user.name,
          role: user.role,
        };
      },
    }),
  ],
});
