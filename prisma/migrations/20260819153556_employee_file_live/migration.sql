-- AlterEnum
ALTER TYPE "AttendanceSource" ADD VALUE 'OWNER';

-- AlterTable
ALTER TABLE "AttendanceDay" ADD COLUMN     "lockedAt" TIMESTAMP(3),
ADD COLUMN     "lockedById" TEXT;

-- AlterTable
ALTER TABLE "AttendanceSchedule" ADD COLUMN     "dayLockEnabled" BOOLEAN,
ADD COLUMN     "exemptReason" TEXT,
ADD COLUMN     "notifyMissedCall" BOOLEAN,
ADD COLUMN     "outZoneCallEnabled" BOOLEAN,
ADD COLUMN     "verificationPerDay" INTEGER,
ADD COLUMN     "watchAlertFirstSeen" BOOLEAN,
ADD COLUMN     "watchFromMinutes" INTEGER,
ADD COLUMN     "watchToMinutes" INTEGER,
ADD COLUMN     "weekendDays" TEXT;
