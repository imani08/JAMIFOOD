import {
  Body,
  Controller,
  Get,
  Headers,
  Injectable,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';

import {
  createClientSchema,
  pageSchema,
  uuid,
} from '@jami/validation';

import { z } from 'zod';

import {
  PrismaService,
} from './prisma.service';

import {
  DomainError,
} from './http';

import {
  AuthRequest,
  Require,
} from './auth';

import {
  audit,
  mutate,
} from './transaction';

const photoObjectKeySchema =
  z
    .string()
    .regex(
      /^[0-9a-f-]{36}\.(jpg|png|webp)$/i,
      'Référence photo invalide.',
    );

const clientCreateSchema =
  createClientSchema.extend({
    photoObjectKey:
      photoObjectKeySchema.optional(),
  });

const clientUpdateSchema =
  clientCreateSchema
    .partial()
    .refine(
      (value) =>
        Object.keys(value).length >
        0,
      'Aucune modification fournie.',
    );

const clientSelect = {
  id: true,
  firstName: true,
  lastName: true,
  ulcNumber: true,
  categoryId: true,
  category: true,
  phone: true,
  email: true,
  faculty: true,
  promotion: true,
  residency: true,
  photoObjectKey: true,
  status: true,
  mergedIntoId: true,
  createdAt: true,
  updatedAt: true,
} as const;

function todayKinshasa() {
  const value =
    new Intl.DateTimeFormat(
      'en-CA',
      {
        timeZone:
          'Africa/Kinshasa',

        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      },
    ).format(
      new Date(),
    );

  return new Date(
    `${value}T00:00:00.000Z`,
  );
}

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    input: unknown,
    key:
      | string
      | undefined,
    actorId: string,
  ) {
    const data =
      clientCreateSchema.parse(
        input,
      );

    const client = await mutate(
      this.prisma,
      'clients.create',
      key,
      actorId,
      data,

      async (tx) => {
        const category =
          await tx.clientCategory.findFirst(
            {
              where: {
                id:
                  data.categoryId,

                active: true,
              },
            },
          );

        if (!category) {
          throw new DomainError(
            'CATEGORY_INVALID',
            'Catégorie client indisponible.',
            400,
          );
        }

        const duplicate =
          await tx.client.findFirst({
            where: {
              OR: [
                {
                  firstName: {
                    equals:
                      data.firstName,

                    mode:
                      'insensitive',
                  },

                  lastName: {
                    equals:
                      data.lastName,

                    mode:
                      'insensitive',
                  },
                },

                ...(data.phone
                  ? [
                      {
                        phone:
                          data.phone,
                      },
                    ]
                  : []),

                ...(data.ulcNumber
                  ? [
                      {
                        ulcNumber:
                          data.ulcNumber,
                      },
                    ]
                  : []),
              ],
            },
          });

        if (duplicate) {
          throw new DomainError(
            'POSSIBLE_DUPLICATE',
            `Un client similaire existe déjà (${duplicate.id}). Vérifiez sa fiche avant de continuer.`,
            409,
          );
        }

        const client =
          await tx.client.create({
            data,

            select:
              clientSelect,
          });

        await audit(
          tx,
          actorId,
          'CLIENT_CREATED',
          'Client',
          client.id,
          {
            categoryId:
              client.categoryId,
          },
        );

        return client;
      },
    ) as { id: string; [key: string]: unknown };
    return client;
  }

  update(
    clientId: string,
    input: unknown,
    key:
      | string
      | undefined,
    actorId: string,
  ) {
    uuid.parse(clientId);

    const data =
      clientUpdateSchema.parse(
        input,
      );

    return mutate(
      this.prisma,
      'clients.update',
      key,
      actorId,
      {
        clientId,
        ...data,
      },

      async (tx) => {
        const before =
          await tx.client.findUnique({
            where: {
              id: clientId,
            },
          });

        if (!before) {
          throw new DomainError(
            'CLIENT_NOT_FOUND',
            'Client introuvable.',
            404,
          );
        }

        if (
          before.status !==
          'ACTIVE'
        ) {
          throw new DomainError(
            'CLIENT_NOT_ACTIVE',
            'Cette fiche client n’est plus active.',
            409,
          );
        }

        if (data.categoryId) {
          const category =
            await tx.clientCategory.findFirst(
              {
                where: {
                  id:
                    data.categoryId,

                  active: true,
                },
              },
            );

          if (!category) {
            throw new DomainError(
              'CATEGORY_INVALID',
              'Catégorie client indisponible.',
              400,
            );
          }
        }

        const after =
          await tx.client.update({
            where: {
              id: clientId,
            },

            data,

            select:
              clientSelect,
          });

        await tx.auditLog.create({
          data: {
            actorId,

            action:
              'CLIENT_UPDATED',

            entityType:
              'Client',

            entityId:
              clientId,

            oldValue: {
              firstName:
                before.firstName,

              lastName:
                before.lastName,

              categoryId:
                before.categoryId,

              ulcNumber:
                before.ulcNumber,

              phone:
                before.phone,

              email:
                before.email,

              photoObjectKey:
                before.photoObjectKey,
            },

            newValue: {
              firstName:
                after.firstName,

              lastName:
                after.lastName,

              categoryId:
                after.categoryId,

              ulcNumber:
                after.ulcNumber,

              phone:
                after.phone,

              email:
                after.email,

              photoObjectKey:
                after.photoObjectKey,
            },
          },
        });

        return after;
      },
    );
  }

  async find(
    query: unknown,
  ) {
    const {
      q,
      page,
      limit,
    } =
      pageSchema.parse(query);

    const where = {
      status:
        'ACTIVE' as const,

      ...(q
        ? {
            OR: [
              {
                firstName: {
                  contains: q,

                  mode:
                    'insensitive' as const,
                },
              },

              {
                lastName: {
                  contains: q,

                  mode:
                    'insensitive' as const,
                },
              },

              {
                ulcNumber: {
                  contains: q,

                  mode:
                    'insensitive' as const,
                },
              },

              {
                phone: {
                  contains: q,
                },
              },

              ...(uuid.safeParse(q)
                .success
                ? [
                    {
                      id: q,
                    },
                  ]
                : []),
            ],
          }
        : {}),
    };

    const [data, total] =
      await this.prisma.$transaction(
        [
          this.prisma.client.findMany(
            {
              where,

              take: limit,

              skip:
                (page - 1) *
                limit,

              orderBy: [
                {
                  lastName:
                    'asc',
                },

                {
                  id: 'asc',
                },
              ],

              select:
                clientSelect,
            },
          ),

          this.prisma.client.count(
            {
              where,
            },
          ),
        ],
      );

    return {
      data,

      meta: {
        page,
        limit,
        total,
      },
    };
  }

  async detail(clientId: string) { uuid.parse(clientId); const client = await this.prisma.client.findUnique({ where: { id: clientId }, include: { category: true, subscriptions: { orderBy: { startsOn: 'desc' }, take: 50, include: { planVersion: { include: { plan: true } }, payments: { where: { status: 'CONFIRMED' }, select: { id: true, amountDue: true, confirmedAt: true, method: true } } } } } }); if (!client) throw new DomainError("CLIENT_NOT_FOUND", "Abonné introuvable.", 404); return client; }
  archive(clientId: string, key: string | undefined, actorId: string) {
    uuid.parse(clientId);
    return mutate(this.prisma, 'clients.archive', key, actorId, { clientId }, async tx => {
      const client = await tx.client.findUnique({ where: { id: clientId } });
      if (!client) throw new DomainError('CLIENT_NOT_FOUND', 'Abonné introuvable.', 404);
      if (client.status === 'ARCHIVED') return { id: client.id, status: client.status };
      const activeSubscription = await tx.subscription.findFirst({ where: { clientId, status: { in: ['ACTIVE','SCHEDULED','PENDING_PAYMENT'] } } });
      if (activeSubscription) throw new DomainError('SUBSCRIBER_HAS_ACTIVE_SUBSCRIPTION', 'Suspendez ou annulez les abonnements actifs avant l’archivage.', 409);
      const updated = await tx.client.update({ where: { id: clientId }, data: { status: 'ARCHIVED', archivedAt: new Date() } });
      await audit(tx, actorId, 'SUBSCRIBER_ARCHIVED', 'Client', clientId, { status: 'ARCHIVED', archivedAt: updated.archivedAt?.toISOString() });
      return { id: updated.id, status: updated.status };
    });
  }
}

