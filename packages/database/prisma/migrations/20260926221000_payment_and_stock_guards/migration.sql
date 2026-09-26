-- Partial payments are serialized by the order/subscription row locks.
-- Retain one pending external confirmation, allow multiple confirmed tenders.
DROP INDEX IF EXISTS "one_live_order_payment";
DROP INDEX IF EXISTS "one_live_subscription_payment";
CREATE UNIQUE INDEX "one_pending_order_payment" ON "Payment" ("orderId") WHERE status = 'PENDING';
CREATE UNIQUE INDEX "one_pending_subscription_payment" ON "Payment" ("subscriptionId") WHERE status = 'PENDING';
-- NOT VALID preserves historical rows; all new writes are checked. Existing
-- anomalies must be reconciled explicitly, never deleted by a migration.
ALTER TABLE "StockLot" ADD CONSTRAINT "stock_lot_nonnegative" CHECK (quantity >= 0) NOT VALID;
ALTER TABLE "PurchaseLine" ADD CONSTRAINT "purchase_line_quantities" CHECK ("orderedQuantity" > 0 AND "receivedQuantity" >= 0 AND "receivedQuantity" <= "orderedQuantity") NOT VALID;
