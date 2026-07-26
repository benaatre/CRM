-- CreateEnum
CREATE TYPE "Floor" AS ENUM ('GROUND', 'FIRST', 'SECOND', 'TOP');

-- AlterEnum
ALTER TYPE "BookingStage" ADD VALUE 'DELIVERED';

-- AlterEnum
BEGIN;
CREATE TYPE "FirstContactStage_new" AS ENUM ('INTERESTED', 'NO_ANSWER', 'NOT_INTERESTED');
ALTER TABLE "Lead" ALTER COLUMN "firstContactStage" TYPE "FirstContactStage_new" USING ("firstContactStage"::text::"FirstContactStage_new");
ALTER TYPE "FirstContactStage" RENAME TO "FirstContactStage_old";
ALTER TYPE "FirstContactStage_new" RENAME TO "FirstContactStage";
DROP TYPE "public"."FirstContactStage_old";
COMMIT;

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FollowUpResult" ADD VALUE 'NO_ANSWER_INTERESTED';
ALTER TYPE "FollowUpResult" ADD VALUE 'BANK_CHECK';
ALTER TYPE "FollowUpResult" ADD VALUE 'ON_HOLD';
ALTER TYPE "FollowUpResult" ADD VALUE 'NOT_INTERESTED_VISITED';
ALTER TYPE "FollowUpResult" ADD VALUE 'NOT_INTERESTED_BANK';
ALTER TYPE "FollowUpResult" ADD VALUE 'NOT_INTERESTED_MARKETER';
ALTER TYPE "FollowUpResult" ADD VALUE 'NOT_INTERESTED_OTHER';
ALTER TYPE "FollowUpResult" ADD VALUE 'INTERESTED_VISIT_SCHEDULED';
ALTER TYPE "FollowUpResult" ADD VALUE 'VISIT_NO_SHOW_RESCHEDULED';

-- AlterEnum
ALTER TYPE "LeadStage" ADD VALUE 'VISIT_SCHEDULED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PurchaseMethod" ADD VALUE 'BANK_FINANCE_SUPPORTED';
ALTER TYPE "PurchaseMethod" ADD VALUE 'BANK_FINANCE_UNSUPPORTED';

-- AlterEnum
ALTER TYPE "SaudiBank" ADD VALUE 'SAMBA';

-- AlterTable
ALTER TABLE "Booking" DROP COLUMN "financePercent",
DROP COLUMN "financeRequestNo",
ADD COLUMN     "collectedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "discountExceeded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "discountOverage" DECIMAL(14,2),
ADD COLUMN     "discountPercentAtBooking" DECIMAL(5,2),
ADD COLUMN     "includesVAT" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "maxDiscountPercentAtBooking" DECIMAL(5,2),
ADD COLUMN     "remainingAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "secondaryPhone" TEXT,
ADD COLUMN     "vatAmount" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "assignedAt" TIMESTAMP(3),
ADD COLUMN     "contactedAt" TIMESTAMP(3),
ADD COLUMN     "manualAssignedAt" TIMESTAMP(3),
ADD COLUMN     "reassignCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "source" TEXT,
ADD COLUMN     "sourceId" TEXT,
ADD COLUMN     "visitAt" TIMESTAMP(3),
ADD COLUMN     "visitRescheduleCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "link" TEXT;

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "autoDistribute" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "distEndHour" INTEGER NOT NULL DEFAULT 21,
ADD COLUMN     "distInitialMode" TEXT NOT NULL DEFAULT 'ROUND_ROBIN',
ADD COLUMN     "distOrder" TEXT[],
ADD COLUMN     "distPointer" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "distPresenceMin" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "distReassignMode" TEXT NOT NULL DEFAULT 'MOST_ACTIVE',
ADD COLUMN     "distStartHour" INTEGER NOT NULL DEFAULT 13,
ADD COLUMN     "distTimeoutMin" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "globalMute" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastCronAt" TIMESTAMP(3),
ADD COLUMN     "lastCronDistributed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastCronReassigned" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "logoUrl" TEXT,
ADD COLUMN     "masterVolume" INTEGER NOT NULL DEFAULT 80,
ADD COLUMN     "sweepCutoffAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Unit" ADD COLUMN     "discountedPrice" DECIMAL(14,2),
ADD COLUMN     "floorLevel" "Floor",
ADD COLUMN     "totalArea" DECIMAL(8,2);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "availabilityPaused" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pauseReason" TEXT,
ADD COLUMN     "pauseUntil" TIMESTAMP(3),
ADD COLUMN     "pausedAt" TIMESTAMP(3),
ADD COLUMN     "pausedBy" TEXT,
ADD COLUMN     "pinResetExp" TIMESTAMP(3),
ADD COLUMN     "pinResetToken" TEXT,
ADD COLUMN     "sessionsValidFrom" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "recipientId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reassignment" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "fromUserId" TEXT,
    "toUserId" TEXT,
    "reason" TEXT NOT NULL DEFAULT 'timeout',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reassignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SweepCandidate" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "fromUserId" TEXT,
    "reason" TEXT NOT NULL DEFAULT 'timeout',
    "timeoutMin" INTEGER,
    "leadAssignedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SweepCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadSource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SheetLink" (
    "id" TEXT NOT NULL,
    "sheetUrl" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "lastRowSynced" INTEGER NOT NULL DEFAULT 0,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncStatus" TEXT,
    "lastSyncError" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SheetLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationSetting" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "soundEnabled" BOOLEAN NOT NULL DEFAULT true,
    "toastEnabled" BOOLEAN NOT NULL DEFAULT true,
    "volume" INTEGER NOT NULL DEFAULT 100,
    "soundId" TEXT,
    "audience" TEXT NOT NULL DEFAULT 'MANAGERS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SoundAsset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SoundAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatMessage_recipientId_createdAt_idx" ON "ChatMessage"("recipientId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatMessage_senderId_createdAt_idx" ON "ChatMessage"("senderId", "createdAt");

-- CreateIndex
CREATE INDEX "Reassignment_leadId_idx" ON "Reassignment"("leadId");

-- CreateIndex
CREATE INDEX "Reassignment_createdAt_idx" ON "Reassignment"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SweepCandidate_leadId_key" ON "SweepCandidate"("leadId");

-- CreateIndex
CREATE INDEX "SweepCandidate_createdAt_idx" ON "SweepCandidate"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LeadSource_name_key" ON "LeadSource"("name");

-- CreateIndex
CREATE INDEX "SheetLink_sourceId_idx" ON "SheetLink"("sourceId");

-- CreateIndex
CREATE INDEX "SheetLink_isActive_idx" ON "SheetLink"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationSetting_eventKey_key" ON "NotificationSetting"("eventKey");

-- CreateIndex
CREATE INDEX "Lead_assignedAt_idx" ON "Lead"("assignedAt");

-- CreateIndex
CREATE INDEX "Lead_assignedToId_assignedAt_idx" ON "Lead"("assignedToId", "assignedAt");

-- CreateIndex
CREATE INDEX "Lead_sourceId_idx" ON "Lead"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "User_pinResetToken_key" ON "User"("pinResetToken");

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "LeadSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reassignment" ADD CONSTRAINT "Reassignment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SweepCandidate" ADD CONSTRAINT "SweepCandidate_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetLink" ADD CONSTRAINT "SheetLink_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "LeadSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

