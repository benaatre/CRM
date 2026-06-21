-- AlterEnum
ALTER TYPE "CashPaymentType" ADD VALUE 'CHECK';

-- AlterEnum
ALTER TYPE "SaudiBank" ADD VALUE 'ANB';

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "expectedTransferDate" TIMESTAMP(3),
ADD COLUMN     "installments" JSONB,
ADD COLUMN     "stageIndex" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "subjectToTax" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "taxAmount" DECIMAL(14,2);
