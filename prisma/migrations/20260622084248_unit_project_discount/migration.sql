-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "maxDiscountAmount" DECIMAL(14,2),
ADD COLUMN     "maxDiscountPercent" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "Unit" ADD COLUMN     "discountPercent" DECIMAL(5,2);
