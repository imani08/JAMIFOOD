export type OrderAttemptPayload = {
  menuVersionId: string;
  serviceMode: 'DINE_IN' | 'TAKEAWAY';
  currency: string;
  items: Array<{
    productId: string;
    quantity: number;
    variant?: string;
    optionSelections?: Array<{ groupId: string; optionIds: string[] }>;
  }>;
};

type AttemptRecord = { fingerprint: string; key: string };
export interface AttemptStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export const ORDER_ATTEMPT_STORAGE_KEY = 'jami-order-idempotency';

export function canonicalOrderPayload(payload: OrderAttemptPayload): OrderAttemptPayload {
  const items = payload.items.map(item => ({
    ...item,
    ...(item.optionSelections ? {
      optionSelections: item.optionSelections
        .map(selection => ({ groupId: selection.groupId, optionIds: [...selection.optionIds].sort() }))
        .sort((left, right) => left.groupId.localeCompare(right.groupId)),
    } : {}),
  }));
  items.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return { menuVersionId: payload.menuVersionId, serviceMode: payload.serviceMode, currency: payload.currency, items };
}

export function getOrderAttempt(storage: AttemptStorage, payload: OrderAttemptPayload, createKey: () => string) {
  const normalized = canonicalOrderPayload(payload);
  const fingerprint = JSON.stringify(normalized);
  let saved: AttemptRecord | null = null;
  try { saved = JSON.parse(storage.getItem(ORDER_ATTEMPT_STORAGE_KEY) ?? 'null') as AttemptRecord | null; } catch { saved = null; }
  if (saved?.fingerprint === fingerprint && saved.key) return { payload: normalized, key: saved.key };
  const key = createKey();
  storage.setItem(ORDER_ATTEMPT_STORAGE_KEY, JSON.stringify({ fingerprint, key } satisfies AttemptRecord));
  return { payload: normalized, key };
}

export function invalidateOrderAttempt(storage: AttemptStorage) {
  storage.removeItem(ORDER_ATTEMPT_STORAGE_KEY);
}
