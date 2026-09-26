import { Body, Controller, Get, Headers, Param, Post, Query, Req } from '@nestjs/common';
import { Prisma } from '@jami/database';
import { currency, money, pageSchema, uuid } from '@jami/validation';
import { z } from 'zod';
import { AuthRequest, Require } from './auth';
import { PrismaService } from './prisma.service';
import { audit, lockCash, mutate, Tx } from './transaction';
import { DomainError } from './http';
const quantity = z.string().regex(/^\d{1,10}(\.\d{1,3})?$/).refine(x => Number(x) > 0);
const reason = z.string().trim().min(5).max(500);
async function move(tx: Tx, id: string, delta: Prisma.Decimal, type: string, sourceId: string, why: string, actorId: string) {
  await tx.$queryRaw`SELECT id FROM "StockItem" WHERE id = ${id}::uuid FOR UPDATE`;
  const item = await tx.stockItem.findUnique({ where: { id } });
  if (!item || !item.active) throw new DomainError('NOT_FOUND', 'Article de stock introuvable.', 404);
  if (!delta.eq(delta.toDecimalPlaces(3))) throw new DomainError('UNIT_PRECISION', 'La quantité doit être exprimable à 0,001 unité près.');
  if (item.quantity.add(delta).lt(0)) throw new DomainError('INSUFFICIENT_STOCK', `Stock insuffisant pour ${item.name}.`);
  await tx.stockItem.update({ where: { id }, data: { quantity: { increment: delta } } });
  const movement = await tx.stockMovement.create({ data: { stockItemId: id, delta, type, sourceId, reason: why, actorId } });
  await audit(tx, actorId, 'STOCK_MOVEMENT', 'StockMovement', movement.id, { type, delta: delta.toString(), stockItemId: id });
}
@Controller('stock')
export class StockController {
  constructor(private readonly db: PrismaService) {}
  @Require('stock.read') @Get() async list(@Query() query: unknown) {
    const { page, limit, q } = pageSchema.parse(query); const where = q ? { name: { contains: q, mode: 'insensitive' as const } } : {};
    return { success: true, data: await this.db.stockItem.findMany({ where, take: limit, skip: (page-1)*limit, orderBy: { name: 'asc' }, include: { conversions: true } }), meta: { page, limit, total: await this.db.stockItem.count({ where }) } };
  }
  @Require('stock.adjust') @Post() create(@Body() input: unknown, @Headers('idempotency-key') key: string | undefined, @Req() req: AuthRequest) {
    const body = z.object({ code: z.string().min(2).max(40), name: z.string().min(2).max(100), unit: z.enum(['kg','litre','pièce']), alertThreshold: money }).strict().parse(input);
    return mutate(this.db, 'stock.create', key, req.actor.id, body, async tx => { const item = await tx.stockItem.create({ data: body }); await audit(tx, req.actor.id, 'STOCK_ITEM_CREATED', 'StockItem', item.id); return item; }).then(data => ({ success: true, data }));
  }
  @Require('stock.adjust') @Post(':id/conversions') conversion(@Param('id') id: string, @Body() input: unknown, @Headers('idempotency-key') key: string | undefined, @Req() req: AuthRequest) {
    uuid.parse(id); const body = z.object({ fromUnit: z.string().min(1).max(30), factor: quantity }).strict().parse(input);
    return mutate(this.db, 'stock.conversion', key, req.actor.id, { id, ...body }, async tx => { const result = await tx.unitConversion.create({ data: { stockItemId: id, ...body } }); await audit(tx, req.actor.id, 'UNIT_CONVERSION_CREATED', 'UnitConversion', result.id); return result; }).then(data => ({ success: true, data }));
  }
  @Require('stock.adjust') @Post(':id/movements') adjustment(@Param('id') id: string, @Body() input: unknown, @Headers('idempotency-key') key: string | undefined, @Req() req: AuthRequest) {
    uuid.parse(id); const body = z.object({ quantity, type: z.enum(['INITIAL','RETURN','LOSS','OUT']), reason }).strict().parse(input);
    return mutate(this.db, 'stock.adjust', key, req.actor.id, { id, ...body }, async tx => {
      await tx.$queryRaw`SELECT id FROM "StockItem" WHERE id = ${id}::uuid FOR UPDATE`;
      if (body.type === 'INITIAL' && await tx.stockMovement.count({ where: { stockItemId: id } })) throw new DomainError('INITIAL_STOCK_EXISTS', 'Le stock initial est déjà renseigné. Utilisez un inventaire.');
      await move(tx, id, new Prisma.Decimal(body.quantity).mul(['LOSS','OUT'].includes(body.type) ? -1 : 1), body.type, key!, body.reason, req.actor.id); return tx.stockItem.findUnique({ where: { id } });
    }).then(data => ({ success: true, data }));
  }
  @Require('stock.read') @Get('movements') async movements(@Query() query: unknown) { const { page, limit } = pageSchema.parse(query); return { success: true, data: await this.db.stockMovement.findMany({ take: limit, skip: (page-1)*limit, orderBy: { occurredAt: 'desc' }, include: { stockItem: { select: { name: true, unit: true } } } }) }; }
  @Require('stock.inventory') @Post('inventories') inventory(@Body() input: unknown, @Headers('idempotency-key') key: string | undefined, @Req() req: AuthRequest) {
    const body = z.object({ stockItemId: uuid, counted: money, reason }).strict().parse(input);
    return mutate(this.db, 'stock.inventory', key, req.actor.id, body, async tx => {
      await tx.$queryRaw`SELECT id FROM "StockItem" WHERE id = ${body.stockItemId}::uuid FOR UPDATE`;
      const item = await tx.stockItem.findUniqueOrThrow({ where: { id: body.stockItemId } });
      const inv = await tx.inventory.create({ data: { ...body, expected: item.quantity, createdById: req.actor.id } });
      await audit(tx, req.actor.id, 'INVENTORY_SUBMITTED', 'Inventory', inv.id); return inv;
    }).then(data => ({ success: true, data }));
  }
  @Require('stock.read') @Get('inventories') async inventories() { return { success: true, data: await this.db.inventory.findMany({ take: 100, orderBy: { createdAt: 'desc' } }) }; }
  @Require('stock.adjust') @Post('inventories/:id/validate') validateInventory(@Param('id') id: string, @Headers('idempotency-key') key: string | undefined, @Req() req: AuthRequest) {
    uuid.parse(id); return mutate(this.db, 'stock.inventory.validate', key, req.actor.id, { id }, async tx => {
      await tx.$queryRaw`SELECT id FROM "Inventory" WHERE id = ${id}::uuid FOR UPDATE`;
      const inv = await tx.inventory.findUniqueOrThrow({ where: { id } });
      if (inv.status !== 'PENDING') throw new DomainError('INVENTORY_VALIDATED', 'Inventaire déjà validé.');
      await tx.$queryRaw`SELECT id FROM "StockItem" WHERE id = ${inv.stockItemId}::uuid FOR UPDATE`;
      const item = await tx.stockItem.findUniqueOrThrow({ where: { id: inv.stockItemId } });
      if (!item.quantity.eq(inv.expected)) throw new DomainError('INVENTORY_STALE', 'Le stock a changé depuis le comptage. Recomptez avant validation.');
      await move(tx, item.id, inv.counted.sub(inv.expected), 'INVENTORY', id, inv.reason, req.actor.id);
      return tx.inventory.update({ where: { id }, data: { status: 'VALIDATED', validatedById: req.actor.id, validatedAt: new Date() } });
    }).then(data => ({ success: true, data }));
  }
  @Require('stock.read') @Get('suppliers') async suppliers() { return { success: true, data: await this.db.supplier.findMany({ take: 100, orderBy: { name: 'asc' } }) }; }
  @Require('stock.adjust') @Post('suppliers') supplier(@Body() input: unknown, @Headers('idempotency-key') key: string | undefined, @Req() req: AuthRequest) {
    const body = z.object({ name: z.string().min(2).max(100), phone: z.string().max(40).optional() }).strict().parse(input);
    return mutate(this.db, 'supplier.create', key, req.actor.id, body, async tx => { const s = await tx.supplier.create({ data: body }); await audit(tx, req.actor.id, 'SUPPLIER_CREATED', 'Supplier', s.id); return s; }).then(data => ({ success: true, data }));
  }
  @Require('stock.read') @Get('purchases') async purchases() { return { success: true, data: await this.db.purchase.findMany({ take: 100, orderBy: { createdAt: 'desc' }, include: { supplier: true, receipts: true } }) }; }
  @Require('stock.adjust') @Post('purchases') purchase(@Body() input: unknown, @Headers('idempotency-key') key: string | undefined, @Req() req: AuthRequest) {
    const body = z.object({ supplierId: uuid, amount: money, currency }).strict().parse(input);
    return mutate(this.db, 'purchase.create', key, req.actor.id, body, async tx => { const p = await tx.purchase.create({ data: body }); await audit(tx, req.actor.id, 'PURCHASE_CREATED', 'Purchase', p.id); return p; }).then(data => ({ success: true, data }));
  }
  @Require('stock.adjust') @Post('receipts') receive(@Body() input: unknown, @Headers('idempotency-key') key: string | undefined, @Req() req: AuthRequest) {
    const body = z.object({ purchaseId: uuid, reference: z.string().min(3).max(80), lines: z.array(z.object({ stockItemId: uuid, quantity, unit: z.string().min(1).max(30) }).strict()).min(1).max(100) }).strict().parse(input);
    return mutate(this.db, 'stock.receive', key, req.actor.id, body, async tx => {
      const receipt = await tx.goodsReceipt.create({ data: { purchaseId: body.purchaseId, reference: body.reference, lines: body.lines } });
      if (new Set(body.lines.map(l=>l.stockItemId)).size !== body.lines.length) throw new DomainError('DUPLICATE_ITEM', 'Regroupez les lignes du même article.', 400);
      for (const line of [...body.lines].sort((a,b)=>a.stockItemId.localeCompare(b.stockItemId))) {
        const item = await tx.stockItem.findUniqueOrThrow({ where: { id: line.stockItemId }, include: { conversions: true } });
        const factor = line.unit === item.unit ? new Prisma.Decimal(1) : item.conversions.find(c => c.fromUnit === line.unit)?.factor;
        if (!factor) throw new DomainError('UNIT_CONVERSION_REQUIRED', 'Une conversion explicite est requise pour cette unité.');
        await move(tx, item.id, new Prisma.Decimal(line.quantity).mul(factor), 'RECEIPT', receipt.id, 'Réception ' + body.reference, req.actor.id);
      }
      return receipt;
    }).then(data => ({ success: true, data }));
  }
  @Require('cash.expense') @Post('purchases/:id/payments') paySupplier(@Param('id') id: string, @Body() input: unknown, @Headers('idempotency-key') key: string | undefined, @Req() req: AuthRequest) {
    uuid.parse(id); const body = z.object({ cashSessionId: uuid, amount: money }).strict().parse(input);
    return mutate(this.db, 'supplier.pay', key, req.actor.id, { id, ...body }, async tx => {
      const session = await lockCash(tx, body.cashSessionId, req.actor.id);
      await tx.$queryRaw`SELECT id FROM "Purchase" WHERE id = ${id}::uuid FOR UPDATE`;
      const purchase = await tx.purchase.findUniqueOrThrow({ where: { id } }); const amount = new Prisma.Decimal(body.amount);
      if (amount.lte(0) || amount.gt(purchase.amount.sub(purchase.paidAmount))) throw new DomainError('INVALID_AMOUNT', 'Montant supérieur au solde ou invalide.');
      const moves = await tx.cashMovement.findMany({ where: { cashSessionId: session.id, currency: purchase.currency } });
      const available = moves.reduce((n,m)=>m.type==='CASH_IN'?n.add(m.amount):m.type==='CASH_OUT'?n.sub(m.amount):n, purchase.currency==='USD'?session.openingUsd:session.openingCdf);
      if (available.lt(amount)) throw new DomainError('INSUFFICIENT_CASH', 'Fonds insuffisant.');
      const payment = await tx.supplierPayment.create({ data: { purchaseId: id, amount, currency: purchase.currency, actorId: req.actor.id } });
      await tx.purchase.update({ where: { id }, data: { paidAmount: { increment: amount } } });
      await tx.cashMovement.create({ data: { cashSessionId: session.id, type: 'CASH_OUT', amount, currency: purchase.currency, sourceType: 'SUPPLIER_PAYMENT', sourceId: payment.id } });
      await audit(tx, req.actor.id, 'SUPPLIER_PAID', 'SupplierPayment', payment.id); return payment;
    }).then(data => ({ success: true, data }));
  }
  @Require('stock.read') @Get('recipes') async recipes() { return { success: true, data: await this.db.recipe.findMany({ take: 100, include: { versions: { include: { ingredients: true } } } }) }; }
  @Require('stock.adjust') @Post('recipes') recipe(@Body() input: unknown, @Headers('idempotency-key') key: string | undefined, @Req() req: AuthRequest) {
    const body = z.object({ name: z.string().min(2).max(100), yieldQuantity: quantity, ingredients: z.array(z.object({ stockItemId: uuid, quantity }).strict()).min(1).max(100) }).strict().parse(input);
    return mutate(this.db, 'recipe.create', key, req.actor.id, body, async tx => { const recipe = await tx.recipe.create({ data: { name: body.name, versions: { create: { version: 1, yieldQuantity: body.yieldQuantity, ingredients: { create: body.ingredients } } } }, include: { versions: true } }); await audit(tx, req.actor.id, 'RECIPE_CREATED', 'Recipe', recipe.id); return recipe; }).then(data => ({ success: true, data }));
  }
  @Require('stock.adjust') @Post('recipes/:id/validate') validateRecipe(@Param('id') id: string, @Headers('idempotency-key') key: string | undefined, @Req() req: AuthRequest) { uuid.parse(id); return mutate(this.db, 'recipe.validate', key, req.actor.id, { id }, async tx => { const v = await tx.recipeVersion.update({ where: { id }, data: { validated: true } }); await audit(tx, req.actor.id, 'RECIPE_VALIDATED', 'RecipeVersion', id); return v; }).then(data=>({success:true,data})); }
  @Require('stock.adjust') @Post('productions') produce(@Body() input: unknown, @Headers('idempotency-key') key: string | undefined, @Req() req: AuthRequest) {
    const body = z.object({ recipeVersionId: uuid, quantity }).strict().parse(input);
    return mutate(this.db, 'production.create', key, req.actor.id, body, async tx => {
      const recipe = await tx.recipeVersion.findUniqueOrThrow({ where: { id: body.recipeVersionId }, include: { ingredients: true } });
      if (!recipe.validated) throw new DomainError('RECIPE_NOT_VALIDATED', 'La recette doit être validée par la cuisine.');
      const production = await tx.production.create({ data: { ...body, actorId: req.actor.id } });
      for (const ingredient of [...recipe.ingredients].sort((a,b)=>a.stockItemId.localeCompare(b.stockItemId))) await move(tx, ingredient.stockItemId, ingredient.quantity.mul(body.quantity).div(recipe.yieldQuantity).negated(), 'PRODUCTION', production.id, 'Production validée', req.actor.id);
      return production;
    }).then(data=>({success:true,data}));
  }
}
