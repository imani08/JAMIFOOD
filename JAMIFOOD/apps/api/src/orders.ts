import { Body, Controller, Headers, Injectable, Param, Post } from '@nestjs/common';
import { confirmPaymentSchema, createOrderSchema } from '@jami/validation';
import { Currency, OrderStatus, PaymentStatus, Prisma, ServiceMode } from '@jami/database';
import { ORDER_TRANSITIONS } from '@jami/shared';
import { PrismaService } from './prisma.service';
import { DomainError } from './http';

const businessDate = () => new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kinshasa', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()));
const orderNumber = () => `CMD-${new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kinshasa', year: 'numeric' }).format(new Date())}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}
  async create(input: unknown, key?: string) {
    if (!key) throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'La clé d’idempotence est obligatoire.', 400);
    const data = createOrderSchema.parse(input); const requestHash = JSON.stringify(data);
    const cached = await this.prisma.idempotencyRecord.findUnique({ where: { scope_key: { scope: 'orders.create', key } } });
    if (cached) { if (cached.requestHash !== requestHash) throw new DomainError('IDEMPOTENCY_KEY_REUSED', 'Cette clé est déjà associée à une autre requête.'); return cached.responseBody; }
    return this.prisma.$transaction(async (tx) => {
      const products = await tx.product.findMany({ where: { id: { in: data.items.map((i) => i.productId) }, active: true }, include: { prices: { include: { versions: { where: { status: 'ACTIVE', effectiveFrom: { lte: new Date() }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }] }, orderBy: { effectiveFrom: 'desc' }, take: 1 } } } } });
      if (products.length !== new Set(data.items.map((i) => i.productId)).size) throw new DomainError('PRODUCT_UNAVAILABLE', 'Un ou plusieurs articles ne sont pas disponibles.', 400);
      const lines = data.items.map((item) => { const p = products.find((x) => x.id === item.productId)!; const price = p.prices.flatMap((x) => x.versions).find((x) => x.currency === data.currency); if (!price) throw new DomainError('PRICE_UNAVAILABLE', 'Le tarif de cet article n’est pas disponible dans cette devise.', 400); const q = new Prisma.Decimal(item.quantity); return { productId: p.id, quantity: q, unitPrice: price.amount, lineTotal: price.amount.mul(q), productSnapshot: { name: p.name, priceVersionId: price.id, currency: price.currency }, variantsSnapshot: item.variants, supplementsSnapshot: item.supplements }; });
      const total = lines.reduce((sum, line) => sum.add(line.lineTotal), new Prisma.Decimal(0));
      const order = await tx.order.create({ data: { number: orderNumber(), clientId: data.clientId, serviceMode: data.serviceMode as ServiceMode, status: 'RECEIVED', businessDate: businessDate(), paymentRequired: true, totalAmount: total, currency: data.currency as Currency, items: { create: lines }, statusHistory: { create: { toStatus: 'RECEIVED' } } }, include: { items: true } });
      await tx.auditLog.create({ data: { action: 'ORDER_CREATED', entityType: 'Order', entityId: order.id, newValue: { number: order.number, total: order.totalAmount.toString() } } });
      const response = { orderId: order.id, number: order.number, status: order.status, totalAmount: order.totalAmount.toString(), currency: order.currency };
      await tx.idempotencyRecord.create({ data: { scope: 'orders.create', key, requestHash, responseStatus: 201, responseBody: response, expiresAt: new Date(Date.now() + 86_400_000) } }); return response;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
  async pay(orderId: string, input: unknown, key?: string) {
    if (!key) throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'La clé d’idempotence est obligatoire.', 400); const body = confirmPaymentSchema.parse(input);
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } }); if (!order) throw new DomainError('NOT_FOUND', 'Commande introuvable.', 404);
      const existing = await tx.payment.findUnique({ where: { idempotencyKey: key } }); if (existing) return { paymentId: existing.id, status: existing.status, orderNumber: order.number };
      const isCash = body.method === 'CASH'; const status = isCash ? PaymentStatus.CONFIRMED : PaymentStatus.PENDING;
      const payment = await tx.payment.create({ data: { orderId, status, method: body.method, operator: body.method === 'CASH' ? undefined : body.method, referenceCurrency: order.currency, amountDue: order.totalAmount, receivedAmount: new Prisma.Decimal(body.receivedAmount), receivedCurrency: body.receivedCurrency as Currency, externalReference: body.externalReference, confirmedAt: isCash ? new Date() : undefined, idempotencyKey: key, references: body.externalReference ? { create: { operator: body.method, reference: body.externalReference } } : undefined } });
      if (isCash) await this.confirmPaidOrder(tx, order.id, payment.id);
      await tx.auditLog.create({ data: { action: isCash ? 'PAYMENT_CONFIRMED' : 'PAYMENT_PENDING', entityType: 'Payment', entityId: payment.id, newValue: { orderId, method: body.method, status } } });
      return { paymentId: payment.id, status: payment.status, orderNumber: order.number };
    });
  }
  async confirmExternal(paymentId: string) { return this.prisma.$transaction(async (tx) => { const payment = await tx.payment.findUnique({ where: { id: paymentId } }); if (!payment) throw new DomainError('NOT_FOUND', 'Paiement introuvable.', 404); if (payment.status === 'CONFIRMED') return payment; if (payment.status !== 'PENDING') throw new DomainError('PAYMENT_NOT_CONFIRMABLE', 'Ce paiement ne peut pas être confirmé.'); const confirmed = await tx.payment.update({ where: { id: paymentId }, data: { status: 'CONFIRMED', confirmedAt: new Date() } }); if (confirmed.orderId) await this.confirmPaidOrder(tx, confirmed.orderId, confirmed.id); return confirmed; }); }
  private async confirmPaidOrder(tx: Prisma.TransactionClient, orderId: string, paymentId: string) { const order = await tx.order.findUnique({ where: { id: orderId } }); if (!order || order.status !== 'RECEIVED') return; const number = `K-${order.number}`; await tx.order.update({ where: { id: orderId }, data: { status: 'CONFIRMED', statusHistory: { create: { fromStatus: 'RECEIVED', toStatus: 'CONFIRMED' } }, kitchenTicket: { create: { number, renderedSnapshot: { orderNumber: order.number, paymentStatus: 'CONFIRMED' } } } } }); await tx.auditLog.create({ data: { action: 'ORDER_CONFIRMED_AFTER_PAYMENT', entityType: 'Order', entityId: orderId, newValue: { paymentId, kitchenTicket: number } } }); }
  async transition(orderId: string, target: OrderStatus) { return this.prisma.$transaction(async (tx) => { const order = await tx.order.findUnique({ where: { id: orderId } }); if (!order) throw new DomainError('NOT_FOUND', 'Commande introuvable.', 404); if (order.status === 'SERVED' || order.status === 'DELIVERED') throw new DomainError('ORDER_ALREADY_SERVED', 'Cette commande a déjà été remise.', 409); if (!(ORDER_TRANSITIONS[order.status] as readonly string[]).includes(target)) throw new DomainError('INVALID_ORDER_TRANSITION', 'Transition de commande invalide.', 409); const updated = await tx.order.updateMany({ where: { id: orderId, status: order.status }, data: { status: target } }); if (updated.count !== 1) throw new DomainError('ORDER_ALREADY_SERVED', 'La commande a déjà été traitée.', 409); await tx.orderStatusHistory.create({ data: { orderId, fromStatus: order.status, toStatus: target } }); await tx.auditLog.create({ data: { action: 'ORDER_STATUS_CHANGED', entityType: 'Order', entityId: orderId, oldValue: { status: order.status }, newValue: { status: target } } }); return { orderId, status: target }; }); }
}
@Controller('orders')
export class OrdersController { constructor(private readonly orders: OrdersService) {} @Post() create(@Body() body: unknown, @Headers('idempotency-key') key?: string) { return this.orders.create(body, key).then((data) => ({ success: true, data })); } @Post(':id/payments') pay(@Param('id') id: string, @Body() body: unknown, @Headers('idempotency-key') key?: string) { return this.orders.pay(id, body, key).then((data) => ({ success: true, data })); } @Post(':id/status/:status') status(@Param('id') id: string, @Param('status') status: OrderStatus) { return this.orders.transition(id, status).then((data) => ({ success: true, data })); } @Post('payments/:paymentId/confirm') confirm(@Param('paymentId') id: string) { return this.orders.confirmExternal(id).then((data) => ({ success: true, data })); } }
