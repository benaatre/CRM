-- AlterTable
ALTER TABLE "AttendanceDecision" ADD COLUMN     "authorizerId" TEXT,
ADD COLUMN     "authorizerLabel" TEXT;

-- AlterTable
ALTER TABLE "AttendanceSettings" ADD COLUMN     "radarFreshMinutes" INTEGER NOT NULL DEFAULT 3;

-- CreateIndex
CREATE INDEX "AttendancePulse_locationId_at_idx" ON "AttendancePulse"("locationId", "at");

