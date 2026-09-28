import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import ExcelJS from 'exceljs';
import type {Response} from './transport';

import { Prisma } from '@jami/database';
import {
  currency,
  money,
  pageSchema,
  uuid,
} from '@jami/validation';
import { z } from 'zod';

import { PrismaService } from './prisma.service';
import { AuthRequest, Require } from './auth';
import {
  audit,
  mutate,
  Tx,
} from './transaction';
import { DomainError } from './http';
import { localDate, serviceEndDate, serviceRightDates } from '@jami/shared';

const codeSchema = z
  .string()
  .trim()
  .min(2)
  .max(50)
  .regex(
    /^[A-Za-z0-9_-]+$/,
    'Utilisez uniquement lettres, chiffres, tiret ou underscore.',
  );

  const productImageSchema = z
  .string()
  .trim()
  .regex(
    /^\/api\/v1\/product-images\/[0-9a-f-]{36}\.(jpg|png|webp)$/i,
    'Une image valide du produit est obligatoire.',
  );

const productCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(150),
    categoryId: uuid,
    description: z.string().trim().max(1000).optional(),
    saleUnit: z.string().trim().min(1).max(50),
    baseComposition: z.string().trim().max(2000).optional(),
    optionsDescription: z.string().trim().max(2000).optional(),
    variantsDescription: z.string().trim().max(2000).optional(),
    imageUrl: productImageSchema,
  })
  .strict();

