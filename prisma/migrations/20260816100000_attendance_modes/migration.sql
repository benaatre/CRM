-- حوكمة الدوام — الدفعة الرابعة: أوضاع اليوم والتحقق الذكي.
-- صفر تغيير على "Lead". جداول جديدة + أعمدة على جداول الدوام فقط.
-- ALTER TYPE ADD VALUE في نهاية الملف حصرًا وبلا أي استخدام داخله.
-- لا تُطبَّق آليًا: المالك ينفّذ migrate deploy بنفسه.

-- CreateEnum — وضع اليوم
CREATE TYPE "AttendanceDayMode" AS ENUM ('ONSITE', 'REMOTE', 'LEAVE');

-- CreateTable — اليوم المنطقي (الحساب اليومي)
CREATE TABLE "AttendanceDay" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "mode" "AttendanceDayMode" NOT NULL DEFAULT 'ONSITE',
    "firstCheckInAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3),
    "wasLate" BOOLEAN NOT NULL DEFAULT false,
    "unconfirmedMinutes" INTEGER NOT NULL DEFAULT 0,
    "autoEnded" BOOLEAN NOT NULL DEFAULT false,
    "remoteAuthorizerId" TEXT,
    "remoteAuthorizerLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceDay_userId_date_key" ON "AttendanceDay"("userId", "date");
CREATE INDEX "AttendanceDay_date_idx" ON "AttendanceDay"("date");

-- CreateTable — فترات فتح التطبيق (وضع عن بُعد)
CREATE TABLE "AppActivityWindow" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppActivityWindow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AppActivityWindow_userId_date_idx" ON "AppActivityWindow"("userId", "date");

-- CreateTable — الفحص الصامت (للمالك فقط)
CREATE TABLE "AttendanceSilentCheck" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "locationId" TEXT,
    "distanceMeters" DOUBLE PRECISION,
    "outOfZone" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceSilentCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceSilentCheck_userId_at_idx" ON "AttendanceSilentCheck"("userId", "at");

-- CreateTable — سجل التدقيق (append-only في الكود)
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditEvent_resourceType_resourceId_idx" ON "AuditEvent"("resourceType", "resourceId");
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "AttendanceDay" ADD CONSTRAINT "AttendanceDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AppActivityWindow" ADD CONSTRAINT "AppActivityWindow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AttendanceSilentCheck" ADD CONSTRAINT "AttendanceSilentCheck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable — ربط الجلسة بيومها المنطقي (اختياري للتوافق مع القديم)
ALTER TABLE "AttendanceSession" ADD COLUMN "dayId" TEXT;
ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "AttendanceDay"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable — إجازة الدفعة الرابعة على الاستثناءات
ALTER TABLE "AttendanceException" ADD COLUMN "leaveType" TEXT;
ALTER TABLE "AttendanceException" ADD COLUMN "authorizerId" TEXT;
ALTER TABLE "AttendanceException" ADD COLUMN "authorizerLabel" TEXT;
ALTER TABLE "AttendanceException" ADD COLUMN "selfDeclared" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable — إعدادات التحقق الذكي والأوضاع
ALTER TABLE "AttendanceSettings" ADD COLUMN "verificationQuietWindowMinutes" INTEGER NOT NULL DEFAULT 90;
ALTER TABLE "AttendanceSettings" ADD COLUMN "verificationStartGuardMinutes" INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "AttendanceSettings" ADD COLUMN "verificationEndGuardMinutes" INTEGER NOT NULL DEFAULT 45;
ALTER TABLE "AttendanceSettings" ADD COLUMN "escalationDelayMinutes" INTEGER NOT NULL DEFAULT 20;
ALTER TABLE "AttendanceSettings" ADD COLUMN "silentCheckIntervalMinutes" INTEGER NOT NULL DEFAULT 20;
ALTER TABLE "AttendanceSettings" ADD COLUMN "leaveNeedsApproval" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AttendanceSettings" ADD COLUMN "remoteWeeklyCap" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AttendanceSettings" ADD COLUMN "leavePausesLeadIntake" BOOLEAN NOT NULL DEFAULT true;

-- AlterEnum — في النهاية حصرًا، وبلا أي استخدام للقيمة في هذا الملف
ALTER TYPE "AttendancePauseKind" ADD VALUE 'NO_RESPONSE';
