-- إضافة نتيجة متابعة «اتصال في وقت آخر» (CALL_LATER).
-- ⚠️ هذا الملف كُتب يدويًا ولم يُطبَّق بعد — التطبيق على الإنتاج بأمر صريح فقط
--    (ALTER TYPE ... ADD VALUE لا يعمل داخل transaction على PostgreSQL < 12؛
--     على Neon/PG الحديث يمرّ مباشرة، وIF NOT EXISTS تجعله آمن التكرار).
ALTER TYPE "FollowUpResult" ADD VALUE IF NOT EXISTS 'CALL_LATER';
