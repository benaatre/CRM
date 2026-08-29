-- AlterTable
ALTER TABLE "AttendanceSchedule" ADD COLUMN     "gapCallEnabled" BOOLEAN,
ADD COLUMN     "lateThresholdMinutes" INTEGER,
ADD COLUMN     "punchReminderEnabled" BOOLEAN,
ADD COLUMN     "quietMode" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "AttendanceSettings" DROP COLUMN "allowLeftOption",
DROP COLUMN "excuseDefaultMinutes",
DROP COLUMN "idleDeviceMinutes",
DROP COLUMN "leaveNeedsApproval",
DROP COLUMN "maxVisitMinutes",
DROP COLUMN "outZoneGraceMinutes",
ADD COLUMN     "alertRouting" JSONB,
ADD COLUMN     "autoCallOnSustainedOutZone" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "maxSessionMinutes" INTEGER NOT NULL DEFAULT 840,
ADD COLUMN     "pulseImmunityMinutes" INTEGER NOT NULL DEFAULT 30;

