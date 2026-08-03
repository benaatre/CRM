import type { CapacitorConfig } from "@capacitor/cli";

/**
 * تغليف أندرويد — WebView يشير لواجهة الجوال على الإنتاج مباشرة.
 *
 * لماذا server.url وليس تصديرًا ثابتًا: التطبيق server-rendered بمصادقة
 * وقاعدة بيانات (App Router + Auth.js + Prisma) — لا يوجد وضع static أصلًا.
 * webDir=public شكلي فقط (Capacitor يلزمه مجلد) — لا يُحمَّل منه شيء.
 */
const config: CapacitorConfig = {
  appId: "com.benaatre.sultan",
  appName: "مشاريع السلطان",
  webDir: "public",
  server: {
    url: "https://crm.benaatre.com/m",
    androidScheme: "https",
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
