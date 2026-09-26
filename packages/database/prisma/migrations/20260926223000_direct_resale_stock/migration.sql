-- Existing food products keep production-only deduction until explicitly changed.
ALTER TABLE "Product" ADD COLUMN "stockMode" TEXT NOT NULL DEFAULT 'PRODUCTION',
 ADD COLUMN "stockItemId" UUID,
 ADD COLUMN "stockQuantity" DECIMAL(18,3) NOT NULL DEFAULT 1;
ALTER TABLE "Product" ADD CONSTRAINT "Product_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "product_stock_mode" CHECK ("stockMode" IN ('PRODUCTION','DIRECT','NONE') AND "stockQuantity" > 0 AND ("stockMode" <> 'DIRECT' OR "stockItemId" IS NOT NULL));
