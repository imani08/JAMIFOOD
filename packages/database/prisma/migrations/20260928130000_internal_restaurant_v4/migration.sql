-- Internal restaurant operations: preserve all legacy portal, delivery, QR and kitchen data by archiving tables.
ALTER TABLE "ClientAccount" RENAME TO "LegacyClientAccount";
ALTER TABLE "ClientSession" RENAME TO "LegacyClientSession";
ALTER TABLE "ClientPortalEvent" RENAME TO "LegacyClientPortalEvent";
ALTER TABLE "ClientAuthToken" RENAME TO "LegacyClientAuthToken";
ALTER TYPE "CourierAvailability" RENAME TO "LegacyCourierAvailability";
ALTER TYPE "ClientAccountType" RENAME TO "LegacyClientAccountType";
ALTER TYPE "ClientVerificationStatus" RENAME TO "LegacyClientVerificationStatus";
ALTER TABLE "QRCodeHistory" RENAME TO "LegacyQRCodeHistory";
ALTER TABLE "QRCode" RENAME TO "LegacyQRCode";
ALTER TABLE "KitchenTicketItem" RENAME TO "LegacyKitchenTicketItem";
ALTER TABLE "KitchenTicket" RENAME TO "LegacyKitchenTicket";
ALTER TABLE "Delivery" RENAME TO "LegacyDelivery";
ALTER TABLE "CourierProfile" RENAME TO "LegacyCourierProfile";

-- The legacy portal/kitchen/delivery tables are retained for historical review only.
ALTER INDEX "ClientAccount_clientId_key" RENAME TO "LegacyClientAccount_clientId_key";
ALTER INDEX "ClientAccount_email_key" RENAME TO "LegacyClientAccount_email_key";
ALTER INDEX "ClientAccount_verificationStatus_createdAt_idx" RENAME TO "LegacyClientAccount_verificationStatus_createdAt_idx";
ALTER INDEX "ClientSession_tokenHash_key" RENAME TO "LegacyClientSession_tokenHash_key";
ALTER INDEX "ClientSession_accountId_expiresAt_idx" RENAME TO "LegacyClientSession_accountId_expiresAt_idx";
ALTER INDEX "ClientPortalEvent_accountId_createdAt_idx" RENAME TO "LegacyClientPortalEvent_accountId_createdAt_idx";
ALTER INDEX "ClientAuthToken_tokenHash_key" RENAME TO "LegacyClientAuthToken_tokenHash_key";
ALTER INDEX "ClientAuthToken_accountId_purpose_createdAt_idx" RENAME TO "LegacyClientAuthToken_accountId_purpose_createdAt_idx";
ALTER INDEX "ClientAuthToken_expiresAt_idx" RENAME TO "LegacyClientAuthToken_expiresAt_idx";
ALTER INDEX "QRCode_clientId_status_idx" RENAME TO "LegacyQRCode_clientId_status_idx";
ALTER INDEX "QRCode_tokenHash_key" RENAME TO "LegacyQRCode_tokenHash_key";
ALTER INDEX "QRCode_replacedById_key" RENAME TO "LegacyQRCode_replacedById_key";
ALTER INDEX "QRCode_one_active_per_client_idx" RENAME TO "LegacyQRCode_one_active_per_client_idx";
ALTER INDEX "KitchenTicket_orderId_key" RENAME TO "LegacyKitchenTicket_orderId_key";
ALTER INDEX "KitchenTicket_number_key" RENAME TO "LegacyKitchenTicket_number_key";
ALTER INDEX "Delivery_orderId_key" RENAME TO "LegacyDelivery_orderId_key";
ALTER INDEX "Delivery_courierId_status_idx" RENAME TO "LegacyDelivery_courierId_status_idx";

-- Preserve the original relation columns and constraints in inert legacy tables.
ALTER TABLE "LegacyDelivery" RENAME COLUMN "courierId" TO "legacyCourierId";

-- Retain former account identities only as inert archive records, never as auth users.
CREATE TABLE "LegacyClientAccountIdentity" AS
  SELECT "id", "clientId", "email", "passwordHash", "type"::text AS "type", "verificationStatus"::text AS "verificationStatus", "emailVerifiedAt", "verifiedAt", "verifiedById", "createdAt", "updatedAt"
  FROM "LegacyClientAccount";

