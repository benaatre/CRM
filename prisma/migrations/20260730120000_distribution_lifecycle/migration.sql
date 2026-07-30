-- دورة حياة التوزيع والسحب (feat/distribution-lifecycle) — أربعة أعمدة بافتراضات آمنة
-- لا تغيّر أي سلوك قائم حتى يضبطها المالك من اللوحة:
--   sweepWarnMin: دقائق إنذار ما قبل السحب (افتراضي ٥)
--   distReceiveGapMin: فاصل الاستقبال بين إسنادين آليين للموظف الواحد (افتراضي ١٠ دقائق)
--   sweepStartHour/sweepEndHour: نافذة السحب التلقائي المستقلة (افتراضي ١٣→٢١ بتوقيت الرياض)
ALTER TABLE "Settings" ADD COLUMN "sweepWarnMin" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "Settings" ADD COLUMN "distReceiveGapMin" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "Settings" ADD COLUMN "sweepStartHour" INTEGER NOT NULL DEFAULT 13;
ALTER TABLE "Settings" ADD COLUMN "sweepEndHour" INTEGER NOT NULL DEFAULT 21;
