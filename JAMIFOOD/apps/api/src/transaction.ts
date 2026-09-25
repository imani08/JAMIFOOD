import { createHash } from 'node:crypto';
import { Prisma } from '@jami/database';
import { PrismaService } from './prisma.service';
import { DomainError } from './http';
export type Tx = Prisma.TransactionClient;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value) ?? 'null';
}
export async function mutate(db: PrismaService, scope: string, key: string | undefined, actorId: string, input: unknown, work: (tx: Tx) => Promise<unknown>) {
  if (!key || key.length < 8 || key.length > 128) throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Une clé d’idempotence de 8 à 128 caractères est requise.', 400);
  const requestHash = createHash('sha256').update(canonical({ actorId, input })).digest('hex');
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scope + ':' + key}, 0))`;
    const cached = await tx.idempotencyRecord.findUnique({ where: { scope_key: { scope, key } } });
    if (cached) {
      if (cached.requestHash !== requestHash) throw new DomainError('IDEMPOTENCY_KEY_REUSED', 'Cette clé est associée à une autre opération.', 409);
      return cached.responseBody;
    }
    const data = JSON.parse(JSON.stringify(await work(tx))) as Prisma.InputJsonValue;
    await tx.idempotencyRecord.create({ data: { scope, key, requestHash, responseStatus: 200, responseBody: data, expiresAt: new Date(Date.now() + 365 * 86400000) } });
    return data;
  }, { timeout: 15000 });
}
export async function audit(tx: Tx, actorId: string, action: string, entityType: string, entityId: string, newValue?: Prisma.InputJsonValue) {
  await tx.auditLog.create({ data: { actorId, action, entityType, entityId, newValue } });
}
export async function lockOrder(tx: Tx, id: string) { await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${id}::uuid FOR UPDATE`; }
export async function lockCash(tx: Tx, id: string, actorId: string) {
  await tx.$queryRaw`SELECT id FROM "CashSession" WHERE id = ${id}::uuid FOR UPDATE`;
  const session = await tx.cashSession.findUnique({ where: { id } });
  if (!session || session.status !== 'OPEN' || session.cashierId !== actorId) throw new DomainError('CASH_SESSION_REQUIRED', 'Ouvrez votre session de caisse avant cette opération.');
  return session;
}
