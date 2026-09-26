import { Body, Controller, Get, Headers, Injectable, Param, Post, Query, Req } from '@nestjs/common';
import { confirmPaymentSchema, createOrderSchema, pageSchema, uuid } from '@jami/validation';
import { Prisma } from '@jami/database';
import { localDate } from '@jami/shared';
import { z } from 'zod';
import { PrismaService } from './prisma.service';
import { DomainError } from './http';
import { AuthRequest, Require } from './auth';
import {
  subscriptionLifecycleStatus,
} from './subscription-status';
import { audit, lockCash, lockOrder, mutate, Tx } from './transaction';
const Decimal = Prisma.Decimal;
export function settlement(due: Prisma.Decimal, reference: string, received: Prisma.Decimal, paidCurrency: string, rate?: Prisma.Decimal) {
  if (received.lte(0)) throw new DomainError('INVALID_AMOUNT', 'Le montant reçu doit être positif.', 400);
  if (reference !== paidCurrency && !rate?.gt(0)) throw new DomainError('RATE_REQUIRED', 'Aucun taux approuvé n’est disponible.');
  const value = reference === paidCurrency ? received : reference === 'CDF' ? received.mul(rate!) : received.div(rate!);
  if (value.lt(due)) throw new DomainError('INSUFFICIENT_PAYMENT', 'Le montant reçu est insuffisant.');
  const change = value.sub(due);
  if (!change.eq(change.toDecimalPlaces(2))) throw new DomainError('ROUNDING_RULE_REQUIRED', 'Cette conversion nécessite une règle d’arrondi validée.');
  return change;
}

