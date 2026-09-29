import { Body, Controller, Get, Headers, Injectable, Param, Post, Query, Req } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { confirmPaymentSchema, createOrderSchema, pageSchema, uuid } from '@jami/validation';
import { Prisma } from '@jami/database';
import { localDate } from '@jami/shared';
import { z } from 'zod';
import { PrismaService } from './prisma.service';
import { DomainError } from './http';
import { netPaymentReceived } from './refund-value';
import { move } from './stock';
import { consumeReservedMealRight } from './meal-consumption';
import { AuthRequest, Require, RequireAny } from './auth';
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
  const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const movements = [{ cashSessionId: payment.cashSessionId, paymentId: payment.id, type: payment.method === 'CASH' ? 'CASH_IN' : 'DIGITAL_IN', amount: payment.receivedAmount, currency: payment.receivedCurrency, sourceType: 'PAYMENT', sourceId: payment.id }];
  if (payment.changeAmount.gt(0)) movements.push({ cashSessionId: payment.cashSessionId, paymentId: payment.id, type: 'CASH_OUT', amount: payment.changeAmount, currency: payment.changeCurrency!, sourceType: 'PAYMENT', sourceId: payment.id });
  await tx.cashMovement.createMany({ data: movements });

  if (payment.orderId) {
    const order = await tx.order.findUniqueOrThrow({ where: { id: payment.orderId } });
    if (order.sourceChannel === 'WHATSAPP') {
      await audit(tx, actorId, 'ORDER_EXTRA_PAID', 'Order', order.id, { paymentId: payment.id });
    } else {
      const paid = await tx.payment.aggregate({ where: { orderId: order.id, status: 'CONFIRMED' }, _sum: { amountDue: true } });
      const totalPaid = paid._sum.amountDue ?? new Decimal(0);
      if (totalPaid.gte(order.totalAmount.sub(order.coveredAmount))) {
        const stockTotals = new Map<string, Prisma.Decimal>();
        const lines = await tx.orderItem.findMany({ where: { orderId: order.id } });
        for (const line of lines) {
          const snapshot = line.productSnapshot as { stockMode?: string; stockItemId?: string; stockQuantity?: string; menuVersionId?: string };
          if (snapshot.menuVersionId === order.menuVersionId && snapshot.menuVersionId && line.productId) {
            const menuItem = await tx.menuItem.findUnique({ where: { menuVersionId_productId: { menuVersionId: snapshot.menuVersionId, productId: line.productId } } });
            if (menuItem) { const qty = Math.ceil(Number(line.quantity)); const changed = await tx.menuItem.updateMany({ where: { id: menuItem.id, quantityReserved: { gte: qty } }, data: { quantityReserved: { decrement: qty }, quantitySold: { increment: qty } } }); if (!changed.count) throw new DomainError('MENU_RESERVATION_MISSING', 'La réservation du menu est absente.', 409); }
          }
          if (snapshot.stockMode === 'DIRECT' && snapshot.stockItemId && snapshot.stockQuantity) stockTotals.set(snapshot.stockItemId, (stockTotals.get(snapshot.stockItemId) ?? new Decimal(0)).add(line.quantity.mul(snapshot.stockQuantity)));
          const extras = Array.isArray(line.supplementsSnapshot) ? line.supplementsSnapshot as { quantity?: number; linkedStock?: { stockMode?: string; stockItemId?: string | null; stockQuantity?: string } }[] : [];
          for (const extra of extras) {
            const linked = extra.linkedStock;
            if (linked?.stockMode === 'DIRECT' && linked.stockItemId && linked.stockQuantity) {
              const quantity = line.quantity.mul(extra.quantity ?? 1).mul(linked.stockQuantity);
              stockTotals.set(linked.stockItemId, (stockTotals.get(linked.stockItemId) ?? new Decimal(0)).add(quantity));
            }
          }
        }
        for (const [stockId, quantity] of [...stockTotals].sort(([a], [b]) => a.localeCompare(b))) await move(tx, stockId, quantity.negated(), 'DIRECT_SALE', order.id, `Vente validée : ${order.number}`, actorId);
        await tx.order.update({ where: { id: order.id }, data: { status: 'READY', statusHistory: { create: { fromStatus: 'RECEIVED', toStatus: 'READY', actorId } } } });
        await audit(tx, actorId, 'ORDER_PAID', 'Order', order.id, { paymentId: payment.id });
      }
    }
  }

  if (payment.subscriptionId) {
    const subscription = await tx.subscription.findUniqueOrThrow({ where: { id: payment.subscriptionId } });
    const paid = subscription.paidAmount.add(payment.amountDue);
    const balance = subscription.amount.sub(paid);
    const status = subscriptionLifecycleStatus(balance, subscription.startsOn, subscription.endsOn);
    await tx.subscription.update({ where: { id: subscription.id }, data: { paidAmount: paid, balance, status } });
  }
  await audit(tx, actorId, 'PAYMENT_CONFIRMED', 'Payment', payment.id, { method: payment.method, receivedAmount: payment.receivedAmount.toString(), receivedCurrency: payment.receivedCurrency });
}@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}
  handoverPos(orderId: string, cashSessionId: string, key: string | undefined, actorId: string) {
    uuid.parse(orderId);
    return mutate(this.prisma, 'orders.pos-handover', key, actorId, { orderId, cashSessionId }, async tx => {
      await lockOrder(tx, orderId);
      await lockCash(tx, cashSessionId, actorId);
      const order = await tx.order.findUnique({ where: { id: orderId }, include: { client: true, payments: true, reservation: { include: { mealRight: true } }, items: true, cashier: { select: { firstName: true, lastName: true } } } });
      if (order?.status === 'SERVED' && order.handoverAt) throw new DomainError('ORDER_ALREADY_SERVED', 'REPAS DÉJÀ REMIS.', 409);
      if (!order || order.sourceChannel !== 'POS' || !order.clientId || order.status !== 'READY') throw new DomainError('ORDER_NOT_READY', 'Cette commande abonné n’est pas prête à être remise.', 409);
      if (order.payments.some(payment => payment.status === 'PENDING')) throw new DomainError('PAYMENT_PENDING', 'Un paiement attend confirmation.', 409);
      const paid = order.payments.filter(payment => payment.status === 'CONFIRMED').reduce((sum, payment) => sum.add(payment.amountDue), new Decimal(0));
      if (order.totalAmount.sub(order.coveredAmount).sub(paid).gt(0)) throw new DomainError('PAYMENT_REQUIRED', 'Encaissez le montant restant avant la remise.', 409);
      const reservation = order.reservation;
      if (reservation) {
        const right = await tx.mealRight.findUniqueOrThrow({ where: { id: reservation.mealRightId } });
        if (right.status === 'CONSUMED') throw new DomainError('MEAL_RIGHT_CONSUMED', 'Le droit a déjà été consommé.', 409);
        if (right.status !== 'RESERVED') throw new DomainError('MEAL_RIGHT_UNAVAILABLE', 'Le droit n’est plus réservé pour cette commande.', 409);
        const subscription = await tx.subscription.findUniqueOrThrow({ where: { id: right.subscriptionId }, include: { planVersion: true } });
        const today = localDate();
        const start = subscription.startsOn.toISOString().slice(0, 10);
        const end = subscription.endsOn.toISOString().slice(0, 10);
        if (subscription.status === 'SUSPENDED') throw new DomainError('SUBSCRIPTION_SUSPENDED', 'Abonnement suspendu.', 409);
        if (subscription.status === 'CANCELLED') throw new DomainError('SUBSCRIPTION_CANCELLED', 'Abonnement annulé.', 409);
        if (subscription.balance.gt(0)) throw new DomainError('SUBSCRIPTION_PAYMENT_BLOCKING', 'Paiement de l’abonnement requis.', 409);
        if (start > today) throw new DomainError('SUBSCRIPTION_SCHEDULED', 'Abonnement planifié : période non commencée.', 409);
        if (end < today) throw new DomainError('SUBSCRIPTION_EXPIRED', 'Abonnement expiré.', 409);
        const services = Array.isArray(subscription.planVersion.services) ? subscription.planVersion.services as string[] : [];
        const serviceCovered = right.serviceCode === 'MAIN' ? services.includes('MAIN') : services.includes(right.serviceCode);
        if (!serviceCovered) throw new DomainError('SERVICE_NOT_COVERED', `Cette formule ne couvre pas le service ${order.serviceCode ?? right.serviceCode}.`, 409);
        await consumeReservedMealRight(tx, { mealRightId: right.id, orderId, actorId, idempotencyKey: key! });
      }
      if (!order.payments.some(payment => payment.status === 'CONFIRMED')) {
        const stockTotals = new Map<string, Prisma.Decimal>();
        for (const line of order.items) {
          const snapshot = line.productSnapshot as { stockMode?: string; stockItemId?: string | null; stockQuantity?: string };
          if (snapshot.stockMode === 'DIRECT' && snapshot.stockItemId && snapshot.stockQuantity) stockTotals.set(snapshot.stockItemId, (stockTotals.get(snapshot.stockItemId) ?? new Decimal(0)).add(line.quantity.mul(snapshot.stockQuantity)));
          const extras = Array.isArray(line.supplementsSnapshot) ? line.supplementsSnapshot as { quantity?: number; linkedStock?: { stockMode?: string; stockItemId?: string | null; stockQuantity?: string } }[] : [];
          for (const extra of extras) if (extra.linkedStock?.stockMode === 'DIRECT' && extra.linkedStock.stockItemId && extra.linkedStock.stockQuantity) stockTotals.set(extra.linkedStock.stockItemId, (stockTotals.get(extra.linkedStock.stockItemId) ?? new Decimal(0)).add(line.quantity.mul(extra.quantity ?? 1).mul(extra.linkedStock.stockQuantity)));
        }
        for (const [stockId, quantity] of [...stockTotals].sort(([a], [b]) => a.localeCompare(b))) await move(tx, stockId, quantity.negated(), 'DIRECT_SALE', order.id, `Remise abonné : ${order.number}`, actorId);
      }
      const handoverAt = new Date();
      // consumeReservedMealRight creates the unique MealConsumption row itself.
      await tx.order.update({ where: { id: orderId }, data: { status: 'SERVED', cashierId: actorId, handoverAt, statusHistory: { create: { fromStatus: 'READY', toStatus: 'SERVED', actorId } } } });
      await audit(tx, actorId, 'ORDER_HANDED_OVER', 'Order', orderId, { cashierId: actorId, handoverAt: handoverAt.toISOString(), amountDue: '0' });
      return { id: orderId, number: order.number, status: 'SERVED', receiptUrl: `/orders/${orderId}/receipt` };
    });
  }
  addPickupExtras(orderId: string, input: unknown, key: string | undefined, actorId: string) {
    uuid.parse(orderId);
    const body = z.object({ cashSessionId: uuid, items: z.array(z.object({ productId: uuid, quantity: z.number().int().min(1).max(100), selections: z.record(z.array(uuid).max(20)).optional() }).strict()).min(1).max(50) }).strict().parse(input);
    return mutate(this.prisma, 'orders.pickup-extras', key, actorId, { orderId, ...body }, async tx => {
      await lockCash(tx, body.cashSessionId, actorId);
      await lockOrder(tx, orderId);
      const order = await tx.order.findUnique({ where: { id: orderId }, include: { client: { include: { category: true } }, payments: true } });
      if (!order || order.sourceChannel !== 'WHATSAPP' || order.status !== 'READY' || !order.client) throw new DomainError('ORDER_NOT_READY', 'Cette commande n’est plus disponible pour ajouter des extras.', 409);
      if (order.payments.some(payment => payment.status === 'PENDING')) throw new DomainError('PAYMENT_PENDING', 'Vérifiez le paiement en attente avant de modifier les extras.', 409);
      const now = new Date();
      const products = await tx.product.findMany({
        where: { id: { in: body.items.map(item => item.productId) }, active: true, available: true },
        include: {
          category: true, stockItem: true,
          prices: { where: { categoryCode: order.client.category.code }, include: { versions: { where: { currency: order.currency, status: 'ACTIVE', effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }, orderBy: { effectiveFrom: 'desc' }, take: 1 } } },
          optionGroups: {
            where: { active: true }, orderBy: { position: 'asc' },
            include: {
              options: {
                where: { active: true }, orderBy: { position: 'asc' },
                include: {
                  linkedProduct: {
                    include: {
                      stockItem: true,
                      prices: {
                        where: { categoryCode: order.client.category.code },
                        include: { versions: { where: { currency: order.currency, status: 'ACTIVE', effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }, orderBy: { effectiveFrom: 'desc' }, take: 1 } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });
      const lines = body.items.map(item => {
        const product = products.find(row => row.id === item.productId);
        const price = product?.prices.flatMap(value => value.versions).find(value => !value.effectiveTo || value.effectiveTo > now);
        if (!product || !price) throw new DomainError('PRICE_UNAVAILABLE', 'Un extra est indisponible ou son tarif n’est pas configuré.', 409);
        const selections = item.selections ?? {};
        const supplements: { id: string; name: string; quantity: number; unitPrice: string; linkedStock?: { stockMode: string; stockItemId: string | null; stockQuantity: string } }[] = [];
        for (const group of product.optionGroups) {
          const selected = selections[group.id] ?? [];
          if (selected.length < Math.max(group.minSelections, group.required ? 1 : 0) || selected.length > group.maxSelections) throw new DomainError('PRODUCT_OPTIONS_INVALID', `Options invalides pour ${group.name}.`, 400);
          if (selected.some(id => !group.options.some(option => option.id === id))) throw new DomainError('PRODUCT_OPTION_UNKNOWN', 'Une option sélectionnée est inconnue.', 400);
          for (const option of group.options.filter(value => selected.includes(value.id))) {
            const linked = option.linkedProduct;
            const linkedPrice = linked?.prices.flatMap(value => value.versions).find(value => !value.effectiveTo || value.effectiveTo > now);
            if (linked && (!linked.active || !linked.available || (linked.stockMode === 'DIRECT' && (!linked.stockItem?.active || linked.stockItem.quantity.lt(linked.stockQuantity.mul(item.quantity))))) ) throw new DomainError('PRODUCT_OPTION_OUT_OF_STOCK', `${linked.name} est indisponible.`, 409);
            supplements.push({ id: option.id, name: option.name, quantity: 1, unitPrice: (linkedPrice?.amount ?? option.priceDelta).toString(), linkedStock: linked ? { stockMode: linked.stockMode, stockItemId: linked.stockItemId, stockQuantity: linked.stockQuantity.toString() } : undefined });
          }
        }
        if (Object.keys(selections).some(groupId => !product.optionGroups.some(group => group.id === groupId))) throw new DomainError('PRODUCT_OPTION_UNKNOWN', 'Un groupe d’options est inconnu.', 400);
        if (product.stockMode === 'DIRECT' && (!product.stockItem?.active || product.stockItem.quantity.lt(product.stockQuantity.mul(item.quantity)))) throw new DomainError('PRODUCT_OUT_OF_STOCK', `${product.name} est en rupture de stock.`, 409);
        const unitPrice = new Decimal(price.amount).add(supplements.reduce((sum, option) => sum.add(option.unitPrice), new Decimal(0)));
        return { productId: product.id, quantity: new Decimal(item.quantity), unitPrice, lineTotal: unitPrice.mul(item.quantity), supplementsSnapshot: supplements.length ? supplements : undefined, productSnapshot: { name: product.name, stockMode: product.stockMode, stockItemId: product.stockItemId, stockQuantity: product.stockQuantity.toString(), productCategoryCode: product.category.code, productCategoryLabel: product.category.label, priceVersionId: price.id, clientCategoryCode: order.client!.category.code, pickupExtra: true } };
      });
      const extraTotal = lines.reduce((sum, line) => sum.add(line.lineTotal), new Decimal(0));
      const updated = await tx.order.update({ where: { id: orderId }, data: { totalAmount: { increment: extraTotal }, commercialTotal: { increment: extraTotal }, items: { create: lines } } });
      await audit(tx, actorId, 'PICKUP_EXTRAS_ADDED', 'Order', orderId, { amount: extraTotal.toString(), items: body.items.length });
      return updated;
    });
  }
  create(input: unknown, key: string | undefined, actorId: string) {
    const data = createOrderSchema.parse(input);
    return mutate(this.prisma, 'orders.create', key, actorId, data, async tx => {
      if (data.clientId && !data.serviceCode) throw new DomainError('SERVICE_REQUIRED', 'Choisissez le service demandé par l’abonné.', 400);
      const subscriber = data.clientId ? await tx.client.findFirst({ where: { id: data.clientId, archivedAt: null }, include: { category: true } }) : null;
      if (data.clientId && !subscriber) throw new DomainError('SUBSCRIBER_NOT_FOUND', 'Abonné introuvable ou archivé.', 404);
      let priceCategoryCode = subscriber?.category.code;
      if (!priceCategoryCode) {
        const setting = await tx.setting.findUnique({ where: { key: 'pos_anonymous_category' } });
        const configured = setting?.validated ? z.object({ categoryCode: z.string().min(1).max(50) }).safeParse(setting.value) : null;
        if (!configured?.success) throw new DomainError('POS_PRICE_CATEGORY_NOT_CONFIGURED', 'La catégorie de tarification comptoir doit être configurée et validée par la Responsable.', 409);
        if (data.categoryCode !== configured.data.categoryCode) throw new DomainError('POS_PRICE_CATEGORY_INVALID', 'La catégorie de tarification comptoir fournie n’est pas autorisée.', 403);
        priceCategoryCode = configured.data.categoryCode;
      }
      if(data.menuVersionId) await tx.$queryRaw`SELECT id FROM "MenuVersion" WHERE id = ${data.menuVersionId}::uuid FOR UPDATE`;
      const menuVersion = data.menuVersionId ? await tx.menuVersion.findUnique({where:{id:data.menuVersionId},include:{menu:true,items:true}}) : null;
      if (data.menuVersionId && (!menuVersion || menuVersion.status !== 'PUBLISHED' || menuVersion.menu.businessDate.toISOString().slice(0,10) !== localDate())) throw new DomainError('MENU_UNAVAILABLE', 'Ce menu n’est plus publié pour aujourd’hui. Actualisez le POS.');
      if (!await tx.clientCategory.findFirst({ where: { code: priceCategoryCode, active: true } })) throw new DomainError('CATEGORY_INVALID', 'Catégorie de tarification non autorisée.', 400);
const products = await tx.product.findMany({
  where: { id: { in: data.items.map(item => item.productId) }, active: true },
  include: {
    category: true,
    optionGroups: { where: { active: true }, orderBy: { position: 'asc' }, include: { options: { where: { active: true }, orderBy: { position: 'asc' }, include: { linkedProduct: { include: { stockItem: true, prices: { where: { categoryCode: priceCategoryCode }, include: { versions: { where: { currency: data.currency, status: 'ACTIVE', effectiveFrom: { lte: new Date() }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }] }, orderBy: { effectiveFrom: 'desc' }, take: 1 } } } } } } } } },
    prices: { where: { categoryCode: priceCategoryCode }, include: { versions: { where: { currency: data.currency, status: 'ACTIVE', effectiveFrom: { lte: new Date() } }, orderBy: { effectiveFrom: 'desc' } } } },
  },
});  const lines = data.items.map(item => {
        const p = products.find(p => p.id === item.productId);
        const price = p?.prices.flatMap(p => p.versions).find(v => !v.effectiveTo || v.effectiveTo > new Date());
        if (!p || !p.available) throw new DomainError('PRICE_UNAVAILABLE', 'Article indisponible.', 400);
        const selections = item.selections ?? {};
        const extras: { id: string; name: string; quantity: number; unitPrice: string; linkedStock?: { stockMode: string; stockItemId: string | null; stockQuantity: string } }[] = [];
        for (const group of p.optionGroups) {
          const selected = selections[group.id] ?? [];
          if (selected.length < Math.max(group.minSelections, group.required ? 1 : 0) || selected.length > group.maxSelections) throw new DomainError('PRODUCT_OPTIONS_INVALID', `Options invalides pour ${group.name}.`, 400);
          if (selected.some(id => !group.options.some(option => option.id === id))) throw new DomainError('PRODUCT_OPTION_UNKNOWN', 'Une option sélectionnée est inconnue.', 400);
          for (const option of group.options.filter(option => selected.includes(option.id))) {
            const linked = option.linkedProduct;
            const linkedPrice = linked?.prices[0]?.versions[0];
            if (linked && (!linked.active || !linked.available || (linked.stockMode === 'DIRECT' && (!linked.stockItem?.active || linked.stockItem.quantity.lt(linked.stockQuantity))))) throw new DomainError('PRODUCT_OPTION_OUT_OF_STOCK', `${linked.name} est indisponible.`, 409);
            extras.push({ id: option.id, name: option.name, quantity: 1, unitPrice: (linkedPrice?.amount ?? option.priceDelta).toString(), linkedStock: linked ? { stockMode: linked.stockMode, stockItemId: linked.stockItemId, stockQuantity: linked.stockQuantity.toString() } : undefined });
          }
        }
        if (Object.keys(selections).some(groupId => !p.optionGroups.some(group => group.id === groupId))) throw new DomainError('PRODUCT_OPTION_UNKNOWN', 'Un groupe d’options est inconnu.', 400);
        const baseAmount = menuVersion ? new Decimal((menuVersion.items.find(row => row.productId === p.id)?.priceSnapshot as { categories?: Record<string, { amount: string; currency: string }> } | null)?.categories?.[priceCategoryCode]?.amount ?? '0') : new Decimal(price!.amount);
        const extraAmount = extras.reduce((sum, option) => sum.add(option.unitPrice), new Decimal(0));
        const lineAmount = baseAmount.add(extraAmount);
        if (menuVersion) {
          const menuItem = menuVersion.items.find(row => row.productId === p.id);
          if (!menuItem?.available || item.quantity > menuItem.quantityAvailable - menuItem.quantitySold - menuItem.quantityReserved) throw new DomainError('MENU_ITEM_UNAVAILABLE', 'Article épuisé ou absent de cette version du menu.');
          const snapshot = z.object({categories:z.record(z.object({amount:z.string(),currency:z.string(),priceVersionId:z.string()}))}).parse(menuItem.priceSnapshot);
          const fixed = snapshot.categories[priceCategoryCode];
          if (!fixed || fixed.currency !== data.currency) throw new DomainError('PRICE_UNAVAILABLE', 'Tarif du menu indisponible pour cette catégorie et cette devise.');
          return {productId:p.id,quantity:new Decimal(item.quantity),unitPrice:lineAmount,lineTotal:lineAmount.mul(item.quantity),supplementsSnapshot:extras.length?extras:undefined,productSnapshot:{name:p.name,stockMode:p.stockMode,stockItemId:p.stockItemId,stockQuantity:p.stockQuantity.toString(),menuVersionId:menuVersion.id,product:menuItem.productSnapshot,variants:menuItem.variants,priceVersionId:fixed.priceVersionId,clientCategoryCode:data.categoryCode}};
        }
        if (!price) throw new DomainError('PRICE_UNAVAILABLE', 'Tarif indisponible.', 400);
        return { productId: p.id, quantity: new Decimal(item.quantity), unitPrice: lineAmount, lineTotal: lineAmount.mul(item.quantity), supplementsSnapshot: extras.length?extras:undefined, productSnapshot: {
  name: p.name,
  stockMode:p.stockMode,stockItemId:p.stockItemId,stockQuantity:p.stockQuantity.toString(),

  productCategoryCode:
    p.category.code,

  productCategoryLabel:
    p.category.label,

  priceVersionId:
    price.id,

  clientCategoryCode:
    priceCategoryCode,
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
      const businessDate = new Date(`${localDate()}T00:00:00.000Z`);
      let reservedRightId: string | undefined;
      let coverageReason: string | undefined;
      if (subscriber && data.serviceCode) {
        const subscription = await tx.subscription.findFirst({
          where: { clientId: subscriber.id, status: { in: ['ACTIVE','SUSPENDED'] }, startsOn: { lte: businessDate }, endsOn: { gte: businessDate } },
          orderBy: { startsOn: 'desc' }, include: { planVersion: true },
        });
        if (!subscription) coverageReason = 'Aucun abonnement utilisable pour cette période : vente au tarif normal.';
        else if (subscription.status === 'SUSPENDED') coverageReason = 'Abonnement suspendu : vente au tarif normal.';
        else if (subscription.balance.gt(0)) coverageReason = 'Paiement de l’abonnement requis : vente au tarif normal.';
        else if (subscription.status !== 'ACTIVE' || subscriptionLifecycleStatus(subscription.balance, subscription.startsOn, subscription.endsOn) !== 'ACTIVE') coverageReason = 'Abonnement non actif ou expiré : vente au tarif normal.';
        else {
          const services = Array.isArray(subscription.planVersion.services) ? subscription.planVersion.services as string[] : [];
          const rightService = services.includes(data.serviceCode) ? data.serviceCode : (data.serviceCode !== 'BREAKFAST' && services.includes('MAIN') ? 'MAIN' : null);
          if (!rightService) coverageReason = `La formule ne couvre pas le service ${data.serviceCode} : vente au tarif normal.`;
          else {
            const candidate = await tx.mealRight.findUnique({ where: { subscriptionId_businessDate_serviceCode_quotaGroup: { subscriptionId: subscription.id, businessDate, serviceCode: rightService, quotaGroup: rightService } } });
            if (candidate?.status === 'RESERVED') throw new DomainError('MEAL_RIGHT_RESERVED', 'Un droit est déjà réservé par une commande WhatsApp. Retrouvez la commande à retirer de cet abonné.', 409);
            if (candidate?.status === 'AVAILABLE') {
              await tx.$queryRaw`SELECT id FROM "MealRight" WHERE id = ${candidate.id}::uuid FOR UPDATE`;
              const currentRight = await tx.mealRight.findUniqueOrThrow({ where: { id: candidate.id } });
              if (currentRight.status === 'AVAILABLE') reservedRightId = currentRight.id;
              else if (currentRight.status === 'RESERVED') throw new DomainError('MEAL_RIGHT_RESERVED', 'Un droit vient d’être réservé. Retrouvez la commande à retirer de cet abonné.', 409);
              else coverageReason = 'DROIT ABONNEMENT DÉJÀ UTILISÉ : ce repas sera facturé normalement.';
            } else coverageReason = candidate?.status === 'CONSUMED' ? 'DROIT ABONNEMENT DÉJÀ UTILISÉ : ce repas sera facturé normalement.' : 'Aucun droit disponible pour ce service : vente au tarif normal.';
          }
        }
      }
      let coveredAmount = new Decimal(0);
      if (reservedRightId) for (const line of lines) {
        const snapshot = line.productSnapshot as { productCategoryCode?: string };
        if (!['REPAS','PETIT_DEJEUNER'].includes(snapshot.productCategoryCode ?? '')) continue;
        const supplements = Array.isArray(line.supplementsSnapshot) ? line.supplementsSnapshot as { unitPrice: string; quantity: number }[] : [];
        const extras = supplements.reduce((sum, option) => sum.add(new Decimal(option.unitPrice).mul(option.quantity)), new Decimal(0));
        coveredAmount = coveredAmount.add(Prisma.Decimal.max(new Decimal(0), line.lineTotal.sub(extras.mul(line.quantity))));
      }
      coveredAmount = Prisma.Decimal.min(coveredAmount, total);
      if (reservedRightId && coveredAmount.lte(0)) coverageReason = 'Le droit ne couvre pas le type de repas sélectionné : vente au tarif normal.';
      if (reservedRightId && coveredAmount.gt(0)) {
        const reserved = await tx.mealRight.updateMany({ where: { id: reservedRightId, status: 'AVAILABLE' }, data: { status: 'RESERVED', reservedAt: new Date() } });
        if (reserved.count !== 1) throw new DomainError('MEAL_RIGHT_UNAVAILABLE', 'Le droit vient d’être utilisé. Actualisez le dossier abonné.', 409);
      } else reservedRightId = undefined;
      const amountDue = total.sub(coveredAmount);
      const pickupStatus = amountDue.eq(0) ? 'READY' : 'RECEIVED';
      const order = await tx.order.create({ data: { number: `POS-${localDate().slice(0,4)}-${randomUUID().slice(0, 8).toUpperCase()}`, clientId: data.clientId ?? null, menuVersionId:data.menuVersionId, mealRightId:reservedRightId, serviceCode:data.serviceCode, sourceChannel: 'POS', createdById: actorId, cashierId: actorId, serviceMode: data.serviceMode, businessDate, totalAmount: total, commercialTotal: total, coveredAmount, paymentRequired: amountDue.gt(0), currency: data.currency, status: pickupStatus, items: { create: lines }, reservation: reservedRightId ? { create: { mealRightId: reservedRightId, reservedById: actorId } } : undefined, statusHistory: { create: { toStatus: pickupStatus, actorId } } } });
      await audit(tx, actorId, 'ORDER_CREATED', 'Order', order.id, { total: total.toString(), number: order.number });
      return { ...order, coverageReason: coveredAmount.gt(0) ? 'Repas couvert par le droit disponible.' : coverageReason ?? null };
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
        (order.sourceChannel === 'WHATSAPP' ? order.status !== 'READY' : (!order.paymentRequired || order.status !== 'RECEIVED'))
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
        order.totalAmount.sub(order.coveredAmount).sub(
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
      if (payment.status === 'CONFIRMED') {
        const isFinal = remaining.sub(appliedAmount).lte(0);
        if (order.sourceChannel === 'WHATSAPP' && isFinal) {
          await tx.order.update({ where: { id: order.id }, data: { paymentRequired: false } });
        }
        if (order.sourceChannel === 'WHATSAPP' && isFinal) {
          await audit(tx, actorId, 'WHATSAPP_EXTRAS_PAID', 'Order', order.id, { paymentId: payment.id });
        }
      }

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

        orderStatus: order.sourceChannel === 'WHATSAPP' ? 'READY' : remainingAfter.lte(0) ? 'READY' : 'RECEIVED',
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
      if (p.orderId) {
        const paidOrder = await tx.order.findUnique({ where: { id: p.orderId }, select: { id: true, sourceChannel: true, totalAmount: true, coveredAmount: true } });
        if (paidOrder?.sourceChannel === 'WHATSAPP') {
          const payments = await tx.payment.aggregate({ where: { orderId: p.orderId, status: 'CONFIRMED' }, _sum: { amountDue: true } });
          if ((payments._sum.amountDue ?? new Decimal(0)).gte(paidOrder.totalAmount.sub(paidOrder.coveredAmount))) await tx.order.update({ where: { id: p.orderId }, data: { paymentRequired: false } });
        }
      }
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

      if (order.sourceChannel === 'WHATSAPP' && order.status === 'SERVED') {
        throw new DomainError('ORDER_ALREADY_SERVED','Une commande retirée ne peut pas être annulée.',409);
      }
      if (order.sourceChannel !== 'WHATSAPP' && ['READY', 'SERVED'].includes(order.status)) {
        throw new DomainError(
          'ORDER_CANCEL_REVIEW_REQUIRED',
          'Cette commande est déjà prête ou remise.',
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
      if (order.sourceChannel === 'WHATSAPP' && order.menuVersionId) {
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
      if (order.sourceChannel === 'WHATSAPP' && order.payments.some(p=>p.status==='CONFIRMED')) {
        await audit(tx,actorId,'WHATSAPP_ORDER_REFUND_REVIEW_REQUIRED','Order',id,{reason:body.reason,confirmedPayments:order.payments.filter(p=>p.status==='CONFIRMED').map(p=>p.id)});
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
    .object({ status: z.enum(['READY', 'SERVED']) })
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

      if (order.status === 'SERVED') {
        throw new DomainError(
          'ORDER_ALREADY_SERVED',
          'Cette commande a déjà été remise.',
          409,
        );
      }

      const allowed =
        (status === 'READY' &&
          ['RECEIVED', 'CONFIRMED'].includes(order.status)) ||
        (status === 'SERVED' && order.status === 'READY');

      if (!allowed) {
        throw new DomainError(
          'INVALID_ORDER_TRANSITION',
          'Cette transition de commande n’est pas autorisée.',
          409,
        );
      }
      if(status === 'SERVED') {
        const reservation = await tx.mealReservation.findUnique({where:{orderId:id}});
        if(reservation) {
          await consumeReservedMealRight(tx,{mealRightId:reservation.mealRightId,orderId:id,actorId,idempotencyKey:key!});
        }
      }

      // Subscription-covered orders are sold at physical handover.
      if (!order.paymentRequired && order.menuVersionId && status === 'SERVED') {
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
  @RequireAny('orders.create','sales.create') @Post() create(@Body() body: unknown, @Headers('idempotency-key') key: string | undefined, @Req() req: AuthRequest) { return this.orders.create(body, key, req.actor.id).then(data => ({ success: true, data })); }
  @Require('sales.create') @Get('pos-catalog') async posCatalog(@Query() query: unknown) {
    const queryData = z.object({ categoryCode: z.string().trim().min(1).max(50).optional(), currency: z.enum(['CDF','USD']).default('CDF') }).parse(query);
    let categoryCode = queryData.categoryCode;
    if (!categoryCode) {
      const setting = await this.prisma.setting.findUnique({ where: { key: 'pos_anonymous_category' } });
      const configured = setting?.validated ? z.object({ categoryCode: z.string().min(1).max(50) }).safeParse(setting.value) : null;
      if (!configured?.success) throw new DomainError('POS_PRICE_CATEGORY_NOT_CONFIGURED', 'La catégorie de tarification des ventes comptoir doit être configurée et validée par la Responsable.', 409);
      categoryCode = configured.data.categoryCode;
    }
    const currency = queryData.currency;
    const now = new Date();
    const products = await this.prisma.product.findMany({
      where: { active: true, available: true, category: { active: true }, prices: { some: { categoryCode, versions: { some: { currency, status: 'ACTIVE', effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] } } } } },
      orderBy: [{ category: { label: 'asc' } }, { name: 'asc' }],
      include: {
        category: true,
        stockItem: { select: { active: true, quantity: true } },
        prices: { where: { categoryCode }, include: { versions: { where: { currency, status: 'ACTIVE', effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }, orderBy: { effectiveFrom: 'desc' }, take: 1 } } },
        optionGroups: { where: { active: true }, orderBy: { position: 'asc' }, include: { options: { where: { active: true }, orderBy: { position: 'asc' }, include: { linkedProduct: { include: { stockItem: { select: { active: true, quantity: true } } } } } } } },
      },
    });
    return { success: true, data: { categoryCode, products: products.filter(product => product.prices[0]?.versions[0]).map(product => ({ ...product, price: product.prices[0]!.versions[0], prices: undefined })) } };
  }
  @Require('sales.create') @Get('pos-subscriber/:id') async posSubscriber(@Param('id') id: string) {
    uuid.parse(id);
    const client = await this.prisma.client.findFirst({ where: { id, archivedAt: null }, select: { id: true, firstName: true, lastName: true, ulcNumber: true, phone: true, category: { select: { code: true, label: true } }, subscriptions: { orderBy: { startsOn: 'desc' }, take: 5, select: { id: true, status: true, startsOn: true, endsOn: true, balance: true, currency: true, planVersion: { select: { services: true, plan: { select: { name: true } } } } } } } });
    if (!client) throw new DomainError('NOT_FOUND', 'Abonné introuvable ou archivé.', 404);
    const subscriber = { ...client, subscriptions: client.subscriptions.map(subscription => ({ ...subscription, status: ['SUSPENDED','CANCELLED'].includes(subscription.status) ? subscription.status : subscriptionLifecycleStatus(subscription.balance, subscription.startsOn, subscription.endsOn) })) };
    const date = new Date(`${localDate()}T00:00:00.000Z`);
    const orders = await this.prisma.order.findMany({ where: { clientId: id, sourceChannel: 'WHATSAPP', status: 'READY', businessDate: date }, orderBy: { createdAt: 'asc' }, take: 10, include: { items: { select: { id: true, quantity: true, lineTotal: true, productSnapshot: true, variantsSnapshot: true, supplementsSnapshot: true } }, payments: { where: { status: { in: ['CONFIRMED','PENDING'] } }, select: { id: true, status: true, method: true, amountDue: true } }, reservation: { include: { mealRight: { select: { serviceCode: true, quotaGroup: true, status: true } } } } } });
    return { success: true, data: { client: subscriber, orders: orders.map(order => { const paid = order.payments.filter(payment => payment.status === 'CONFIRMED').reduce((sum, payment) => sum.add(payment.amountDue), new Prisma.Decimal(0)); return { ...order, paidAmount: paid.toString(), remainingAmount: Prisma.Decimal.max(new Prisma.Decimal(0), order.totalAmount.sub(order.coveredAmount).sub(paid)).toString() }; }) } };
  }
  @Require('orders.manage') @Get('whatsapp') async whatsapp(@Query() query: unknown) {
    const {q='',date:day}=z.object({q:z.string().trim().max(120).optional(),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()}).parse(query);
    const where={sourceChannel:'WHATSAPP' as const,...(day?{businessDate:new Date(`${day}T00:00:00.000Z`)}:{}),...(q?{OR:[{number:{contains:q,mode:'insensitive' as const}},{client:{is:{firstName:{contains:q,mode:'insensitive' as const}}}},{client:{is:{lastName:{contains:q,mode:'insensitive' as const}}}},{client:{is:{ulcNumber:{contains:q,mode:'insensitive' as const}}}},{client:{is:{phone:{contains:q,mode:'insensitive' as const}}}}]}:{})};
    const [orders,total]=await Promise.all([this.prisma.order.findMany({where,take:100,orderBy:[{businessDate:'desc'},{createdAt:'desc'}],include:{client:{select:{id:true,firstName:true,lastName:true,ulcNumber:true,phone:true}},items:true,payments:{select:{status:true,amountDue:true}},reservation:{include:{mealRight:true}}}}),this.prisma.order.count({where})]);
    const data=orders.map(order=>{const paid=order.payments.filter(p=>p.status==='CONFIRMED').reduce((n,p)=>n.add(p.amountDue),new Prisma.Decimal(0));const remaining=order.totalAmount.sub(order.coveredAmount).sub(paid);return {...order,paidAmount:paid.toString(),remainingAmount:remaining.gt(0)?remaining.toString():'0'};});return {success:true,data:{orders:data,total},meta:{total}};
  }
  @Require('orders.manage') @Post('whatsapp') async createWhatsApp(@Body() input:unknown,@Headers('idempotency-key') key:string|undefined,@Req() req:AuthRequest){
    const body=z.object({subscriberId:uuid,businessDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),serviceCode:z.enum(['BREAKFAST','LUNCH','DINNER']),menuVersionId:uuid,items:z.array(z.object({productId:uuid,quantity:z.number().int().min(1).max(50),selections:z.record(z.array(uuid)).optional()}).strict()).min(1).max(30),note:z.string().trim().max(500).optional()}).strict().parse(input);
    return mutate(this.prisma,'whatsapp.orders.create',key,req.actor.id,body,async tx=>{
      const date=new Date(`${body.businessDate}T00:00:00.000Z`);if(!Number.isFinite(date.getTime())||body.businessDate<localDate())throw new DomainError('INVALID_BUSINESS_DATE','Date de service invalide ou passée.',400);
      await tx.$queryRaw`SELECT id FROM "MenuVersion" WHERE id=${body.menuVersionId}::uuid FOR UPDATE`;
      const subscriber=await tx.client.findUnique({where:{id:body.subscriberId},include:{category:true,subscriptions:{where:{startsOn:{lte:date},endsOn:{gte:date},status:{in:['ACTIVE','SCHEDULED']}},include:{planVersion:true,rights:{where:{businessDate:date,serviceCode:{in:[body.serviceCode,'MAIN']},status:'AVAILABLE'},take:1}},orderBy:{startsOn:'desc'}}}});
      if(!subscriber||subscriber.status!=='ACTIVE')throw new DomainError('SUBSCRIBER_INACTIVE','Abonné introuvable ou archivé.',409);
      const subscription=subscriber.subscriptions.find(s=>s.balance.lte(0)&&subscriptionLifecycleStatus(s.balance,s.startsOn,s.endsOn,date.toISOString().slice(0,10))==='ACTIVE');if(!subscription)throw new DomainError('SUBSCRIPTION_INVALID','Aucun abonnement actif et payé ne couvre cette date.',409);
      const snapshot=subscription.serviceSnapshot as {services?:unknown};const services=Array.isArray(snapshot.services)?snapshot.services.filter((x):x is string=>typeof x==='string'):[];if(!services.includes(body.serviceCode)&&!(['LUNCH','DINNER'].includes(body.serviceCode)&&services.includes('MAIN')))throw new DomainError('SERVICE_NOT_COVERED','Service non couvert par la formule.',409);
      const right=subscription.rights.find(x=>x.serviceCode===body.serviceCode)??subscription.rights.find(x=>x.serviceCode==='MAIN');if(!right)throw new DomainError('MEAL_RIGHT_UNAVAILABLE','Aucun droit disponible pour ce service à cette date.',409);
      const version=await tx.menuVersion.findUnique({where:{id:body.menuVersionId},include:{menu:true,items:{include:{product:{include:{optionGroups:{where:{active:true},orderBy:{position:'asc'},include:{options:{where:{active:true},orderBy:{position:'asc'},include:{linkedProduct:{include:{stockItem:true,prices:{where:{categoryCode:subscriber.category.code},include:{versions:{where:{currency:subscription.currency,status:'ACTIVE',effectiveFrom:{lte:new Date()}},orderBy:{effectiveFrom:'desc'},take:1}}}}}}}}},prices:{where:{categoryCode:subscriber.category.code},include:{versions:{where:{currency:subscription.currency,status:'ACTIVE',effectiveFrom:{lte:new Date()}},orderBy:{effectiveFrom:'desc'},take:1}}}}}}}}});
      if(!version||version.status!=='PUBLISHED'||version.menu.serviceCode!==body.serviceCode||version.menu.businessDate.toISOString().slice(0,10)!==body.businessDate)throw new DomainError('PUBLISHED_MENU_REQUIRED','Aucune version publiée ne correspond au service et à la date.',409);
      const coveredLines: Prisma.Decimal[]=[];
      let orderCurrency:'USD'|'CDF'|undefined;
      const lines=body.items.map(row=>{const item=version.items.find(x=>x.productId===row.productId);if(!item||!item.available||!item.product.active||!item.product.available||item.quantityAvailable-item.quantitySold-item.quantityReserved<row.quantity)throw new DomainError('MENU_ITEM_UNAVAILABLE','Article indisponible ou quantité insuffisante.',409);const snapshot=item.priceSnapshot as {categories?:Record<string,{amount:string;currency:string}>}|null;const price=snapshot?.categories?.[subscriber.category.code];if(!price)throw new DomainError('PRICE_UNAVAILABLE','Prix publié indisponible pour cet abonné.',409);if(price.currency!=='USD'&&price.currency!=='CDF')throw new DomainError('PRICE_UNAVAILABLE','Devise du prix publié invalide.',409);if(orderCurrency&&orderCurrency!==price.currency)throw new DomainError('MENU_CURRENCY_MISMATCH','Tous les articles d’une commande doivent utiliser la même devise.',409);orderCurrency=price.currency;const base=new Decimal(price.amount);const selected=row.selections??{};const extras:{id:string;name:string;quantity:number;unitPrice:string;linkedStock?:{stockMode:string;stockItemId:string|null;stockQuantity:string}}[]=[];for(const group of item.product.optionGroups){const ids=selected[group.id]??[];if(ids.length<Math.max(group.minSelections,group.required?1:0)||ids.length>group.maxSelections||ids.some(id=>!group.options.some(o=>o.id===id)))throw new DomainError('PRODUCT_OPTIONS_INVALID',`Options invalides pour ${group.name}.`,400);for(const option of group.options.filter(o=>ids.includes(o.id))){const linked=option.linkedProduct,linkedPrice=linked?.prices.flatMap(p=>p.versions)[0];const optionCurrency=linkedPrice?.currency??option.currency;if(optionCurrency!==price.currency)throw new DomainError('MENU_CURRENCY_MISMATCH','La devise d’une option ne correspond pas à celle du menu.',409);if(linked&&(!linked.active||!linked.available||(linked.stockMode==='DIRECT'&&(!linked.stockItem?.active||linked.stockItem.quantity.lt(linked.stockQuantity)))))throw new DomainError('PRODUCT_OPTION_OUT_OF_STOCK',`${linked.name} est indisponible.`,409);extras.push({id:option.id,name:option.name,quantity:1,unitPrice:(linkedPrice?.amount??option.priceDelta).toString(),linkedStock:linked?{stockMode:linked.stockMode,stockItemId:linked.stockItemId,stockQuantity:linked.stockQuantity.toString()}:undefined});}}if(Object.keys(selected).some(id=>!item.product.optionGroups.some(g=>g.id===id)))throw new DomainError('PRODUCT_OPTION_UNKNOWN','Groupe d’options inconnu.',400);const extra=extras.reduce((n,e)=>n.add(e.unitPrice),new Decimal(0));coveredLines.push(base.mul(row.quantity));return {productId:item.productId,quantity:new Decimal(row.quantity),unitPrice:base.add(extra),lineTotal:base.add(extra).mul(row.quantity),supplementsSnapshot:extras.length?extras:undefined,variantsSnapshot:Object.keys(selected).length?selected:undefined,productSnapshot:{name:(item.productSnapshot as {name?:string}|null)?.name??item.product.name,menuVersionId:version.id,stockMode:item.product.stockMode,stockItemId:item.product.stockItemId,stockQuantity:item.product.stockQuantity.toString()}};});
      const menuQuantities=new Map<string,number>();for(const row of body.items)menuQuantities.set(row.productId,(menuQuantities.get(row.productId)??0)+row.quantity);for(const [productId,quantity] of menuQuantities){const mi=version.items.find(i=>i.productId===productId)!;const changed=await tx.menuItem.updateMany({where:{menuVersionId:version.id,productId,available:true,quantityReserved:{lte:mi.quantityAvailable-mi.quantitySold-quantity}},data:{quantityReserved:{increment:quantity}}});if(changed.count!==1)throw new DomainError('MENU_ITEM_UNAVAILABLE','Quantité disponible insuffisante.',409);}
      await tx.$queryRaw`SELECT id FROM "MealRight" WHERE id=${right.id}::uuid FOR UPDATE`;
      const changed=await tx.mealRight.updateMany({where:{id:right.id,status:'AVAILABLE'},data:{status:'RESERVED',reservedAt:new Date()}});if(changed.count!==1)throw new DomainError('MEAL_RIGHT_UNAVAILABLE','Ce droit vient d’être réservé.',409);
      const total=lines.reduce((n,l)=>n.add(l.lineTotal),new Decimal(0));const covered=Prisma.Decimal.min(total,coveredLines.reduce((n,x)=>n.add(x),new Decimal(0)));const number=`WA-${body.businessDate.replaceAll('-','')}-${randomUUID().slice(0,8).toUpperCase()}`;
      const order=await tx.order.create({data:{number,clientId:subscriber.id,menuVersionId:version.id,mealRightId:right.id,serviceMode:'TAKEAWAY',status:'READY',sourceChannel:'WHATSAPP',serviceCode:body.serviceCode,createdById:req.actor.id,businessDate:date,totalAmount:total,commercialTotal:total,coveredAmount:covered,paymentRequired:false,currency:orderCurrency!,items:{create:lines},statusHistory:{create:{toStatus:'READY',actorId:req.actor.id,reason:body.note}},reservation:{create:{mealRightId:right.id,reservedById:req.actor.id}}}});
      await audit(tx,req.actor.id,'WHATSAPP_ORDER_CREATED','Order',order.id,{number,subscriberId:subscriber.id,serviceCode:body.serviceCode,businessDate:body.businessDate,mealRightId:right.id});return order;
    }).then(data=>({success:true,data}));
  }
  @RequireAny('sales.create','orders.manage')
  @Get('subscriber-search')
  async subscriberSearch(@Query('q') raw: string | undefined, @Query('page') rawPage: string | undefined) {
    const q = (raw ?? '').trim();
    if (q.length < 2) return { success: true, data: [] };
    const page = Math.max(1, Math.min(1000, Number.parseInt(rawPage ?? '1', 10) || 1));
    const words = q.split(/\s+/).filter(Boolean);
    const nameTerms = words.length > 1
      ? [
          { AND: [{ firstName: { contains: words[0], mode: 'insensitive' as const } }, { lastName: { contains: words.slice(1).join(' '), mode: 'insensitive' as const } }] },
          { AND: [{ lastName: { contains: words[0], mode: 'insensitive' as const } }, { firstName: { contains: words.slice(1).join(' '), mode: 'insensitive' as const } }] },
        ]
      : [{ firstName: { contains: q, mode: 'insensitive' as const } }, { lastName: { contains: q, mode: 'insensitive' as const } }];
    const today = new Date(localDate());
    const readyOrders = await this.prisma.order.findMany({
      where: { sourceChannel: 'WHATSAPP', status: 'READY', businessDate: today, clientId: { not: null } },
      select: { clientId: true },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    const pickupIds = new Set(readyOrders.flatMap(order => order.clientId ? [order.clientId] : []));
    const searchWhere = {
      archivedAt: null,
      OR: [...nameTerms, { ulcNumber: { contains: q, mode: 'insensitive' as const } }, { phone: { contains: q } }],
    };
    const pickupClientIds = [...pickupIds];
    const activeSubscriptions = await this.prisma.subscription.findMany({
      where: { status: 'ACTIVE', startsOn: { lte: today }, endsOn: { gte: today }, balance: { lte: 0 } },
      select: { clientId: true }, take: 500,
    });
    const activeClientIds = [...new Set(activeSubscriptions.map(subscription => subscription.clientId))];
    const prioritizedCandidates = [...new Set([...pickupClientIds, ...activeClientIds])];
    const matchingPriorityRows = prioritizedCandidates.length
      ? await this.prisma.client.findMany({ where: { AND: [searchWhere, { id: { in: prioritizedCandidates } }] }, select: { id: true, firstName: true, lastName: true }, take: 500 })
      : [];
    const prioritizedIds = matchingPriorityRows.sort((a, b) => Number(pickupIds.has(b.id)) - Number(pickupIds.has(a.id))
      || Number(activeClientIds.includes(b.id)) - Number(activeClientIds.includes(a.id))
      || a.lastName.localeCompare(b.lastName, 'fr') || a.firstName.localeCompare(b.firstName, 'fr')).map(client => client.id);
    const pickupOffset = (page - 1) * 10;
    const prioritizedPageIds = prioritizedIds.slice(pickupOffset, pickupOffset + 10);
    const ordinaryPageSize = Math.max(0, 10 - prioritizedPageIds.length);
    const ordinaryOffset = Math.max(0, pickupOffset - prioritizedIds.length);
    const select = {
        id: true, firstName: true, lastName: true, ulcNumber: true, phone: true,
        category: { select: { code: true, label: true } },
        subscriptions: {
          orderBy: { startsOn: 'desc' }, take: 3,
          select: { id: true, status: true, startsOn: true, endsOn: true, balance: true, planVersion: { select: { plan: { select: { name: true } } } } },
        },
      } as const;
    const [priorityRows, ordinaryRows] = await Promise.all([
      prioritizedPageIds.length ? this.prisma.client.findMany({ where: { id: { in: prioritizedPageIds } }, select, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] }) : [],
      ordinaryPageSize ? this.prisma.client.findMany({ where: { AND: [searchWhere, { id: { notIn: prioritizedIds } }] }, take: ordinaryPageSize, skip: ordinaryOffset, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }], select }) : [],
    ]);
    const rows = [...priorityRows, ...ordinaryRows];
    const data = rows.map(({ subscriptions, ...client }) => ({
      ...client,
      hasPickupToday: pickupIds.has(client.id),
      subscriptions: subscriptions.map(subscription => ({
        id: subscription.id,
        status: subscription.status === 'SUSPENDED' || subscription.status === 'CANCELLED'
          ? subscription.status
          : subscriptionLifecycleStatus(subscription.balance, subscription.startsOn, subscription.endsOn),
        startsOn: subscription.startsOn,
        endsOn: subscription.endsOn,
        planName: subscription.planVersion.plan.name,
      })),
    })).sort((a, b) => Number(b.hasPickupToday) - Number(a.hasPickupToday)
      || Number(b.subscriptions.some(subscription => subscription.status === 'ACTIVE')) - Number(a.subscriptions.some(subscription => subscription.status === 'ACTIVE'))
      || a.lastName.localeCompare(b.lastName, 'fr') || a.firstName.localeCompare(b.firstName, 'fr'));
    return { success: true, data };
  }
  @Require('sales.create')
  @Post(':id/extras')
  addPickupExtras(@Param('id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: string | undefined, @Req() req: AuthRequest) {
    return this.orders.addPickupExtras(id, body, key, req.actor.id).then(data => ({ success: true, data }));
  }
  @Require('sales.create') @Post(':id/handover') async handover(@Param('id') id:string,@Body() input:unknown,@Headers('idempotency-key') key:string|undefined,@Req() req:AuthRequest){
    uuid.parse(id);const {cashSessionId}=z.object({cashSessionId:uuid}).strict().parse(input);
    const posOrder = await this.prisma.order.findUnique({ where: { id }, select: { sourceChannel: true, clientId: true } });
    if (posOrder?.sourceChannel === 'POS' && posOrder.clientId) {
      const result = await this.orders.handoverPos(id, cashSessionId, key, req.actor.id);
      return { success: true, data: result };
    }
    const result=await mutate(this.prisma,'orders.handover',key,req.actor.id,{id,cashSessionId},async tx=>{await lockOrder(tx,id);await lockCash(tx,cashSessionId,req.actor.id);const order=await tx.order.findUnique({where:{id},include:{payments:true,reservation:true,items:true,client:{include:{category:true}},cashier:{select:{firstName:true,lastName:true}}}});if(order?.status==='SERVED'&&order.handoverAt)throw new DomainError('ORDER_ALREADY_SERVED',`REPAS DÉJÀ REMIS · ${new Intl.DateTimeFormat('fr-CD',{dateStyle:'short',timeStyle:'short',timeZone:'Africa/Kinshasa'}).format(order.handoverAt)} · Caissier : ${order.cashier?`${order.cashier.firstName} ${order.cashier.lastName}`:'inconnu'}.`,409);if(!order||order.sourceChannel!=='WHATSAPP'||order.status!=='READY')throw new DomainError('ORDER_NOT_READY','Commande non disponible au retrait.',409);if(order.payments.some(p=>p.status==='PENDING'))throw new DomainError('PAYMENT_PENDING','Un paiement de supplément attend confirmation.',409);const paid=order.payments.filter(p=>p.status==='CONFIRMED').reduce((n,p)=>n.add(p.amountDue),new Decimal(0));if(order.totalAmount.sub(order.coveredAmount).sub(paid).gt(0))throw new DomainError('PAYMENT_REQUIRED','Encaissez les extras avant la remise.',409);if(!order.reservation)throw new DomainError('MEAL_RIGHT_UNAVAILABLE','Réservation du droit introuvable.',409);const right=await tx.mealRight.findUniqueOrThrow({where:{id:order.reservation.mealRightId}});if(right.status==='CONSUMED')throw new DomainError('MEAL_RIGHT_CONSUMED','Droit déjà consommé aujourd’hui.',409);if(right.status!=='RESERVED')throw new DomainError('MEAL_RIGHT_UNAVAILABLE','Droit non réservé ou indisponible.',409);const sub=await tx.subscription.findUniqueOrThrow({where:{id:right.subscriptionId},include:{planVersion:true}});const businessDay=new Date(`${order.businessDate.toISOString().slice(0,10)}T00:00:00.000Z`);if(sub.clientId!==order.clientId)throw new DomainError('SUBSCRIBER_MISMATCH','Le droit ne correspond pas à cet abonné.',409);if(sub.status==='SUSPENDED')throw new DomainError('SUBSCRIPTION_SUSPENDED','Abonnement suspendu.',409);if(sub.status==='CANCELLED')throw new DomainError('SUBSCRIPTION_CANCELLED','Abonnement annulé.',409);if(sub.balance.gt(0))throw new DomainError('SUBSCRIPTION_PAYMENT_BLOCKING','Paiement de l’abonnement requis avant le retrait.',409);if(sub.startsOn>businessDay)throw new DomainError('SUBSCRIPTION_SCHEDULED','Abonnement planifié : la période n’a pas commencé.',409);if(sub.endsOn<businessDay)throw new DomainError('SUBSCRIPTION_EXPIRED','Abonnement expiré.',409);if(order.serviceCode&&Array.isArray(sub.planVersion.services)&&!sub.planVersion.services.includes(order.serviceCode)&&!(['LUNCH','DINNER'].includes(order.serviceCode)&&sub.planVersion.services.includes('MAIN')))throw new DomainError('SERVICE_NOT_COVERED',`Cette formule ne couvre pas le service ${order.serviceCode}.`,409);if(sub.status!=='ACTIVE')throw new DomainError('SUBSCRIPTION_NOT_ACTIVE','Abonnement non actif.',409);await consumeReservedMealRight(tx,{mealRightId:order.reservation.mealRightId,orderId:id,actorId:req.actor.id,idempotencyKey:key!});const qtys=new Map<string,number>();for(const line of order.items){const snapshot=line.productSnapshot as {menuVersionId?:string};if(snapshot.menuVersionId===order.menuVersionId&&line.productId)qtys.set(line.productId,(qtys.get(line.productId)??0)+Math.ceil(Number(line.quantity)));}for(const [productId,quantity] of qtys){const changed=await tx.menuItem.updateMany({where:{menuVersionId:order.menuVersionId!,productId,quantityReserved:{gte:quantity}},data:{quantityReserved:{decrement:quantity},quantitySold:{increment:quantity}}});if(changed.count!==1)throw new DomainError('MENU_RESERVATION_MISSING','La réservation du menu est absente.',409);}const handedAt=new Date();const stockTotals=new Map<string,Prisma.Decimal>();for(const line of order.items){const productSnapshot=line.productSnapshot as {stockMode?:string;stockItemId?:string;stockQuantity?:string};if(productSnapshot.stockMode==='DIRECT'&&productSnapshot.stockItemId&&productSnapshot.stockQuantity)stockTotals.set(productSnapshot.stockItemId,(stockTotals.get(productSnapshot.stockItemId)??new Decimal(0)).add(line.quantity.mul(productSnapshot.stockQuantity)));const extras=Array.isArray(line.supplementsSnapshot)?line.supplementsSnapshot as {quantity?:number;linkedStock?:{stockMode?:string;stockItemId?:string|null;stockQuantity?:string}}[]:[];for(const extra of extras){const linked=extra.linkedStock;if(linked?.stockMode==='DIRECT'&&linked.stockItemId&&linked.stockQuantity)stockTotals.set(linked.stockItemId,(stockTotals.get(linked.stockItemId)??new Decimal(0)).add(line.quantity.mul(extra.quantity??1).mul(linked.stockQuantity)));}}for(const [stockId,quantity] of [...stockTotals].sort(([a],[b])=>a.localeCompare(b)))await move(tx,stockId,quantity.negated(),'DIRECT_SALE',id,`Retrait abonné : ${order.number}`,req.actor.id);await tx.order.update({where:{id},data:{status:'SERVED',cashierId:req.actor.id,handoverAt:handedAt,statusHistory:{create:{fromStatus:'READY',toStatus:'SERVED',actorId:req.actor.id}}}});await audit(tx,req.actor.id,'ORDER_HANDED_OVER','Order',id,{cashierId:req.actor.id,handoverAt:handedAt.toISOString(),amountDue:'0'});return {id,number:order.number,status:'SERVED',receiptUrl:`/orders/${id}/receipt`};});return {success:true,data:result};
  }
  @Require('sales.create') @Get('ready-for-pickup') async clientOrdersToCollect(@Query() query: unknown) {
    const { q = '', page = 1, limit = 50 } = z.object({ q: z.string().trim().max(120).optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(query);
    const words = q.split(/\s+/).filter(Boolean);
    const clientNameTerms = words.length > 1 ? [
      { AND: [{ firstName: { contains: words[0], mode: 'insensitive' as const } }, { lastName: { contains: words.slice(1).join(' '), mode: 'insensitive' as const } }] },
      { AND: [{ lastName: { contains: words[0], mode: 'insensitive' as const } }, { firstName: { contains: words.slice(1).join(' '), mode: 'insensitive' as const } }] },
    ] : [
      { firstName: { contains: q, mode: 'insensitive' as const } },
      { lastName: { contains: q, mode: 'insensitive' as const } },
    ];
    const where = {
      sourceChannel: 'WHATSAPP' as const,
      clientId: { not: null },
      status: 'READY' as const,
      ...(q ? { OR: [
        { number: { contains: q, mode: 'insensitive' as const } },
        ...clientNameTerms.map(term => ({ client: { is: term } })),
        { client: { is: { ulcNumber: { contains: q, mode: 'insensitive' as const } } } },
        { client: { is: { phone: { contains: q, mode: 'insensitive' as const } } } },
      ] } : {}),
    };
    const [orders,total] = await Promise.all([this.prisma.order.findMany({ where, take: limit, skip: (page - 1) * limit, orderBy: { createdAt: 'asc' }, include: {
      client: { select: { firstName: true, lastName: true, ulcNumber: true, phone: true, category: { select: { code: true, label: true } } } },
      items: { select: { id: true, quantity: true, lineTotal: true, productSnapshot: true, variantsSnapshot: true, supplementsSnapshot: true } },
      payments: { select: { id: true, status: true, method: true, amountDue: true } },
    } }),this.prisma.order.count({where})]);
    const data = orders.map(order => {
      const paid = order.payments.filter(payment => payment.status === 'CONFIRMED').reduce((sum, payment) => sum.add(payment.amountDue), new Prisma.Decimal(0));
      const pending = order.payments.find(payment => payment.status === 'PENDING') ?? null;
      const remaining=order.totalAmount.sub(order.coveredAmount).sub(paid);
      return { ...order, paidAmount: paid.toString(), remainingAmount: remaining.gt(0)?remaining.toString():'0', pendingPayment: pending };
    });
    return { success: true, data: { orders: data, total } };
  }
  @RequireAny('sales.read','reports.read','orders.manage') @Get('supervision') async supervision(@Query() raw: unknown) {
    const query = z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(25),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      q: z.string().trim().max(100).optional(),
      status: z.enum(['RECEIVED','CONFIRMED','READY','SERVED','CANCELLED']).optional(),
      sourceChannel: z.enum(['POS','WHATSAPP']).optional(),
      customerType: z.enum(['SUBSCRIBER','ANONYMOUS']).optional(),
      serviceCode: z.enum(['BREAKFAST','LUNCH','DINNER']).optional(),
      paymentMethod: z.enum(['CASH','MPESA','ORANGE_MONEY','AIRTEL_MONEY','CARD','TRANSFER']).optional(),
      cashierId: uuid.optional(),
      cashSessionId: uuid.optional(),
    }).strict().parse(raw);
    if (query.from && query.to && query.from > query.to) throw new DomainError('INVALID_DATE_RANGE', 'La date de début doit précéder la date de fin.', 400);
    const from = query.from ?? localDate();
    const to = query.to ?? from;
    const where: Prisma.OrderWhereInput = {
      createdAt: { gte: new Date(`${from}T00:00:00+01:00`), lte: new Date(`${to}T23:59:59.999+01:00`) },
      ...(query.status ? { status: query.status } : {}),
      ...(query.sourceChannel ? { sourceChannel: query.sourceChannel } : {}),
      ...(query.customerType === 'SUBSCRIBER' ? { clientId: { not: null } } : query.customerType === 'ANONYMOUS' ? { clientId: null } : {}),
      ...(query.serviceCode ? { serviceCode: query.serviceCode } : {}),
      ...(query.cashierId ? { cashierId: query.cashierId } : {}),
      ...(query.paymentMethod || query.cashSessionId ? { payments: { some: { ...(query.paymentMethod ? { method: query.paymentMethod } : {}), ...(query.cashSessionId ? { cashSessionId: query.cashSessionId } : {}) } } } : {}),
      ...(query.q ? { OR: [ { number: { contains: query.q, mode: 'insensitive' } }, { client: { is: { firstName: { contains: query.q, mode: 'insensitive' } } } }, { client: { is: { lastName: { contains: query.q, mode: 'insensitive' } } } }, { client: { is: { ulcNumber: { contains: query.q, mode: 'insensitive' } } } } ] } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({ where, take: query.limit, skip: (query.page - 1) * query.limit, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id:true,number:true,sourceChannel:true,status:true,businessDate:true,createdAt:true,totalAmount:true,coveredAmount:true,currency:true,cashierId:true,handoverAt:true,serviceCode:true,client:{select:{firstName:true,lastName:true,ulcNumber:true}},cashier:{select:{firstName:true,lastName:true,username:true}},items:{select:{productSnapshot:true,quantity:true}},payments:{where:{status:{in:['CONFIRMED','PENDING']}},select:{method:true,amountDue:true,status:true,cashSessionId:true,confirmedAt:true,cashSession:{select:{cashRegister:{select:{code:true,label:true}}}}}}} }),
      this.prisma.order.count({ where }),
    ]);
    return { success:true, data:{orders:data,total}, meta:{page:query.page,limit:query.limit,total} };
  }
  @RequireAny('sales.read','reports.read','orders.manage') @Get('supervision-filters') async supervisionFilters() {
    const [cashiers, sessions] = await Promise.all([
      this.prisma.user.findMany({ where: { cashierOrders: { some: {} } }, select: { id:true, firstName:true, lastName:true, username:true }, orderBy: [{lastName:'asc'},{firstName:'asc'}] }),
      this.prisma.cashSession.findMany({ where: { payments: { some: {} } }, take: 200, orderBy: { openedAt:'desc' }, select: { id:true, openedAt:true, cashierId:true, cashRegister:{select:{code:true,label:true}} } }),
    ]);
    return { success:true, data:{cashiers,sessions} };
  }
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
    if (!order || !((order.sourceChannel === 'WHATSAPP' && order.status === 'READY') || (order.sourceChannel === 'POS' && order.status === 'RECEIVED' && order.paymentRequired))) throw new DomainError('ORDER_NOT_PAYABLE', 'Cette commande ne peut plus recevoir de paiement.', 409);
    const remaining = order.totalAmount.sub(order.coveredAmount).sub(order.payments.filter(p => p.status === 'CONFIRMED').reduce((sum, p) => sum.add(p.amountDue), new Prisma.Decimal(0)));
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
  @RequireAny('sales.read','sales.create') @Get(':id/receipt') async receipt(@Param('id') id: string, @Query('duplicate') duplicateRaw: string | undefined, @Req() req: AuthRequest) {
    uuid.parse(id);
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        items: true,
        payments: { where: { status: 'CONFIRMED' } },
        client: { select: { firstName: true, lastName: true, ulcNumber: true, phone: true, category: { select: { code: true, label: true } } } },
        reservation: {
          include: {
            mealRight: {
              include: {
                subscription: {
                  include: { planVersion: { include: { plan: true } } },
                },
              },
            },
          },
        },
      },
    });
    if (!order || (!order.payments.length && !(order.status === 'SERVED' && order.handoverAt))) throw new DomainError('PAYMENT_NOT_CONFIRMED', 'Le reçu sera disponible après remise ou confirmation du paiement.');
    if (duplicateRaw !== undefined && duplicateRaw !== 'true') throw new DomainError('INVALID_RECEIPT_COPY', 'Le paramètre duplicate doit valoir true.', 400);
    if (duplicateRaw === 'true') await this.prisma.auditLog.create({ data: { actorId: req.actor.id, action: 'RECEIPT_REPRINTED', entityType: 'Order', entityId: id, newValue: { number: order.number } } });
    return { success: true, data: { ...order, subscriptionName: order.reservation?.mealRight.subscription.planVersion.plan.name ?? null, receiptCopy: duplicateRaw === 'true' ? 'DUPLICATA' : null } };
  }
}
