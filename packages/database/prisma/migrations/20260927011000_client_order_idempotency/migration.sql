ALTER TABLE "Order" ADD COLUMN "clientIdempotencyKey" TEXT;
ALTER TABLE "Order" ADD COLUMN "clientRequestHash" TEXT;
CREATE UNIQUE INDEX "Order_clientIdempotencyKey_key" ON "Order"("clientIdempotencyKey");
