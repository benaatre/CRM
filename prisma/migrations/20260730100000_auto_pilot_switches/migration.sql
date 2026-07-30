-- «الحزمة ب» — مفتاحا الأتمتة تحت سيطرة المالك (افتراضيهما مطفأ — لا تغيير سلوك عند الترحيل):
--   autoSweepEnabled: السحب التلقائي للمتأخر (بدل الاقتراح اليدوي)
--   autoRedistributeEnabled: إعادة توزيع مسحوبي «لم يتم الرد» آليًا (كجديد)
ALTER TABLE "Settings" ADD COLUMN "autoSweepEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Settings" ADD COLUMN "autoRedistributeEnabled" BOOLEAN NOT NULL DEFAULT false;
