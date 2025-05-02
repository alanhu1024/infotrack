-- AlterTable
ALTER TABLE "tracking_rules" ADD COLUMN     "lastPolledAt" TIMESTAMP(3),
ADD COLUMN     "pollingEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pollingInterval" INTEGER NOT NULL DEFAULT 300;
