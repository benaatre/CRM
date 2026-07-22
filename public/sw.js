// Service Worker «انتحاري» — يحلّ محل SW قديم (Serwist) من إعداد PWA أُزيل من المشروع.
// النسخ المسجّلة في متصفحات المستخدمين كانت تكاشي ردود /api (بيانات عملاء) وصفحات HTML
// وتبقى بعد تسجيل الخروج. هذا الملف: يمسح كل الكاشات، يلغي تسجيل نفسه، ويعيد تحميل الصفحات.
// يُبقى منشورًا فترة كافية حتى تحدَّث كل المتصفحات، ثم يمكن حذفه نهائيًا.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: "window" });
      for (const client of clients) {
        // إعادة تحميل حتى تُقدَّم الصفحات من الشبكة لا من الكاش الملغى
        client.navigate(client.url);
      }
    })(),
  );
});
