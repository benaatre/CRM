-- حوكمة الدوام (Geofence Attendance) — المرحلة ١.
-- جداول جديدة مستقلة تمامًا: لا ALTER على أي جدول قائم، ولا مساس بـ Lead.
-- آمن على الإنتاج: CREATE TYPE + CREATE TABLE + فهارس + مفاتيح أجنبية فقط.
-- مفتاح "User"("id") نوعه TEXT (cuid) — تحقّق من migration الأساس 20260621085734_init.

-- CreateEnum
CREATE TYPE "AttendanceLocationType" AS ENUM ('HQ', 'PROJECT');
CREATE TYPE "AttendanceEventType" AS ENUM ('CHECK_IN', 'CHECK_OUT', 'PROJECT_IN', 'PROJECT_OUT');
CREATE TYPE "AttendanceSource" AS ENUM ('WEB', 'NATIVE');

-- CreateTable
CREATE TABLE "AttendanceLocation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AttendanceLocationType" NOT NULL DEFAULT 'PROJECT',
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "radiusMeters" INTEGER NOT NULL DEFAULT 150,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "workStartMinutes" INTEGER NOT NULL DEFAULT 540,
    "workEndMinutes" INTEGER NOT NULL DEFAULT 1020,
    "lateThresholdMinutes" INTEGER NOT NULL DEFAULT 15,
    "allowProjectAttendance" BOOLEAN NOT NULL DEFAULT true,
    "minAccuracyMeters" INTEGER NOT NULL DEFAULT 100,
    "cooldownSeconds" INTEGER NOT NULL DEFAULT 120,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "locationId" TEXT,
    "type" "AttendanceEventType" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION NOT NULL,
    "distanceMeters" DOUBLE PRECISION NOT NULL,
    "source" "AttendanceSource" NOT NULL DEFAULT 'WEB',
    "isMock" BOOLEAN NOT NULL DEFAULT false,
    "outOfZone" BOOLEAN NOT NULL DEFAULT false,
    "isLate" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceEvent_userId_timestamp_idx" ON "AttendanceEvent"("userId", "timestamp");

-- CreateTable
CREATE TABLE "AttendanceSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "checkInEventId" TEXT NOT NULL,
    "checkOutEventId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "workedMinutes" INTEGER,
    "wasLate" BOOLEAN NOT NULL DEFAULT false,
    "autoClosed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AttendanceSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceSession_checkInEventId_key" ON "AttendanceSession"("checkInEventId");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceSession_checkOutEventId_key" ON "AttendanceSession"("checkOutEventId");

-- CreateIndex
CREATE INDEX "AttendanceSession_userId_startedAt_idx" ON "AttendanceSession"("userId", "startedAt");

-- AddForeignKey
ALTER TABLE "AttendanceEvent" ADD CONSTRAINT "AttendanceEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceEvent" ADD CONSTRAINT "AttendanceEvent_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "AttendanceLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
