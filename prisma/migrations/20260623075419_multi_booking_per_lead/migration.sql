-- DropIndex
DROP INDEX "Booking_leadId_key";

-- CreateIndex
CREATE INDEX "Booking_leadId_idx" ON "Booking"("leadId");