export async function finishPayment(tx: Tx, paymentId: string, actorId: string) {
  const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const entries = [{ cashSessionId: p.cashSessionId, paymentId: p.id, type: p.method === 'CASH' ? 'CASH_IN' : 'DIGITAL_IN', amount: p.receivedAmount, currency: p.receivedCurrency, sourceType: 'PAYMENT', sourceId: p.id }];
  if (p.changeAmount.gt(0)) entries.push({ cashSessionId: p.cashSessionId, paymentId: p.id, type: 'CASH_OUT', amount: p.changeAmount, currency: p.changeCurrency!, sourceType: 'PAYMENT', sourceId: p.id });
  await tx.cashMovement.createMany({ data: entries });
 if (p.orderId) {
  const order =
    await tx.order.findUniqueOrThrow(
      {
        where: {
          id: p.orderId,
        },

        include: {
          items: true,

          payments: {
            where: {
              status:
                'CONFIRMED',
            },
          },
        },
      },
    );

  if (
    ![
      'RECEIVED',
      'CONFIRMED',
    ].includes(order.status)
  ) {
    throw new DomainError(
      'ORDER_NOT_PAYABLE',
      'Cette commande ne peut plus être payée.',
      409,
    );
  }

  const paid =
    order.payments.reduce(
      (total, payment) =>
        total.add(
          payment.amountDue,
        ),
      new Decimal(0),
    );

  /*
   * Paiement partiel :
   * la commande reste RECEIVED.
   */
  if (
    paid.lt(
      order.totalAmount,
    )
  ) {
    await audit(
      tx,
      actorId,
      'ORDER_PARTIAL_PAYMENT',
      'Order',
      order.id,
      {
        paid:
          paid.toString(),

        remaining:
          order.totalAmount
            .sub(paid)
            .toString(),
      },
    );
  }

  /*
   * Paiement complet :
   * on confirme une seule fois
   * la commande.
   */
  if (
    paid.gte(
      order.totalAmount,
    ) &&
    order.status ===
      'RECEIVED'
  ) {
    await tx.order.update({
      where: {
        id:
          order.id,
      },

      data: {
        status:
          'CONFIRMED',

        statusHistory: {
          create: {
            fromStatus:
              'RECEIVED',

            toStatus:
              'CONFIRMED',

            actorId,
          },
        },

        kitchenTicket: {
          create: {
            number:
              'K-' +
              order.number,

            renderedSnapshot: {
              orderNumber:
                order.number,

              paymentStatus:
                'CONFIRMED',

              serviceMode:
                order.serviceMode,
            },

            items: {
              create:
                order.items.map(
                  (item) => ({
                    quantity:
                      item.quantity,

                    preparationSnapshot:
                      {
                        name: (
                          item.productSnapshot as {
                            name: string;
                          }
                        ).name,
                      },
                  }),
                ),
            },
          },
        },
      },
    });

    await audit(
      tx,
      actorId,
      'ORDER_CONFIRMED',
      'Order',
      order.id,
      {
        paymentId:
          p.id,
      },
    );

    await audit(
      tx,
      actorId,
      'KITCHEN_TICKET_ISSUED',
      'Order',
      order.id,
    );
  }
}
  if (p.subscriptionId) {
  const sub =
    await tx.subscription.findUniqueOrThrow({
      where: {
        id:
          p.subscriptionId,
      },
    });

  const paid =
    sub.paidAmount.add(
      p.amountDue,
    );

  const balance =
    sub.amount.sub(paid);

  const status =
    subscriptionLifecycleStatus(
      balance,
      sub.startsOn,
      sub.endsOn,
    );

  await tx.subscription.update({
    where: {
      id:
        sub.id,
    },

    data: {
      paidAmount:
        paid,

      balance,

      status,
    },
  });
}
  await audit(tx, actorId, 'PAYMENT_CONFIRMED', 'Payment', p.id, { method: p.method, receivedAmount: p.receivedAmount.toString(), receivedCurrency: p.receivedCurrency });
}
@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}
  create(input: unknown, key: string | undefined, actorId: string) {
    const data = createOrderSchema.parse(input);
    return mutate(this.prisma, 'orders.create', key, actorId, data, async tx => {
      if (!await tx.clientCategory.findFirst({ where: { code: data.categoryCode, active: true } })) throw new DomainError('CATEGORY_INVALID', 'Catégorie non autorisée.', 400);
      if (data.clientId) {
  const client =
    await tx.client.findUnique({
      where: {
        id: data.clientId,
      },

      include: {
        category: true,
      },
    });

  if (
    !client ||
    client.status !== 'ACTIVE'
  ) {
    throw new DomainError(
      'CLIENT_NOT_FOUND',
      'Client actif introuvable.',
      404,
    );
  }

  if (
    client.category.code !==
    data.categoryCode
  ) {
    throw new DomainError(
      'CATEGORY_MISMATCH',
      'La catégorie sélectionnée ne correspond pas au client.',
      400,
    );
  }
} else if (
  data.serviceMode ===
  'DELIVERY'
) {
  throw new DomainError(
    'CLIENT_REQUIRED',
    'Une livraison exige l’identification du client.',
    400,
  );
}
const products =
  await tx.product.findMany({
    where: {
      id: {
        in: data.items.map(
          (i) => i.productId,
        ),
      },
      active: true,
    },

    include: {
      category: true,

      prices: {
        where: {
          categoryCode:
            data.categoryCode,
        },

        include: {
          versions: {
            where: {
              currency:
                data.currency,

              status:
                'ACTIVE',

              effectiveFrom: {
                lte:
                  new Date(),
              },
            },

            orderBy: {
              effectiveFrom:
                'desc',
            },
          },
        },
      },
    },
  });
      const lines = data.items.map(item => {
        const p = products.find(p => p.id === item.productId);
        const price = p?.prices.flatMap(p => p.versions).find(v => !v.effectiveTo || v.effectiveTo > new Date());
        if (!p || !price) throw new DomainError('PRICE_UNAVAILABLE', 'Article ou tarif indisponible.', 400);
        return { productId: p.id, quantity: new Decimal(item.quantity), unitPrice: price.amount, lineTotal: price.amount.mul(item.quantity), productSnapshot: {
  name: p.name,

  productCategoryCode:
    p.category.code,

  productCategoryLabel:
    p.category.label,

  priceVersionId:
    price.id,

  clientCategoryCode:
    data.categoryCode,
}, };
      });
      const total = lines.reduce((n, i) => n.add(i.lineTotal), new Decimal(0));
      if (total.lte(0)) throw new DomainError('INVALID_AMOUNT', 'Le total doit être positif.', 400);
      const order = await tx.order.create({ data: { number: `CMD-${localDate().slice(0,4)}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, clientId: data.clientId, serviceMode: data.serviceMode, businessDate: new Date(localDate()), totalAmount: total, currency: data.currency, items: { create: lines }, statusHistory: { create: { toStatus: 'RECEIVED', actorId } } } });
      await audit(tx, actorId, 'ORDER_CREATED', 'Order', order.id, { total: total.toString(), number: order.number });
      return order;
    });
  }

    pay(
  orderId: string,
  input: unknown,
  key: string | undefined,
  actorId: string,
) {
  uuid.parse(orderId);

  const body =
    confirmPaymentSchema.parse(input);

  return mutate(
    this.prisma,
    'orders.pay',
    key,
    actorId,
    {
      orderId,
      ...body,
    },
    async (tx) => {
      await lockCash(
        tx,
        body.cashSessionId,
        actorId,
      );

      await lockOrder(
        tx,
        orderId,
      );

      const order =
        await tx.order.findUnique({
          where: {
            id: orderId,
          },

          include: {
            payments: true,
          },
        });

      if (
        !order ||
        !order.paymentRequired ||
        order.status !== 'RECEIVED'
      ) {
        throw new DomainError(
          'ORDER_NOT_PAYABLE',
          'Cette commande ne peut plus recevoir de paiement.',
          409,
        );
      }

      // On refuse un nouveau paiement
      // si un paiement externe attend
      // encore une confirmation.
      if (
        order.payments.some(
          (payment) =>
            payment.status ===
            'PENDING',
        )
      ) {
        throw new DomainError(
          'PAYMENT_PENDING',
          'Un paiement est déjà en attente de confirmation.',
          409,
        );
      }

      // Total déjà payé sur cette commande.
      const alreadyPaid =
        order.payments
          .filter(
            (payment) =>
              payment.status ===
              'CONFIRMED',
          )
          .reduce(
            (total, payment) =>
              total.add(
                payment.amountDue,
              ),
            new Decimal(0),
          );

      // Reste à payer.
      const remaining =
        order.totalAmount.sub(
          alreadyPaid,
        );

      if (remaining.lte(0)) {
        throw new DomainError(
          'ORDER_ALREADY_PAID',
          'Cette commande est déjà entièrement réglée.',
          409,
        );
      }

      // Chercher le taux seulement
      // si la devise reçue est différente
      // de la devise de la commande.
      const rate =
        body.receivedCurrency !==
        order.currency
          ? await tx.exchangeRate.findFirst(
              {
                where: {
                  status: 'ACTIVE',

                  baseCurrency:
                    'USD',

                  quoteCurrency:
                    'CDF',

                  effectiveFrom: {
                    lte:
                      new Date(),
                  },
                },

                orderBy: {
                  effectiveFrom:
                    'desc',
                },
              },
            )
          : null;

      // Convertir le montant reçu
      // dans la devise de référence
      // de la commande.
      const receivedValue =
        paymentValue(
          order.currency,
          new Decimal(
            body.receivedAmount,
          ),
          body.receivedCurrency,
          rate?.rate,
        );

      // Montant réellement affecté
      // à cette commande.
      const appliedAmount =
        receivedValue.gte(
          remaining,
        )
          ? remaining
          : receivedValue;

      // Surplus éventuel.
      const change =
        receivedValue.sub(
          appliedAmount,
        );

      // Pour le moment on interdit
      // de rendre de la monnaie dans
      // une autre devise.
      if (
        change.gt(0) &&
        body.receivedCurrency !==
          order.currency
      ) {
        throw new DomainError(
          'CROSS_CURRENCY_CHANGE_RULE_REQUIRED',
          'Le rendu de monnaie entre USD et CDF n’est pas encore paramétré. Utilisez un montant exact.',
          409,
        );
      }

      // Vérifier que la caisse possède
      // suffisamment d'argent pour
      // rendre la monnaie.
      if (change.gt(0)) {
        const session =
          await tx.cashSession.findUniqueOrThrow(
            {
              where: {
                id:
                  body.cashSessionId,
              },

              include: {
                movements: true,
              },
            },
          );

        const available =
          session.movements
            .filter(
              (movement) =>
                movement.currency ===
                order.currency,
            )
            .reduce(
              (
                total,
                movement,
              ) =>
                movement.type ===
                'CASH_IN'
                  ? total.add(
                      movement.amount,
                    )
                  : movement.type ===
                      'CASH_OUT'
                    ? total.sub(
                        movement.amount,
                      )
                    : total,

              order.currency ===
              'USD'
                ? session.openingUsd
                : session.openingCdf,
            )
            .add(
              body.receivedCurrency ===
                order.currency
                ? new Decimal(
                    body.receivedAmount,
                  )
                : 0,
            );

        if (
          available.lt(change)
        ) {
          throw new DomainError(
            'INSUFFICIENT_CHANGE',
            'Le fonds de caisse ne permet pas ce rendu de monnaie.',
            409,
          );
        }
      }

      const payment =
        await tx.payment.create({
          data: {
            orderId,

            cashSessionId:
              body.cashSessionId,

            method:
              body.method,

            status:
              body.method ===
              'CASH'
                ? 'CONFIRMED'
                : 'PENDING',

            referenceCurrency:
              order.currency,

            // IMPORTANT :
            // on ne met plus
            // order.totalAmount ici.
            // On met seulement la partie
            // réellement payée.
            amountDue:
              appliedAmount,

            receivedAmount:
              body.receivedAmount,

            receivedCurrency:
              body.receivedCurrency,

            exchangeRateSnapshot:
              rate?.rate,

            changeAmount:
              change,

            changeCurrency:
              change.gt(0)
                ? order.currency
                : null,

            externalReference:
              body.externalReference,

            operator:
              body.method,

            idempotencyKey:
              key!,

            confirmedAt:
              body.method ===
              'CASH'
                ? new Date()
                : null,

            confirmedById:
              body.method ===
              'CASH'
                ? actorId
                : null,

            references:
              body.externalReference
                ? {
                    create: {
                      operator:
                        body.method,

                      reference:
                        body.externalReference,
                    },
                  }
                : undefined,
          },
        });

      if (
        payment.status ===
        'CONFIRMED'
      ) {
        await finishPayment(
          tx,
          payment.id,
          actorId,
        );
      } else {
        await audit(
          tx,
          actorId,
          'PAYMENT_PENDING',
          'Payment',
          payment.id,
        );
      }

      const remainingAfter =
        remaining.sub(
          appliedAmount,
        );

      return {
        ...payment,

        remainingAmount:
          remainingAfter.gt(0)
            ? remainingAfter.toString()
            : '0',

        orderStatus:
          remainingAfter.lte(0)
            ? 'CONFIRMED'
            : 'RECEIVED',
      };
    },
  );
}
  confirmExternal(id: string, key: string | undefined, actorId: string) {
    uuid.parse(id);
    return mutate(this.prisma, 'payments.confirm', key, actorId, { id }, async tx => {
      const initial = await tx.payment.findUnique({ where: { id } });
      if (!initial) throw new DomainError('NOT_FOUND', 'Paiement introuvable.', 404);
      await tx.$queryRaw`SELECT id FROM "CashSession" WHERE id = ${initial.cashSessionId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${id}::uuid FOR UPDATE`;
      const p = await tx.payment.findUniqueOrThrow({ where: { id } });
      if (p.status === 'CONFIRMED') return p;
      if (p.status !== 'PENDING') throw new DomainError('PAYMENT_NOT_CONFIRMABLE', 'Paiement non confirmable.');
      const session = await tx.cashSession.findUniqueOrThrow({ where: { id: p.cashSessionId } });
      if (session.status !== 'OPEN') throw new DomainError('CASH_CLOSED', 'La session de caisse est clôturée.');
      if (p.subscriptionId) {
  await tx.$queryRaw`
    SELECT id
    FROM "Subscription"
    WHERE id = ${p.subscriptionId}::uuid
    FOR UPDATE
  `;
}
      await tx.payment.update({ where: { id }, data: { status: 'CONFIRMED', confirmedAt: new Date(), confirmedById: actorId } });
      await finishPayment(tx, id, actorId);
      return tx.payment.findUniqueOrThrow({ where: { id } });
    });
  }
  transition(id: string, input: unknown, key: string | undefined, actorId: string) {
    uuid.parse(id); const { status } = z.object({ status: z.enum(['PREPARING','READY','SERVED']) }).strict().parse(input);
    return mutate(this.prisma, 'orders.transition', key, actorId, { id, status }, async tx => {
      await lockOrder(tx, id);
      const order = await tx.order.findUnique({ where: { id }, include: { payments: true } });
      if (!order) throw new DomainError('NOT_FOUND', 'Commande introuvable.', 404);
      if (['SERVED','DELIVERED'].includes(order.status)) throw new DomainError('ORDER_ALREADY_SERVED', 'Cette commande a déjà été remise.');
      const previous = { PREPARING: 'CONFIRMED', READY: 'PREPARING', SERVED: 'READY' }[status];
      if (order.status !== previous || order.serviceMode === 'DELIVERY') throw new DomainError('INVALID_ORDER_TRANSITION', 'Cette étape n’est pas autorisée.');
      if (order.paymentRequired && !order.payments.some(p => p.status === 'CONFIRMED')) throw new DomainError('PAYMENT_NOT_CONFIRMED', 'Le paiement doit être confirmé.');
      await tx.order.update({ where: { id }, data: { status, statusHistory: { create: { fromStatus: order.status, toStatus: status, actorId } } } });
      await audit(tx, actorId, `ORDER_${status}`, 'Order', id);
      return { id, status };
    });
  }
}
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService, private readonly prisma: PrismaService) {}
  @Require('orders.create') @Post() create(@Body() body: unknown, @Headers('idempotency-key') key: string | undefined, @Req() req: AuthRequest) { return this.orders.create(body, key, req.actor.id).then(data => ({ success: true, data })); }
  @Require('sales.create') @Post(':id/payments') pay(@Param('id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: string | undefined, @Req() req: AuthRequest) { return this.orders.pay(id, body, key, req.actor.id).then(data => ({ success: true, data })); }
  @Require('payments.confirm') @Post('payments/:id/confirm') confirm(@Param('id') id: string, @Headers('idempotency-key') key: string | undefined, @Req() req: AuthRequest) { return this.orders.confirmExternal(id, key, req.actor.id).then(data => ({ success: true, data })); }
  @Require('orders.read') @Get() async list(@Query() query: unknown) {
    const { page, limit, q } = pageSchema.parse(query); const where = q ? { number: { contains: q, mode: 'insensitive' as const } } : {};
    return { success: true, data: await this.prisma.order.findMany({ where, take: limit, skip: (page-1)*limit, orderBy: { createdAt: 'desc' }, include: { items: true, payments: true } }), meta: { page, limit, total: await this.prisma.order.count({ where }) } };
  }
  @Require('sales.read') @Get(':id/receipt') async receipt(@Param('id') id: string) {
    uuid.parse(id); const order = await this.prisma.order.findUnique({ where: { id }, include: { items: true, payments: { where: { status: 'CONFIRMED' } } } });
    if (!order || !order.payments.length) throw new DomainError('PAYMENT_NOT_CONFIRMED', 'Le reçu sera disponible après confirmation du paiement.');
    return { success: true, data: order };
  }
}
@Controller('kitchen')
export class KitchenController {
  constructor(private readonly orders: OrdersService, private readonly prisma: PrismaService) {}
  @Require('kitchen.read') @Get() async list() { return { success: true, data: await this.prisma.order.findMany({ where: { status: { in: ['CONFIRMED','PREPARING','READY'] } }, take: 100, orderBy: { createdAt: 'asc' }, select: { id: true, number: true, status: true, serviceMode: true, createdAt: true, kitchenTicket: { include: { items: true } } } }) }; }
  @Require('kitchen.read') @Post(':id/status') transition(@Param('id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: string | undefined, @Req() req: AuthRequest) {
    const target = z.object({ status: z.enum(['PREPARING','READY','SERVED']) }).parse(body).status;
    const permission = { PREPARING: 'kitchen.prepare', READY: 'kitchen.ready', SERVED: 'kitchen.serve' }[target];
    if (!req.actor.permissions.includes(permission)) throw new DomainError('FORBIDDEN', 'Permission insuffisante.', 403);
    return this.orders.transition(id, body, key, req.actor.id).then(data => ({ success: true, data }));
  }
}
