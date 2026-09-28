import {navigation} from './navigation';
export const pagePermissions: Record<string,string> = Object.fromEntries(navigation.map(item=>[item.href,item.permission]));

export function hasPageAccess(path: string, permissions: readonly string[]): boolean {
  if (path === '/') return permissions.includes('reports.read');
  const basePath = `/${path.split('/')[1]}`;
  const required = pagePermissions[path] ?? pagePermissions[basePath];
  return Boolean(required && permissions.includes(required));
}
