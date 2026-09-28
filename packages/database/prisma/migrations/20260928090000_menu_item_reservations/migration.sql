-- Track orders that hold menu quantities separately from completed sales.
ALTER TABLE "MenuItem" ADD COLUMN "quantityReserved" INTEGER NOT NULL DEFAULT 0;

-- Existing orders in RECEIVED have not completed payment yet. Restore their
-- quantities from quantitySold and mark them as reservations instead.
WITH pending AS (
  SELECT (line."productSnapshot"->>'menuVersionId')::uuid AS "menuVersionId",
         line."productId",
         SUM(line."quantity")::integer AS quantity
  FROM "OrderItem" line
  JOIN "Order" ord ON ord.id = line."orderId"
  WHERE ord.status = 'RECEIVED'
    AND line."productSnapshot" ? 'menuVersionId'
  GROUP BY 1, 2
)
UPDATE "MenuItem" menu_item
SET "quantityReserved" = pending.quantity,
    "quantitySold" = GREATEST(0, menu_item."quantitySold" - pending.quantity)
FROM pending
WHERE menu_item."menuVersionId" = pending."menuVersionId"
  AND menu_item."productId" = pending."productId";
