import { Body, Controller, Headers, Injectable, Post, Req } from '@nestjs/common';
import { consumeMealSchema } from '@jami/validation';
import { localDate } from '@jami/shared';
import { PrismaService } from './prisma.service';
import { DomainError } from './http';
import { AuthRequest, Require } from './auth';
import { audit, mutate } from './transaction';
@Injectable()
export class MealsService {
  constructor(private readonly prisma: PrismaService) {}
  consume(input: unknown, key: string | undefined, actorId: string) {
    const body = consumeMealSchema.parse(input);
    return mutate(this.prisma, 'meal.consume', key, actorId, body, async tx => {
      await tx.$queryRaw`SELECT id FROM "MealRight" WHERE id = ${body.mealRightId}::uuid FOR UPDATE`;
      const right = await tx.mealRight.findUnique({ where: { id: body.mealRightId }, include: { subscription: { include: { client: true } } } });
      if (!right) throw new DomainError('NOT_FOUND', 'Droit au repas introuvable.', 404);
      if (right.status !== 'AVAILABLE') throw new DomainError(right.status === 'CONSUMED' ? 'MEAL_RIGHT_ALREADY_CONSUMED' : 'MEAL_RIGHT_UNAVAILABLE', right.status === 'CONSUMED' ? 'Ce droit a déjà été consommé.' : 'Ce droit est réservé ou annulé.');
      const sub = right.subscription, today = localDate();
      if (sub.client.status !== 'ACTIVE' || !['ACTIVE','SCHEDULED'].includes(sub.status)) throw new DomainError('SUBSCRIPTION_NOT_ACTIVE', 'L’abonnement n’est pas actif.');
      if (sub.startsOn.toISOString().slice(0,10) > today || sub.endsOn.toISOString().slice(0,10) < today || right.businessDate.toISOString().slice(0,10) !== today) throw new DomainError('PERIOD_EXPIRED', 'Le droit n’est pas valable aujourd’hui.');
      if (sub.balance.gt(0)) throw new DomainError('INSUFFICIENT_PAYMENT', 'Le paiement de l’abonnement est insuffisant.');
      if (right.serviceCode !== body.serviceCode && !(right.serviceCode === 'MAIN' && ['LUNCH','DINNER'].includes(body.serviceCode))) throw new DomainError('SERVICE_NOT_COVERED', 'Ce service n’est pas couvert.');
      const consumption = await tx.mealConsumption.create({ data: { mealRightId: right.id, servedById: actorId, idempotencyKey: key! } });
      await tx.mealRight.update({ where: { id: right.id }, data: { status: 'CONSUMED', consumedAt: consumption.consumedAt } });
      await audit(tx, actorId, 'MEAL_CONSUMED', 'MealRight', right.id, { serviceCode: body.serviceCode, consumptionId: consumption.id });
      return consumption;
    });
  }
}
@Controller('meals')
export class MealsController {
  constructor(private readonly meals: MealsService) {}
  @Require('meal.validate') @Post('consume') consume(@Body() body: unknown, @Headers('idempotency-key') key: string | undefined, @Req() req: AuthRequest) { return this.meals.consume(body, key, req.actor.id).then(data => ({ success: true, data })); }
}
