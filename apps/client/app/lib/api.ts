export type ApiEnvelope<T> = { success: true; data: T } | { success: false; error?: { message?: string } };

export async function clientApi<T>(path: string, options: { method?: 'GET' | 'POST' | 'PATCH'; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12_000);
  options.signal?.addEventListener('abort', () => controller.abort(), { once: true });
  try {
    const response = await fetch(`/api/v1/${path.replace(/^\/+/, '')}`, {
      method: options.method ?? 'GET', credentials: 'include', signal: controller.signal,
      headers: { Accept: 'application/json', ...(options.body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Jami-Request': '1' }) },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    let result: ApiEnvelope<T>;
    try { result = await response.json() as ApiEnvelope<T>; }
    catch { throw new Error(`Réponse invalide du serveur (HTTP ${response.status}).`); }
    if (!response.ok || !result.success) {
      const message = !result.success ? result.error?.message : undefined;
      if (response.status === 401) throw new Error('Votre session a expiré. Reconnectez-vous.');
      if (response.status === 403) throw new Error('Cette action n’est pas autorisée pour votre compte.');
      throw new Error(message || `La demande n’a pas abouti (HTTP ${response.status}).`);
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
