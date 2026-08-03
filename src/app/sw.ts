/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig } from "serwist";
import { NetworkOnly, Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}
declare const self: ServiceWorkerGlobalScope;

// أمان: لا تخزين لأي مسار مصادَق عليه أو API — شبكة فقط
const runtimeCaching: RuntimeCaching[] = [
  {
    matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/api"),
    handler: new NetworkOnly(),
  },
  {
    matcher: ({ request, sameOrigin }) => sameOrigin && request.mode === "navigate",
    handler: new NetworkOnly(),
  },
  {
    // تنقلات App Router من العميل (RSC) تجي fetch لا navigate — بدون هذا
    // الحاجز تسقط في كاش others من defaultCache وتحمل بيانات صفحات مصادَق عليها.
    matcher: ({ request, sameOrigin }) => sameOrigin && request.headers.get("RSC") === "1",
    handler: new NetworkOnly(),
  },
  ...defaultCache, // ملفات ثابتة فقط (JS/CSS/خطوط/صور)
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  precacheOptions: { cleanupOutdatedCaches: true },
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  disableDevLogs: true,
  runtimeCaching,
  fallbacks: {
    entries: [{ url: "/~offline", matcher: ({ request }) => request.mode === "navigate" }],
  },
});

serwist.addEventListeners();

// وراثة مهمة الـ SW «الانتحاري» (حادثة 07-22): مسح أي كاشات لا تخص precache الحالي
// عند كل activate. يغطي المتصفحات التي ما مرّت على الانتحاري، ويعدم كاشات الإعداد
// القديم (apis/others/next-data…) التي كانت تحمل بيانات عملاء — الإعداد القديم كان
// Serwist بنفس أسماء defaultCache، فالكاشات التشغيلية الجديدة بنفس الأسماء تُمسح
// معها أيضًا وهذا مقبول: محتواها أصول ثابتة فقط ويُعاد تعبئتها تلقائيًا.
// المحمي: precache الحالي «serwist-precache-v2» (تحقّقنا من الاسم بتشغيل cacheNames).
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => !k.startsWith("serwist-") && !k.includes("precache"))
          .map((k) => caches.delete(k)),
      );
    })(),
  );
});
