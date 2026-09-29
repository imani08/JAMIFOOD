-- Keep the Responsable role limited to explicit restaurant operations.
INSERT INTO "Role" ("id", "code", "label")
VALUES (gen_random_uuid(), 'RESPONSABLE_RESTAURANT', 'Responsable restaurant')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "Permission" ("id", "code", "label") VALUES
  (gen_random_uuid(), 'auth.session', 'Accès à la session'),
  (gen_random_uuid(), 'auth.password-change', 'Changer son mot de passe'),
  (gen_random_uuid(), 'users.read', 'Consulter les utilisateurs'),
  (gen_random_uuid(), 'users.create', 'Créer des utilisateurs'),
  (gen_random_uuid(), 'users.update', 'Modifier les utilisateurs'),
  (gen_random_uuid(), 'users.disable', 'Activer ou désactiver les utilisateurs'),
  (gen_random_uuid(), 'clients.read', 'Consulter les abonnés'),
  (gen_random_uuid(), 'clients.create', 'Créer des abonnés'),
  (gen_random_uuid(), 'clients.update', 'Modifier des abonnés'),
  (gen_random_uuid(), 'clients.archive', 'Archiver les abonnés'),
  (gen_random_uuid(), 'subscriptions.read', 'Consulter les abonnements'),
  (gen_random_uuid(), 'subscriptions.create', 'Créer et renouveler les abonnements'),
  (gen_random_uuid(), 'subscriptions.suspend', 'Suspendre les abonnements'),
  (gen_random_uuid(), 'subscriptions.cancel', 'Annuler les abonnements'),
  (gen_random_uuid(), 'pricing.read', 'Consulter les prix'),
  (gen_random_uuid(), 'pricing.update', 'Gérer les tarifs et paramètres métier autorisés'),
  (gen_random_uuid(), 'cash.open', 'Gérer les ouvertures de caisse'),
  (gen_random_uuid(), 'cash.close', 'Clôturer les caisses'),
  (gen_random_uuid(), 'cash.read', 'Consulter les caisses'),
  (gen_random_uuid(), 'cash.expense', 'Enregistrer les dépenses'),
  (gen_random_uuid(), 'cash.validate', 'Valider les clôtures'),
  (gen_random_uuid(), 'cash.refund', 'Rembourser les paiements'),
  (gen_random_uuid(), 'cash.adjust', 'Ajuster la caisse'),
  (gen_random_uuid(), 'sales.create', 'Enregistrer les ventes'),
  (gen_random_uuid(), 'sales.read', 'Consulter les ventes'),
  (gen_random_uuid(), 'orders.create', 'Créer des commandes'),
  (gen_random_uuid(), 'orders.read', 'Consulter les commandes'),
  (gen_random_uuid(), 'orders.manage', 'Gérer les commandes WhatsApp'),
  (gen_random_uuid(), 'orders.cancel', 'Annuler les commandes'),
  (gen_random_uuid(), 'meal.correct', 'Corriger un droit repas via le flux contrôlé'),
  (gen_random_uuid(), 'meal.exception', 'Autoriser une exception de droit repas'),
  (gen_random_uuid(), 'payments.confirm', 'Confirmer les paiements'),
  (gen_random_uuid(), 'reports.read', 'Consulter les rapports'),
  (gen_random_uuid(), 'reports.export', 'Exporter les rapports'),
  (gen_random_uuid(), 'audit.read', 'Consulter le journal d’audit'),
  (gen_random_uuid(), 'stock.read', 'Consulter le stock'),
  (gen_random_uuid(), 'stock.adjust', 'Modifier le stock'),
  (gen_random_uuid(), 'stock.inventory', 'Réaliser les inventaires'),
  (gen_random_uuid(), 'menus.read', 'Consulter les menus'),
  (gen_random_uuid(), 'menus.write', 'Gérer les options et suppléments des menus'),
  (gen_random_uuid(), 'menus.manage', 'Gérer les menus'),
  (gen_random_uuid(), 'menus.publish', 'Publier les menus')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT target_role."id", granted_permission."id"
FROM "Role" target_role
CROSS JOIN "Permission" granted_permission
WHERE target_role."code" = 'RESPONSABLE_RESTAURANT'
  AND granted_permission."code" IN (
    'auth.session', 'auth.password-change',
    'users.read', 'users.create', 'users.update', 'users.disable',
    'clients.read', 'clients.create', 'clients.update', 'clients.archive',
    'subscriptions.read', 'subscriptions.create', 'subscriptions.suspend', 'subscriptions.cancel',
    'pricing.read', 'pricing.update',
    'cash.open', 'cash.close', 'cash.read', 'cash.expense', 'cash.validate', 'cash.refund', 'cash.adjust',
    'sales.create', 'sales.read',
    'orders.create', 'orders.read', 'orders.manage', 'orders.cancel',
    'meal.correct', 'meal.exception', 'payments.confirm',
    'reports.read', 'reports.export', 'audit.read',
    'stock.read', 'stock.adjust', 'stock.inventory',
    'menus.read', 'menus.write', 'menus.manage', 'menus.publish'
  )
ON CONFLICT DO NOTHING;

-- The Responsable's authorization set is exact; remove obsolete/unrelated grants only.
DELETE FROM "RolePermission" old_grant
USING "Role" target_role, "Permission" old_permission
WHERE old_grant."roleId" = target_role."id"
  AND old_grant."permissionId" = old_permission."id"
  AND target_role."code" = 'RESPONSABLE_RESTAURANT'
  AND old_permission."code" NOT IN (
    'auth.session', 'auth.password-change',
    'users.read', 'users.create', 'users.update', 'users.disable',
    'clients.read', 'clients.create', 'clients.update', 'clients.archive',
    'subscriptions.read', 'subscriptions.create', 'subscriptions.suspend', 'subscriptions.cancel',
    'pricing.read', 'pricing.update',
    'cash.open', 'cash.close', 'cash.read', 'cash.expense', 'cash.validate', 'cash.refund', 'cash.adjust',
    'sales.create', 'sales.read',
    'orders.create', 'orders.read', 'orders.manage', 'orders.cancel',
    'meal.correct', 'meal.exception', 'payments.confirm',
    'reports.read', 'reports.export', 'audit.read',
    'stock.read', 'stock.adjust', 'stock.inventory',
    'menus.read', 'menus.write', 'menus.manage', 'menus.publish'
  );
