-- حوكمة الدوام — الدفعة الثانية: قيمة enum واحدة لنموذج المحطات.
-- «تغيير موقعي»: حدث LOCATION_CHANGE يقفل المحطة السابقة ويفتح التالية داخل الجلسة.
-- صفر لمس لأي جدول — ALTER TYPE فقط (آمنة على Neon PG15؛ القيمة الجديدة لا
-- تُستخدم في نفس معاملة الإضافة، وprisma migrate يشغّل كل ملف بمعاملته).
-- لا تُطبّق آليًا: المالك ينفّذ `migrate deploy` بنفسه.

-- AlterEnum
ALTER TYPE "AttendanceEventType" ADD VALUE 'LOCATION_CHANGE';
