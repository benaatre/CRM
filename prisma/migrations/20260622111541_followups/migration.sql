-- CreateEnum
CREATE TYPE "FollowUpType" AS ENUM ('CALL', 'WHATSAPP', 'VISIT_PROJECT', 'VISIT_OFFICE', 'OTHER');

-- CreateEnum
CREATE TYPE "FollowUpResult" AS ENUM ('INTERESTED_SCHEDULED', 'INTERESTED_SENT_INFO', 'INTERESTED_VISITED', 'NEGOTIATING', 'NOT_ANSWERED_SCHEDULED', 'NOT_ANSWERED_WHATSAPP', 'NOT_INTERESTED_LOCATION', 'NOT_INTERESTED_SPACE', 'NOT_INTERESTED_PRICE', 'NOT_INTERESTED_FINAL', 'BOOKED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Channel" ADD VALUE 'SNAPCHAT';
ALTER TYPE "Channel" ADD VALUE 'GOOGLE';

-- CreateTable
CREATE TABLE "FollowUp" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "type" "FollowUpType" NOT NULL,
    "note" TEXT,
    "result" "FollowUpResult" NOT NULL,
    "nextDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "FollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FollowUp_leadId_idx" ON "FollowUp"("leadId");

-- CreateIndex
CREATE INDEX "FollowUp_createdBy_idx" ON "FollowUp"("createdBy");

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
