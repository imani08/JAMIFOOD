import { Body, Controller, Get, Headers, Injectable, Param, Post, Query, Req } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { confirmPaymentSchema, createOrderSchema, pageSchema, uuid } from '@jami/validation';
import { Prisma } from '@jami/database';
import { localDate } from '@jami/shared';
import { z } from 'zod';
import { PrismaService } from './prisma.service';
import { DomainError } from './http';
import { netPaymentReceived } from './refund-value';
import { move } from './stock';
import { AuthRequest, Require } from './auth';
import {
  subscriptionLifecycleStatus,
} from './subscription-status';
import { audit, lockCash, lockOrder, mutate, Tx } from './transaction';
import { PaymentTerminalService } from './payment-terminal/payment-terminal.service';
import type { TerminalPaymentStatus } from './payment-terminal/payment-terminal.types';
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
function paymentValue(
  referenceCurrency: string,
  receivedAmount: Prisma.Decimal,
  receivedCurrency: string,
  rate?: Prisma.Decimal,
) {
  if (receivedAmount.lte(0)) {
    throw new DomainError(
      'INVALID_AMOUNT',
      'Le montant reçu doit être positif.',
      400,
    );
  }

  if (
    referenceCurrency !==
      receivedCurrency &&
    !rate?.gt(0)
  ) {
    throw new DomainError(
      'RATE_REQUIRED',
      'Aucun taux USD/CDF approuvé n’est disponible.',
      409,
    );
  }

  const value =
    referenceCurrency ===
    receivedCurrency
      ? receivedAmount
      : referenceCurrency === 'CDF'
        ? receivedAmount.mul(rate!)
        : receivedAmount.div(rate!);

  if (
    !value.eq(
      value.toDecimalPlaces(2),
    )
  ) {
    throw new DomainError(
      'ROUNDING_RULE_REQUIRED',
      'Cette conversion nécessite une règle d’arrondi validée.',
      409,
    );
  }

  return value;
}

