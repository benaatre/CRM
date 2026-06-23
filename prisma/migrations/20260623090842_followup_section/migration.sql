-- CreateEnum
CREATE TYPE "FollowUpSection" AS ENUM ('INTERESTED', 'NO_ANSWER', 'NOT_INTERESTED');

-- AlterTable
ALTER TABLE "FollowUp" ADD COLUMN     "section" "FollowUpSection";
