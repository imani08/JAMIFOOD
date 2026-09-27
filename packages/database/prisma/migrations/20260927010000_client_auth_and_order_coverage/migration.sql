ALTER TABLE "ClientAccount" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
CREATE TABLE "ClientAuthToken" (
  "id" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "purpose" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClientAuthToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ClientAuthToken_tokenHash_key" ON "ClientAuthToken"("tokenHash");
CREATE INDEX "ClientAuthToken_accountId_purpose_createdAt_idx" ON "ClientAuthToken"("accountId", "purpose", "createdAt");
CREATE INDEX "ClientAuthToken_expiresAt_idx" ON "ClientAuthToken"("expiresAt");
ALTER TABLE "ClientAuthToken" ADD CONSTRAINT "ClientAuthToken_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ClientAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Order" ADD COLUMN "commercialTotal" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "coveredAmount" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "mealRightId" UUID;
CREATE UNIQUE INDEX "Order_mealRightId_key" ON "Order"("mealRightId");
UPDATE "Order" SET "commercialTotal" = "totalAmount" WHERE "commercialTotal" = 0;
