import { Body, Controller, Get, Headers, Param, Post, Query, Req } from '@nestjs/common';
import { Prisma } from '@jami/database';
import { currency, money, pageSchema, uuid } from '@jami/validation';
import { z } from 'zod';
import { AuthRequest, Require } from './auth';
import { PrismaService } from './prisma.service';
import { audit, lockCash, mutate, Tx } from './transaction';
import { DomainError } from './http';
import { localDate } from '@jami/shared';
const quantity = z.string().regex(/^\d{1,10}(\.\d{1,3})?$/).refine(x => Number(x) > 0);
const reason = z.string().trim().min(5).max(500);
export async function move(
  tx: Tx,
  id: string,
  delta: Prisma.Decimal,
  type: string,
  sourceId: string,
  why: string,
  actorId: string,
) {
  await tx.$queryRaw`
    SELECT id
    FROM "StockItem"
    WHERE id = ${id}::uuid
    FOR UPDATE
  `;

  const item =
    await tx.stockItem.findUnique({
      where: { id },
    });

  if (!item || !item.active) {
    throw new DomainError(
      'NOT_FOUND',
      'Article de stock introuvable.',
      404,
    );
  }

  if (
    !delta.eq(
      delta.toDecimalPlaces(3),
    )
  ) {
    throw new DomainError(
      'UNIT_PRECISION',
      'La quantité doit être exprimable à 0,001 unité près.',
    );
  }

  const nextQuantity =
    item.quantity.add(delta);

  if (nextQuantity.lt(0)) {
    throw new DomainError(
      'INSUFFICIENT_STOCK',
      `Stock insuffisant pour ${item.name}.`,
    );
  }

  const consumedLots: {
    lotId: string;
    batchNumber: string;
    quantity: string;
  }[] = [];

  // Une sortie doit aussi diminuer les lots.
  if (delta.lt(0)) {
    const trackedLots =
      await tx.stockLot.findMany({
        where: {
          stockItemId: id,

          quantity: {
            gt: 0,
          },
        },
      });
    const trackedQuantity = trackedLots.reduce((sum, lot) => sum.add(lot.quantity), new Prisma.Decimal(0));
    if (trackedQuantity.gt(item.quantity)) throw new DomainError('LOT_BALANCE_CONFLICT', 'Les lots dépassent le stock global. Un inventaire est nécessaire.');
    // Historical stock and positive adjustments may have no lot. This explicit
    // residual is usable after FEFO lots, never as a substitute for expired lots.
    const untrackedQuantity = item.quantity.sub(trackedQuantity);
    const today = new Date(localDate() + 'T00:00:00Z');
    const lots = trackedLots.filter(lot => lot.active && (type === 'LOSS' || type === 'INVENTORY' || !lot.expiresAt || lot.expiresAt >= today));

    /*
     * FEFO :
     * on consomme d'abord le lot qui
     * expire le plus tôt.
     * Les lots sans péremption passent
     * après les lots datés.
     */
    lots.sort((a, b) => {
      if (
        a.expiresAt &&
        b.expiresAt
      ) {
        const expiry =
          a.expiresAt.getTime() -
          b.expiresAt.getTime();

        if (expiry !== 0) {
          return expiry;
        }
      } else if (a.expiresAt) {
        return -1;
      } else if (b.expiresAt) {
        return 1;
      }

      return (
        a.receivedAt.getTime() -
        b.receivedAt.getTime()
      );
    });

    let remaining =
      delta.negated();


    for (const lot of lots) {
      if (remaining.lte(0)) {
        break;
      }

      /*
       * Le StockItem est déjà verrouillé.
       * Toutes les sorties passent par move(),
       * donc les consommations d'un même
       * article sont sérialisées.
       */
      const available =
        lot.quantity;

      const taken =
        available.lte(remaining)
          ? available
          : remaining;

      const newLotQuantity =
        available.sub(taken);

      await tx.stockLot.update({
        where: {
          id: lot.id,
        },

        data: {
          quantity:
            newLotQuantity,

          active:
            newLotQuantity.gt(0),
        },
      });

      consumedLots.push({
        lotId: lot.id,

        batchNumber:
          lot.batchNumber,

        quantity:
          taken.toString(),
      });

      remaining =
        remaining.sub(taken);
    }

    /*
     * Si cet article utilise déjà le suivi
     * par lots, on refuse une sortie qui
     * dépasserait la somme des lots actifs.
     *
     * Cela empêche le stock global et les
     * lots de devenir incohérents.
     */
    if (
      remaining.gt(untrackedQuantity)
    ) {
      throw new DomainError(
        'LOT_STOCK_INSUFFICIENT',
        `Les lots disponibles de ${item.name} ne couvrent pas la quantité demandée.`,
        409,
      );
    }
  }

  await tx.stockItem.update({
    where: { id },

    data: {
      quantity: {
        increment: delta,
      },
    },
  });

  const movement =
    await tx.stockMovement.create({
      data: {
        stockItemId: id,
        delta,
        type,
        sourceId,
        reason: why,
        actorId,
      },
    });

  await audit(
    tx,
    actorId,
    'STOCK_MOVEMENT',
    'StockMovement',
    movement.id,
    {
      type,

      delta:
        delta.toString(),

      stockItemId: id,

      sourceId,

      reason: why,

      consumedLots,
    },
  );
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
@Require('stock.read')
@Get('lots')
async lots() {
  return {
    success: true,

    data:
      await this.db.stockLot.findMany({
        where: {
          active: true,
          quantity: {
            gt: 0,
          },
        },

        orderBy: [
          {
            expiresAt: 'asc',
          },

          {
            receivedAt: 'asc',
          },
        ],

        include: {
          stockItem: {
            select: {
              id: true,
              code: true,
              name: true,
              unit: true,
            },
          },
        },
      }),
  };
}  @Require('stock.inventory') @Post('inventories') inventory(@Body() input: unknown, @Headers('idempotency-key') key: string | undefined, @Req() req: AuthRequest) {
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

  @Require('stock.read')
@Get('suppliers/:id/history')
async supplierHistory(
  @Param('id') id: string,
) {
  const supplierId = uuid.parse(id);

  const supplier =
    await this.db.supplier.findUnique({
      where: {
        id: supplierId,
      },
    });

  if (!supplier) {
    throw new DomainError(
      'SUPPLIER_NOT_FOUND',
      'Fournisseur introuvable.',
      404,
    );
  }

  const purchases =
    await this.db.purchase.findMany({
      where: {
        supplierId,
      },

      orderBy: {
        createdAt: 'desc',
      },

      include: {
        lines: {
          include: {
            stockItem: {
              select: {
                id: true,
                code: true,
                name: true,
                unit: true,
              },
            },
          },
        },

        receipts: {
          orderBy: {
            receivedAt: 'desc',
          },
        },

        payments: {
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

  const balances = purchases.reduce<
    Record<
      string,
      {
        total: number;
        paid: number;
        remaining: number;
      }
    >
  >((result, purchase) => {
    const currency =
      purchase.currency;

    if (!result[currency]) {
      result[currency] = {
        total: 0,
        paid: 0,
        remaining: 0,
      };
    }

    const amount =
      Number(purchase.amount);

    const paid =
      Number(
        purchase.paidAmount,
      );

    result[currency].total +=
      amount;

    result[currency].paid +=
      paid;

    result[
      currency
    ].remaining +=
      Math.max(
        0,
        amount - paid,
      );

    return result;
  }, {});

  return {
    success: true,

    data: {
      supplier,
      balances,
      purchases,
    },
  };
}

  @Require('stock.read')
@Get('purchases')
async purchases() {
  const data =
    await this.db.purchase.findMany({
      take: 100,

      orderBy: {
        createdAt: 'desc',
      },

      include: {
        supplier: true,

        lines: {
          include: {
            stockItem: {
              select: {
                id: true,
                code: true,
                name: true,
                unit: true,
              },
            },
          },
        },

        receipts: {
          orderBy: {
            receivedAt: 'desc',
          },
        },

        payments: {
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

  return {
    success: true,
    data,
  };
}
  @Require('stock.adjust')
@Post('purchases')
purchase(
  @Body() input: unknown,
  @Headers('idempotency-key')
  key: string | undefined,
  @Req() req: AuthRequest,
) {
  const body = z
    .object({
      supplierId: uuid,

      reference: z
        .string()
        .trim()
        .min(3)
        .max(80)
        .optional(),

      invoiceNumber: z
        .string()
        .trim()
        .min(1)
        .max(80)
        .optional(),

      invoiceDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),

      amount: money,

      currency,

      lines: z
        .array(
          z
            .object({
              stockItemId: uuid,
              orderedQuantity: quantity,
            })
            .strict(),
        )
        .min(1)
        .max(100),
    })
    .strict()
    .parse(input);

  const ids =
    body.lines.map(
      (line) =>
        line.stockItemId,
    );

  if (
    new Set(ids).size !==
    ids.length
  ) {
    throw new DomainError(
      'DUPLICATE_ITEM',
      'Un article ne peut apparaître qu’une seule fois dans le même achat.',
      400,
    );
  }

  return mutate(
    this.db,
    'purchase.create',
    key,
    req.actor.id,
    body,

    async (tx) => {
      const supplier =
        await tx.supplier.findUnique({
          where: {
            id: body.supplierId,
          },
        });

      if (!supplier) {
        throw new DomainError(
          'SUPPLIER_NOT_FOUND',
          'Fournisseur introuvable.',
          404,
        );
      }

      const items =
        await tx.stockItem.findMany({
          where: {
            id: {
              in: ids,
            },

            active: true,
          },
        });

      if (
        items.length !==
        ids.length
      ) {
        throw new DomainError(
          'STOCK_ITEM_INVALID',
          'Un ou plusieurs articles de stock sont introuvables ou inactifs.',
          400,
        );
      }

      const itemMap =
        new Map(
          items.map(
            (item) => [
              item.id,
              item,
            ],
          ),
        );

      const purchase =
        await tx.purchase.create({
          data: {
            supplierId:
              body.supplierId,

            ...(body.reference
              ? {
                  reference:
                    body.reference,
                }
              : {}),

            ...(body.invoiceNumber
              ? {
                  invoiceNumber:
                    body.invoiceNumber,
                }
              : {}),

            ...(body.invoiceDate
              ? {
                  invoiceDate:
                    new Date(
                      `${body.invoiceDate}T00:00:00+01:00`,
                    ),
                }
              : {}),

            amount:
              body.amount,

            currency:
              body.currency,

            lines: {
              create:
                body.lines.map(
                  (line) => ({
                    stockItemId:
                      line.stockItemId,

                    orderedQuantity:
                      line.orderedQuantity,

                    receivedQuantity:
                      '0',

                    unit:
                      itemMap.get(
                        line.stockItemId,
                      )!.unit,
                  }),
                ),
            },
          },

          include: {
            supplier: true,

            lines: {
              include: {
                stockItem: true,
              },
            },
          },
        });

      await audit(
        tx,
        req.actor.id,
        'PURCHASE_CREATED',
        'Purchase',
        purchase.id,
        {
          supplierId:
            body.supplierId,

          reference:
            body.reference ??
            null,

          amount:
            body.amount,

          currency:
            body.currency,

          lineCount:
            body.lines.length,
        },
      );

      return purchase;
    },
  ).then((data) => ({
    success: true,
    data,
  }));
}
@Require('stock.adjust')
@Post('receipts')
receive(
  @Body() input: unknown,
  @Headers('idempotency-key')
  key: string | undefined,
  @Req() req: AuthRequest,
) {
  const body = z
    .object({
      purchaseId: uuid,

      reference: z
        .string()
        .trim()
        .min(3)
        .max(80),

      lines: z
        .array(
          z
            .object({
              stockItemId: uuid,

              quantity,

              unit: z
                .string()
                .trim()
                .min(1)
                .max(30),

              batchNumber: z
                .string()
                .trim()
                .min(1)
                .max(80)
                .optional(),

              expiresAt: z
                .string()
                .regex(
                  /^\d{4}-\d{2}-\d{2}$/,
                  'Date de péremption invalide.',
                )
                .optional(),
            })
            .strict()
            .refine(
              (line) =>
                !line.expiresAt ||
                !!line.batchNumber,
              {
                message:
                  'Un numéro de lot est obligatoire lorsqu’une date de péremption est renseignée.',
                path: ['batchNumber'],
              },
            ),
        )
        .min(1)
        .max(100),
    })
    .strict()
    .parse(input);

  const ids = body.lines.map(
    (line) => line.stockItemId,
  );

  if (
    new Set(ids).size !== ids.length
  ) {
    throw new DomainError(
      'DUPLICATE_ITEM',
      'Regroupez les lignes du même article.',
      400,
    );
  }

  return mutate(
    this.db,
    'stock.receive',
    key,
    req.actor.id,
    body,

    async (tx) => {
      const purchase =
        await tx.purchase.findUnique({
          where: {
            id: body.purchaseId,
          },

          include: {
            lines: true,
          },
        });

      if (!purchase) {
        throw new DomainError(
          'PURCHASE_NOT_FOUND',
          'Achat fournisseur introuvable.',
          404,
        );
      }

      const receipt =
        await tx.goodsReceipt.create({
          data: {
            purchaseId:
              body.purchaseId,

            reference:
              body.reference,

            lines:
              body.lines,
          },
        });

      const sortedLines = [
        ...body.lines,
      ].sort((a, b) =>
        a.stockItemId.localeCompare(
          b.stockItemId,
        ),
      );

      for (const line of sortedLines) {
        /*
         * Verrouille la ligne de commande :
         * deux réceptions simultanées ne
         * peuvent pas dépasser la quantité
         * commandée.
         */
        await tx.$queryRaw`
          SELECT id
          FROM "PurchaseLine"
          WHERE "purchaseId" = ${body.purchaseId}::uuid
          AND "stockItemId" = ${line.stockItemId}::uuid
          FOR UPDATE
        `;

        const purchaseLine =
          await tx.purchaseLine.findUnique({
            where: {
              purchaseId_stockItemId: {
                purchaseId:
                  body.purchaseId,

                stockItemId:
                  line.stockItemId,
              },
            },
          });

        if (!purchaseLine) {
          throw new DomainError(
            'PURCHASE_LINE_NOT_FOUND',
            'Cet article ne fait pas partie de cet achat.',
            400,
          );
        }

        const item =
          await tx.stockItem.findUnique({
            where: {
              id: line.stockItemId,
            },

            include: {
              conversions: true,
            },
          });

        if (
          !item ||
          !item.active
        ) {
          throw new DomainError(
            'STOCK_ITEM_NOT_FOUND',
            'Article de stock introuvable ou inactif.',
            404,
          );
        }

        const factor =
          line.unit === item.unit
            ? new Prisma.Decimal(1)
            : item.conversions.find(
                (conversion) =>
                  conversion.fromUnit ===
                  line.unit,
              )?.factor;

        if (!factor) {
          throw new DomainError(
            'UNIT_CONVERSION_REQUIRED',
            `Une conversion explicite est requise pour ${item.name} depuis l’unité ${line.unit}.`,
            400,
          );
        }

        const baseQuantity =
          new Prisma.Decimal(
            line.quantity,
          )
            .mul(factor)
            .toDecimalPlaces(3);

        const remaining =
          purchaseLine
            .orderedQuantity
            .sub(
              purchaseLine
                .receivedQuantity,
            );

        if (remaining.lte(0)) {
          throw new DomainError(
            'PURCHASE_LINE_ALREADY_RECEIVED',
            `${item.name} a déjà été entièrement réceptionné.`,
            409,
          );
        }

        if (
          baseQuantity.gt(remaining)
        ) {
          throw new DomainError(
            'RECEIPT_EXCEEDS_ORDER',
            `Réception impossible pour ${item.name}. Restant à recevoir : ${remaining.toString()} ${item.unit}.`,
            409,
          );
        }

        /*
         * Augmente le stock une seule fois.
         */
        await move(
          tx,
          item.id,
          baseQuantity,
          'RECEIPT',
          receipt.id,
          `Réception ${body.reference}`,
          req.actor.id,
        );

        /*
         * Met à jour le cumul reçu.
         */
        await tx.purchaseLine.update({
          where: {
            id: purchaseLine.id,
          },

          data: {
            receivedQuantity: {
              increment:
                baseQuantity,
            },
          },
        });

        /*
         * Lot / péremption.
         */
        if (line.batchNumber) {
          await tx.$queryRaw`
            SELECT id
            FROM "StockLot"
            WHERE "stockItemId" = ${item.id}::uuid
            AND "batchNumber" = ${line.batchNumber}
            FOR UPDATE
          `;

          const existingLot =
            await tx.stockLot.findUnique({
              where: {
                stockItemId_batchNumber: {
                  stockItemId:
                    item.id,

                  batchNumber:
                    line.batchNumber,
                },
              },
            });

          const expirationDate =
            line.expiresAt
              ? new Date(
                  `${line.expiresAt}T00:00:00Z`,
                )
              : null;

          if (
            existingLot &&
            existingLot.expiresAt &&
            expirationDate &&
            existingLot.expiresAt.getTime() !==
              expirationDate.getTime()
          ) {
            throw new DomainError(
              'LOT_EXPIRY_MISMATCH',
              `Le lot ${line.batchNumber} existe déjà avec une autre date de péremption.`,
              409,
            );
          }

          if (existingLot) {
            await tx.stockLot.update({
              where: {
                id: existingLot.id,
              },

              data: {
                quantity: {
                  increment:
                    baseQuantity,
                },

                active: true,
              },
            });
          } else {
            await tx.stockLot.create({
              data: {
                stockItemId:
                  item.id,

                batchNumber:
                  line.batchNumber,

                quantity:
                  baseQuantity,

                expiresAt:
                  expirationDate,
              },
            });
          }
        }
      }

      const updatedLines =
        await tx.purchaseLine.findMany({
          where: {
            purchaseId:
              body.purchaseId,
          },

          include: {
            stockItem: {
              select: {
                name: true,
                unit: true,
              },
            },
          },
        });

      const complete =
        updatedLines.every(
          (line) =>
            line.receivedQuantity.gte(
              line.orderedQuantity,
            ),
        );

      await audit(
        tx,
        req.actor.id,
        'GOODS_RECEIVED',
        'GoodsReceipt',
        receipt.id,
        {
          purchaseId:
            body.purchaseId,

          reference:
            body.reference,

          complete,

          lines:
            updatedLines.map(
              (line) => ({
                stockItemId:
                  line.stockItemId,

                ordered:
                  line.orderedQuantity.toString(),

                received:
                  line.receivedQuantity.toString(),

                remaining:
                  line.orderedQuantity
                    .sub(
                      line.receivedQuantity,
                    )
                    .toString(),
              }),
            ),
        },
      );

      return {
        receipt,

        purchase: {
          id: purchase.id,

          status:
            complete
              ? 'RECEIVED'
              : 'PARTIAL',

          lines:
            updatedLines.map(
              (line) => ({
                id: line.id,

                stockItemId:
                  line.stockItemId,

                stockItem:
                  line.stockItem,

                orderedQuantity:
                  line.orderedQuantity,

                receivedQuantity:
                  line.receivedQuantity,

                remainingQuantity:
                  line.orderedQuantity.sub(
                    line.receivedQuantity,
                  ),
              }),
            ),
        },
      };
    },
  ).then((data) => ({
    success: true,
    data,
  }));
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
