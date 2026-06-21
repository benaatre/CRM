-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "LeadStage" AS ENUM ('NEW', 'ATTEMPTED', 'INTERESTED', 'FOLLOW_UP_LATER', 'VIEWING', 'NEGOTIATION', 'RESERVED', 'CLOSED_WON', 'CLOSED_LOST');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('WHATSAPP', 'TIKTOK', 'META', 'AQAR', 'REFERRAL', 'VISIT', 'OTHER');

-- CreateEnum
CREATE TYPE "UnitType" AS ENUM ('APARTMENT', 'FLOOR', 'GROUND_FLOOR_APARTMENT', 'PENTHOUSE', 'OTHER');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('AVAILABLE', 'UNDER_CONSTRUCTION', 'FINISHING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "UnitStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'SOLD');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_FINANCE');

-- CreateEnum
CREATE TYPE "SaudiBank" AS ENUM ('RAJHI', 'SNB', 'RIYAD', 'ALINMA', 'SAB', 'ALBILAD', 'ALJAZIRA', 'OTHER');

-- CreateEnum
CREATE TYPE "Nationality" AS ENUM ('SAUDI', 'RESIDENT');

-- CreateEnum
CREATE TYPE "BookingStage" AS ENUM ('RESERVATION', 'PAPERWORK', 'VALUATION', 'SIGNING', 'TRANSFER', 'SOLD');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SCHEDULED', 'DELIVERED');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('CALL', 'WHATSAPP', 'VISIT', 'APPOINTMENT', 'NOTE', 'STAGE_CHANGE', 'ASSIGNMENT');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "role" "Role" NOT NULL DEFAULT 'EMPLOYEE',
    "passwordHash" TEXT,
    "pinHash" TEXT,
    "targetDeals" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "district" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'AVAILABLE',
    "priceMin" DECIMAL(14,2),
    "priceMax" DECIMAL(14,2),
    "deliveryDate" TIMESTAMP(3),
    "falLicense" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "type" "UnitType" NOT NULL DEFAULT 'APARTMENT',
    "floor" TEXT,
    "area" DECIMAL(8,2),
    "price" DECIMAL(14,2),
    "status" "UnitStatus" NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "nationalId" TEXT,
    "nationality" "Nationality",
    "channel" "Channel" NOT NULL DEFAULT 'OTHER',
    "projectId" TEXT,
    "unitType" "UnitType",
    "budget" DECIMAL(14,2),
    "stage" "LeadStage" NOT NULL DEFAULT 'NEW',
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "firstContactAt" TIMESTAMP(3),
    "lastContact" TIMESTAMP(3),
    "nextFollowup" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "assignedToId" TEXT,
    "createdById" TEXT,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "sellerId" TEXT,
    "nationality" "Nationality",
    "nationalId" TEXT,
    "phone" TEXT,
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "bankName" "SaudiBank",
    "deposit" DECIMAL(14,2),
    "price" DECIMAL(14,2) NOT NULL,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "finalPrice" DECIMAL(14,2) NOT NULL,
    "stage" "BookingStage" NOT NULL DEFAULT 'RESERVATION',
    "deliveryStatus" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "financeRejected" BOOLEAN NOT NULL DEFAULT false,
    "collected" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "userId" TEXT,
    "type" "ActivityType" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "fromLeadId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "converted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "Project_status_idx" ON "Project"("status");

-- CreateIndex
CREATE INDEX "Unit_status_idx" ON "Unit"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Unit_projectId_number_key" ON "Unit"("projectId", "number");

-- CreateIndex
CREATE INDEX "Lead_stage_idx" ON "Lead"("stage");

-- CreateIndex
CREATE INDEX "Lead_assignedToId_idx" ON "Lead"("assignedToId");

-- CreateIndex
CREATE INDEX "Lead_nextFollowup_idx" ON "Lead"("nextFollowup");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_leadId_key" ON "Booking"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_unitId_key" ON "Booking"("unitId");

-- CreateIndex
CREATE INDEX "Booking_stage_idx" ON "Booking"("stage");

-- CreateIndex
CREATE INDEX "Booking_sellerId_idx" ON "Booking"("sellerId");

-- CreateIndex
CREATE INDEX "Activity_leadId_idx" ON "Activity"("leadId");

-- CreateIndex
CREATE INDEX "Activity_type_idx" ON "Activity"("type");

-- CreateIndex
CREATE INDEX "Referral_fromLeadId_idx" ON "Referral"("fromLeadId");

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_fromLeadId_fkey" FOREIGN KEY ("fromLeadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
