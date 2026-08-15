-- حوكمة الدوام — الدفعة الثالثة: النداء الإجباري وإيقاف العدّاد.
-- صفر لمس لأي جدول خارج الدوام، ولا تُطبَّق آليًا (المالك ينفّذ migrate deploy).
-- قاعدة الترتيب: ALTER TYPE ADD VALUE في نهاية الملف، ولا يُشار للقيم الجديدة
-- داخل نفس الملف إطلاقًا (قيود Postgres على استخدام قيمة enum في معاملتها).

-- CreateEnum
CREATE TYPE "AttendancePauseKind" AS ENUM ('EXCUSED', 'LEFT');

-- CreateTable — فترات التوقف داخل الجلسة (تُخصم من الساعات النشطة)
CREATE TABLE "AttendancePause" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "AttendancePauseKind" NOT NULL,
    "authorizerId" TEXT,
    "authorizerLabel" TEXT NOT NULL,
    "reason" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "autoClosed" BOOLEAN NOT NULL DEFAULT false,
    "remindersSent" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendancePause_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendancePause_sessionId_idx" ON "AttendancePause"("sessionId");
CREATE INDEX "AttendancePause_userId_startedAt_idx" ON "AttendancePause"("userId", "startedAt");

-- CreateTable — جهات الإذن (الحذف تعطيل isActive=false لا مسحًا)
CREATE TABLE "AttendanceAuthorizer" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AttendanceAuthorizer_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "AttendancePause" ADD CONSTRAINT "AttendancePause_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AttendanceSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AttendancePause" ADD CONSTRAINT "AttendancePause_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable — نوع النداء (RANDOM | MANUAL | ARRIVAL) ونسب نداء الوصول لأصله
ALTER TABLE "AttendanceVerification" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'RANDOM';
ALTER TABLE "AttendanceVerification" ADD COLUMN "parentId" TEXT;

-- AlterTable — إعدادات الدفعة الثالثة
ALTER TABLE "AttendanceSettings" ADD COLUMN "arrivalConfirmMinutes" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "AttendanceSettings" ADD COLUMN "allowLeftOption" BOOLEAN NOT NULL DEFAULT true;

-- AlterEnum — في النهاية حصرًا، وبلا أي استخدام للقيمتين في هذا الملف
ALTER TYPE "AttendanceVerificationStatus" ADD VALUE 'PAUSED';
ALTER TYPE "AttendanceVerificationStatus" ADD VALUE 'EN_ROUTE';
