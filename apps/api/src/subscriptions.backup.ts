import { Body, Controller, Get, Headers, Param, Post, Query, Req } from '@nestjs/common';
import { Prisma } from '@jami/database';
import { endDate, localDate, rightDates } from '@jami/shared';
import { confirmPaymentSchema, pageSchema, uuid } from '@jami/validation';
import { z } from 'zod';
import { AuthRequest, Require } from './auth';
import { PrismaService } from './prisma.service';
import { audit, lockCash, mutate } from './transaction';
import { DomainError } from './http';
import { finishPayment, settlement } from './orders';
const rulesSchema = z.object({ pendingValidation: z.literal(false), days: z.number().int().min(1).max(366) });
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly db: PrismaService) {}
  @Require('subscriptions.read') @Get('plans') async plans() { return { success: true, data: await this.db.subscriptionPlan.findMany({ where: { active: true }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } }) }; }
  @Require('subscriptions.read') @Get() async list(@Query() query: unknown) { const { page, limit } = pageSchema.parse(query); return { success: true, data: await this.db.subscription.findMany({ take: limit, skip: (page-1)*limit, orderBy: { createdAt: 'desc' }, include: { client: { select: { firstName: true, lastName: true } }, planVersion: { include: { plan: true } } } }) }; }
  @Require('subscriptions.create') @Post() create(@Body() input: unknown, @Headers('idempotency-key') key: string | undefined, @Req() req: AuthRequest) {
    const body = z.object({ clientId: uuid, planVersionId: uuid, startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict().parse(input);
    return mutate(this.db, 'subscription.create', key, req.actor.id, body, async tx => {
      await tx.$queryRaw`SELECT id FROM "Client" WHERE id = ${body.clientId}::uuid FOR UPDATE`;
      const client = await tx.client.findUnique({ where: { id: body.clientId } });
      if (!client || client.status !== 'ACTIVE') throw new DomainError('NOT_FOUND', 'Client actif introuvable.', 404);
      const version = await tx.subscriptionPlanVersion.findUniqueOrThrow({ where: { id: body.planVersionId } });
      const rules = rulesSchema.safeParse(version.quotaRules);
      if (version.status !== 'ACTIVE' || !rules.success || version.effectiveFrom > new Date() || (version.effectiveTo && version.effectiveTo <= new Date())) throw new DomainError('PLAN_NOT_VALIDATED', 'Les règles de cette formule doivent être validées.');
      const services = z.array(z.enum(['BREAKFAST','LUNCH','DINNER','MAIN'])).min(1).parse(version.services);
      const eligibleDays = z.array(z.number().int().min(0).max(6)).min(1).parse(version.eligibilityDays);
      const endsOn = endDate(body.startsOn, rules.data.days);
      if (body.startsOn < localDate()) throw new DomainError('START_IN_PAST', 'La date de début ne peut pas être passée.', 400);
      if (await tx.subscription.findFirst({ where: { clientId: body.clientId, status: { not: 'CANCELLED' }, startsOn: { lte: new Date(endsOn) }, endsOn: { gte: new Date(body.startsOn) } } })) throw new DomainError('SUBSCRIPTION_OVERLAP', 'Une période d’abonnement existe déjà sur ces dates.');
      const sub = await tx.subscription.create({ data: { clientId: body.clientId, planVersionId: version.id, startsOn: new Date(body.startsOn), endsOn: new Date(endsOn), amount: version.price, currency: version.currency, balance: version.price, serviceSnapshot: { services, eligibleDays, days: rules.data.days }, deliveryIncluded: version.deliveryIncluded, rights: { create: rightDates(body.startsOn, endsOn, eligibleDays).flatMap(date => services.map(serviceCode => ({ businessDate: new Date(date), serviceCode, quotaGroup: serviceCode }))) } } });
      await audit(tx, req.actor.id, 'SUBSCRIPTION_CREATED', 'Subscription', sub.id, { startsOn: body.startsOn, endsOn }); return sub;
    }).then(data=>({success:true,data}));
  }
  @Require('sales.create') @Post(':id/payments') pay(@Param('id') id: string, @Body() input: unknown, @Headers('idempotency-key') key: string | undefined, @Req() req: AuthRequest) {
    uuid.parse(id); const body = confirmPaymentSchema.parse(input);
    return mutate(this.db, 'subscription.pay', key, req.actor.id, { id, ...body }, async tx => {
      await lockCash(tx, body.cashSessionId, req.actor.id);
      await tx.$queryRaw`SELECT id FROM "Subscription" WHERE id = ${id}::uuid FOR UPDATE`;
      const sub = await tx.subscription.findUniqueOrThrow({ where: { id }, include: { payments: true } });
      if (sub.balance.lte(0) || sub.payments.some(p=>p.status==='PENDING') || sub.status !== 'PENDING_PAYMENT') throw new DomainError('SUBSCRIPTION_NOT_PAYABLE', 'Abonnement déjà réglé, en attente de confirmation ou non payable.');
      const rate = sub.currency !== body.receivedCurrency ? await tx.exchangeRate.findFirst({ where: { status: 'ACTIVE', baseCurrency: 'USD', quoteCurrency: 'CDF', effectiveFrom: { lte: new Date() } }, orderBy: { effectiveFrom: 'desc' } }) : null;
      const change = settlement(sub.balance, sub.currency, new Prisma.Decimal(body.receivedAmount), body.receivedCurrency, rate?.rate);
      if (!change.eq(0)) throw new DomainError('EXACT_AMOUNT_REQUIRED', 'Pour un abonnement, saisissez le montant exact du solde.');
      const p = await tx.payment.create({ data: { subscriptionId: id, cashSessionId: body.cashSessionId, method: body.method, operator: body.method, status: body.method==='CASH'?'CONFIRMED':'PENDING', referenceCurrency: sub.currency, amountDue: sub.balance, receivedAmount: body.receivedAmount, receivedCurrency: body.receivedCurrency, exchangeRateSnapshot: rate?.rate, idempotencyKey: key!, externalReference: body.externalReference, confirmedAt: body.method==='CASH'?new Date():null, confirmedById: body.method==='CASH'?req.actor.id:null, references: body.externalReference?{create:{operator:body.method,reference:body.externalReference}}:undefined } });
      if (p.status==='CONFIRMED') await finishPayment(tx,p.id,req.actor.id); else await audit(tx,req.actor.id,'PAYMENT_PENDING','Payment',p.id);
      return p;
    }).then(data=>({success:true,data}));
  }
}
