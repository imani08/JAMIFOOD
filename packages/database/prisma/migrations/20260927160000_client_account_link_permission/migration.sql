INSERT INTO "Permission" ("id", "code", "label")
VALUES (gen_random_uuid(), 'clients.verify', 'Vérifier les comptes clients ULC')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
CROSS JOIN "Permission" p
WHERE r."code" IN ('DIRECTION', 'RESPONSABLE_RESTAURANT')
  AND p."code" = 'clients.verify'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
