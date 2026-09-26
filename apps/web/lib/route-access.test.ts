import { describe, expect, it } from 'vitest';
import { hasPageAccess, pagePermissions } from './route-access';

const roles: Record<string, string[]> = {
  DIRECTION: ['sales.create','orders.read','kitchen.read','delivery.read','clients.read','subscriptions.read','meal.validate','pricing.read','menus.read','stock.read','cash.read','cash.expense','reports.read','audit.read','users.read'],
  RESPONSABLE_RESTAURANT: ['sales.create','orders.read','kitchen.read','delivery.read','clients.read','subscriptions.read','meal.validate','pricing.read','menus.read','stock.read','cash.read','cash.expense','reports.read','audit.read'],
  CAISSIER: ['sales.create','orders.read','clients.read','subscriptions.read','meal.validate','pricing.read','cash.read'],
  CUISINE: ['kitchen.read','menus.read'],
  GESTIONNAIRE_STOCK: ['stock.read'],
  LIVREUR: ['delivery.read'],
  ADMIN_TECHNIQUE: ['users.read'],
};

describe('route access follows the application role permissions', () => {
  it('keeps the dashboard available without revealing report data', () => {
    expect(hasPageAccess('/', [])).toBe(true);
  });
  it('allows each role only on its assigned operational routes', () => {
    expect(hasPageAccess('/kitchen', roles.CUISINE)).toBe(true);
    expect(hasPageAccess('/reports', roles.CUISINE)).toBe(false);
    expect(hasPageAccess('/reports', roles.LIVREUR)).toBe(false);
    expect(hasPageAccess('/cash', roles.GESTIONNAIRE_STOCK)).toBe(false);
    expect(hasPageAccess('/orders', roles.CAISSIER)).toBe(true);
    expect(hasPageAccess('/orders', ['orders.read'])).toBe(true);
    expect(hasPageAccess('/orders', ['orders.cancel'])).toBe(false);
    expect(hasPageAccess('/users', roles.ADMIN_TECHNIQUE)).toBe(true);
    expect(hasPageAccess('/cash', roles.ADMIN_TECHNIQUE)).toBe(false);
  });
  it('checks every listed page against each seeded role permission', () => {
    for (const [role, permissions] of Object.entries(roles)) {
      for (const [path, permission] of Object.entries(pagePermissions)) {
        expect(hasPageAccess(path, permissions), `${role} ${path}`).toBe(permissions.includes(permission));
      }
    }
  });
  it('maps nested URLs to their protected page before page data mounts', () => {
    expect(hasPageAccess('/products/123', ['pricing.read'])).toBe(true);
    expect(hasPageAccess('/products/123', ['reports.read'])).toBe(false);
    expect(hasPageAccess('/unmapped-admin-page', ['reports.read'])).toBe(false);
  });
});
