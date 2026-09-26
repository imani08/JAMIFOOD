/*
  LOT 2 - Paramétrage commercial, catalogue et historique.

  La contrainte unique ProductPrice(productId, categoryCode)
  a été vérifiée sur la base existante : aucun doublon.
*/

-- ============================================================
-- PRICE VERSION
-- ============================================================

ALTER TABLE "PriceVersion"
ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "createdById" UUID;


-- ============================================================
-- PRODUCT
-- ============================================================

ALTER TABLE "Product"
ADD COLUMN "available" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "baseComposition" TEXT,
ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "description" TEXT,
ADD COLUMN "optionsDescription" TEXT,
ADD COLUMN "saleUnit" TEXT NOT NULL DEFAULT 'portion',
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "variantsDescription" TEXT;


-- ============================================================
-- PRODUCT CATEGORY
-- ============================================================

ALTER TABLE "ProductCategory"
ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;


-- ============================================================
-- SETTINGS
-- ============================================================

ALTER TABLE "Setting"
ADD COLUMN "validatedById" UUID,
ADD COLUMN "validatedAt" TIMESTAMP(3);


-- ============================================================
-- SETTING HISTORY
-- ============================================================

CREATE TABLE "SettingHistory" (
    "id" UUID NOT NULL,
    "settingKey" TEXT NOT NULL,
    "oldValue" JSONB NOT NULL,
    "newValue" JSONB NOT NULL,
    "oldValidated" BOOLEAN NOT NULL,
    "newValidated" BOOLEAN NOT NULL,
    "changedById" UUID,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettingHistory_pkey" PRIMARY KEY ("id")
);


-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX "Product_categoryId_active_available_idx"
ON "Product"("categoryId", "active", "available");

CREATE INDEX "Product_name_idx"
ON "Product"("name");

CREATE INDEX "ProductPrice_categoryCode_idx"
ON "ProductPrice"("categoryCode");

CREATE UNIQUE INDEX "ProductPrice_productId_categoryCode_key"
ON "ProductPrice"("productId", "categoryCode");

CREATE INDEX "SettingHistory_settingKey_changedAt_idx"
ON "SettingHistory"("settingKey", "changedAt");


-- ============================================================
-- FOREIGN KEYS
-- ============================================================

ALTER TABLE "SettingHistory"
ADD CONSTRAINT "SettingHistory_settingKey_fkey"
FOREIGN KEY ("settingKey")
REFERENCES "Setting"("key")
ON DELETE RESTRICT
ON UPDATE CASCADE;