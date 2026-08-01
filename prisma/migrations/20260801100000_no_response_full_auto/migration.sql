-- استكمال أتمتة «لم يتم الرد» — أربعة أعمدة، كلها بافتراضيات تحفظ السلوك الحالي حرفيًا
-- (لا تغيير سلوك لحظة الترحيل: المفتاحان الجديدان مطفآن، والوضع الافتراضي هو الوضع القائم).
--
--   noContactPullEnabled   : سحب «صامتي التواصل» تلقائيًا (مُسند + صفر متابعات بعد الإسناد).
--                            مطفأ = السلوك الحالي حرفيًا: تنبيه وأزرار يدوية فقط.
--   noContactPullDays      : مهلة صامت التواصل بالأيام قبل السحب (التنبيه قبلها بيوم). ٣ = القيمة
--                            المستخدمة حاليًا في لوحة «لم يُتواصل معهم إطلاقًا».
--   noContactIncludeManual : يشمل الموزّعين يدويًا — الباب الوحيد الذي يتخطّى حصانة
--                            manualAssignedAt وقاعدة البركة، ولصامتي التواصل وحدهم. مطفأ افتراضيًا.
--   noResponseRedistMode   : وضع إعادة التوزيع الآلي — 'fresh' (القائم: بدون متابعات، السجل مخفي
--                            عن المستلم) أو 'full' (ببياناته: المرحلة NEW والعدّاد يبدأ، والمتابعات ظاهرة).
ALTER TABLE "Settings" ADD COLUMN "noContactPullEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Settings" ADD COLUMN "noContactPullDays" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "Settings" ADD COLUMN "noContactIncludeManual" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Settings" ADD COLUMN "noResponseRedistMode" TEXT NOT NULL DEFAULT 'fresh';
