-- CreateEnum
CREATE TYPE "MenuVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "menuVersionId" UUID;

-- CreateTable
CREATE TABLE "Menu" (
    "id" UUID NOT NULL,
    "businessDate" DATE NOT NULL,
    "serviceCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Menu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuVersion" (
    "id" UUID NOT NULL,
    "menuId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "MenuVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdById" UUID NOT NULL,
    "publishedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "MenuVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuItem" (
    "id" UUID NOT NULL,
    "menuVersionId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "quantityAvailable" INTEGER NOT NULL,
    "quantitySold" INTEGER NOT NULL DEFAULT 0,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "variants" JSONB,
    "productSnapshot" JSONB,
    "priceSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Menu_businessDate_serviceCode_idx" ON "Menu"("businessDate", "serviceCode");

-- CreateIndex
CREATE UNIQUE INDEX "Menu_businessDate_serviceCode_key" ON "Menu"("businessDate", "serviceCode");

-- CreateIndex
CREATE INDEX "MenuVersion_menuId_status_idx" ON "MenuVersion"("menuId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MenuVersion_menuId_version_key" ON "MenuVersion"("menuId", "version");

-- CreateIndex
CREATE INDEX "MenuItem_menuVersionId_available_idx" ON "MenuItem"("menuVersionId", "available");

-- CreateIndex
CREATE INDEX "MenuItem_productId_idx" ON "MenuItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "MenuItem_menuVersionId_productId_key" ON "MenuItem"("menuVersionId", "productId");

-- AddForeignKey
ALTER TABLE "MenuVersion" ADD CONSTRAINT "MenuVersion_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_menuVersionId_fkey" FOREIGN KEY ("menuVersionId") REFERENCES "MenuVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_menuVersionId_fkey" FOREIGN KEY ("menuVersionId") REFERENCES "MenuVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
