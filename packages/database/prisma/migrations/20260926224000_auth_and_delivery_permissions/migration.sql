INSERT INTO "Permission" ("id", "code", "label")
VALUES
  (gen_random_uuid(), 'auth.session', 'Session utilisateur'),
  (gen_random_uuid(), 'auth.password-change', 'Changer son mot de passe'),
  (gen_random_uuid(), 'delivery.assign', 'Affecter les livraisons')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
CROSS JOIN "Permission" p
WHERE r."code" <> 'CLIENT'
  AND p."code" IN ('auth.session', 'auth.password-change')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
CROSS JOIN "Permission" p
WHERE r."code" IN ('DIRECTION', 'RESPONSABLE_RESTAURANT')
  AND p."code" = 'delivery.assign'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
