import { Body, Controller, Headers, Injectable, Post } from '@nestjs/common';
import { consumeMealSchema } from '@jami/validation';
import { Prisma, MealRightStatus } from '@jami/database';
import { PrismaService } from './prisma.service';
import { DomainError } from './http';

@Injectable()
export class MealsService {
  constructor(private readonly prisma: PrismaService) {}
  async consume(input: unknown, idempotencyKey: string | undefined, actorId = '00000000-0000-0000-0000-000000000000') {
    if (!idempotencyKey) throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'La clé d’idempotence est obligatoire.', 400);
    const body = consumeMealSchema.parse(input); const requestHash = JSON.stringify(body);
    const existing = await this.prisma.idempotencyRecord.findUnique({ where: { scope_key: { scope: 'meal.consume', key: idempotencyKey } } });
    if (existing) { if (existing.requestHash !== requestHash) throw new DomainError('IDEMPOTENCY_KEY_REUSED', 'Cette clé est déjà associée à une autre requête.', 409); return existing.responseBody; }
    return this.prisma.$transaction(async (tx) => {
      const replay = await tx.idempotencyRecord.findUnique({ where: { scope_key: { scope: 'meal.consume', key: idempotencyKey } } });
      if (replay) return replay.responseBody;
      const rights = await tx.$queryRaw<Array<{ id: string; status: MealRightStatus; subscription_id: string; starts_on: Date; ends_on: Date; subscription_status: string }>>(Prisma.sql`SELECT mr.id, mr.status, mr."subscriptionId" AS subscription_id, s."startsOn" AS starts_on, s."endsOn" AS ends_on, s.status AS subscription_status FROM "MealRight" mr JOIN "Subscription" s ON s.id = mr."subscriptionId" WHERE mr.id = ${body.mealRightId} FOR UPDATE`);
      const right = rights[0];
      if (!right) throw new DomainError('NOT_FOUND', 'Droit au repas introuvable.', 404);
      if (right.status !== 'AVAILABLE') throw new DomainError(right.status === 'CONSUMED' ? 'MEAL_RIGHT_ALREADY_CONSUMED' : 'MEAL_RIGHT_UNAVAILABLE', right.status === 'CONSUMED' ? 'Ce droit au repas a déjà été consommé.' : 'Ce droit au repas n’est pas disponible.');
      if (right.subscription_status !== 'ACTIVE') throw new DomainError('SUBSCRIPTION_NOT_ACTIVE', 'L’abonnement n’est pas actif.');
      const consumption = await tx.mealConsumption.create({ data: { mealRightId: body.mealRightId, orderId: body.orderId, servedById: actorId, idempotencyKey } });
      await tx.mealRight.update({ where: { id: body.mealRightId }, data: { status: 'CONSUMED', consumedAt: consumption.consumedAt } });
      await tx.auditLog.create({ data: { actorId, action: 'MEAL_CONSUMED', entityType: 'MealRight', entityId: body.mealRightId, newValue: { consumptionId: consumption.id, orderId: body.orderId ?? null } } });
      const response = { consumptionId: consumption.id, mealRightId: body.mealRightId, status: 'CONSUMED' };
      await tx.idempotencyRecord.create({ data: { scope: 'meal.consume', key: idempotencyKey, requestHash, responseStatus: 201, responseBody: response, expiresAt: new Date(Date.now() + 86_400_000) } });
      return response;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
@Controller('meals')
export class MealsController {
  constructor(private readonly meals: MealsService) {}
  @Post('consume') async consume(@Body() body: unknown, @Headers('idempotency-key') key?: string) { return { success: true, data: await this.meals.consume(body, key) }; }
}
