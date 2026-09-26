export type ApiResult<T> = { success: boolean; data: T; meta?: { page: number; limit: number; total: number }; error?: { message: string; code: string } };
export async function api<T>(path: string, body?: unknown, key?: string): Promise<T> {
  const response = await fetch('/api/v1' + path, { method: body === undefined ? 'GET' : 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-Jami-Request': '1', ...(body === undefined ? {} : { 'Idempotency-Key': key ?? crypto.randomUUID() }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json() as ApiResult<T>;
  if (!response.ok || !result.success) throw new Error(result.error?.message ?? 'Une erreur est survenue. Réessayez.');
  return result.data;
}
export function money(value: string | number, currency = 'CDF') { return Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' ' + currency; }
export function date(value: string) { return new Date(value).toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa' }); }
export function downloadCSV(name: string, rows: (string | number)[][]) {
  const text = '\ufeff' + rows.map(row => row.map(v => '"' + String(v).replace(/^[=+@-]/, "'$&").replaceAll('"', '""') + '"').join(';')).join('\r\n');
  const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);
}
