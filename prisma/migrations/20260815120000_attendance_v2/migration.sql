-- حوكمة الدوام — المرحلة ٢ (الدوام المحدد + الاستثناءات + نداءات التحقق).
-- آمن على الإنتاج: CREATE TYPE + CREATE TABLE + ALTER على "AttendanceSettings" (جدولنا) فقط.
-- صفر لمس لأي جدول آخر — ولا مساس بـ Lead.
-- مفتاح "User"("id") نوعه TEXT (cuid) — تحقّق من migration الأساس 20260621085734_init.
-- لا تُطبّق آليًا: المالك يشغّل `migrate deploy` بنفسه بعد Neon backup.

-- CreateEnum
CREATE TYPE "AttendanceExceptionType" AS ENUM ('FULL_DAY_LEAVE', 'HOURS_EXCUSE', 'MODIFIED_SHIFT');
CREATE TYPE "AttendanceVerificationStatus" AS ENUM ('PENDING', 'SENT', 'CONFIRMED', 'OUT_OF_ZONE', 'MISSED');

-- CreateTable
CREATE TABLE "AttendanceSchedule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startMinutes" INTEGER NOT NULL DEFAULT 540,
    "shiftMinutes" INTEGER NOT NULL DEFAULT 480,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceSchedule_userId_key" ON "AttendanceSchedule"("userId");

-- CreateTable
CREATE TABLE "AttendanceException" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "AttendanceExceptionType" NOT NULL,
    "dateFrom" DATE NOT NULL,
    "dateTo" DATE NOT NULL,
    "excuseUntilMinutes" INTEGER,
    "modifiedShiftMinutes" INTEGER,
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceException_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceException_userId_dateFrom_idx" ON "AttendanceException"("userId", "dateFrom");

-- CreateTable
CREATE TABLE "AttendanceVerification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "deadlineAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "accuracy" DOUBLE PRECISION,
    "locationId" TEXT,
    "distanceMeters" DOUBLE PRECISION,
    "status" "AttendanceVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceVerification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceVerification_userId_scheduledAt_idx" ON "AttendanceVerification"("userId", "scheduledAt");
CREATE INDEX "AttendanceVerification_status_scheduledAt_idx" ON "AttendanceVerification"("status", "scheduledAt");

-- AddForeignKey
ALTER TABLE "AttendanceSchedule" ADD CONSTRAINT "AttendanceSchedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceException" ADD CONSTRAINT "AttendanceException_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceVerification" ADD CONSTRAINT "AttendanceVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable — أعمدة إعدادات جديدة بقيم افتراضية (جدول AttendanceSettings ملكنا وصفّه singleton واحد)
ALTER TABLE "AttendanceSettings" ADD COLUMN "weekendDays" TEXT NOT NULL DEFAULT 'FRI,SAT';
ALTER TABLE "AttendanceSettings" ADD COLUMN "noShowAfterMinutes" INTEGER NOT NULL DEFAULT 180;
ALTER TABLE "AttendanceSettings" ADD COLUMN "verificationEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "AttendanceSettings" ADD COLUMN "verificationPerDay" INTEGER NOT NULL DEFAULT 2;
ALTER TABLE "AttendanceSettings" ADD COLUMN "verificationWindowMinutes" INTEGER NOT NULL DEFAULT 15;
