export const pagePermissions: Record<string, string> = {
  '/pos': 'sales.create',
  '/orders': 'orders.read',
  '/kitchen': 'kitchen.read',
  '/delivery': 'delivery.read',
  '/clients': 'clients.read',
  '/subscriptions': 'subscriptions.read',
  '/meals': 'meal.validate',
  '/products': 'pricing.read',
  '/menus': 'menus.read',
  '/stock': 'stock.read',
  '/cash': 'cash.read',
  '/expenses': 'cash.expense',
  '/reports': 'reports.read',
  '/audit': 'audit.read',
  '/users': 'users.read',
  '/settings': 'pricing.read',
};

export function hasPageAccess(path: string, permissions: readonly string[]): boolean {
  if (path === '/') return true;
  const basePath = `/${path.split('/')[1]}`;
  const required = pagePermissions[path] ?? pagePermissions[basePath];
  return Boolean(required && permissions.includes(required));
}
