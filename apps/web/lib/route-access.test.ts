import { describe, expect, it } from 'vitest';
import { navigation } from './navigation';
import { hasPageAccess } from './route-access';

describe('navigation and direct page access', () => {
  const responsablePermissions = [
    'reports.read', 'sales.create', 'orders.manage', 'clients.read',
    'subscriptions.read', 'pricing.read', 'menus.read', 'stock.read',
    'cash.read', 'cash.expense', 'sales.read', 'users.read', 'audit.read',
  ];

  it('shows only pages granted by permission and permits direct URLs for those pages', () => {
    const visible = navigation.filter(item => responsablePermissions.includes(item.permission));
    expect(visible).toHaveLength(navigation.length);
    for (const item of visible) expect(hasPageAccess(item.href, responsablePermissions)).toBe(true);
  });

  it('denies direct URLs without their page permission and unknown routes', () => {
    expect(hasPageAccess('/users', ['sales.create'])).toBe(false);
    expect(hasPageAccess('/cash', ['cash.expense'])).toBe(false);
    expect(hasPageAccess('/kitchen', responsablePermissions)).toBe(false);
    expect(hasPageAccess('/purchases', responsablePermissions)).toBe(false);
    expect(hasPageAccess('/suppliers', responsablePermissions)).toBe(false);
  });
});
