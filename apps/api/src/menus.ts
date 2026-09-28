import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';

import { Prisma } from '@jami/database';
import { uuid } from '@jami/validation';
import { z } from 'zod';

import {
  AuthRequest, Public,
  Require,
} from './auth';

import { DomainError } from './http';
import { PrismaService } from './prisma.service';
import { isServiceDay } from '@jami/shared';

import {
  audit,
  mutate,
  Tx,
} from './transaction';

const serviceSchema = z.enum([
  'BREAKFAST',
  'LUNCH',
  'DINNER',
]);

const dateSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}$/,
    'Date invalide.',
  )
  .refine(
    (value) =>
      !Number.isNaN(
        Date.parse(
          `${value}T00:00:00.000Z`,
        ),
      ),
    'Date invalide.',
  );

const createMenuSchema = z
  .object({
    businessDate: dateSchema,
    serviceCode: serviceSchema,
    notes: z
      .string()
      .trim()
      .max(1000)
      .optional(),
    imageUrl: z
  .string()
  .trim()
  .regex(/^\/api\/v1\/product-images\/[0-9a-f-]{36}\.(jpg|png|webp)$/i)
  .optional(),
  })
  .strict();

const menuItemSchema = z
  .object({
    productId: uuid,

    quantityAvailable: z
      .number()
      .int()
      .min(0)
      .max(100000),

    variants: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(100),
      )
      .max(30)
      .default([]),

    position: z
      .number()
      .int()
      .min(0)
      .max(1000)
      .default(0),
  })
  .strict();

const availabilitySchema = z
  .object({
    available: z.boolean(),
  })
  .strict();

const duplicateSchema = z
  .object({
    businessDate: dateSchema,
    serviceCode: serviceSchema,
  })
  .strict();

function dbDate(value: string) {
  return new Date(
    `${value}T00:00:00.000Z`,
  );
}

function json(
  value: unknown,
): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value),
  ) as Prisma.InputJsonValue;
}

async function requireDraft(
  tx: Tx,
  versionId: string,
) {
  const version =
    await tx.menuVersion.findUnique({
      where: {
        id: versionId,
      },
      include: {
        menu: true,
      },
    });

  if (!version) {
    throw new DomainError(
      'MENU_VERSION_NOT_FOUND',
      'Version de menu introuvable.',
      404,
    );
  }

  if (version.status !== 'DRAFT') {
    throw new DomainError(
      'MENU_NOT_EDITABLE',
      'Seul un menu en brouillon peut être modifié.',
      409,
    );
  }

  return version;
}

@Controller('menus')
export class MenusController {
  constructor(
    private readonly db: PrismaService,
  ) {}

  @Require('menus.write')
  @Get('products/:productId/option-groups')
  async productOptionGroups(@Param('productId') productId: string) {
    const id = uuid.parse(productId);
    const groups = await this.db.productOptionGroup.findMany({ where: { productId: id }, orderBy: { position: 'asc' }, include: { options: { orderBy: { position: 'asc' } } } });
    return { success: true, data: groups };
  }

  @Require('menus.write')
  @Post('products/:productId/option-groups')
  async createProductOptionGroup(@Param('productId') productId: string, @Body() input: unknown) {
    const id = uuid.parse(productId);
    const body = z.object({ name: z.string().trim().min(1).max(80), type: z.enum(['VARIANT','SUPPLEMENT']), required: z.boolean().default(false), minSelections: z.number().int().min(0).max(20), maxSelections: z.number().int().min(1).max(20), position: z.number().int().min(0).default(0), options: z.array(z.object({ name: z.string().trim().min(1).max(80), linkedProductId: uuid.optional(), priceDelta: z.string().regex(/^\d+(?:\.\d{1,2})?$/).default('0'), currency: z.enum(['CDF','USD']).default('CDF'), position: z.number().int().min(0).default(0) }).strict()).min(1).max(50) }).strict().refine(value=>value.maxSelections>=value.minSelections,'Le maximum doit être supérieur ou égal au minimum').parse(input);
    if (body.type === 'VARIANT' && body.options.some(option=>option.linkedProductId||Number(option.priceDelta)!==0)) throw new DomainError('VARIANT_PRICE_INVALID','Une variante incluse ne peut pas avoir de supplément payant.',400);
    const group = await this.db.productOptionGroup.create({ data: { productId: id, name: body.name, type: body.type, required: body.required, minSelections: body.minSelections, maxSelections: body.maxSelections, position: body.position, options: { create: body.options } }, include: { options: { orderBy: { position: 'asc' } } } });
    return { success: true, data: group };
  }

