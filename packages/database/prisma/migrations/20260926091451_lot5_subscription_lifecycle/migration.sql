-- AlterTable
ALTER TABLE "MenuVersion" ADD COLUMN     "imageUrl" TEXT;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "renewedFromId" UUID;

-- AlterTable
ALTER TABLE "SubscriptionPlanVersion" ADD COLUMN     "durationDays" INTEGER NOT NULL DEFAULT 30;

-- CreateTable
CREATE TABLE "SubscriptionSuspension" (
    "id" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE,
    "reason" TEXT NOT NULL,
    "endDateExtended" BOOLEAN NOT NULL DEFAULT false,
    "createdById" UUID NOT NULL,
    "resumedAt" TIMESTAMP(3),
    "resumedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionSuspension_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubscriptionSuspension_subscriptionId_startsOn_idx" ON "SubscriptionSuspension"("subscriptionId", "startsOn");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_renewedFromId_fkey" FOREIGN KEY ("renewedFromId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionSuspension" ADD CONSTRAINT "SubscriptionSuspension_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
