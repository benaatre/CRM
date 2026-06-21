-- CreateEnum
CREATE TYPE "PurchaseMethod" AS ENUM ('CASH', 'BANK_FINANCE', 'CASH_AND_FINANCE');

-- CreateEnum
CREATE TYPE "PurchaseGoal" AS ENUM ('RESIDENCE', 'INVESTMENT', 'BOTH');

-- CreateEnum
CREATE TYPE "CashPaymentType" AS ENUM ('TRANSFER', 'INSTALLMENTS');

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'CASH_AND_FINANCE';

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "cashAmount" DECIMAL(14,2),
ADD COLUMN     "cashPaymentType" "CashPaymentType",
ADD COLUMN     "expectedCheckDate" TIMESTAMP(3),
ADD COLUMN     "financePercent" DECIMAL(5,2),
ADD COLUMN     "financeRejectedReason" TEXT,
ADD COLUMN     "financeRequestNo" TEXT,
ADD COLUMN     "installmentAmount" DECIMAL(14,2),
ADD COLUMN     "installmentsCount" INTEGER;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "preferredDistrict" TEXT,
ADD COLUMN     "purchaseGoal" "PurchaseGoal",
ADD COLUMN     "purchaseMethod" "PurchaseMethod";

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "googleSheetUrl" TEXT,
ADD COLUMN     "lastSyncAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "BookingEvent" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "userId" TEXT,
    "fromStage" "BookingStage",
    "toStage" "BookingStage" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookingEvent_bookingId_idx" ON "BookingEvent"("bookingId");

-- AddForeignKey
ALTER TABLE "BookingEvent" ADD CONSTRAINT "BookingEvent_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingEvent" ADD CONSTRAINT "BookingEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