  @Require('menus.write')
  @Delete('option-groups/:groupId')
  async archiveProductOptionGroup(@Param('groupId') groupId: string) {
    const id = uuid.parse(groupId);
    await this.db.productOptionGroup.update({ where: { id }, data: { active: false, options: { updateMany: { where: {}, data: { active: false } } } } });
    return { success: true, data: { id, active: false } };
  }

  @Public()
  @Get('commercial-offers')
  async commercialOffers() {
    const now = new Date();
    const [plans, products] = await Promise.all([
      this.db.subscriptionPlan.findMany({
        where: { active: true, code: { in: ['PREMIUM','COMBINEE','REPAS','BREAKFAST'] } }, orderBy: { name: 'asc' },
        include: { versions: { where: { status: 'ACTIVE', effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }, orderBy: { version: 'desc' }, take: 1 } },
      }),
      this.db.product.findMany({
        where: { active: true, available: true, sku: { in: ['JAMI-REPAS-COMPLET', 'JAMI-SUP-FOUFOU', 'JAMI-SUP-CHIKWANGUE', 'JAMI-SUP-RIZ', 'JAMI-SUP-BANANES'] } },
        include: { prices: { where: { categoryCode: process.env.PUBLIC_PRICE_CATEGORY_CODE ?? 'ETUDIANT_EXTERNE' }, include: { versions: { where: { status: 'ACTIVE', effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }, orderBy: { version: 'desc' }, take: 1 } } } },
      }),
    ]);
    const productBySku = new Map(products.map(product => [product.sku, product]));
    const meal = productBySku.get('JAMI-REPAS-COMPLET');
    const mealPrice = meal?.prices[0]?.versions[0];
    return { success: true, data: {
      meal: meal && mealPrice ? { name: meal.name, description: meal.description, composition: meal.baseComposition, amount: mealPrice.amount.toString(), currency: mealPrice.currency } : null,
      supplements: ['JAMI-SUP-FOUFOU','JAMI-SUP-CHIKWANGUE','JAMI-SUP-RIZ','JAMI-SUP-BANANES'].flatMap(sku => { const p = productBySku.get(sku); const price = p?.prices[0]?.versions[0]; return p && price ? [{ id:p.id, name: p.name, amount: price.amount.toString(), currency: price.currency, saleUnit: p.saleUnit }] : []; }),
      plans: [...plans.flatMap(plan => { const version = plan.versions[0]; return version ? [{ code: plan.code, name: plan.name, price: version.price.toString(), currency: version.currency, services: version.services, quotaRules: version.quotaRules, deliveryIncluded: version.deliveryIncluded }] : []; }), { code: 'FLEX', name: 'Sur-mesure / Flex', price: null, currency: null, services: [], quotaRules: {}, deliveryIncluded: false }],
    } };
  }

  // ============================================================
  // LISTE DES MENUS
  // ============================================================

