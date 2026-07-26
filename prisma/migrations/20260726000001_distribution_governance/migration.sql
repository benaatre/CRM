-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "autoPoolAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "LeadSource" ADD COLUMN     "autoPool" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "distBatchSize" INTEGER,
ADD COLUMN     "distPerEmployeePerWindow" INTEGER,
ADD COLUMN     "distWindowMin" INTEGER NOT NULL DEFAULT 30;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "dailyAssignCap" INTEGER;

-- CreateIndex
CREATE INDEX "Lead_autoPoolAt_idx" ON "Lead"("autoPoolAt");

