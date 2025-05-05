-- CreateTable
CREATE TABLE "tracking_time_slots" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "pollingInterval" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tracking_time_slots_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "tracking_time_slots" ADD CONSTRAINT "tracking_time_slots_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "tracking_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