  @Public()
  @Get('public')
  async publicMenu(
    @Query('date') inputDate?: string,
    @Query('serviceCode') inputService?: string,
  ) {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.RESTAURANT_TIMEZONE ?? 'Africa/Kinshasa' }).format(new Date());
    const businessDate = dateSchema.parse(inputDate ?? today);
    const serviceCode = serviceSchema.parse(inputService ?? 'LUNCH');
    const category = process.env.PUBLIC_PRICE_CATEGORY_CODE;
    if (!category) return { success: true, data: null, meta: { reason: 'PUBLIC_PRICE_NOT_CONFIGURED' } };
    const menu = await this.db.menu.findUnique({
      where: { businessDate_serviceCode: { businessDate: dbDate(businessDate), serviceCode } },
      include: { versions: { where: { status: 'PUBLISHED' }, take: 1, orderBy: { version: 'desc' }, include: { items: { where: { available: true }, orderBy: { position: 'asc' }, include: { product: true } } } } },
    });
    const version = menu?.versions[0];
    if (!menu || !version) return { success: true, data: null };
    const optionGroups = await this.db.productOptionGroup.findMany({ where: { productId: { in: version.items.map(item => item.productId) }, active: true }, orderBy: { position: 'asc' }, include: { options: { where: { active: true }, orderBy: { position: 'asc' } } } });
    const linkedIds = [...new Set(optionGroups.flatMap(group => group.options.flatMap(option => option.linkedProductId ? [option.linkedProductId] : [])))];
    const linkedProducts = linkedIds.length ? await this.db.product.findMany({ where: { id: { in: linkedIds }, active: true, available: true }, include: { stockItem: true, prices: { where: { categoryCode: category }, include: { versions: { where: { status: 'ACTIVE', effectiveFrom: { lte: new Date() }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }] }, orderBy: { effectiveFrom: 'desc' }, take: 1 } } } } }) : [];
    const linkedById = new Map(linkedProducts.map(product => [product.id, product]));
    const optionsByProduct = new Map<string, typeof optionGroups>();
    for (const group of optionGroups) optionsByProduct.set(group.productId, [...(optionsByProduct.get(group.productId) ?? []), group]);
    const items = version.items.flatMap(item => {
      const remaining = Math.max(0, item.quantityAvailable - item.quantitySold - item.quantityReserved);
      if (!remaining || !item.product.active || !item.product.available) return [];
      const snapshot = item.priceSnapshot as { categories?: Record<string, { amount: string; currency: string }> } | null;
      const price = snapshot?.categories?.[category];
      if (!price) return [];
      const product = item.productSnapshot as { name?: string; imageUrl?: string; description?: string } | null;
      return [{ id: item.productId, name: product?.name ?? item.product.name, imageUrl: product?.imageUrl ?? item.product.imageUrl, description: product?.description ?? item.product.description, variants: item.variants, optionGroups: (optionsByProduct.get(item.productId)??[]).map(group => ({ id: group.id, name: group.name, type: group.type, required: group.required, minSelections: group.minSelections, maxSelections: group.maxSelections, options: group.options.flatMap(option => { const linked=linkedById.get(option.linkedProductId??'');if(option.linkedProductId&&(!linked||!linked.prices[0]?.versions[0]||(linked.stockMode==='DIRECT'&&(!linked.stockItem||!linked.stockItem.active||linked.stockItem.quantity.lt(linked.stockQuantity)))))return [];return [{ id: option.id, name: option.name, priceDelta: linked?.prices[0]?.versions[0]?.amount.toString() ?? option.priceDelta.toString(), currency: linked?.prices[0]?.versions[0]?.currency ?? option.currency, linkedProductId: option.linkedProductId }]; }) })), remaining, price: { amount: price.amount, currency: price.currency } }];
    });
    return { success: true, data: { businessDate, serviceCode, version: version.version, menuVersionId: version.id, imageUrl: version.imageUrl, items } };
  }

  @Require('menus.read')
  @Get()
  async list(
    @Query('date') date?: string,
  ) {
    const parsedDate = date
      ? dateSchema.parse(date)
      : undefined;

    const data =
      await this.db.menu.findMany({
        where: parsedDate
          ? {
              businessDate:
                dbDate(parsedDate),
            }
          : undefined,

        take: 100,

        orderBy: [
          {
            businessDate: 'desc',
          },
          {
            serviceCode: 'asc',
          },
        ],

        include: {
          versions: {
            orderBy: {
              version: 'desc',
            },

            include: {
              items: {
                orderBy: {
                  position: 'asc',
                },

                include: {
                  product: true,
                },
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
  // CRÉER UN BROUILLON
  // ============================================================

  @Require('menus.manage')
  @Post()
  create(
    @Body() input: unknown,

    @Headers('idempotency-key')
    key: string | undefined,

    @Req()
    req: AuthRequest,
  ) {
    const body =
      createMenuSchema.parse(input);

    return mutate(
      this.db,
      'menu.create-draft',
      key,
      req.actor.id,
      body,

      async (tx) => {
        const businessDate =
          dbDate(body.businessDate);

        let menu =
          await tx.menu.findUnique({
            where: {
              businessDate_serviceCode:
                {
                  businessDate,
                  serviceCode:
                    body.serviceCode,
                },
            },

            include: {
              versions: true,
            },
          });

        if (!menu) {
          menu =
            await tx.menu.create({
              data: {
                businessDate,
                serviceCode:
                  body.serviceCode,
              },

              include: {
                versions: true,
              },
            });
        }

        const existingDraft =
          menu.versions.find(
            (version) =>
              version.status ===
              'DRAFT',
          );

        if (existingDraft) {
          throw new DomainError(
            'MENU_DRAFT_ALREADY_EXISTS',
            'Un brouillon existe déjà pour cette date et ce service.',
            409,
          );
        }

        const nextVersion =
          menu.versions.reduce(
            (maximum, version) =>
              Math.max(
                maximum,
                version.version,
              ),
            0,
          ) + 1;

        const version =
  await tx.menuVersion.create({
    data: {
      menuId: menu.id,
      version: nextVersion,
      notes:
        body.notes || null,
      imageUrl: body.imageUrl,
      createdById:
        req.actor.id,
    },
  });

        await audit(
          tx,
          req.actor.id,
          'MENU_DRAFT_CREATED',
          'MenuVersion',
          version.id,
          json({
            businessDate:
              body.businessDate,

            serviceCode:
              body.serviceCode,

            version:
              version.version,
          }),
        );

        return version;
      },
    ).then((data) => ({
      success: true,
      data,
    }));
  }

  @Require('menus.manage')
  @Post('versions/:versionId/image')
  setImage(
    @Param('versionId') versionId: string,
    @Body() input: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: AuthRequest,
  ) {
    uuid.parse(versionId);
    const body = z.object({
      imageUrl: z.string().trim().regex(/^\/api\/v1\/product-images\/[0-9a-f-]{36}\.(jpg|png|webp)$/i),
    }).strict().parse(input);
    return mutate(this.db, 'menu.image.update', key, req.actor.id, { versionId, ...body }, async tx => {
      await requireDraft(tx, versionId);
      const version = await tx.menuVersion.update({ where: { id: versionId }, data: { imageUrl: body.imageUrl } });
      await audit(tx, req.actor.id, 'MENU_IMAGE_UPDATED', 'MenuVersion', version.id, json({ imageUrl: body.imageUrl }));
      return version;
    }).then(data => ({ success: true, data }));
  }

  // ============================================================
  // AJOUTER / MODIFIER UN ARTICLE
  // ============================================================

  @Require('menus.manage')
  @Post(
    'versions/:versionId/items',
  )
  addItem(
    @Param('versionId')
    versionId: string,

    @Body()
    input: unknown,

    @Headers('idempotency-key')
    key: string | undefined,

    @Req()
    req: AuthRequest,
  ) {
    uuid.parse(versionId);

    const body =
      menuItemSchema.parse(input);

    return mutate(
      this.db,
      'menu.item.upsert',
      key,
      req.actor.id,
      {
        versionId,
        ...body,
      },

      async (tx) => {
        await requireDraft(
          tx,
          versionId,
        );

        const product =
          await tx.product.findUnique({
            where: {
              id: body.productId,
            },
          });

        if (
          !product ||
          !product.active
        ) {
          throw new DomainError(
            'PRODUCT_NOT_AVAILABLE',
            'Ce produit ne peut pas être ajouté au menu.',
            400,
          );
        }

        const item =
          await tx.menuItem.upsert({
            where: {
              menuVersionId_productId:
                {
                  menuVersionId:
                    versionId,

                  productId:
                    body.productId,
                },
            },

            create: {
              menuVersionId:
                versionId,

              productId:
                body.productId,

              quantityAvailable:
                body.quantityAvailable,

              variants:
                json(body.variants),

              position:
                body.position,

              available: true,
            },

            update: {
              quantityAvailable:
                body.quantityAvailable,

              variants:
                json(body.variants),

              position:
                body.position,
            },
          });

        await audit(
          tx,
          req.actor.id,
          'MENU_ITEM_SAVED',
          'MenuItem',
          item.id,
          json({
            menuVersionId:
              versionId,

            productId:
              body.productId,

            quantityAvailable:
              body.quantityAvailable,

            variants:
              body.variants,
          }),
        );

        return item;
      },
    ).then((data) => ({
      success: true,
      data,
    }));
  }

  // ============================================================
  // DISPONIBLE / ÉPUISÉ
  // ============================================================

  @Require('menus.manage')
  @Post(
    'items/:itemId/availability',
  )
  availability(
    @Param('itemId')
    itemId: string,

    @Body()
    input: unknown,

    @Headers('idempotency-key')
    key: string | undefined,

    @Req()
    req: AuthRequest,
  ) {
    uuid.parse(itemId);

    const body =
      availabilitySchema.parse(
        input,
      );

    return mutate(
      this.db,
      'menu.item.availability',
      key,
      req.actor.id,
      {
        itemId,
        ...body,
      },

      async (tx) => {
        const before =
          await tx.menuItem.findUnique({
            where: {
              id: itemId,
            },
          });

        if (!before) {
          throw new DomainError(
            'MENU_ITEM_NOT_FOUND',
            'Article du menu introuvable.',
            404,
          );
        }

        const item =
          await tx.menuItem.update({
            where: {
              id: itemId,
            },

            data: {
              available:
                body.available,
            },
          });

        await tx.auditLog.create({
          data: {
            actorId:
              req.actor.id,

            action:
              body.available
                ? 'MENU_ITEM_AVAILABLE'
                : 'MENU_ITEM_SOLD_OUT',

            entityType:
              'MenuItem',

            entityId:
              item.id,

            oldValue: json({
              available:
                before.available,
            }),

            newValue: json({
              available:
                item.available,
            }),
          },
        });

        return item;
      },
    ).then((data) => ({
      success: true,
      data,
    }));
  }

  // ============================================================
  // PUBLIER
  // ============================================================

  @Require('menus.publish')
  @Post(
    'versions/:versionId/publish',
  )
  publish(
    @Param('versionId')
    versionId: string,

    @Headers('idempotency-key')
    key: string | undefined,

    @Req()
    req: AuthRequest,
  ) {
    uuid.parse(versionId);

    return mutate(
      this.db,
      'menu.publish',
      key,
      req.actor.id,
      {
        versionId,
      },

      async (tx) => {
        const version =
          await requireDraft(
            tx,
            versionId,
          );
        await tx.$queryRaw`SELECT id FROM "Menu" WHERE id = ${version.menuId}::uuid FOR UPDATE`;

        const calendar =
          await tx.setting.findUnique({
            where: {
              key: 'calendrier',
            },
          });

        if (
          !calendar ||
          !calendar.validated
        ) {
          throw new DomainError(
            'CALENDAR_NOT_VALIDATED',
            'Le calendrier commercial doit être validé avant de publier un menu.',
            409,
          );
        }

        const calendarRules = z.object({
          weekdays: z.array(z.number().int().min(1).max(5)).min(1),
          closures: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).default([]),
        }).passthrough().safeParse(calendar.value);
        if (!calendarRules.success || calendarRules.data.weekdays.length !== 5 || ![1, 2, 3, 4, 5].every(day => calendarRules.data.weekdays.includes(day))) {
          throw new DomainError('CALENDAR_INVALID', 'Configurez et enregistrez les jours ouvrés du lundi au vendredi avant de publier.', 409);
        }
        const publicationDate = version.menu.businessDate.toISOString().slice(0, 10);
        if (!isServiceDay(publicationDate, calendarRules.data.closures)) {
          throw new DomainError('CALENDAR_CLOSED', 'Un menu ne peut pas être publié pour un week-end, un jour férié légal ou une fermeture exceptionnelle.', 409);
        }

        const items =
          await tx.menuItem.findMany({
            where: {
              menuVersionId:
                versionId,
            },

            include: {
              product: {
                include: {
                  category: true,

                  prices: {
                    include: {
                      versions: {
                        orderBy: {
                          effectiveFrom:
                            'desc',
                        },
                      },
                    },
                  },
                },
              },
            },
          });

        if (!items.length) {
          throw new DomainError(
            'MENU_EMPTY',
            'Ajoutez au moins un produit avant de publier le menu.',
            400,
          );
        }

        const now = new Date();

        for (const item of items) {
          if (
            !item.product.active
          ) {
            throw new DomainError(
              'MENU_PRODUCT_INACTIVE',
              `Le produit "${item.product.name}" est inactif.`,
              409,
            );
          }

          const categories:
            Record<
              string,
              {
                amount: string;
                currency: string;
                priceVersionId: string;
              }
            > = {};

          for (
            const productPrice
            of item.product.prices
          ) {
            const activePrice =
              productPrice.versions.find(
                (price) =>
                  price.effectiveFrom <=
                    now &&
                  (!price.effectiveTo ||
                    price.effectiveTo >
                      now),
              );

            if (activePrice) {
              categories[
                productPrice.categoryCode
              ] = {
                amount:
                  activePrice.amount.toString(),

                currency:
                  activePrice.currency,

                priceVersionId:
                  activePrice.id,
              };
            }
          }

          if (
            !Object.keys(categories)
              .length
          ) {
            throw new DomainError(
              'MENU_PRODUCT_WITHOUT_PRICE',
              `Le produit "${item.product.name}" n'a aucun tarif applicable.`,
              409,
            );
          }

          await tx.menuItem.update({
            where: {
              id: item.id,
            },

            data: {
              productSnapshot: json({
                productId:
                  item.product.id,

                sku:
                  item.product.sku,

                name:
                  item.product.name,

                imageUrl:
                  item.product.imageUrl,

                saleUnit:
                  item.product.saleUnit,

                description:
                  item.product.description,

                baseComposition:
                  item.product
                    .baseComposition,

                category: {
                  id:
                    item.product
                      .category.id,

                  code:
                    item.product
                      .category.code,

                  label:
                    item.product
                      .category.label,
                },
              }),

              priceSnapshot: json({
                categories,
                capturedAt:
                  now.toISOString(),
              }),
            },
          });
        }

        await tx.menuVersion.updateMany({
          where: {
            menuId:
              version.menuId,

            status: 'PUBLISHED',
          },

          data: {
            status: 'RETIRED',
          },
        });

        const published =
          await tx.menuVersion.update({
            where: {
              id: versionId,
            },

            data: {
              status: 'PUBLISHED',

              publishedAt:
                new Date(),

              publishedById:
                req.actor.id,
            },
          });

        await audit(
          tx,
          req.actor.id,
          'MENU_PUBLISHED',
          'MenuVersion',
          versionId,
          json({
            menuId:
              version.menuId,

            version:
              version.version,

            serviceCode:
              version.menu.serviceCode,

            businessDate:
              version.menu.businessDate,
          }),
        );

        return published;
      },
    ).then((data) => ({
      success: true,
      data,
    }));
  }

  // ============================================================
  // DUPLIQUER
  // ============================================================

  @Require('menus.manage')
  @Post(
    'versions/:versionId/duplicate',
  )
  duplicate(
    @Param('versionId')
    versionId: string,

    @Body()
    input: unknown,

    @Headers('idempotency-key')
    key: string | undefined,

    @Req()
    req: AuthRequest,
  ) {
    uuid.parse(versionId);

    const body =
      duplicateSchema.parse(input);

    return mutate(
      this.db,
      'menu.duplicate',
      key,
      req.actor.id,
      {
        versionId,
        ...body,
      },

      async (tx) => {
        const source =
          await tx.menuVersion.findUnique({
            where: {
              id: versionId,
            },

            include: {
              items: true,
            },
          });

        if (!source) {
          throw new DomainError(
            'MENU_VERSION_NOT_FOUND',
            'Version de menu introuvable.',
            404,
          );
        }

        const businessDate =
          dbDate(body.businessDate);

        let targetMenu =
          await tx.menu.findUnique({
            where: {
              businessDate_serviceCode:
                {
                  businessDate,

                  serviceCode:
                    body.serviceCode,
                },
            },

            include: {
              versions: true,
            },
          });

        if (!targetMenu) {
          targetMenu =
            await tx.menu.create({
              data: {
                businessDate,

                serviceCode:
                  body.serviceCode,
              },

              include: {
                versions: true,
              },
            });
        }

        if (
          targetMenu.versions.some(
            (item) =>
              item.status ===
              'DRAFT',
          )
        ) {
          throw new DomainError(
            'TARGET_DRAFT_EXISTS',
            'Un brouillon existe déjà pour la date cible.',
            409,
          );
        }

        const nextVersion =
          targetMenu.versions.reduce(
            (maximum, item) =>
              Math.max(
                maximum,
                item.version,
              ),
            0,
          ) + 1;

        const duplicated =
  await tx.menuVersion.create({
    data: {
      menuId:
        targetMenu.id,

      version:
        nextVersion,

              status: 'DRAFT',

              notes:
                `Copie de la version ${source.version}`,

              imageUrl: source.imageUrl,

              createdById:
                req.actor.id,

              items: {
                create:
                  source.items.map(
                    (item) => ({
                      productId:
                        item.productId,

                      quantityAvailable:
                        item.quantityAvailable,

                      quantitySold: 0,
                      quantityReserved: 0,

                      available: true,

                      position:
                        item.position,

                      variants:
                        item.variants ??
                        undefined,
                    }),
                  ),
              },
            },

            include: {
              items: true,
            },
          });

        await audit(
          tx,
          req.actor.id,
          'MENU_DUPLICATED',
          'MenuVersion',
          duplicated.id,
          json({
            sourceVersionId:
              source.id,

            businessDate:
              body.businessDate,

            serviceCode:
              body.serviceCode,
          }),
        );

        return duplicated;
      },
    ).then((data) => ({
      success: true,
      data,
    }));
  }

  // ============================================================
  // MENU PUBLIÉ POUR LE POS
  // ============================================================

  @Require('sales.create')
  @Get('active')
  async active(
    @Query('date')
    inputDate: string,

    @Query('serviceCode')
    inputService: string,

    @Query('categoryCode')
    categoryCode: string,
  ) {
    const businessDate =
      dateSchema.parse(inputDate);

    const serviceCode =
      serviceSchema.parse(
        inputService,
      );

    const category = z
      .string()
      .trim()
      .min(1)
      .max(50)
      .parse(categoryCode);

    const menu =
      await this.db.menu.findUnique({
        where: {
          businessDate_serviceCode:
            {
              businessDate:
                dbDate(
                  businessDate,
                ),

              serviceCode,
            },
        },

        include: {
          versions: {
            where: {
              status: 'PUBLISHED',
            },

            take: 1,

            orderBy: {
              version: 'desc',
            },

            include: {
              items: {
                where: {
                  available: true,
                },

                orderBy: {
                  position: 'asc',
                },

                include: {
                  product: true,
                },
              },
            },
          },
        },
      });

    const version =
      menu?.versions[0];

    if (!menu || !version) {
      return {
        success: true,

        data: null,
      };
    }

    const items =
      version.items.flatMap(
        (item) => {
          const remaining =
            Math.max(
              0,
              item.quantityAvailable -
                item.quantitySold -
                item.quantityReserved,
            );

          if (
            remaining <= 0 ||
            !item.product.active ||
            !item.product.available
          ) {
            return [];
          }

          const snapshot =
            item.priceSnapshot as
              | {
                  categories?: Record<
                    string,
                    {
                      amount: string;
                      currency: string;
                      priceVersionId: string;
                    }
                  >;
                }
              | null;

          const price =
            snapshot?.categories?.[
              category
            ];

          if (!price) {
            return [];
          }

          return [
            {
              id: item.id,

              productId:
                item.productId,

              name:
                (
                  item.productSnapshot as
                    | {
                        name?: string;
                      }
                    | null
                )?.name ??
                item.product.name,

              imageUrl:
                (
                  item.productSnapshot as
                    | {
                        imageUrl?: string;
                      }
                    | null
                )?.imageUrl ??
                item.product.imageUrl,

              variants:
                item.variants,

              quantityAvailable:
                item.quantityAvailable,

              quantitySold:
                item.quantitySold,

              quantityReserved:
                item.quantityReserved,

              remaining,

              price,
            },
          ];
        },
      );

    return {
      success: true,

      data: {
        id: menu.id,

        businessDate,

        serviceCode,

        version: {
          id: version.id,

          version:
            version.version,

          publishedAt:
            version.publishedAt,

          items,
        },
      },
    };
  }
}
