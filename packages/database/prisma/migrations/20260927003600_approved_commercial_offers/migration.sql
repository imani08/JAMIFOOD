-- Approved JAMI FOOD public offers. Existing versions and historical orders are never rewritten.
INSERT INTO "ProductCategory" ("id", "code", "label", "active", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'REPAS', 'Repas complets', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'SUPPLEMENT', 'Suppléments', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "SubscriptionPlan" ("id", "code", "name", "active")
VALUES
  (gen_random_uuid(), 'PREMIUM', 'Premium intégral', true),
  (gen_random_uuid(), 'COMBINEE', 'Combinée', true),
  (gen_random_uuid(), 'REPAS', 'Repas', true),
  (gen_random_uuid(), 'BREAKFAST', 'Petit-déjeuner', true)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "SubscriptionPlanVersion" ("id", "planId", "version", "durationDays", "price", "currency", "services", "eligibilityDays", "quotaRules", "deliveryIncluded", "effectiveFrom", "status")
SELECT gen_random_uuid(), p."id", 1, 30, offer.price, 'USD'::"Currency", offer.services::jsonb, '[1,2,3,4,5,6]'::jsonb, offer.rules::jsonb, offer.delivery, TIMESTAMP '2026-01-01 00:00:00', 'ACTIVE'::"PriceStatus"
FROM (VALUES
  ('PREMIUM', 140.00, '["BREAKFAST","LUNCH","DINNER"]', '{"pendingValidation":false,"days":30,"serviceQuotas":{"BREAKFAST":1,"LUNCH":1,"DINNER":1}}', true),
  ('COMBINEE', 110.00, '["LUNCH","DINNER"]', '{"pendingValidation":false,"days":30,"serviceQuotas":{"LUNCH":1,"DINNER":1}}', false),
  ('REPAS', 60.00, '["MAIN"]', '{"pendingValidation":false,"days":30,"serviceQuotas":{"MAIN":1}}', false),
  ('BREAKFAST', 40.00, '["BREAKFAST"]', '{"pendingValidation":false,"days":30,"serviceQuotas":{"BREAKFAST":1}}', false)
) AS offer(code, price, services, rules, delivery)
JOIN "SubscriptionPlan" p ON p."code" = offer.code
WHERE NOT EXISTS (SELECT 1 FROM "SubscriptionPlanVersion" v WHERE v."planId" = p."id" AND v."version" = 1);

-- If a demo version predates these approved terms, preserve it and add a corrected version.
INSERT INTO "SubscriptionPlanVersion" ("id", "planId", "version", "durationDays", "price", "currency", "services", "eligibilityDays", "quotaRules", "deliveryIncluded", "effectiveFrom", "status")
SELECT gen_random_uuid(), p."id", 2, 30, offer.price, 'USD'::"Currency", offer.services::jsonb, '[1,2,3,4,5,6]'::jsonb, offer.rules::jsonb, offer.delivery, CURRENT_TIMESTAMP, 'ACTIVE'::"PriceStatus"
FROM (VALUES
  ('PREMIUM', 140.00, '["BREAKFAST","LUNCH","DINNER"]', '{"pendingValidation":false,"days":30,"serviceQuotas":{"BREAKFAST":1,"LUNCH":1,"DINNER":1}}', true),
  ('COMBINEE', 110.00, '["LUNCH","DINNER"]', '{"pendingValidation":false,"days":30,"serviceQuotas":{"LUNCH":1,"DINNER":1}}', false),
  ('REPAS', 60.00, '["MAIN"]', '{"pendingValidation":false,"days":30,"serviceQuotas":{"MAIN":1}}', false),
  ('BREAKFAST', 40.00, '["BREAKFAST"]', '{"pendingValidation":false,"days":30,"serviceQuotas":{"BREAKFAST":1}}', false)
) AS offer(code, price, services, rules, delivery)
JOIN "SubscriptionPlan" p ON p."code" = offer.code
JOIN "SubscriptionPlanVersion" old ON old."planId" = p."id" AND old."version" = 1
WHERE (old."quotaRules"->>'demo' = 'true' OR old."deliveryIncluded" IS DISTINCT FROM offer.delivery)
  AND NOT EXISTS (SELECT 1 FROM "SubscriptionPlanVersion" v WHERE v."planId" = p."id" AND v."version" = 2);

INSERT INTO "Product" ("id", "categoryId", "sku", "name", "description", "saleUnit", "baseComposition", "active", "available", "createdAt", "updatedAt")
SELECT gen_random_uuid(), c."id", offer.sku, offer.name, offer.description, 'portion', offer.composition, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES
  ('JAMI-REPAS-COMPLET', 'REPAS', 'Repas complet étudiant', 'Repas étudiant acheté à l’unité.', 'Accompagnement · Légumes · Portion de viande ou poisson · Fruit du jour'),
  ('JAMI-SUP-FOUFOU', 'SUPPLEMENT', 'Portion de foufou', NULL, NULL),
  ('JAMI-SUP-CHIKWANGUE', 'SUPPLEMENT', 'Portion de chikwangue', NULL, NULL),
  ('JAMI-SUP-RIZ', 'SUPPLEMENT', 'Portion de riz', NULL, NULL),
  ('JAMI-SUP-BANANES', 'SUPPLEMENT', 'Portion de bananes frites', NULL, NULL)
) AS offer(sku, category, name, description, composition)
JOIN "ProductCategory" c ON c."code" = offer.category
ON CONFLICT ("sku") DO NOTHING;

