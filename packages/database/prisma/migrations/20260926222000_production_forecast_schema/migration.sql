-- Persist the already-present Prisma model; preserve all existing productions.
ALTER TABLE "Production" ADD COLUMN "forecastId" UUID;
CREATE TABLE "ProductionForecast" (
 "id" UUID NOT NULL,
 "businessDate" DATE NOT NULL,
 "serviceCode" TEXT NOT NULL,
 "theoreticalRights" INTEGER NOT NULL DEFAULT 0,
 "reservations" INTEGER NOT NULL DEFAULT 0,
 "directOrders" DECIMAL(18,3) NOT NULL DEFAULT 0,
 "estimatedAttendance" DECIMAL(18,3) NOT NULL DEFAULT 0,
 "calculatedQuantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
 "adjustment" DECIMAL(18,3) NOT NULL DEFAULT 0,
 "finalQuantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
 "lostQuantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
 "adjustmentReason" TEXT,
 "adjustedById" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "ProductionForecast_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProductionForecast_businessDate_idx" ON "ProductionForecast"("businessDate");
CREATE UNIQUE INDEX "ProductionForecast_businessDate_serviceCode_key" ON "ProductionForecast"("businessDate", "serviceCode");
CREATE INDEX "Production_forecastId_idx" ON "Production"("forecastId");
ALTER TABLE "Production" ADD CONSTRAINT "Production_forecastId_fkey" FOREIGN KEY ("forecastId") REFERENCES "ProductionForecast"("id") ON DELETE SET NULL ON UPDATE CASCADE;