export async function finishPayment(tx: Tx, paymentId: string, actorId: string) {
  const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const entries = [{ cashSessionId: p.cashSessionId, paymentId: p.id, type: p.method === 'CASH' ? 'CASH_IN' : 'DIGITAL_IN', amount: p.receivedAmount, currency: p.receivedCurrency, sourceType: 'PAYMENT', sourceId: p.id }];
  if (p.changeAmount.gt(0)) entries.push({ cashSessionId: p.cashSessionId, paymentId: p.id, type: 'CASH_OUT', amount: p.changeAmount, currency: p.changeCurrency!, sourceType: 'PAYMENT', sourceId: p.id });
  await tx.cashMovement.createMany({ data: entries });
 if (p.orderId) {
  const order =
    await tx.order.findUniqueOrThrow({
      where: {
        id: p.orderId,
      },

      include: {
        items: true,

        payments: {
          where: {
            status: 'CONFIRMED',
          },
        },
      },
    });

  if (order.status !== 'RECEIVED') {
    throw new DomainError(
      'ORDER_NOT_PAYABLE',
      'Cette commande ne peut plus être payée.',
      409,
    );
  }

  // Total de tous les paiements
  // confirmés de cette commande.
  const paid =
    order.payments.reduce(
      (total, payment) =>
        total.add(
          payment.amountDue,
        ),
      new Decimal(0),
    );

  // Si ce n'est pas encore entièrement payé,
  // on garde la commande en RECEIVED.
  if (
    paid.lt(order.totalAmount)
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

  // Si le total est entièrement payé,
  // la commande devient CONFIRMED.
  if (
    paid.gte(order.totalAmount)
  ) {
    // Convert this order's reservation into a sale atomically. RECEIVED orders
    // reserve quantities; only the first successful final payment sells them.
    if (order.menuVersionId) {
      const menuLines = new Map<string, number>();
      for (const item of order.items) {
        const snapshot = item.productSnapshot as { menuVersionId?: string };
        if (snapshot.menuVersionId === order.menuVersionId && item.productId) {
          menuLines.set(item.productId, (menuLines.get(item.productId) ?? 0) + Number(item.quantity));
        }
      }
      for (const [productId, quantity] of menuLines) {
        const row = await tx.menuItem.findUnique({ where: { menuVersionId_productId: { menuVersionId: order.menuVersionId, productId } } });
        if (row) {
          const moved = await tx.menuItem.updateMany({
            where: { id: row.id, quantityReserved: { gte: quantity } },
            data: { quantityReserved: { decrement: quantity }, quantitySold: { increment: quantity } },
          });
          if (moved.count !== 1) throw new DomainError('MENU_RESERVATION_MISSING', 'La réservation du menu est absente; vérifiez la migration et les commandes en attente.', 409);
        }
      }
    }
    const direct = order.items.flatMap(item=>{
      const stock=z.object({stockMode:z.literal('DIRECT'),stockItemId:z.string().uuid(),stockQuantity:z.string()}).safeParse(item.productSnapshot);
      return stock.success ? [{...stock.data,quantity:item.quantity}] : [];
    });
    const linkedSupplements=order.items.flatMap(item=>{
      const snapshots=z.array(z.object({quantity:z.number(),linkedStock:z.object({stockMode:z.string(),stockItemId:z.string().uuid().nullable(),stockQuantity:z.string()}).optional()})).safeParse(item.supplementsSnapshot);
      return snapshots.success?snapshots.data.flatMap(supplement=>supplement.linkedStock?.stockMode==='DIRECT'&&supplement.linkedStock.stockItemId?[{stockItemId:supplement.linkedStock.stockItemId,stockQuantity:supplement.linkedStock.stockQuantity,quantity:item.quantity.mul(supplement.quantity)}]:[]):[];
    });
    const quantities=new Map<string,Prisma.Decimal>();
    for(const item of [...direct,...linkedSupplements])quantities.set(item.stockItemId,(quantities.get(item.stockItemId)??new Decimal(0)).add(item.quantity.mul(item.stockQuantity)));
    for(const [stockId,quantity] of [...quantities].sort(([a],[b])=>a.localeCompare(b)))await move(tx,stockId,quantity.negated(),'DIRECT_SALE',order.id,'Vente validée : '+order.number,actorId);
    await tx.order.update({
      where: {
        id: order.id,
      },

      data: {
        status: 'CONFIRMED',

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
        paymentId: p.id,
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
      if(data.menuVersionId) await tx.$queryRaw`SELECT id FROM "MenuVersion" WHERE id = ${data.menuVersionId}::uuid FOR UPDATE`;
      const menuVersion = data.menuVersionId ? await tx.menuVersion.findUnique({where:{id:data.menuVersionId},include:{menu:true,items:true}}) : null;
      if (data.menuVersionId && (!menuVersion || menuVersion.status !== 'PUBLISHED' || menuVersion.menu.businessDate.toISOString().slice(0,10) !== localDate())) throw new DomainError('MENU_UNAVAILABLE', 'Ce menu n’est plus publié pour aujourd’hui. Actualisez le POS.');
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
        if (!p || !p.available) throw new DomainError('PRICE_UNAVAILABLE', 'Article indisponible.', 400);
        if (menuVersion) {
          const menuItem = menuVersion.items.find(row => row.productId === p.id);
          if (!menuItem?.available || item.quantity > menuItem.quantityAvailable - menuItem.quantitySold - menuItem.quantityReserved) throw new DomainError('MENU_ITEM_UNAVAILABLE', 'Article épuisé ou absent de cette version du menu.');
          const snapshot = z.object({categories:z.record(z.object({amount:z.string(),currency:z.string(),priceVersionId:z.string()}))}).parse(menuItem.priceSnapshot);
          const fixed = snapshot.categories[data.categoryCode];
          if (!fixed || fixed.currency !== data.currency) throw new DomainError('PRICE_UNAVAILABLE', 'Tarif du menu indisponible pour cette catégorie et cette devise.');
          return {productId:p.id,quantity:new Decimal(item.quantity),unitPrice:new Decimal(fixed.amount),lineTotal:new Decimal(fixed.amount).mul(item.quantity),productSnapshot:{name:p.name,stockMode:p.stockMode,stockItemId:p.stockItemId,stockQuantity:p.stockQuantity.toString(),menuVersionId:menuVersion.id,product:menuItem.productSnapshot,variants:menuItem.variants,priceVersionId:fixed.priceVersionId,clientCategoryCode:data.categoryCode}};
        }
        if (!price) throw new DomainError('PRICE_UNAVAILABLE', 'Tarif indisponible.', 400);
        return { productId: p.id, quantity: new Decimal(item.quantity), unitPrice: price.amount, lineTotal: price.amount.mul(item.quantity), productSnapshot: {
  name: p.name,
  stockMode:p.stockMode,stockItemId:p.stockItemId,stockQuantity:p.stockQuantity.toString(),

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
      if (menuVersion) {
        const menuQuantities = new Map<string, { itemId: string; quantity: number; remaining: number }>();
        for (const item of data.items) {
          const row = menuVersion.items.find(value => value.productId === item.productId)!;
          const previous = menuQuantities.get(row.id);
          menuQuantities.set(row.id, { itemId: row.id, quantity: (previous?.quantity ?? 0) + item.quantity, remaining: row.quantityAvailable - row.quantitySold - row.quantityReserved });
        }
        for (const line of menuQuantities.values()) {
          if (line.quantity > line.remaining) throw new DomainError('MENU_ITEM_UNAVAILABLE', 'Quantité du menu insuffisante.');
          const updated = await tx.menuItem.updateMany({where:{id:line.itemId,available:true,quantityReserved: { lte: menuVersion.items.find(value => value.id === line.itemId)!.quantityAvailable - menuVersion.items.find(value => value.id === line.itemId)!.quantitySold - line.quantity }},data:{quantityReserved:{increment:line.quantity}}});
          if(updated.count!==1)throw new DomainError('MENU_ITEM_UNAVAILABLE','Quantité du menu insuffisante.');
        }
      }
      if (total.lte(0)) throw new DomainError('INVALID_AMOUNT', 'Le total doit être positif.', 400);
      const order = await tx.order.create({ data: { number: `CMD-${localDate().slice(0,4)}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, clientId: data.clientId, menuVersionId:data.menuVersionId, serviceMode: data.serviceMode, businessDate: new Date(localDate()), totalAmount: total, currency: data.currency, items: { create: lines }, statusHistory: { create: { toStatus: 'RECEIVED', actorId } } } });
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
        if (payment.method === 'CARD') {
          await audit(tx, actorId, 'TPE_PAYMENT_PENDING', 'Payment', payment.id, { paymentId: payment.id, orderId, amount: payment.amountDue.toString(), currency: payment.referenceCurrency, externalReference: payment.externalReference });
        }
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
      if (p.method === 'CARD') await audit(tx, actorId, 'TPE_PAYMENT_APPROVED', 'Payment', id, { paymentId: id, orderId: p.orderId, amount: p.amountDue.toString(), currency: p.referenceCurrency, externalReference: p.externalReference });
      await finishPayment(tx, id, actorId);
      return tx.payment.findUniqueOrThrow({ where: { id } });
    });
  }
  cancel(
  id: string,
  input: unknown,
  key: string | undefined,
  actorId: string,
) {
  uuid.parse(id);

  const body = z
    .object({
      reason: z
        .string()
        .trim()
        .min(5)
        .max(500),
    })
    .strict()
    .parse(input);

  return mutate(
    this.prisma,
    'orders.cancel',
    key,
    actorId,
    {
      id,
      ...body,
    },
    async (tx) => {
      await lockOrder(tx, id);

      const order =
        await tx.order.findUnique({
          where: { id },

          include: {
            items: true,
            payments: true,
          },
        });

      if (!order) {
        throw new DomainError(
          'NOT_FOUND',
          'Commande introuvable.',
          404,
        );
      }

      if (
        order.status ===
        'CANCELLED'
      ) {
        return {
          id: order.id,
          status: order.status,
        };
      }

      if (
        [
          'PREPARING',
          'READY',
          'SERVED',
          'OUT_FOR_DELIVERY',
          'DELIVERED',
        ].includes(order.status)
      ) {
        throw new DomainError(
          'ORDER_CANCEL_REVIEW_REQUIRED',
          'Cette commande est déjà avancée dans la préparation ou la livraison.',
          409,
        );
      }

      const hasConfirmedPayment =
        order.payments.some(
          (payment) =>
            payment.status ===
            'CONFIRMED',
        );

      // An unpaid cancellation releases menu quantities reserved at creation.
      if (!hasConfirmedPayment && order.menuVersionId) {
        for (const line of order.items) {
          const snapshot = line.productSnapshot as { menuVersionId?: string };
          if (snapshot.menuVersionId !== order.menuVersionId || !line.productId) continue;
          await tx.menuItem.updateMany({
            where: { menuVersionId: order.menuVersionId, productId: line.productId, quantityReserved: { gte: Number(line.quantity) } },
            data: { quantityReserved: { decrement: Number(line.quantity) } },
          });
        }
      }

      await tx.order.update({
        where: { id },

        data: {
          status: 'CANCELLED',

          statusHistory: {
            create: {
              fromStatus:
                order.status,

              toStatus:
                'CANCELLED',

              reason:
                body.reason,

              actorId,
            },
          },
        },
      });

      const reservation = await tx.mealReservation.findUnique({where:{orderId:id}});
      if(reservation) {
        await tx.$queryRaw`SELECT id FROM "MealRight" WHERE id = ${reservation.mealRightId}::uuid FOR UPDATE`;
        await tx.mealRight.updateMany({where:{id:reservation.mealRightId,status:'RESERVED'},data:{status:'AVAILABLE',reservedAt:null}});
        await tx.mealReservation.delete({where:{id:reservation.id}});
      }

      await audit(
        tx,
        actorId,
        'ORDER_CANCELLED',
        'Order',
        id,
        {
          reason:
            body.reason,

          refundRequired:
            hasConfirmedPayment,
        },
      );

      return {
        id,
        status:
          'CANCELLED',

        refundRequired:
          hasConfirmedPayment,
      };
    },
  );
}
refundPayment(
  paymentId: string,
  input: unknown,
  key: string | undefined,
  actorId: string,
) {
  uuid.parse(paymentId);

  const body = z
    .object({
      cashSessionId: uuid,

      amount: z
        .union([
          z.string().regex(
            /^\d{1,12}(\.\d{1,2})?$/,
          ),
          z.number().positive(),
        ])
        .transform(String),

      reason: z
        .string()
        .trim()
        .min(5)
        .max(500),
    })
    .strict()
    .parse(input);

  return mutate(
    this.prisma,
    'payments.refund',
    key,
    actorId,
    {
      paymentId,
      ...body,
    },
    async (tx) => {
      await lockCash(
        tx,
        body.cashSessionId,
        actorId,
      );

      await tx.$queryRaw`
        SELECT id
        FROM "Payment"
        WHERE id = ${paymentId}::uuid
        FOR UPDATE
      `;

      const payment =
        await tx.payment.findUnique({
          where: {
            id: paymentId,
          },

          include: {
            refunds: true,
          },
        });

      if (!payment) {
        throw new DomainError(
          'NOT_FOUND',
          'Paiement introuvable.',
          404,
        );
      }

      if (
        payment.status !==
          'CONFIRMED' &&
        payment.status !==
          'REFUNDED'
      ) {
        throw new DomainError(
          'PAYMENT_NOT_REFUNDABLE',
          'Ce paiement ne peut pas être remboursé.',
          409,
        );
      }

      if (
        payment.method !== 'CASH'
      ) {
        throw new DomainError(
          'CASH_REFUND_ONLY',
          'Seuls les paiements en espèces sont remboursables dans cette première version.',
          409,
        );
      }

      const alreadyRefunded =
        payment.refunds.reduce(
          (total, refund) =>
            total.add(
              refund.amount,
            ),
          new Decimal(0),
        );

      const netReceived = netPaymentReceived(payment);

const refundable =
  netReceived.sub(
    alreadyRefunded,
  );

      const amount =
        new Decimal(body.amount);

      if (
        amount.lte(0) ||
        amount.gt(refundable)
      ) {
        throw new DomainError(
          'INVALID_REFUND_AMOUNT',
          `Montant remboursable restant : ${refundable.toString()} ${payment.receivedCurrency}.`,
          409,
        );
      }

      const session =
        await tx.cashSession.findUniqueOrThrow({
          where: {
            id: body.cashSessionId,
          },

          include: {
            movements: true,
          },
        });

      const opening =
        payment.receivedCurrency ===
        'USD'
          ? session.openingUsd
          : session.openingCdf;

      const available =
        session.movements
          .filter(
            (movement) =>
              movement.currency ===
              payment.receivedCurrency,
          )
          .reduce(
            (total, movement) =>
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
            opening,
          );

      if (available.lt(amount)) {
        throw new DomainError(
          'INSUFFICIENT_CASH',
          'La caisse ne contient pas assez d’espèces pour effectuer ce remboursement.',
          409,
        );
      }

      const refund =
        await tx.refund.create({
          data: {
            originalPaymentId:
              payment.id,

            cashSessionId:
              body.cashSessionId,

            amount,

            currency:
              payment.receivedCurrency,

            reason:
              body.reason,

            createdById:
              actorId,
          },
        });

      await tx.cashMovement.create({
        data: {
          cashSessionId:
            body.cashSessionId,

          type: 'CASH_OUT',

          amount,

          currency:
            payment.receivedCurrency,

          sourceType:
            'REFUND',

          sourceId:
            refund.id,
        },
      });

      const totalRefunded =
        alreadyRefunded.add(
          amount,
        );

      if (
        totalRefunded.gte(
          netReceived,
        )
      ) {
        await tx.payment.update({
          where: {
            id:
              payment.id,
          },

          data: {
            status:
              'REFUNDED',
          },
        });
      }

      await audit(
        tx,
        actorId,
        'PAYMENT_REFUNDED',
        'Refund',
        refund.id,
        {
          paymentId:
            payment.id,

          amount:
            amount.toString(),

          currency:
            payment.receivedCurrency,

          reason:
            body.reason,
        },
      );

      return {
        id: refund.id,

        paymentId:
          payment.id,

        amount:
          amount.toString(),

        currency:
          payment.receivedCurrency,

        remainingRefundable:
          netReceived
            .sub(totalRefunded)
            .toString(),
      };
    },
  );
}
  transition(
  id: string,
  input: unknown,
  key: string | undefined,
  actorId: string,
) {
  uuid.parse(id);

  const { status } = z
    .object({
      status: z.enum([
        'PREPARING',
        'READY',
        'SERVED',
        'OUT_FOR_DELIVERY',
        'DELIVERED',
      ]),
    })
    .strict()
    .parse(input);

  return mutate(
    this.prisma,
    'orders.transition',
    key,
    actorId,
    { id, status },
    async (tx) => {
      await lockOrder(tx, id);

      const order =
        await tx.order.findUnique({
          where: { id },
          include: {
            payments: true,
          },
        });

      if (!order) {
        throw new DomainError(
          'NOT_FOUND',
          'Commande introuvable.',
          404,
        );
      }

      if (
        ['SERVED', 'DELIVERED'].includes(
          order.status,
        )
      ) {
        throw new DomainError(
          'ORDER_ALREADY_SERVED',
          'Cette commande a déjà été remise.',
          409,
        );
      }

      const allowed =
        (status === 'PREPARING' &&
          order.status === 'CONFIRMED') ||

        (status === 'READY' &&
          order.status === 'PREPARING') ||

        (status === 'SERVED' &&
          order.status === 'READY' &&
          order.serviceMode !== 'DELIVERY') ||

        (status === 'OUT_FOR_DELIVERY' &&
          order.status === 'READY' &&
          order.serviceMode === 'DELIVERY') ||

        (status === 'DELIVERED' &&
          order.status ===
            'OUT_FOR_DELIVERY' &&
          order.serviceMode === 'DELIVERY');

      if (!allowed) {
        throw new DomainError(
          'INVALID_ORDER_TRANSITION',
          'Cette transition de commande n’est pas autorisée.',
          409,
        );
      }
      if(status === 'OUT_FOR_DELIVERY') {
        const client = order.clientId ? await tx.client.findUnique({where:{id:order.clientId}}) : null;
        const assigned = await tx.delivery.findUnique({where:{orderId:id}});
        if (assigned && assigned.courierId !== actorId) throw new DomainError('FORBIDDEN','Cette livraison est affectée à un autre livreur.',403);
        if (assigned) await tx.delivery.update({where:{id:assigned.id},data:{status:'OUT_FOR_DELIVERY'}});
        else await tx.delivery.create({data:{orderId:id,courierId:actorId,status:'OUT_FOR_DELIVERY',assignedAt:new Date(),addressSnapshot:{residency:client?.residency ?? '',phone:client?.phone ?? ''}}});
      }
      if(status === 'DELIVERED') {
        const delivery = await tx.delivery.findUnique({where:{orderId:id}});
        if(!delivery || delivery.courierId !== actorId) throw new DomainError('FORBIDDEN','Cette livraison est affectée à un autre livreur.',403);
        await tx.delivery.update({where:{orderId:id},data:{status:'DELIVERED',deliveredAt:new Date()}});
      }
      if(status === 'DELIVERED' || status === 'SERVED') {
        const reservation = await tx.mealReservation.findUnique({where:{orderId:id}});
        if(reservation) {
          await tx.$queryRaw`SELECT id FROM "MealRight" WHERE id = ${reservation.mealRightId}::uuid FOR UPDATE`;
          const right=await tx.mealRight.findUniqueOrThrow({where:{id:reservation.mealRightId}});
          if(right.status !== 'RESERVED')throw new DomainError('MEAL_RIGHT_UNAVAILABLE','Le droit réservé ne peut plus être consommé.');
          const consumption=await tx.mealConsumption.create({data:{mealRightId:right.id,orderId:id,servedById:actorId,idempotencyKey:key!}});
          await tx.mealRight.update({where:{id:right.id},data:{status:'CONSUMED',consumedAt:consumption.consumedAt}});
          await audit(tx,actorId,'MEAL_CONSUMED','MealRight',right.id,{orderId:id,consumptionId:consumption.id});
        }
      }

      // Subscription-covered orders are sold at physical handover.
      if (!order.paymentRequired && order.menuVersionId && (status === 'DELIVERED' || status === 'SERVED')) {
        const lines = await tx.orderItem.findMany({ where: { orderId: id } });
        const totals = new Map<string, number>();
        for (const line of lines) {
          const snapshot = line.productSnapshot as { menuVersionId?: string };
          if (snapshot.menuVersionId === order.menuVersionId && line.productId) totals.set(line.productId, (totals.get(line.productId) ?? 0) + Number(line.quantity));
        }
        for (const [productId, quantity] of totals) {
          const changed = await tx.menuItem.updateMany({
            where: { menuVersionId: order.menuVersionId, productId, quantityReserved: { gte: quantity } },
            data: { quantityReserved: { decrement: quantity }, quantitySold: { increment: quantity } },
          });
          if (changed.count !== 1) throw new DomainError('MENU_RESERVATION_MISSING', 'La réservation du menu est absente; vérifiez la migration.', 409);
        }
      }

      if (
        order.paymentRequired &&
        !order.payments.some(
          (p) =>
            p.status === 'CONFIRMED',
        )
      ) {
        throw new DomainError(
          'PAYMENT_NOT_CONFIRMED',
          'Le paiement doit être confirmé.',
          409,
        );
      }

      await tx.order.update({
        where: { id },

        data: {
          status,

          statusHistory: {
            create: {
              fromStatus:
                order.status,

              toStatus:
                status,

              actorId,
            },
          },
        },
      });

      await audit(
        tx,
        actorId,
        `ORDER_${status}`,
        'Order',
        id,
      );

      return {
        id,
        status,
      };
    },
  );
}
}
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService, private readonly prisma: PrismaService, private readonly terminal: PaymentTerminalService) {}
  @Require('orders.create') @Post() create(@Body() body: unknown, @Headers('idempotency-key') key: string | undefined, @Req() req: AuthRequest) { return this.orders.create(body, key, req.actor.id).then(data => ({ success: true, data })); }
  @Require('cash.refund')
@Post('payments/:id/refund')
refundPayment(
  @Param('id') id: string,
  @Body() body: unknown,
  @Headers('idempotency-key')
  key: string | undefined,
  @Req() req: AuthRequest,
) {
  return this.orders
    .refundPayment(
      id,
      body,
      key,
      req.actor.id,
    )
    .then((data) => ({
      success: true,
      data,
    }));
}
@Require('orders.cancel')
@Post(':id/cancel')
cancel(
  @Param('id') id: string,
  @Body() body: unknown,
  @Headers('idempotency-key')
  key: string | undefined,
  @Req() req: AuthRequest,
) {
  return this.orders
    .cancel(
      id,
      body,
      key,
      req.actor.id,
    )
    .then((data) => ({
      success: true,
      data,
    }));
}
  @Require('sales.create') @Post(':id/payments') pay(@Param('id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: string | undefined, @Req() req: AuthRequest) { return this.orders.pay(id, body, key, req.actor.id).then(data => ({ success: true, data })); }
  @Require('sales.create') @Get('terminal/config') terminalConfig() { return { success: true, data: { mode: this.terminal.mode, provider: this.terminal.providerName, terminalId: this.terminal.terminalId || null, simulated: this.terminal.isMockEnabled } }; }
  @Require('sales.create') @Post(':id/terminal-payments') async startTerminalPayment(@Param('id') id: string, @Body() input: unknown, @Headers('idempotency-key') key: string | undefined, @Req() req: AuthRequest) {
    uuid.parse(id);
    if (!key || key.length < 8 || key.length > 128) throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Une clé d’idempotence valide est requise.', 400);
    const body = z.object({ cashSessionId: uuid, externalReference: z.string().trim().min(1).max(120).optional() }).strict().parse(input);
    this.terminal.assertReady();
    if (this.terminal.mode === 'MANUAL' && !body.externalReference) throw new DomainError('TERMINAL_REFERENCE_REQUIRED', 'Saisissez uniquement la référence non sensible fournie par le TPE.', 400);
    if (this.terminal.mode !== 'MANUAL' && body.externalReference) throw new DomainError('TERMINAL_REFERENCE_NOT_ALLOWED', 'La référence est fournie par le simulateur ou le terminal configuré.', 400);
    const order = await this.prisma.order.findUnique({ where: { id }, include: { payments: true } });
    if (!order || order.status !== 'RECEIVED' || !order.paymentRequired) throw new DomainError('ORDER_NOT_PAYABLE', 'Cette commande ne peut plus recevoir de paiement.', 409);
    const remaining = order.totalAmount.sub(order.payments.filter(p => p.status === 'CONFIRMED').reduce((sum, p) => sum.add(p.amountDue), new Prisma.Decimal(0)));
    if (remaining.lte(0)) throw new DomainError('ORDER_ALREADY_PAID', 'Cette commande est déjà réglée.', 409);
    const reference = this.terminal.mode === 'MOCK' ? `MOCK-${createHash('sha256').update(`${id}:${key}`).digest('hex').slice(0, 32)}` : body.externalReference;
    const payment = await this.orders.pay(id, { cashSessionId: body.cashSessionId, method: 'CARD', receivedAmount: remaining.toString(), receivedCurrency: order.currency, externalReference: reference }, key, req.actor.id) as { id: string; orderId: string | null; amountDue: { toString(): string }; referenceCurrency: 'CDF' | 'USD'; status: string; [key: string]: unknown };
    const terminal = await this.terminal.startPayment({ paymentId: payment.id, orderId: id, amount: payment.amountDue.toString(), currency: payment.referenceCurrency, terminalId: this.terminal.terminalId, externalReference: reference });
    await this.prisma.auditLog.create({ data: { actorId: req.actor.id, action: 'TPE_PAYMENT_STARTED', entityType: 'Payment', entityId: payment.id, newValue: { paymentId: payment.id, orderId: id, terminalId: terminal.terminalId ?? null, provider: terminal.provider ?? this.terminal.providerName, externalReference: terminal.externalReference ?? reference, amount: payment.amountDue.toString(), currency: payment.referenceCurrency } } });
    return { success: true, data: { ...payment, terminal, mode: this.terminal.mode } };
  }
  @Require('sales.create') @Post('payments/:id/terminal-simulate') async simulateTerminalPayment(@Param('id') id: string, @Body() input: unknown, @Headers('idempotency-key') key: string | undefined, @Req() req: AuthRequest) {
    uuid.parse(id);
    const { status } = z.object({ status: z.enum(['APPROVED', 'DECLINED', 'CANCELLED', 'TIMEOUT', 'UNKNOWN']) }).strict().parse(input);
    const payment = await this.prisma.payment.findUnique({ where: { id } });
    if (!payment || payment.method !== 'CARD' || payment.status !== 'PENDING') throw new DomainError('PAYMENT_NOT_PENDING', 'Aucun paiement TPE en attente à simuler.', 409);
    const result = this.terminal.simulate(id, status as TerminalPaymentStatus);
    if (status === 'APPROVED') {
      const data = await this.orders.confirmExternal(id, key, req.actor.id);
      return { success: true, data: { payment: data, terminal: result } };
    }
    const action = status === 'DECLINED' ? 'TPE_PAYMENT_DECLINED' : status === 'CANCELLED' ? 'TPE_PAYMENT_CANCELLED' : 'TPE_PAYMENT_TIMEOUT';
    const nextStatus = status === 'DECLINED' ? 'FAILED' : status === 'CANCELLED' ? 'CANCELLED' : 'PENDING';
    const updated = await mutate(this.prisma, 'tpe.simulate', key, req.actor.id, { id, status }, async tx => {
      await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${id}::uuid FOR UPDATE`;
      const current = await tx.payment.findUniqueOrThrow({ where: { id } });
      if (current.method !== 'CARD' || current.status !== 'PENDING') throw new DomainError('PAYMENT_NOT_PENDING', 'Aucun paiement TPE en attente à simuler.', 409);
      if (nextStatus !== 'PENDING') await tx.payment.update({ where: { id }, data: { status: nextStatus } });
      await audit(tx, req.actor.id, action, 'Payment', id, { paymentId: id, orderId: current.orderId, terminalId: result.terminalId ?? null, provider: 'MOCK', externalReference: current.externalReference, amount: current.amountDue.toString(), currency: current.referenceCurrency, result: status });
      return { ...current, status: nextStatus };
    });
    return { success: true, data: { payment: updated, terminal: result } };
  }
  @Require('sales.create') @Post('payments/:id/terminal-status') async terminalPaymentStatus(@Param('id') id: string, @Headers('idempotency-key') key: string | undefined, @Req() req: AuthRequest) {
    uuid.parse(id);
    const payment = await this.prisma.payment.findUnique({ where: { id } });
    if (!payment || payment.method !== 'CARD') throw new DomainError('TERMINAL_PAYMENT_NOT_FOUND', 'Paiement carte introuvable.', 404);
    const terminal = await this.terminal.getPaymentStatus(id);
    const metadata = { paymentId: id, orderId: payment.orderId, terminalId: terminal.terminalId ?? null, provider: terminal.provider ?? this.terminal.providerName, externalReference: terminal.externalReference ?? payment.externalReference, amount: payment.amountDue.toString(), currency: payment.referenceCurrency, result: terminal.status };
    await this.prisma.auditLog.create({ data: { actorId: req.actor.id, action: 'TPE_PAYMENT_STATUS_CHECKED', entityType: 'Payment', entityId: id, newValue: metadata } });
    let current: unknown = payment;
    if (payment.status === 'PENDING' && terminal.status === 'APPROVED') current = await this.orders.confirmExternal(id, key, req.actor.id);
    else if (payment.status === 'PENDING' && (terminal.status === 'DECLINED' || terminal.status === 'CANCELLED')) {
      const nextStatus = terminal.status === 'DECLINED' ? 'FAILED' : 'CANCELLED';
      current = await mutate(this.prisma, 'tpe.status', key, req.actor.id, { id, result: terminal.status }, async tx => {
        await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${id}::uuid FOR UPDATE`;
        const locked = await tx.payment.findUniqueOrThrow({ where: { id } });
        if (locked.status !== 'PENDING' || locked.method !== 'CARD') throw new DomainError('PAYMENT_NOT_PENDING', 'Le paiement n’est plus en attente.', 409);
        const updated = await tx.payment.update({ where: { id }, data: { status: nextStatus } });
        await audit(tx, req.actor.id, terminal.status === 'DECLINED' ? 'TPE_PAYMENT_DECLINED' : 'TPE_PAYMENT_CANCELLED', 'Payment', id, metadata);
        return updated;
      });
    } else {
      if (payment.status === 'PENDING' && (terminal.status === 'TIMEOUT' || terminal.status === 'UNKNOWN')) {
        await this.prisma.auditLog.create({ data: { actorId: req.actor.id, action: 'TPE_PAYMENT_TIMEOUT', entityType: 'Payment', entityId: id, newValue: metadata } });
      }
    }
    return { success: true, data: { payment: current, terminal } };
  }
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
@Controller('delivery')
export class DeliveryController {
  constructor(
    private readonly orders:
      OrdersService,

    private readonly prisma:
      PrismaService,
  ) {}

  @Require('delivery.assign')
  @Get('dispatch')
  async dispatch() {
    const [orders, couriers] = await Promise.all([
      this.prisma.order.findMany({where:{serviceMode:'DELIVERY',status:'READY',delivery:{is:null}},take:100,orderBy:{createdAt:'asc'},select:{id:true,number:true,createdAt:true,client:{select:{firstName:true,lastName:true}},kitchenTicket:{include:{items:true}}}}),
      this.prisma.user.findMany({where:{status:'ACTIVE',roles:{some:{role:{code:'LIVREUR'}}}},select:{id:true,firstName:true,lastName:true},orderBy:{firstName:'asc'}}),
    ]);
    return {success:true,data:{orders,couriers}};
  }

  @Require('delivery.assign')
  @Post(':id/assign')
  assign(@Param('id') id:string,@Body() input:unknown,@Headers('idempotency-key') key:string|undefined,@Req() req:AuthRequest) {
    uuid.parse(id);
    const {courierId}=z.object({courierId:uuid}).strict().parse(input);
    return mutate(this.prisma,'delivery.assign',key,req.actor.id,{id,courierId},async tx=>{
      await lockOrder(tx,id);
      const order=await tx.order.findFirst({where:{id,serviceMode:'DELIVERY',status:'READY',delivery:{is:null}},include:{client:true}});
      if(!order)throw new DomainError('DELIVERY_NOT_ASSIGNABLE','Cette commande n’est plus disponible pour affectation.',409);
      const courier=await tx.user.findFirst({where:{id:courierId,status:'ACTIVE',roles:{some:{role:{code:'LIVREUR'}}}},select:{id:true}});
      if(!courier)throw new DomainError('COURIER_NOT_FOUND','Livreur actif introuvable.',404);
      const delivery=await tx.delivery.create({data:{orderId:id,courierId,status:'READY',assignedAt:new Date(),addressSnapshot:{residency:order.client?.residency??'',phone:order.client?.phone??''}}});
      await audit(tx,req.actor.id,'DELIVERY_ASSIGNED','Delivery',delivery.id,{orderId:id,courierId});
      return delivery;
    }).then(data=>({success:true,data}));
  }

  @Require('delivery.read')
  @Get()
  async list(@Req() req: AuthRequest) {
    return {
      success: true,

      data:
        await this.prisma.order.findMany({
          where: {
            serviceMode: 'DELIVERY',
            delivery:{is:{courierId:req.actor.id}},

            status: {
              in: [
                'READY',
                'OUT_FOR_DELIVERY',
              ],
            },
          },

          take: 100,

          orderBy: {
            createdAt: 'asc',
          },

          select: {
            id: true,
            number: true,
            status: true,
            serviceMode: true,
            createdAt: true,
            client: {select:{firstName:true,lastName:true,phone:true,residency:true}},
            kitchenTicket: {
              include: {
                items: true,
              },
            },
          },
        }),
    };
  }

  @Require('delivery.confirm')
  @Post(':id/status')
  transition(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key')
    key: string | undefined,
    @Req() req: AuthRequest,
  ) {
    const deliveryInput = z
      .object({
        status: z.enum([
          'OUT_FOR_DELIVERY',
          'DELIVERED',
        ]),
        physicallyHandedOver: z.boolean().optional(),
      })
      .strict()
      .parse(body);
    const status=deliveryInput.status;
    if(status==='DELIVERED' && deliveryInput.physicallyHandedOver!==true)throw new DomainError('HANDOVER_REQUIRED','Confirmez la remise physique au destinataire.',400);

    return this.orders
      .transition(
        id,
        { status },
        key,
        req.actor.id,
      )
      .then((data) => ({
        success: true,
        data,
      }));
  }
}
