CREATE TYPE "ProductOptionGroupType" AS ENUM ('VARIANT', 'SUPPLEMENT');
CREATE TABLE "ProductOptionGroup" (
  "id" UUID NOT NULL,
  "productId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "type" "ProductOptionGroupType" NOT NULL DEFAULT 'VARIANT',
  "required" BOOLEAN NOT NULL DEFAULT false,
  "minSelections" INTEGER NOT NULL DEFAULT 0,
  "maxSelections" INTEGER NOT NULL DEFAULT 1,
  "position" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductOptionGroup_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductOptionGroup_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProductOptionGroup_selections_check" CHECK ("minSelections" >= 0 AND "maxSelections" >= "minSelections")
);
CREATE INDEX "ProductOptionGroup_productId_active_position_idx" ON "ProductOptionGroup"("productId", "active", "position");

CREATE TABLE "ProductOption" (
  "id" UUID NOT NULL,
  "groupId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "linkedProductId" UUID,
  "priceDelta" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "currency" "Currency" NOT NULL DEFAULT 'CDF',
  "position" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductOption_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductOption_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ProductOptionGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProductOption_linkedProductId_fkey" FOREIGN KEY ("linkedProductId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ProductOption_groupId_active_position_idx" ON "ProductOption"("groupId", "active", "position");
CREATE INDEX "ProductOption_linkedProductId_idx" ON "ProductOption"("linkedProductId");
