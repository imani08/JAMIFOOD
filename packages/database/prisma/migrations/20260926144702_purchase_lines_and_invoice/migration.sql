/*
  Warnings:

  - A unique constraint covering the columns `[reference]` on the table `Purchase` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Purchase" ADD COLUMN     "invoiceDate" DATE,
ADD COLUMN     "invoiceNumber" TEXT,
ADD COLUMN     "invoiceObjectKey" TEXT,
ADD COLUMN     "reference" TEXT;

-- CreateTable
CREATE TABLE "StockLot" (
    "id" UUID NOT NULL,
    "stockItemId" UUID NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "expiresAt" DATE,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "StockLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseLine" (
    "id" UUID NOT NULL,
    "purchaseId" UUID NOT NULL,
    "stockItemId" UUID NOT NULL,
    "orderedQuantity" DECIMAL(18,3) NOT NULL,
    "receivedQuantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL,

    CONSTRAINT "PurchaseLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockLot_expiresAt_idx" ON "StockLot"("expiresAt");

-- CreateIndex
CREATE INDEX "StockLot_stockItemId_active_idx" ON "StockLot"("stockItemId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "StockLot_stockItemId_batchNumber_key" ON "StockLot"("stockItemId", "batchNumber");

-- CreateIndex
CREATE INDEX "PurchaseLine_stockItemId_idx" ON "PurchaseLine"("stockItemId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseLine_purchaseId_stockItemId_key" ON "PurchaseLine"("purchaseId", "stockItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_reference_key" ON "Purchase"("reference");

-- CreateIndex
CREATE INDEX "Purchase_supplierId_createdAt_idx" ON "Purchase"("supplierId", "createdAt");

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