@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService, private readonly prisma: PrismaService) {}

  @Require('clients.read') @Get('categories') categories() {
    return this.prisma.clientCategory.findMany({ where: { active: true }, orderBy: { label: 'asc' } }).then(data => ({ success: true, data }));
  }
  @Require('clients.read') @Get() async list(@Query() query: unknown) {
    const result = await this.clients.find(query); return { success: true, data: result.data, meta: result.meta };
  }
  @Require('clients.create') @Post() create(@Body() body: unknown, @Headers('idempotency-key') key: string | undefined, @Req() req: AuthRequest) {
    return this.clients.create(body, key, req.actor.id).then(data => ({ success: true, data }));
  }
  @Require('clients.read') @Get(':id') detail(@Param('id') id: string) {
    return this.clients.detail(id).then(data => ({ success: true, data }));
  }
  @Require('clients.update')
  @Post(':id')
  update(
    @Param('id')
    id: string,

    @Body()
    body: unknown,

    @Headers(
      'idempotency-key',
    )
    key:
      | string
      | undefined,

    @Req()
    req: AuthRequest,
  ) {
    return this.clients
      .update(
        id,
        body,
        key,
        req.actor.id,
      )
      .then(
        (data) => ({
          success: true,
          data,
        }),
      );
  }

  @Require('clients.archive')
  @Post(':id/archive')
  archive(
    @Param('id')
    id: string,

    @Headers(
      'idempotency-key',
    )
    key:
      | string
      | undefined,

    @Req()
    req: AuthRequest,
  ) {
    return this.clients
      .archive(
        id,
        key,
        req.actor.id,
      )
      .then(
        (data) => ({
          success: true,
          data,
        }),
      );
  }
}
