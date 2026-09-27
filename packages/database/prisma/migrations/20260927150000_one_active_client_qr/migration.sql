-- Retire historical duplicates before enforcing the invariant.
WITH ranked AS (
  SELECT "id", "clientId", row_number() OVER (PARTITION BY "clientId" ORDER BY "issuedAt" DESC, "id" DESC) AS position
  FROM "QRCode"
  WHERE "status" = 'ACTIVE'::"QRCodeStatus"
), retired AS (
  UPDATE "QRCode" q
  SET "status" = 'REPLACED'::"QRCodeStatus", "revokedAt" = now()
  FROM ranked r
  WHERE q."id" = r."id" AND r.position > 1
  RETURNING q."id"
)
INSERT INTO "QRCodeHistory" ("id", "qrCodeId", "action", "metadata", "createdAt")
SELECT gen_random_uuid(), "id", 'REPLACED', '{"reason":"duplicate-active-cleanup"}'::jsonb, now()
FROM retired;

CREATE UNIQUE INDEX "QRCode_one_active_per_client_idx"
ON "QRCode" ("clientId")
WHERE "status" = 'ACTIVE'::"QRCodeStatus";
