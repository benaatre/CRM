-- AlterTable
ALTER TABLE "AttendanceSettings" ADD COLUMN     "autoCloseAliveGraceMinutes" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "conditionalCooldownMinutes" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "conditionalWindowMinutes" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "excuseDefaultMinutes" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "heartbeatGapMinutes" INTEGER NOT NULL DEFAULT 45,
ADD COLUMN     "idleDeviceMinutes" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "maxConditionalPerDay" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN     "maxOutOfZoneMinutes" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "maxVisitMinutes" INTEGER NOT NULL DEFAULT 240,
ADD COLUMN     "outZoneGraceMinutes" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "quietWindowCountsCrm" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "visitReverifyMinutes" INTEGER NOT NULL DEFAULT 90;

-- AlterTable
ALTER TABLE "AttendanceVerification" ADD COLUMN     "triggerReason" TEXT;

-- AlterTable
ALTER TABLE "AttendanceSession" ADD COLUMN     "closedBy" TEXT,
ADD COLUMN     "lastAliveAt" TIMESTAMP(3),
ADD COLUMN     "lastZoneProofAt" TIMESTAMP(3),
ADD COLUMN     "voided" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AttendancePulse" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT,
    "at" TIMESTAMP(3) NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "locationId" TEXT,
    "inZone" BOOLEAN,
    "flags" TEXT,

    CONSTRAINT "AttendancePulse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceVisit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT,
    "locationId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'AUTO',
    "minutes" INTEGER,

    CONSTRAINT "AttendanceVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceExcuse" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "authorizerId" TEXT,
    "authorizerLabel" TEXT NOT NULL,
    "reason" TEXT,
    "expectedMinutes" INTEGER,
    "returnedVia" TEXT,

    CONSTRAINT "AttendanceExcuse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendancePulse_userId_at_idx" ON "AttendancePulse"("userId", "at");

-- CreateIndex
CREATE INDEX "AttendancePulse_at_idx" ON "AttendancePulse"("at");

-- CreateIndex
CREATE INDEX "AttendanceVisit_userId_startedAt_idx" ON "AttendanceVisit"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "AttendanceExcuse_userId_startedAt_idx" ON "AttendanceExcuse"("userId", "startedAt");

-- AddForeignKey
ALTER TABLE "AttendancePulse" ADD CONSTRAINT "AttendancePulse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendancePulse" ADD CONSTRAINT "AttendancePulse_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "AttendanceLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceVisit" ADD CONSTRAINT "AttendanceVisit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceVisit" ADD CONSTRAINT "AttendanceVisit_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "AttendanceLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceExcuse" ADD CONSTRAINT "AttendanceExcuse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

