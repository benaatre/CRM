-- CreateEnum
CREATE TYPE "FirstContactStage" AS ENUM ('CONTACTED', 'NO_ANSWER', 'NOT_SUITABLE');

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "firstContactDate" TIMESTAMP(3),
ADD COLUMN     "firstContactStage" "FirstContactStage",
ADD COLUMN     "isArchived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "preferredAreas" TEXT[],
ADD COLUMN     "preferredProjects" TEXT[],
ADD COLUMN     "priceMax" INTEGER,
ADD COLUMN     "priceMin" INTEGER;

-- CreateIndex
CREATE INDEX "Lead_isArchived_idx" ON "Lead"("isArchived");
