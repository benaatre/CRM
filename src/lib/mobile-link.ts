/**
 * يحوّل رابط إشعار الويب لمقابله في تطبيق الجوال، وإلا يُسقطه (null) — لا نخرج
 * من التطبيق لمسار ويب ما له شاشة جوال.
 *
 * مصدر واحد: تستخدمه شاشة الإشعارات (/m/notifications) ومعالج الضغط على إشعار
 * Push النيتف. منطق نقي بلا استيرادات — قابل للاستخدام في خادم وعميل.
 */
export function toMobileLink(link: string | null | undefined): string | null {
  if (!link) return null;
  const lead = link.match(/^\/leads\/([^/?#]+)/);
  if (lead) return `/m/leads/${lead[1]}`;
  if (link.startsWith("/leads")) return "/m/leads";
  if (link.startsWith("/dashboard")) return "/m";
  return null;
}
