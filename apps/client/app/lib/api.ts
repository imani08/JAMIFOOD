export type ApiEnvelope<T> = { success: true; data: T } | { success: false; error?: { message?: string; code?:string } };
export class ApiError extends Error { constructor(message:string,readonly status:number,readonly code?:string){super(message);this.name='ApiError';} }

export async function clientApi<T>(path: string, options: { method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; body?: unknown; signal?: AbortSignal; idempotencyKey?: string } = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12_000);
  options.signal?.addEventListener('abort', () => controller.abort(), { once: true });
  try {
    const isForm=typeof FormData!=='undefined'&&options.body instanceof FormData;
    const method=options.method??'GET';
    const response = await fetch(`/api/v1/${path.replace(/^\/+/, '')}`, {
      method, credentials: 'include', signal: controller.signal,
      headers: { Accept: 'application/json', ...(!['GET','HEAD','OPTIONS'].includes(method)?{'X-Jami-Request':'1'}:{}), ...(options.body === undefined ? {} : { ...(isForm?{}:{'Content-Type': 'application/json'}) }), ...(options.idempotencyKey?{'Idempotency-Key':options.idempotencyKey}:{}) },
      ...(options.body === undefined ? {} : { body: isForm?options.body as FormData:JSON.stringify(options.body) }),
    });
    let result: ApiEnvelope<T>;
    try { result = await response.json() as ApiEnvelope<T>; }
    catch { throw new Error(`Réponse invalide du serveur (HTTP ${response.status}).`); }
    if (!response.ok || !result.success) {
      const message = !result.success ? result.error?.message : undefined;
      const code=!result.success?result.error?.code:undefined;
      if (response.status === 401) throw new ApiError(message || 'Votre session a expiré. Reconnectez-vous.',response.status,code);
      if (response.status === 403) throw new ApiError(message || 'Cette action n’est pas autorisée pour votre compte.',response.status,code);
      throw new ApiError(message || `La demande n’a pas abouti (HTTP ${response.status}).`,response.status,code);
    }
    return result.data;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('Le serveur met trop de temps à répondre. Réessayez.');
    if (error instanceof TypeError) throw new Error('Connexion au service indisponible. Vérifiez votre réseau.');
    throw error;
  } finally { window.clearTimeout(timeout); }
}

export function productImageUrl(value?: string | null) {
  if (!value || !/^\/api\/v1\/product-images\/[a-f0-9-]+\.(?:jpg|png|webp)$/i.test(value)) return null;
  return value;
}
