-- AlterEnum
ALTER TYPE "AttendanceSource" ADD VALUE 'AUTO_GEO';

-- AlterTable
ALTER TABLE "AttendanceSchedule" ADD COLUMN     "startWindowEndMinutes" INTEGER;

-- AlterTable
ALTER TABLE "AttendanceSettings" ADD COLUMN     "arrivalMarginMinutes" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "autoPunchEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyAutoPunchOwner" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "AttendanceDecision" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "etaMinutes" INTEGER,
    "decidedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "outcome" TEXT,

    CONSTRAINT "AttendanceDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceDecision_userId_date_idx" ON "AttendanceDecision"("userId", "date");

-- AddForeignKey
ALTER TABLE "AttendanceDecision" ADD CONSTRAINT "AttendanceDecision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- الافتراض الجديد للأعمدة المقبلة
ALTER TABLE "AttendanceSettings" ALTER COLUMN "visitReverifyMinutes" SET DEFAULT 20;

-- قرار ١٠ المعتمد: التحقق الدوري بالزيارة كل ٢٠ دقيقة — تحديث صف الإعدادات القائم
-- (الافتراض الجديد للصفوف الجديدة يبقى من الكود؛ هذا يفرض القيمة على singleton الفعلي)
UPDATE "AttendanceSettings" SET "visitReverifyMinutes" = 20 WHERE "id" = 'singleton' AND "visitReverifyMinutes" = 90;
