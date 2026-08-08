import type { CapacitorConfig } from "@capacitor/cli";

/**
 * تغليف أندرويد و iOS — WebView يشير لواجهة الجوال على الإنتاج مباشرة.
 *
 * لماذا server.url وليس تصديرًا ثابتًا: التطبيق server-rendered بمصادقة
 * وقاعدة بيانات (App Router + Auth.js + Prisma) — لا يوجد وضع static أصلًا.
 * webDir=public شكلي فقط (Capacitor يلزمه مجلد) — لا يُحمَّل منه شيء.
 *
 * allowNavigation: يُبقي التنقّل داخل الـWebView بدل ما يُرمى المستخدم
 * لمتصفح خارجي (سفاري على iOS، كروم على أندرويد).
 */
const config: CapacitorConfig = {
  appId: "com.benaatre.sultan",
  appName: "Sultan CRM",
  webDir: "public",
  server: {
    url: "https://crm.benaatre.com/m",
    androidScheme: "https",
    allowNavigation: ["crm.benaatre.com"],
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      backgroundColor: "#0A0A0B",
      launchShowDuration: 1500,
      launchAutoHide: true,
      showSpinner: false,
    },
  },
};

export default config;
