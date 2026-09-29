/** Explicit restaurant RBAC grants used by the demo seed and its permission tests. */
export const rolePermissions: Record<string, string[]> = {
  RESPONSABLE_RESTAURANT: [
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
    'menus.read', 'menus.write', 'menus.manage', 'menus.publish',
  ],
  GESTIONNAIRE: [
    'auth.session', 'auth.password-change',
    'clients.read', 'clients.create', 'clients.update', 'clients.archive',
    'subscriptions.read', 'subscriptions.create', 'subscriptions.suspend', 'subscriptions.cancel',
    'orders.manage', 'orders.cancel', 'sales.read',
    'cash.read', 'cash.open', 'cash.close', 'stock.read', 'reports.read', 'menus.read',
  ],
  CAISSIER: ['auth.session', 'auth.password-change', 'sales.create'],
  ADMIN_TECHNIQUE: ['auth.session', 'auth.password-change', 'users.read', 'users.create', 'users.update', 'users.disable'],
};
