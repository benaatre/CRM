import { auth, signOut } from "@/auth";
import { dropUserTokens } from "@/lib/push/tokens";
import { loginPathFor, safeLoginTarget, samePathFromReferer } from "@/lib/logout-target";

export const runtime = "nodejs";

// نقطة إبطال الجلسة: تمسح كوكي المصادقة ثم تحوّل لصفحة الدخول المناسبة.
// مستثناة من middleware (المطابق يستثني /api) — فلا حلقة تحويل.
// تُستخدم عند اكتشاف جلسة مُبطَلة (خروج من كل الأجهزة أو حساب موقوف)،
// وهي أيضًا زر «خروج» في تطبيق الجوال (/m/more).
//
// الوجهة: ?to= صراحةً (قائمة سماح مغلقة)، وإلا تُشتقّ من المُحيل — فأي نداء
// من داخل /m ينتهي على /m/login ولا يتسرّب لتخطيط الويب.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const explicit = url.searchParams.get("to");
  const target = explicit
    ? safeLoginTarget(explicit)
    : loginPathFor(samePathFromReferer(req.headers.get("referer"), url.origin));

  // نظّف توكنات Push قبل الخروج — جهاز خرج منه صاحبه ما يصح يستقبل إشعاراته.
  // الجلسة قد تكون مُبطَلة أصلًا (هذا أحد مسارات الوصول) فنتجاهل فشلها ونكمل.
  const session = await auth().catch(() => null);
  if (session?.user?.id) await dropUserTokens(session.user.id);

  await signOut({ redirectTo: target });
}
