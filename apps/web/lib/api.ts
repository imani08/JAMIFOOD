export type ApiResult<T> = { success: boolean; data: T; meta?: { page: number; limit: number; total: number }; message?: string | string[]; error?: { message: string; code: string; fields?: {fieldErrors?: Record<string,string[]>} } };
async function readResponse<T>(response: Response): Promise<T> {
  let result: ApiResult<T>;
  try { result = await response.json() as ApiResult<T>; }
  catch { throw new Error(`Le serveur a renvoyé une réponse invalide (HTTP ${response.status}). Vérifiez la connexion à l’API.`); }
  if (!response.ok || !result.success) {
    const fields=Object.entries(result.error?.fields?.fieldErrors ?? {}).map(([key, messages])=>`${key} : ${messages.join(', ')}`).join(' ; ');
    throw new Error(fields || result.error?.message || (Array.isArray(result.message)?result.message.join(', '):result.message) || `Échec de la requête (HTTP ${response.status}).`);
  }
  return result.data;
}
export async function api<T>(path: string, body?: unknown, key?: string): Promise<T> {
  const response = await fetch('/api/v1' + path, { method: body === undefined ? 'GET' : 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-Jami-Request': '1', ...(body === undefined ? {} : { 'Idempotency-Key': key ?? crypto.randomUUID() }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return readResponse<T>(response);
}
export function money(value: string | number, currency = 'CDF') { return Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' ' + currency; }
export function date(value: string) { return new Date(value).toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa' }); }
export function downloadCSV(name: string, rows: (string | number)[][]) {
  const text = '\ufeff' + rows.map(row => row.map(v => '"' + String(v).replace(/^(?=[\s]*[=+@-]|[\t\r\n])/, "'").replaceAll('"', '""') + '"').join(';')).join('\r\n');
  const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);
}

export async function apiForm<T>(
  path: string,
  body: FormData,
): Promise<T> {
  const response = await fetch(
    '/api/v1' + path,
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        'X-Jami-Request': '1',
      },
      body,
    },
  );

  return readResponse<T>(response);
}

export async function apiDelete<T>(path: string, key = crypto.randomUUID()): Promise<T> {
  const response = await fetch('/api/v1' + path, { method: 'DELETE', credentials: 'include', headers: { 'X-Jami-Request': '1', 'Idempotency-Key': key } });
  return readResponse<T>(response);
}
