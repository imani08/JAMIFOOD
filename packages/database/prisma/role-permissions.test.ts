import { describe, expect, it } from 'vitest';
import { rolePermissions } from './role-permissions';

describe('RBAC RESPONSABLE_RESTAURANT', () => {
  const responsable = new Set(rolePermissions.RESPONSABLE_RESTAURANT);

  it('couvre les opérations restaurant, la supervision et la configuration métier', () => {
    const required = [
      'auth.session', 'auth.password-change',
      'users.read', 'users.create', 'users.update', 'users.disable',
      'clients.read', 'clients.create', 'clients.update', 'clients.archive',
      'subscriptions.read', 'subscriptions.create', 'subscriptions.suspend', 'subscriptions.cancel',
      'orders.read', 'orders.create', 'orders.manage', 'orders.cancel',
      'sales.read', 'sales.create', 'cash.read', 'cash.open', 'cash.close', 'cash.validate',
      'cash.expense', 'cash.refund', 'cash.adjust', 'pricing.read', 'pricing.update',
      'menus.read', 'menus.write', 'menus.manage', 'menus.publish',
      'stock.read', 'stock.adjust', 'stock.inventory', 'reports.read', 'reports.export', 'audit.read',
      'payments.confirm', 'meal.correct', 'meal.exception',
    ];

    expect([...responsable].sort()).toEqual([...required].sort());
  });

  it('inclut les permissions du Gestionnaire sans accorder des fonctions techniques ou retirées', () => {
    expect(rolePermissions.GESTIONNAIRE.every(permission => responsable.has(permission))).toBe(true);
    expect(rolePermissions.RESPONSABLE_RESTAURANT.some(permission => /^(system|infrastructure|secrets|database|technical|kitchen|delivery|qr)\./.test(permission))).toBe(false);
    expect(responsable.has('clients.merge')).toBe(false);
  });
});