-- Capture former delivery attributes before removing active delivery concepts.
ALTER TABLE "Order" ADD COLUMN "legacyDeliveryMode" TEXT;
UPDATE "Order" SET "legacyDeliveryMode" = "serviceMode"::text WHERE "serviceMode"::text = 'DELIVERY';
UPDATE "Order" SET "serviceMode" = 'TAKEAWAY' WHERE "serviceMode"::text = 'DELIVERY';

-- Current order statuses intentionally no longer expose kitchen or courier stages.
ALTER TABLE "OrderStatusHistory" ALTER COLUMN "fromStatus" TYPE TEXT USING "fromStatus"::text;
ALTER TABLE "OrderStatusHistory" ALTER COLUMN "toStatus" TYPE TEXT USING "toStatus"::text;
ALTER TABLE "Order" ALTER COLUMN "status" TYPE TEXT USING "status"::text;
UPDATE "Order" SET "status" = CASE "status"
  WHEN 'PREPARING' THEN 'READY'
  WHEN 'OUT_FOR_DELIVERY' THEN 'READY'
  WHEN 'DELIVERED' THEN 'SERVED'
  ELSE "status" END;
UPDATE "OrderStatusHistory" SET "fromStatus" = CASE "fromStatus"
  WHEN 'PREPARING' THEN 'READY' WHEN 'OUT_FOR_DELIVERY' THEN 'READY' WHEN 'DELIVERED' THEN 'SERVED' ELSE "fromStatus" END;
UPDATE "OrderStatusHistory" SET "toStatus" = CASE "toStatus"
  WHEN 'PREPARING' THEN 'READY' WHEN 'OUT_FOR_DELIVERY' THEN 'READY' WHEN 'DELIVERED' THEN 'SERVED' ELSE "toStatus" END;
ALTER TABLE "Order" ALTER COLUMN "status" DROP DEFAULT;
CREATE TYPE "OrderStatus_v4" AS ENUM ('RECEIVED', 'CONFIRMED', 'READY', 'SERVED', 'CANCELLED');
ALTER TABLE "Order" ALTER COLUMN "status" TYPE "OrderStatus_v4" USING "status"::"OrderStatus_v4";
ALTER TABLE "OrderStatusHistory" ALTER COLUMN "fromStatus" TYPE "OrderStatus_v4" USING "fromStatus"::"OrderStatus_v4";
ALTER TABLE "OrderStatusHistory" ALTER COLUMN "toStatus" TYPE "OrderStatus_v4" USING "toStatus"::"OrderStatus_v4";
DROP TYPE "OrderStatus";
ALTER TYPE "OrderStatus_v4" RENAME TO "OrderStatus";
ALTER TABLE "Order" ALTER COLUMN "status" SET DEFAULT 'RECEIVED';

-- DELIVERY is retained only in the legacyDeliveryMode text snapshot above.
ALTER TABLE "Order" ALTER COLUMN "serviceMode" TYPE TEXT USING "serviceMode"::text;
CREATE TYPE "ServiceMode_v4" AS ENUM ('DINE_IN', 'TAKEAWAY');
ALTER TABLE "Order" ALTER COLUMN "serviceMode" TYPE "ServiceMode_v4" USING "serviceMode"::"ServiceMode_v4";
DROP TYPE "ServiceMode";
ALTER TYPE "ServiceMode_v4" RENAME TO "ServiceMode";

CREATE TYPE "OrderSourceChannel" AS ENUM ('POS', 'WHATSAPP');
ALTER TABLE "Order" ADD COLUMN "sourceChannel" "OrderSourceChannel" NOT NULL DEFAULT 'POS';
ALTER TABLE "Order" ADD COLUMN "serviceCode" TEXT;
ALTER TABLE "Order" ADD COLUMN "createdById" UUID;
ALTER TABLE "Order" ADD COLUMN "cashierId" UUID;
ALTER TABLE "Order" ADD COLUMN "handoverAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD CONSTRAINT "Order_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Order_cashierId_idx" ON "Order"("cashierId");
UPDATE "Order" SET "sourceChannel" = 'WHATSAPP', "serviceCode" = mr."serviceCode"
FROM "MealReservation" reservation JOIN "MealRight" mr ON mr."id" = reservation."mealRightId"
WHERE reservation."orderId" = "Order"."id";

ALTER TABLE "Order" DROP COLUMN "ticketTokenHash";
ALTER TABLE "Order" DROP COLUMN "clientIdempotencyKey";
ALTER TABLE "Order" DROP COLUMN "clientRequestHash";