const productUpdateSchema = z
  .object({
    stockMode: z.enum(['PRODUCTION','DIRECT','NONE']).optional(),
    stockItemId: uuid.nullable().optional(),
    stockQuantity: z.string().regex(/^\d{1,10}(\.\d{1,3})?$/).refine(value=>Number(value)>0).optional(),
    name: z.string().trim().min(2).max(150).optional(),
    categoryId: uuid.optional(),
    description: z.string().trim().max(1000).optional(),
    saleUnit: z.string().trim().min(1).max(50).optional(),
    baseComposition: z.string().trim().max(2000).optional(),
    optionsDescription: z.string().trim().max(2000).optional(),
    variantsDescription: z.string().trim().max(2000).optional(),
    imageUrl: productImageSchema.optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    'Aucune modification fournie.',
  );

const productStateSchema = z
  .object({
    active: z.boolean().optional(),
    available: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.active !== undefined ||
      value.available !== undefined,
    'Indiquez un état à modifier.',
  );

const categoryCreateSchema = z
  .object({
    code: codeSchema,
    label: z.string().trim().min(2).max(100),
  })
  .strict();

const categoryUpdateSchema = z
  .object({
    label: z.string().trim().min(2).max(100).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    'Aucune modification fournie.',
  );

const priceSchema = z
  .object({
    categoryCode: codeSchema,
    amount: money,
    currency,
    effectiveFrom: z
      .string()
      .refine(
        (value) =>
          !Number.isNaN(Date.parse(value)),
        'Date de prise d’effet invalide.',
      ),
  })
  .strict();

const bulkPriceSchema = z
  .object({
    changes: z
      .array(
        priceSchema.extend({
          productId: uuid,
        }),
      )
      .min(1)
      .max(100),
  })
  .strict();

const commercialProductsQuery = pageSchema.extend({
  categoryId: uuid.optional(),
  state: z
    .enum([
      'ALL',
      'ACTIVE',
      'INACTIVE',
      'AVAILABLE',
      'UNAVAILABLE',
    ])
    .optional(),
});

const settingValueSchema = z.record(
  z.string(),
  z.unknown(),
);

const calendarSettingSchema = z.object({
  weekdays: z.array(z.number().int().min(1).max(5)).length(5).refine(days => [1, 2, 3, 4, 5].every(day => days.includes(day))),
  publicHolidays: z.literal('CD_LEGAL'),
  closures: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(date => {
    const parsed = new Date(`${date}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
  })).max(500),
}).strict();

const settingsRequiringConfiguration: Record<string, z.ZodTypeAny> = {
  calendrier: calendarSettingSchema,
  acompte: z.object({ enabled: z.boolean() }).passthrough(),
  flex: z.object({ enabled: z.boolean() }).passthrough(),
  report: z.object({ enabled: z.boolean() }).passthrough(),
  livraison: z.object({ enabled: z.boolean(), zones: z.array(z.object({ name: z.string().min(1), fee: z.number().nonnegative() })).optional() }).passthrough(),
  tpe: z.object({ mode: z.enum(['MANUAL', 'INTEGRATED']), provider: z.string().nullable(), realTerminalConnected: z.boolean() }).passthrough(),
};

const calendarSubscriptionSnapshotSchema = z.object({
  durationDays: z.number().int().min(1).max(366),
  eligibleDays: z.array(z.number().int().min(0).max(6)).min(1),
  services: z.array(z.enum(['BREAKFAST', 'LUNCH', 'DINNER', 'MAIN'])).min(1),
  quotaRules: z.object({
    serviceQuotas: z.record(z.enum(['BREAKFAST', 'LUNCH', 'DINNER', 'MAIN']), z.number().int().min(1).max(10)).optional(),
  }).passthrough(),
}).passthrough();

async function reconcileOpenSubscriptionsForCalendar(tx: Tx, closures: string[], actorId: string) {
  const today = localDate();
  const subscriptions = await tx.subscription.findMany({
    where: {
      status: { in: ['PENDING_PAYMENT', 'SCHEDULED', 'ACTIVE'] },
      endsOn: { gte: new Date(today) },
    },
    include: { rights: true },
    orderBy: [{ clientId: 'asc' }, { startsOn: 'asc' }],
  });

  const adjustments = subscriptions.map(subscription => {
    const snapshot = calendarSubscriptionSnapshotSchema.safeParse(subscription.serviceSnapshot);
    if (!snapshot.success) throw new DomainError('CALENDAR_SUBSCRIPTION_SNAPSHOT_INVALID', 'Un abonnement actif a un instantané incomplet; le calendrier ne peut pas être appliqué sans risque.', 409);
    const startsOn = subscription.startsOn.toISOString().slice(0, 10);
    const endsOn = serviceEndDate(startsOn, snapshot.data.durationDays, closures);
    const serviceDates = serviceRightDates(startsOn, endsOn, snapshot.data.eligibleDays, closures).filter(date => date >= today);
    const desired = serviceDates.flatMap(date => snapshot.data.services.flatMap(service => {
      const quota = snapshot.data.quotaRules.serviceQuotas?.[service] ?? 1;
      return Array.from({ length: quota }, (_, index) => ({
        businessDate: new Date(`${date}T00:00:00.000Z`),
        serviceCode: service,
        quotaGroup: quota === 1 ? service : `${service}:${index + 1}`,
      }));
    }));
    return { subscription, endsOn, desired };
  });

  const previousEndByClient = new Map<string, string>();
  for (const entry of adjustments) {
    const start = entry.subscription.startsOn.toISOString().slice(0, 10);
    const previousEnd = previousEndByClient.get(entry.subscription.clientId);
    if (previousEnd && start <= previousEnd) throw new DomainError('CALENDAR_SUBSCRIPTION_OVERLAP', 'Cette fermeture prolongerait un abonnement sur le suivant. Décalez d’abord la date de début du renouvellement concerné.', 409);
    previousEndByClient.set(entry.subscription.clientId, entry.endsOn);
  }

  let adjusted = 0;
  for (const { subscription, endsOn, desired } of adjustments) {
    const desiredKeys = new Set(desired.map(right => `${right.businessDate.toISOString().slice(0, 10)}|${right.serviceCode}|${right.quotaGroup}`));
    const futureRights = subscription.rights.filter(right => right.businessDate.toISOString().slice(0, 10) >= today);
    const invalidated = futureRights.filter(right => !desiredKeys.has(`${right.businessDate.toISOString().slice(0, 10)}|${right.serviceCode}|${right.quotaGroup}`));
    if (invalidated.some(right => right.status === 'RESERVED' || right.status === 'CONSUMED')) throw new DomainError('CALENDAR_RESERVED_RIGHT', 'Une fermeture touche un repas déjà réservé; annulez ou traitez cette réservation avant de valider le calendrier.', 409);

    const invalidatedIds = invalidated.filter(right => right.status === 'AVAILABLE').map(right => right.id);
    if (invalidatedIds.length) await tx.mealRight.updateMany({ where: { id: { in: invalidatedIds }, status: 'AVAILABLE' }, data: { status: 'CANCELLED' } });
    const restoredIds = futureRights.filter(right => right.status === 'CANCELLED' && desiredKeys.has(`${right.businessDate.toISOString().slice(0, 10)}|${right.serviceCode}|${right.quotaGroup}`)).map(right => right.id);
    if (restoredIds.length) await tx.mealRight.updateMany({ where: { id: { in: restoredIds }, status: 'CANCELLED' }, data: { status: 'AVAILABLE' } });
    await tx.mealRight.createMany({ data: desired.map(right => ({ ...right, subscriptionId: subscription.id })), skipDuplicates: true });

    const nextEndsOn = new Date(`${endsOn}T00:00:00.000Z`);
    if (subscription.endsOn.toISOString().slice(0, 10) !== endsOn) {
      await tx.subscription.update({ where: { id: subscription.id }, data: { endsOn: nextEndsOn } });
      await tx.auditLog.create({ data: {
        actorId,
        action: 'SUBSCRIPTION_CALENDAR_ADJUSTED',
        entityType: 'Subscription',
        entityId: subscription.id,
        oldValue: { endsOn: subscription.endsOn.toISOString().slice(0, 10) },
        newValue: { endsOn, reason: 'CALENDAR_VALIDATED' },
      } });
      adjusted++;
    }
  }
  return adjusted;
}

function jsonValue(
  value: unknown,
): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value),
  ) as Prisma.InputJsonValue;
}

function calculatedPriceStatus(
  version: {
    effectiveFrom: Date;
    effectiveTo: Date | null;
  },
) {
  const now = new Date();

  if (version.effectiveFrom > now) {
    return 'SCHEDULED';
  }

  if (
    version.effectiveTo &&
    version.effectiveTo <= now
  ) {
    return 'RETIRED';
  }

  return 'ACTIVE';
}

async function addPriceVersion(
  tx: Tx,
  input: {
    productId: string;
    categoryCode: string;
    amount: string;
    currency: 'USD' | 'CDF';
    effectiveFrom: string;
  },
  actorId: string,
) {
  await tx.$queryRaw`
    SELECT id
    FROM "Product"
    WHERE id = ${input.productId}::uuid
    FOR UPDATE
  `;

  const product = await tx.product.findUnique({
    where: {
      id: input.productId,
    },
  });

  if (!product) {
    throw new DomainError(
      'PRODUCT_NOT_FOUND',
      'Produit introuvable.',
      404,
    );
  }

  const clientCategory =
    await tx.clientCategory.findUnique({
      where: {
        code: input.categoryCode,
      },
    });

  if (
    !clientCategory ||
    !clientCategory.active
  ) {
    throw new DomainError(
      'CLIENT_CATEGORY_INVALID',
      'Cette catégorie de client est indisponible.',
      400,
    );
  }

  const productPrice =
    await tx.productPrice.upsert({
      where: {
        productId_categoryCode: {
          productId: input.productId,
          categoryCode: input.categoryCode,
        },
      },
      update: {},
      create: {
        productId: input.productId,
        categoryCode: input.categoryCode,
      },
    });

  await tx.$queryRaw`
    SELECT id
    FROM "ProductPrice"
    WHERE id = ${productPrice.id}::uuid
    FOR UPDATE
  `;

  const effectiveFrom = new Date(
    input.effectiveFrom,
  );

  const existing =
    await tx.priceVersion.findMany({
      where: {
        productPriceId: productPrice.id,
      },
      orderBy: {
        effectiveFrom: 'asc',
      },
    });

  const duplicateDate = existing.some(
    (version) =>
      version.effectiveFrom.getTime() ===
      effectiveFrom.getTime(),
  );

  if (duplicateDate) {
    throw new DomainError(
      'PRICE_DATE_ALREADY_EXISTS',
      'Une version tarifaire existe déjà à cette date de prise d’effet.',
      409,
    );
  }

  const previous = [...existing]
    .filter(
      (version) =>
        version.effectiveFrom <
        effectiveFrom,
    )
    .sort(
      (a, b) =>
        b.effectiveFrom.getTime() -
        a.effectiveFrom.getTime(),
    )[0];

  const next = existing
    .filter(
      (version) =>
        version.effectiveFrom >
        effectiveFrom,
    )
    .sort(
      (a, b) =>
        a.effectiveFrom.getTime() -
        b.effectiveFrom.getTime(),
    )[0];

  if (
    previous &&
    (!previous.effectiveTo ||
      previous.effectiveTo >
        effectiveFrom)
  ) {
    await tx.priceVersion.update({
      where: {
        id: previous.id,
      },
      data: {
        effectiveTo: effectiveFrom,
      },
    });
  }

  const lastVersion =
    existing.reduce(
      (max, item) =>
        Math.max(max, item.version),
      0,
    );

  const created =
    await tx.priceVersion.create({
      data: {
        productPriceId: productPrice.id,
        version: lastVersion + 1,
        amount: input.amount,
        currency: input.currency,
        effectiveFrom,
        effectiveTo:
          next?.effectiveFrom ?? null,
        status:
          effectiveFrom <= new Date()
            ? 'ACTIVE'
            : 'SCHEDULED',
        createdById: actorId,
      },
    });

  const now = new Date();

  await tx.priceVersion.updateMany({
    where: {
      productPriceId: productPrice.id,
      effectiveTo: {
        lte: now,
      },
    },
    data: {
      status: 'RETIRED',
    },
  });

  await tx.priceVersion.updateMany({
    where: {
      productPriceId: productPrice.id,
      effectiveFrom: {
        lte: now,
      },
      OR: [
        {
          effectiveTo: null,
        },
        {
          effectiveTo: {
            gt: now,
          },
        },
      ],
    },
    data: {
      status: 'ACTIVE',
    },
  });

  await tx.priceVersion.updateMany({
    where: {
      productPriceId: productPrice.id,
      effectiveFrom: {
        gt: now,
      },
    },
    data: {
      status: 'SCHEDULED',
    },
  });

  await tx.auditLog.create({
    data: {
      actorId,
      action: 'PRICE_CHANGED',
      entityType: 'PriceVersion',
      entityId: created.id,
      oldValue: previous
        ? {
            amount:
              previous.amount.toString(),
            currency: previous.currency,
            version: previous.version,
          }
        : {},
      newValue: {
        productId: input.productId,
        categoryCode:
          input.categoryCode,
        amount: input.amount,
        currency: input.currency,
        version: created.version,
        effectiveFrom:
          effectiveFrom.toISOString(),
      },
    },
  });

  return created;
}

@Controller()
export class CatalogController {
  constructor(
    private readonly db: PrismaService,
  ) {}

  // ============================================================
  // POS : catalogue vendable
  // ============================================================

  @Require('sales.create')
  @Get('products')
  async products(
    @Query('category')
    category = 'ETUDIANT_EXTERNE',
  ) {
    const now = new Date();

    const data =
      await this.db.product.findMany({
        where: {
          active: true,
          available: true,
          category: {
            active: true,
          },
        },
        take: 100,
        orderBy: {
          name: 'asc',
        },
        include: {
          category: true,
          prices: {
            where: {
              categoryCode: category,
            },
            include: {
              versions: {
                where: {
                  effectiveFrom: {
                    lte: now,
                  },
                  OR: [
                    {
                      effectiveTo: null,
                    },
                    {
                      effectiveTo: {
                        gt: now,
                      },
                    },
                  ],
                },
                orderBy: {
                  effectiveFrom: 'desc',
                },
                take: 1,
              },
            },
          },
        },
      });

    return {
      success: true,
      data,
    };
  }

  // ============================================================
  // CATÉGORIES PRODUITS
  // ============================================================

  @Require('pricing.read')
  @Get('commercial/product-categories')
  async productCategories() {
    return {
      success: true,
      data:
        await this.db.productCategory.findMany({
          orderBy: {
            label: 'asc',
          },
        }),
    };
  }

  @Require('pricing.update')
  @Post('commercial/product-categories')
  createProductCategory(
    @Body() input: unknown,
    @Headers('idempotency-key')
    key: string | undefined,
    @Req() req: AuthRequest,
  ) {
    const body =
      categoryCreateSchema.parse(input);

    return mutate(
      this.db,
      'product-category.create',
      key,
      req.actor.id,
      body,
      async (tx) => {
        const category =
          await tx.productCategory.create({
            data: {
              code: body.code.toUpperCase(),
              label: body.label,
            },
          });

        await audit(
          tx,
          req.actor.id,
          'PRODUCT_CATEGORY_CREATED',
          'ProductCategory',
          category.id,
          {
            code: category.code,
            label: category.label,
          },
        );

        return category;
      },
    ).then((data) => ({
      success: true,
      data,
    }));
  }

  @Require('pricing.update')
  @Post(
    'commercial/product-categories/:id',
  )
  updateProductCategory(
    @Param('id') id: string,
    @Body() input: unknown,
    @Headers('idempotency-key')
    key: string | undefined,
    @Req() req: AuthRequest,
  ) {
    uuid.parse(id);

    const body =
      categoryUpdateSchema.parse(input);

    return mutate(
      this.db,
      'product-category.update',
      key,
      req.actor.id,
      {
        id,
        ...body,
      },
      async (tx) => {
        const before =
          await tx.productCategory.findUnique({
            where: { id },
          });

        if (!before) {
          throw new DomainError(
            'NOT_FOUND',
            'Catégorie produit introuvable.',
            404,
          );
        }

        const after =
          await tx.productCategory.update({
            where: { id },
            data: body,
          });

        await tx.auditLog.create({
          data: {
            actorId: req.actor.id,
            action:
              'PRODUCT_CATEGORY_UPDATED',
            entityType: 'ProductCategory',
            entityId: id,
            oldValue: {
              label: before.label,
              active: before.active,
            },
            newValue: {
              label: after.label,
              active: after.active,
            },
          },
        });

        return after;
      },
    ).then((data) => ({
      success: true,
      data,
    }));
  }

  // ============================================================
  // CATÉGORIES CLIENTS
  // ============================================================

  @Require('pricing.read')
  @Get('commercial/client-categories')
  async clientCategories() {
    return {
      success: true,
      data:
        await this.db.clientCategory.findMany({
          orderBy: {
            label: 'asc',
          },
        }),
    };
  }

  @Require('clients.verify')
  @Get('client-accounts/pending')
  async pendingClientAccounts() {
    return { success: true, data: await this.db.clientAccount.findMany({ where: { verificationStatus: 'PENDING' }, orderBy: { createdAt: 'asc' }, take: 100, select: { id: true, type: true, createdAt: true, email: true, client: { select: { id: true, firstName: true, lastName: true, ulcNumber: true, faculty: true, promotion: true, residency: true, phone: true, category: { select: { label: true } } } } } }) };
  }

  @Require('clients.verify')
  @Post('client-accounts/:id/verification')
  async decideClientAccount(@Param('id') id: string, @Body() input: unknown, @Req() req: AuthRequest) {
    uuid.parse(id);
    const body = z.object({ decision: z.enum(['VERIFIED', 'REJECTED']), reason: z.string().trim().min(3).max(500) }).strict().parse(input);
    const account = await this.db.clientAccount.findUnique({ where: { id } });
    if (!account || account.verificationStatus !== 'PENDING') throw new DomainError('VERIFICATION_UNAVAILABLE', 'Cette demande ne peut plus être traitée.', 409);
    await this.db.$transaction(async tx => {
      await tx.clientAccount.update({ where: { id }, data: { verificationStatus: body.decision, verifiedAt: body.decision === 'VERIFIED' ? new Date() : null, verifiedById: req.actor.id } });
      await tx.auditLog.create({ data: { actorId: req.actor.id, action: `CLIENT_ACCOUNT_${body.decision}`, entityType: 'ClientAccount', entityId: id, oldValue: { verificationStatus: 'PENDING' }, newValue: { verificationStatus: body.decision, reason: body.reason }, metadata: { clientId: account.clientId } } });
      await tx.clientPortalEvent.create({ data: { accountId: id, action: `ACCOUNT_${body.decision}` } });
    });
    return { success: true, data: { verificationStatus: body.decision } };
  }

  @Require('pricing.update')
  @Post('commercial/client-categories')
  createClientCategory(
    @Body() input: unknown,
    @Headers('idempotency-key')
    key: string | undefined,
    @Req() req: AuthRequest,
  ) {
    const body =
      categoryCreateSchema.parse(input);

    return mutate(
      this.db,
      'client-category.create',
      key,
      req.actor.id,
      body,
      async (tx) => {
        const category =
          await tx.clientCategory.create({
            data: {
              code: body.code.toUpperCase(),
              label: body.label,
            },
          });

        await audit(
          tx,
          req.actor.id,
          'CLIENT_CATEGORY_CREATED',
          'ClientCategory',
          category.id,
          {
            code: category.code,
            label: category.label,
          },
        );

        return category;
      },
    ).then((data) => ({
      success: true,
      data,
    }));
  }

  @Require('pricing.update')
  @Post(
    'commercial/client-categories/:id',
  )
  updateClientCategory(
    @Param('id') id: string,
    @Body() input: unknown,
    @Headers('idempotency-key')
    key: string | undefined,
    @Req() req: AuthRequest,
  ) {
    uuid.parse(id);

    const body =
      categoryUpdateSchema.parse(input);

    return mutate(
      this.db,
      'client-category.update',
      key,
      req.actor.id,
      {
        id,
        ...body,
      },
      async (tx) => {
        const before =
          await tx.clientCategory.findUnique({
            where: { id },
          });

        if (!before) {
          throw new DomainError(
            'NOT_FOUND',
            'Catégorie client introuvable.',
            404,
          );
        }

        const after =
          await tx.clientCategory.update({
            where: { id },
            data: body,
          });

        await tx.auditLog.create({
          data: {
            actorId: req.actor.id,
            action:
              'CLIENT_CATEGORY_UPDATED',
            entityType: 'ClientCategory',
            entityId: id,
            oldValue: {
              label: before.label,
              active: before.active,
            },
            newValue: {
              label: after.label,
              active: after.active,
            },
          },
        });

        return after;
      },
    ).then((data) => ({
      success: true,
      data,
    }));
  }

  // ============================================================
  // PRODUITS BACK-OFFICE
  // ============================================================

  @Require('pricing.read')
  @Get('commercial/products')
  async commercialProducts(
    @Query() input: unknown,
  ) {
    const {
      page,
      limit,
      q,
      categoryId,
      state,
    } =
      commercialProductsQuery.parse(input);

    const where: Prisma.ProductWhereInput = {
      ...(q
        ? {
            OR: [
              {
                name: {
                  contains: q,
                  mode: 'insensitive',
                },
              },
              {
                sku: {
                  contains: q,
                  mode: 'insensitive',
                },
              },
            ],
          }
        : {}),
      ...(categoryId
        ? {
            categoryId,
          }
        : {}),
      ...(state === 'ACTIVE'
        ? { active: true }
        : {}),
      ...(state === 'INACTIVE'
        ? { active: false }
        : {}),
      ...(state === 'AVAILABLE'
        ? { available: true }
        : {}),
      ...(state === 'UNAVAILABLE'
        ? { available: false }
        : {}),
    };

    const [data, total] =
      await this.db.$transaction([
        this.db.product.findMany({
          where,
          take: limit,
          skip: (page - 1) * limit,
          orderBy: {
            name: 'asc',
          },
          include: {
            category: true,
            prices: {
              orderBy: {
                categoryCode: 'asc',
              },
              include: {
                versions: {
                  orderBy: {
                    effectiveFrom: 'desc',
                  },
                  take: 20,
                },
              },
            },
          },
        }),
        this.db.product.count({
          where,
        }),
      ]);

    return {
      success: true,
      data: data.map((product) => ({
        ...product,
        prices: product.prices.map(
          (price) => ({
            ...price,
            versions: price.versions.map(
              (version) => ({
                ...version,
                effectiveStatus:
                  calculatedPriceStatus(
                    version,
                  ),
              }),
            ),
          }),
        ),
      })),
      meta: {
        page,
        limit,
        total,
      },
    };
  }

  @Require('pricing.update')
  @Post('commercial/products')
  createProduct(
    @Body() input: unknown,
    @Headers('idempotency-key')
    key: string | undefined,
    @Req() req: AuthRequest,
  ) {
    const body =
      productCreateSchema.parse(input);

    return mutate(
      this.db,
      'product.create',
      key,
      req.actor.id,
      body,
      async (tx) => {
        await tx.$queryRaw`
  SELECT id
  FROM "ProductCategory"
  WHERE id = ${body.categoryId}::uuid
  FOR UPDATE
`;

const category =
  await tx.productCategory.findFirst({
    where: {
      id: body.categoryId,
      active: true,
    },
  });

if (!category) {
  throw new DomainError(
    'PRODUCT_CATEGORY_INVALID',
    'Catégorie produit indisponible.',
    400,
  );
}

const prefix = category.code.toUpperCase();
// Serialize generated SKU allocation for this category, including different
// idempotency keys, without rewriting existing product codes.
await tx.$queryRaw`SELECT id FROM "ProductCategory" WHERE id = ${category.id}::uuid FOR UPDATE`;

const existingProducts =
  await tx.product.findMany({
    where: {
      categoryId: category.id,
      sku: {
        startsWith: `${prefix}-`,
      },
    },
    select: {
      sku: true,
    },
  });

let highestNumber = 0;

for (const existing of existingProducts) {
  if (!existing.sku) {
    continue;
  }

  const suffix = existing.sku.slice(
    prefix.length + 1,
  );

  if (/^\d+$/.test(suffix)) {
    highestNumber = Math.max(
      highestNumber,
      Number(suffix),
    );
  }
}

const sku =
  `${prefix}-${String(
    highestNumber + 1,
  ).padStart(3, '0')}`;

const product =
  await tx.product.create({
    data: {
      ...body,
      sku,
    },
  });
        await audit(
          tx,
          req.actor.id,
          'PRODUCT_CREATED',
          'Product',
          product.id,
          {
            sku: product.sku,
            name: product.name,
            categoryId:
              product.categoryId,
          },
        );

        return product;
      },
    ).then((data) => ({
      success: true,
      data,
    }));
  }

  @Require('pricing.update')
  @Post('commercial/products/:id')
  updateProduct(
    @Param('id') id: string,
    @Body() input: unknown,
    @Headers('idempotency-key')
    key: string | undefined,
    @Req() req: AuthRequest,
  ) {
    uuid.parse(id);

    const body =
      productUpdateSchema.parse(input);

    return mutate(
      this.db,
      'product.update',
      key,
      req.actor.id,
      {
        id,
        ...body,
      },
      async (tx) => {
        const before =
          await tx.product.findUnique({
            where: { id },
          });

        if (!before) {
          throw new DomainError(
            'NOT_FOUND',
            'Produit introuvable.',
            404,
          );
        }

        const nextStockId=body.stockItemId===undefined?before.stockItemId:body.stockItemId;
        if((body.stockMode??before.stockMode)==='DIRECT' && !nextStockId)throw new DomainError('STOCK_ITEM_REQUIRED','Sélectionnez un article de stock pour la revente directe.',400);
        if (body.categoryId) {
          // Category validation remains independent from stock settings.
          const category =
            await tx.productCategory.findFirst({
              where: {
                id: body.categoryId,
                active: true,
              },
            });

          if (!category) {
            throw new DomainError(
              'PRODUCT_CATEGORY_INVALID',
              'Catégorie produit indisponible.',
              400,
            );
          }
        }

        const after =
  await tx.product.update({
    where: { id },
    data: body,
  });

        await tx.auditLog.create({
          data: {
            actorId: req.actor.id,
            action: 'PRODUCT_UPDATED',
            entityType: 'Product',
            entityId: id,
            oldValue: {
              sku: before.sku,
              imageUrl: before.imageUrl,
              name: before.name,
              categoryId:
                before.categoryId,
              description:
                before.description,
              saleUnit:
                before.saleUnit,
              baseComposition:
                before.baseComposition,
              optionsDescription:
                before.optionsDescription,
              variantsDescription:
                before.variantsDescription,
            },
            newValue: {
              sku: after.sku,
              imageUrl: after.imageUrl,
              name: after.name,
              categoryId:
                after.categoryId,
              description:
                after.description,
              saleUnit:
                after.saleUnit,
              baseComposition:
                after.baseComposition,
              optionsDescription:
                after.optionsDescription,
              variantsDescription:
                after.variantsDescription,
            },
          },
        });

        return after;
      },
    ).then((data) => ({
      success: true,
      data,
    }));
  }

  @Require('pricing.update')
  @Post(
    'commercial/products/:id/state',
  )
  changeProductState(
    @Param('id') id: string,
    @Body() input: unknown,
    @Headers('idempotency-key')
    key: string | undefined,
    @Req() req: AuthRequest,
  ) {
    uuid.parse(id);

    const body =
      productStateSchema.parse(input);

    return mutate(
      this.db,
      'product.state',
      key,
      req.actor.id,
      {
        id,
        ...body,
      },
      async (tx) => {
        const before =
          await tx.product.findUnique({
            where: { id },
          });

        if (!before) {
          throw new DomainError(
            'NOT_FOUND',
            'Produit introuvable.',
            404,
          );
        }

        const after =
          await tx.product.update({
            where: { id },
            data: body,
          });

        await tx.auditLog.create({
          data: {
            actorId: req.actor.id,
            action:
              'PRODUCT_STATE_CHANGED',
            entityType: 'Product',
            entityId: id,
            oldValue: {
              active: before.active,
              available:
                before.available,
            },
            newValue: {
              active: after.active,
              available:
                after.available,
            },
          },
        });

        return after;
      },
    ).then((data) => ({
      success: true,
      data,
    }));
  }

  // ============================================================
  // PRIX VERSIONNÉS
  // ============================================================

  @Require('pricing.update')
  @Post(
    'commercial/products/:id/prices',
  )
  addProductPrice(
    @Param('id') id: string,
    @Body() input: unknown,
    @Headers('idempotency-key')
    key: string | undefined,
    @Req() req: AuthRequest,
  ) {
    uuid.parse(id);

    const body = priceSchema.parse(input);

    return mutate(
      this.db,
      'price.create',
      key,
      req.actor.id,
      {
        productId: id,
        ...body,
      },
      async (tx) =>
        addPriceVersion(
          tx,
          {
            productId: id,
            ...body,
          },
          req.actor.id,
        ),
    ).then((data) => ({
      success: true,
      data,
    }));
  }

  @Require('pricing.update')
  @Post('commercial/prices/bulk')
  bulkPrices(
    @Body() input: unknown,
    @Headers('idempotency-key')
    key: string | undefined,
    @Req() req: AuthRequest,
  ) {
    const body =
      bulkPriceSchema.parse(input);

    return mutate(
      this.db,
      'price.bulk',
      key,
      req.actor.id,
      body,
      async (tx) => {
        const results = [];

        for (const change of body.changes) {
          results.push(
            await addPriceVersion(
              tx,
              change,
              req.actor.id,
            ),
          );
        }

        await audit(
          tx,
          req.actor.id,
          'PRICE_BULK_CHANGED',
          'PriceVersion',
          key ?? 'bulk',
          {
            count: results.length,
          },
        );

        return results;
      },
    ).then((data) => ({
      success: true,
      data,
    }));
  }

  // ============================================================
  // PARAMÈTRES COMMERCIAUX
  // ============================================================

  @Require('pricing.read')
  @Get('settings')
  async settings() {
    return {
      success: true,
      data:
        await this.db.setting.findMany({
          orderBy: {
            key: 'asc',
          },
        }),
    };
  }

  @Require('pricing.read')
  @Get('settings/:key/history')
  async settingHistory(
    @Param('key') key: string,
  ) {
    return {
      success: true,
      data:
        await this.db.settingHistory.findMany(
          {
            where: {
              settingKey: key,
            },
            orderBy: {
              changedAt: 'desc',
            },
            take: 100,
          },
        ),
    };
  }

  @Require('pricing.update')
  @Post('settings/:key')
  updateSetting(
    @Param('key') key: string,
    @Body() input: unknown,
    @Headers('idempotency-key')
    idempotencyKey:
      | string
      | undefined,
    @Req() req: AuthRequest,
  ) {
    const body = z
      .object({
        value: settingValueSchema,
      })
      .strict()
      .parse(input);

    const value = jsonValue(body.value);

    return mutate(
      this.db,
      'setting.update',
      idempotencyKey,
      req.actor.id,
      {
        key,
        value,
      },
      async (tx) => {
        const before =
          await tx.setting.findUnique({
            where: { key },
          });

        const setting =
          await tx.setting.upsert({
            where: { key },
            create: {
              key,
              value,
              validated: false,
              updatedById:
                req.actor.id,
            },
            update: {
              value,
              validated: false,
              updatedById:
                req.actor.id,
              validatedAt: null,
              validatedById: null,
            },
          });

        await tx.settingHistory.create({
          data: {
            settingKey: key,
            oldValue:
              before?.value ??
              jsonValue({}),
            newValue: value,
            oldValidated:
              before?.validated ??
              false,
            newValidated: false,
            changedById:
              req.actor.id,
          },
        });

        await tx.auditLog.create({
          data: {
            actorId: req.actor.id,
            action: 'SETTING_UPDATED',
            entityType: 'Setting',
            entityId: key,
            oldValue:
              before?.value ??
              jsonValue({}),
            newValue: value,
          },
        });

        return setting;
      },
    ).then((data) => ({
      success: true,
      data,
    }));
  }

  @Require('pricing.update')
  @Post('settings/:key/validate')
  validateSetting(
    @Param('key') key: string,
    @Headers('idempotency-key')
    idempotencyKey:
      | string
      | undefined,
    @Req() req: AuthRequest,
  ) {
    return mutate(
      this.db,
      'setting.validate',
      idempotencyKey,
      req.actor.id,
      { key },
      async (tx) => {
        const before =
          await tx.setting.findUnique({
            where: { key },
          });

        if (!before) {
          throw new DomainError(
            'SETTING_NOT_FOUND',
            'Paramètre introuvable.',
            404,
          );
        }

        const validator = settingsRequiringConfiguration[key];
        if (validator && !validator.safeParse(before.value).success) {
          throw new DomainError('SETTING_CONFIGURATION_INVALID', `Le réglage « ${key} » doit d’abord contenir une configuration complète.`, 409);
        }

        let adjustedSubscriptions = 0;
        if (key === 'calendrier') {
          const calendar = calendarSettingSchema.parse(before.value);
          adjustedSubscriptions = await reconcileOpenSubscriptionsForCalendar(tx, calendar.closures, req.actor.id);
        }

        const setting =
          await tx.setting.update({
            where: { key },
            data: {
              validated: true,
              validatedAt: new Date(),
              validatedById:
                req.actor.id,
              updatedById:
                req.actor.id,
            },
          });

        await tx.settingHistory.create({
          data: {
            settingKey: key,
            oldValue: jsonValue(before.value ?? {}),
            newValue: jsonValue(before.value ?? {}),
            oldValidated:
              before.validated,
            newValidated: true,
            changedById:
              req.actor.id,
          },
        });

        await tx.auditLog.create({
          data: {
            actorId: req.actor.id,
            action:
              'SETTING_VALIDATED',
            entityType: 'Setting',
            entityId: key,
            oldValue: {
              validated:
                before.validated,
            },
            newValue: {
              validated: true,
              ...(key === 'calendrier' ? { adjustedSubscriptions } : {}),
            },
          },
        });

        return setting;
      },
    ).then((data) => ({
      success: true,
      data,
    }));
  }

  // ============================================================
  // TAUX USD/CDF
  // ============================================================

  @Require('pricing.read')
  @Get('exchange-rates')
  async rates() {
    return {
      success: true,
      data:
        await this.db.exchangeRate.findMany({
          take: 30,
          orderBy: {
            effectiveFrom: 'desc',
          },
        }),
    };
  }

  @Require('pricing.update')
  @Post('exchange-rates')
  rate(
    @Body() input: unknown,
    @Headers('idempotency-key')
    key: string | undefined,
    @Req() req: AuthRequest,
  ) {
    const body = z
      .object({
        rate: z
          .string()
          .regex(
            /^\d{1,8}(\.\d{1,8})?$/,
          )
          .refine(
            (value) =>
              Number(value) > 0,
          ),
        source: z
          .string()
          .min(3)
          .max(200),
        effectiveFrom:
          z.string().datetime(),
      })
      .strict()
      .parse(input);

    return mutate(
      this.db,
      'rate.create',
      key,
      req.actor.id,
      body,
      async (tx) => {
        if (
          new Date(
            body.effectiveFrom,
          ).getTime() <
          Date.now() - 60000
        ) {
          throw new DomainError(
            'RETROACTIVE_RATE',
            'Un taux ne peut pas prendre effet rétroactivement.',
          );
        }

        const rate =
          await tx.exchangeRate.create({
            data: {
              ...body,
              baseCurrency: 'USD',
              quoteCurrency: 'CDF',
              status: 'ACTIVE',
              createdById:
                req.actor.id,
            },
          });

        await audit(
          tx,
          req.actor.id,
          'RATE_CREATED',
          'ExchangeRate',
          rate.id,
          {
            rate: body.rate,
            source: body.source,
          },
        );

        return rate;
      },
    ).then((data) => ({
      success: true,
      data,
    }));
  }

  // ============================================================
  // COMPATIBILITÉ ANCIEN ENDPOINT PRIX
  // ============================================================

  @Require('pricing.update')
  @Post('pricing/:id')
  price(
    @Param('id') id: string,
    @Body() input: unknown,
    @Headers('idempotency-key')
    key: string | undefined,
    @Req() req: AuthRequest,
  ) {
    uuid.parse(id);

    const body = z
      .object({
        amount: money,
        currency,
      })
      .strict()
      .parse(input);

    return mutate(
      this.db,
      'price.legacy',
      key,
      req.actor.id,
      {
        id,
        ...body,
      },
      async (tx) => {
        const productPrice =
          await tx.productPrice.findUnique(
            {
              where: { id },
            },
          );

        if (!productPrice) {
          throw new DomainError(
            'NOT_FOUND',
            'Tarif introuvable.',
            404,
          );
        }

        return addPriceVersion(
          tx,
          {
            productId:
              productPrice.productId,
            categoryCode:
              productPrice.categoryCode,
            amount: body.amount,
            currency: body.currency,
            effectiveFrom:
              new Date().toISOString(),
          },
          req.actor.id,
        );
      },
    ).then((data) => ({
      success: true,
      data,
    }));
  }

  // ============================================================
  // AUDIT
  // ============================================================

  @Require('audit.read')
@Get('audit')
async logs(@Query() input: unknown) {
  const query = pageSchema
    .extend({
      action: z
        .string()
        .trim()
        .max(100)
        .optional(),

      entityType: z
        .string()
        .trim()
        .max(100)
        .optional(),

      actorId: uuid.optional(),

      from: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),

      to: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    })
    .parse(input);

  if (
    query.from &&
    query.to &&
    query.from > query.to
  ) {
    throw new DomainError(
      'INVALID_DATE_RANGE',
      'La date de début doit être antérieure ou égale à la date de fin.',
      400,
    );
  }

  const where:
    Prisma.AuditLogWhereInput = {
    ...(query.action
      ? {
          action: {
            contains: query.action,
            mode: 'insensitive',
          },
        }
      : {}),

    ...(query.entityType
      ? {
          entityType: {
            contains:
              query.entityType,
            mode: 'insensitive',
          },
        }
      : {}),

    ...(query.actorId
      ? {
          actorId:
            query.actorId,
        }
      : {}),

    ...(query.q
      ? {
          OR: [
            {
              action: {
                contains: query.q,
                mode: 'insensitive',
              },
            },

            {
              entityType: {
                contains: query.q,
                mode: 'insensitive',
              },
            },

            {
              entityId: {
                contains: query.q,
                mode: 'insensitive',
              },
            },
          ],
        }
      : {}),

    ...(query.from ||
    query.to
      ? {
          createdAt: {
            ...(query.from
              ? {
                  gte: new Date(
                    `${query.from}T00:00:00+01:00`,
                  ),
                }
              : {}),

            ...(query.to
              ? {
                  lte: new Date(
                    `${query.to}T23:59:59.999+01:00`,
                  ),
                }
              : {}),
          },
        }
      : {}),
  };

  const [data, total] =
    await this.db.$transaction([
      this.db.auditLog.findMany({
        where,

        take: query.limit,

        skip:
          (query.page - 1) *
          query.limit,

        orderBy: {
          createdAt: 'desc',
        },

        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          actorId: true,
          createdAt: true,
          requestId: true,
          oldValue: true,
          newValue: true,
          metadata: true,
          ip: true,
          deviceId: true,

          actor: {
            select: {
              username: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      }),

      this.db.auditLog.count({
        where,
      }),
    ]);

  return {
    success: true,
    data,

    meta: {
      page: query.page,
      limit: query.limit,
      total,
    },
  };
}

  // ============================================================
  // RAPPORT ACTUEL
  // ============================================================

 @Require('reports.export')
 @Get('reports/export')
 async exportReport(@Query('from') from:string|undefined,@Query('to') to:string|undefined,@Query('serviceMode') serviceMode:string|undefined,@Res({passthrough:true}) response:Response) {
   const {data}=await this.reports(from,to,serviceMode);
   const book=new ExcelJS.Workbook();book.creator='JAMI FOOD';
   const summary=book.addWorksheet('Synthèse');summary.addRows([['JAMI FOOD',data.from,data.to],['Repas servis',data.served],['Abonnements actifs',data.subscriptions],['Paiements en attente',data.pendingPayments]]);
   const sales=book.addWorksheet('Ventes');sales.addRow(['Devise','Montant','Commandes']);for(const row of data.sales)sales.addRow([row.currency,row._sum.totalAmount?.toString()??'0',row._count]);
   const payments=book.addWorksheet('Encaissements bruts');payments.addRow(['Devise reçue','Moyen','Montant reçu','Monnaie rendue','Devise monnaie','Nombre']);for(const row of data.payments)payments.addRow([row.receivedCurrency,row.method,row._sum.receivedAmount?.toString()??'0',row._sum.changeAmount?.toString()??'0',row.changeCurrency??row.receivedCurrency,row._count]);
   for(const [name,rows] of [['Remboursements',data.refunds],['Dépenses',data.expenses]] as const){const sheet=book.addWorksheet(name);sheet.addRow(['Devise','Montant']);for(const row of rows)sheet.addRow([row.currency,row._sum.amount?.toString()??'0']);}
   for(const sheet of book.worksheets){sheet.getRow(1).font={bold:true};sheet.columns.forEach(column=>{column.width=26;});sheet.views=[{state:'frozen',ySplit:1}];}
   response.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');response.setHeader('Content-Disposition',`attachment; filename="rapport-${data.from}-${data.to}.xlsx"`);
   return new StreamableFile(Buffer.from(await book.xlsx.writeBuffer()));
 }
 @Require('reports.read')
@Get('reports')
async reports(
  @Query('from') from?: string,
  @Query('to') to?: string,
  @Query('serviceMode')
  serviceMode?: string,
) {
  const query = z
    .object({
      from: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),

      to: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),

      serviceMode: z
        .enum([
          'DINE_IN',
          'TAKEAWAY',
          'DELIVERY',
        ])
        .optional(),
    })
    .parse({
      from: from || undefined,
      to: to || undefined,
      serviceMode:
        serviceMode || undefined,
    });

  const startDate =
    query.from ?? localDate();

  const endDate =
    query.to ?? startDate;

  if (startDate > endDate) {
    throw new DomainError(
      'INVALID_DATE_RANGE',
      'La date de début doit être antérieure ou égale à la date de fin.',
      400,
    );
  }

  const start = new Date(
    `${startDate}T00:00:00+01:00`,
  );

  const end = new Date(
    `${endDate}T23:59:59.999+01:00`,
  );

  const orderWhere:
    Prisma.OrderWhereInput = {
    businessDate: {
      gte: new Date(startDate),
      lte: new Date(endDate),
    },

    ...(query.serviceMode
      ? {
          serviceMode:
            query.serviceMode,
        }
      : {}),
  };

  const [
    sales,
    payments,
    served,
    subscriptions,
    expenses,
    refunds,
    cancelled,
    pendingPayments,
  ] = await Promise.all([
    this.db.order.groupBy({
      by: ['currency'],

      where: {
        ...orderWhere,

        paymentRequired: true,

        status: {
          notIn: [
            'RECEIVED',
            'CANCELLED',
          ],
        },
      },

      _sum: {
        totalAmount: true,
      },

      _count: true,
    }),

    this.db.payment.groupBy({
      by: [
        'receivedCurrency',
        'changeCurrency',
        'method',
      ],

      where: {
        // A later refund must not erase the original cash receipt.
        status: { in: ['CONFIRMED', 'REFUNDED'] },

        confirmedAt: {
          gte: start,
          lte: end,
        },

        ...(query.serviceMode
          ? {
              order: {
                serviceMode:
                  query.serviceMode,
              },
            }
          : {}),
      },

      _sum: {
        receivedAmount: true,
        changeAmount: true,
      },

      _count: true,
    }),

    this.db.order.count({
      where: {
        ...orderWhere,

        status: {
          in: [
            'SERVED',
            'DELIVERED',
          ],
        },
      },
    }),

    this.db.subscription.count({
      where: {
        status: {
          in: [
            'ACTIVE',
            'SCHEDULED',
          ],
        },

        startsOn: {
          lte: new Date(endDate),
        },

        endsOn: {
          gte: new Date(startDate),
        },

        balance: 0,
      },
    }),

    this.db.expense.groupBy({
      by: ['currency'],

      where: {
        occurredAt: {
          gte: start,
          lte: end,
        },
      },

      _sum: {
        amount: true,
      },
    }),

    this.db.refund.groupBy({
      by: ['currency'],

      where: {
        createdAt: {
          gte: start,
          lte: end,
        },
      },

      _sum: {
        amount: true,
      },

      _count: true,
    }),

    this.db.order.count({
      where: {
        ...orderWhere,
        status: 'CANCELLED',
      },
    }),

    this.db.payment.count({
      where: {
        status: 'PENDING',

        createdAt: {
          gte: start,
          lte: end,
        },

        ...(query.serviceMode
          ? {
              order: {
                serviceMode:
                  query.serviceMode,
              },
            }
          : {}),
      },
    }),
  ]);

  return {
    success: true,

    data: {
      // Compatibilité avec la page actuelle.
      date: startDate,

      from: startDate,
      to: endDate,

      serviceMode:
        query.serviceMode ?? null,

      sales,
      payments,
      refunds,
      expenses,

      served,
      subscriptions,
      cancelled,
      pendingPayments,
    },
  };
}


 }
