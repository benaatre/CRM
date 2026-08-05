/**
 * وجهة ما بعد الخروج — مصدر واحد للويب والجوال.
 *
 * الخروج من أي شاشة تحت /m لازم ينتهي على شاشة دخول التطبيق، وإلا خرج المستخدم
 * من التطبيق كليًا: البوابة في auth.config.ts تجعل الدخول من /login يوجّه إلى
 * /dashboard (تخطيط الويب) فلا يعود لـ/m أبدًا.
 *
 * منطق نقي بلا استيرادات — يعمل في الحافة والخادم والعميل.
 */

export const WEB_LOGIN = "/login";
export const MOBILE_LOGIN = "/m/login";

/** يشتقّ وجهة الخروج من مسار داخلي: كل ما تحت /m يعود لشاشة دخول التطبيق. */
export function loginPathFor(pathname: string | null | undefined): string {
  if (!pathname) return WEB_LOGIN;
  return pathname === "/m" || pathname.startsWith("/m/") ? MOBILE_LOGIN : WEB_LOGIN;
}

/**
 * يطهّر وجهة قادمة من الخارج (?to=) بقائمة سماح مغلقة — القيم الممكنة اثنتان
 * فقط، فلا مجال لإعادة توجيه مفتوحة (open redirect) مهما كان المُدخَل.
 */
export function safeLoginTarget(to: string | null | undefined): string {
  return to === MOBILE_LOGIN ? MOBILE_LOGIN : WEB_LOGIN;
}

/**
 * مسار المُحيل (Referer) إن كان من نفس الأصل — احتياط لنداءات /api/logout التي
 * ما مرّرت ?to صراحةً (مثل تحويل جلسة مُبطَلة أثناء تنقّل داخل التطبيق).
 */
export function samePathFromReferer(referer: string | null, origin: string): string | null {
  if (!referer) return null;
  try {
    const u = new URL(referer, origin);
    if (u.origin !== origin) return null; // مُحيل خارجي — لا يُوثق به
    return u.pathname;
  } catch {
    return null;
  }
}