INSERT INTO "ProductPrice" ("id", "productId", "categoryCode")
SELECT gen_random_uuid(), p."id", category.code
FROM (VALUES ('JAMI-REPAS-COMPLET','ETUDIANT_HOME'), ('JAMI-REPAS-COMPLET','ETUDIANT_EXTERNE'), ('JAMI-SUP-FOUFOU','ETUDIANT_EXTERNE'), ('JAMI-SUP-CHIKWANGUE','ETUDIANT_EXTERNE'), ('JAMI-SUP-RIZ','ETUDIANT_EXTERNE'), ('JAMI-SUP-BANANES','ETUDIANT_EXTERNE')) AS category(sku, code)
JOIN "Product" p ON p."sku" = category.sku
ON CONFLICT ("productId", "categoryCode") DO NOTHING;

INSERT INTO "PriceVersion" ("id", "productPriceId", "version", "amount", "currency", "effectiveFrom", "status")
SELECT gen_random_uuid(), pp."id", COALESCE(MAX(history."version"), 0) + 1, offer.amount, 'CDF'::"Currency", CURRENT_TIMESTAMP, 'ACTIVE'::"PriceStatus"
FROM (VALUES
  ('JAMI-REPAS-COMPLET','ETUDIANT_HOME',8000.00), ('JAMI-REPAS-COMPLET','ETUDIANT_EXTERNE',8000.00),
  ('JAMI-SUP-FOUFOU','ETUDIANT_EXTERNE',1000.00), ('JAMI-SUP-CHIKWANGUE','ETUDIANT_EXTERNE',1000.00),
  ('JAMI-SUP-RIZ','ETUDIANT_EXTERNE',1500.00), ('JAMI-SUP-BANANES','ETUDIANT_EXTERNE',2000.00)
) AS offer(sku, category, amount)
JOIN "Product" p ON p."sku" = offer.sku
JOIN "ProductPrice" pp ON pp."productId" = p."id" AND pp."categoryCode" = offer.category
LEFT JOIN "PriceVersion" history ON history."productPriceId" = pp."id"
WHERE NOT EXISTS (SELECT 1 FROM "PriceVersion" v WHERE v."productPriceId" = pp."id" AND v."status" = 'ACTIVE' AND v."effectiveFrom" <= CURRENT_TIMESTAMP AND (v."effectiveTo" IS NULL OR v."effectiveTo" > CURRENT_TIMESTAMP))
GROUP BY pp."id", offer.amount;
