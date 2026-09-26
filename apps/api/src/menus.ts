import {
  Body,
  Controller,
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
  AuthRequest,
  Require,
} from './auth';

import { DomainError } from './http';
import { PrismaService } from './prisma.service';

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
  .max(500)
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

  // ============================================================
  // LISTE DES MENUS
  // ============================================================

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
                item.quantitySold,
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