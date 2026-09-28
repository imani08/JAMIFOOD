import { Body, Controller, Headers, Injectable, Post, Req } from '@nestjs/common';
import { consumeMealSchema } from '@jami/validation';
import { localDate } from '@jami/shared';
import { PrismaService } from './prisma.service';
import { DomainError } from './http';
import { AuthRequest, Require } from './auth';
import { mutate } from './transaction';
@Injectable()
export class MealsService {
  constructor(private readonly prisma: PrismaService) {}
  consume(input: unknown, key: string | undefined, actorId: string) {
    const body = consumeMealSchema.parse(input);
    return mutate(this.prisma, 'meal.consume', key, actorId, body, async tx => {
      await tx.$queryRaw`SELECT id FROM "MealRight" WHERE id = ${body.mealRightId}::uuid FOR UPDATE`;
      const right = await tx.mealRight.findUnique({ where: { id: body.mealRightId }, include: { subscription: { include: { client: true } }, reservation: { include: { order: { select: { id: true, number: true, status: true, serviceMode: true } } } } } });
      if (!right) throw new DomainError('NOT_FOUND', 'Droit au repas introuvable.', 404);
      if (!['AVAILABLE','RESERVED'].includes(right.status)) throw new DomainError(right.status === 'CONSUMED' ? 'MEAL_RIGHT_ALREADY_CONSUMED' : 'MEAL_RIGHT_UNAVAILABLE', right.status === 'CONSUMED' ? 'Ce droit a déjà été consommé.' : 'Ce droit est annulé.');
      const sub = right.subscription, today = localDate();
      if (sub.client.status !== 'ACTIVE' || sub.status !== 'ACTIVE') throw new DomainError('SUBSCRIPTION_NOT_ACTIVE', 'L’abonnement n’est pas actif.');
      if (sub.startsOn.toISOString().slice(0,10) > today || sub.endsOn.toISOString().slice(0,10) < today || right.businessDate.toISOString().slice(0,10) !== today) throw new DomainError('PERIOD_EXPIRED', 'Le droit n’est pas valable aujourd’hui.');
      if (sub.balance.gt(0)) throw new DomainError('INSUFFICIENT_PAYMENT', 'Le paiement de l’abonnement est insuffisant.');
      if (right.serviceCode !== body.serviceCode && !(right.serviceCode === 'MAIN' && ['LUNCH','DINNER'].includes(body.serviceCode))) throw new DomainError('SERVICE_NOT_COVERED', 'Ce service n’est pas couvert.');
      return { validated: true, rightId: right.id, status: right.status, order: right.reservation?.order ?? null, message: right.status === 'RESERVED' ? 'Droit réservé. La consommation sera enregistrée à la remise effective de la commande.' : 'Droit disponible. Associez-le à une commande; le scan ne consomme pas le repas.' };
    });
  }
}
@Controller('meals')
export class MealsController {
  constructor(private readonly meals: MealsService) {}
  @Require('meal.validate') @Post('consume') consume(@Body() body: unknown, @Headers('idempotency-key') key: string | undefined, @Req() req: AuthRequest) { return this.meals.consume(body, key, req.actor.id).then(data => ({ success: true, data })); }
}