ALTER TABLE "Client" ADD COLUMN "archivedAt" TIMESTAMP(3);
CREATE INDEX "Client_firstName_lastName_idx" ON "Client"("firstName", "lastName");
CREATE INDEX "Order_clientId_businessDate_status_idx" ON "Order"("clientId", "businessDate", "status");
CREATE INDEX "Order_sourceChannel_businessDate_status_idx" ON "Order"("sourceChannel", "businessDate", "status");

-- Legacy delivery preference snapshots are retained for audits, then removed from active subscription tables.
ALTER TABLE "SubscriptionPlanVersion" ADD COLUMN "legacyDeliveryIncluded" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Subscription" ADD COLUMN "legacyDeliveryIncluded" BOOLEAN NOT NULL DEFAULT false;
UPDATE "SubscriptionPlanVersion" SET "legacyDeliveryIncluded" = "deliveryIncluded";
UPDATE "Subscription" SET "legacyDeliveryIncluded" = "deliveryIncluded";
ALTER TABLE "SubscriptionPlanVersion" DROP COLUMN "deliveryIncluded";
ALTER TABLE "Subscription" DROP COLUMN "deliveryIncluded";

-- Remove obsolete permissions/roles from active authorization; user and audit history remains.
INSERT INTO "Role" ("id", "code", "label") VALUES (gen_random_uuid(), 'RESPONSABLE_RESTAURANT', 'Responsable restaurant') ON CONFLICT ("code") DO NOTHING;
INSERT INTO "Role" ("id", "code", "label") VALUES (gen_random_uuid(), 'GESTIONNAIRE', 'Gestionnaire') ON CONFLICT ("code") DO NOTHING;
INSERT INTO "Role" ("id", "code", "label") VALUES (gen_random_uuid(), 'CAISSIER', 'Caissier') ON CONFLICT ("code") DO NOTHING;
INSERT INTO "Role" ("id", "code", "label") VALUES (gen_random_uuid(), 'ADMIN_TECHNIQUE', 'Admin technique') ON CONFLICT ("code") DO NOTHING;
DELETE FROM "RolePermission" rp USING "Role" r WHERE rp."roleId" = r."id" AND r."code" IN ('CUISINE', 'LIVREUR', 'CLIENT');
DELETE FROM "UserRole" ur USING "Role" r WHERE ur."roleId" = r."id" AND r."code" IN ('CUISINE', 'LIVREUR', 'CLIENT');
DELETE FROM "Role" WHERE "code" IN ('CUISINE', 'LIVREUR', 'CLIENT');
DELETE FROM "RolePermission" rp USING "Permission" p WHERE rp."permissionId" = p."id" AND (p."code" LIKE 'kitchen.%' OR p."code" LIKE 'delivery.%' OR p."code" IN ('meal.validate', 'clients.verify'));
DELETE FROM "Permission" WHERE "code" LIKE 'kitchen.%' OR "code" LIKE 'delivery.%' OR "code" IN ('meal.validate', 'clients.verify');
UPDATE "Role" SET "code" = 'RESPONSABLE_RESTAURANT', "label" = 'Responsable restaurant' WHERE "code" = 'DIRECTION' AND NOT EXISTS (SELECT 1 FROM "Role" WHERE "code" = 'RESPONSABLE_RESTAURANT');
-- If both legacy and current Responsable roles exist, retain the current role and migrate grants.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT target_role."id", old_grant."permissionId"
FROM "Role" old_role
JOIN "Role" target_role ON target_role."code" = 'RESPONSABLE_RESTAURANT'
JOIN "RolePermission" old_grant ON old_grant."roleId" = old_role."id"
WHERE old_role."code" = 'DIRECTION'
ON CONFLICT DO NOTHING;
INSERT INTO "UserRole" ("userId", "roleId")
SELECT old_grant."userId", target_role."id"
FROM "Role" old_role
JOIN "Role" target_role ON target_role."code" = 'RESPONSABLE_RESTAURANT'
JOIN "UserRole" old_grant ON old_grant."roleId" = old_role."id"
WHERE old_role."code" = 'DIRECTION'
ON CONFLICT DO NOTHING;
DELETE FROM "UserRole" ur USING "Role" r WHERE ur."roleId" = r."id" AND r."code" = 'DIRECTION';
DELETE FROM "RolePermission" rp USING "Role" r WHERE rp."roleId" = r."id" AND r."code" = 'DIRECTION';
DELETE FROM "Role" WHERE "code" = 'DIRECTION';
