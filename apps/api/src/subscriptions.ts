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

import {
  serviceEndDate,
  localDate,
  serviceRightDates,
} from '@jami/shared';

import {
  currency,
  money,
  pageSchema,
  uuid,
} from '@jami/validation';

import { z } from 'zod';

import {
  AuthRequest,
  Require,
} from './auth';

import {
  PrismaService,
} from './prisma.service';

import {
  audit,
  lockCash,
  mutate,
} from './transaction';

import {
  DomainError,
} from './http';

import {
  syncSubscriptionStatuses,
} from './subscription-status';

import {
  finishPayment,
  settlement,
} from './orders';

const Decimal =
  Prisma.Decimal;

const serviceCodeSchema =
  z.enum([
    'BREAKFAST',
    'LUNCH',
    'DINNER',
    'MAIN',
  ]);

const dateSchema =
  z
    .string()
    .regex(
      /^\d{4}-\d{2}-\d{2}$/,
    );

const rulesSchema =
  z
    .object({
      pendingValidation:
        z.literal(false),

      serviceQuotas:
        z
          .record(
            serviceCodeSchema,
            z
              .number()
              .int()
              .min(1)
              .max(10),
          )
          .optional(),

      dailyLimit:
        z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional(),

      periodLimit:
        z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional(),

      demo:
        z
          .boolean()
          .optional(),
    })
    .passthrough();

const createSubscriptionSchema =
  z
    .object({
      clientId: uuid,
      planVersionId: uuid,

      startsOn:
        dateSchema,
    })
    .strict();

const subscriptionPaymentSchema =
  z
    .object({
      cashSessionId: uuid,

      method:
        z.enum([
          'CASH',
          'MPESA',
          'ORANGE_MONEY',
          'AIRTEL_MONEY',
          'CARD',
          'TRANSFER',
        ]),

      /*
       * Montant à imputer sur
       * l'abonnement, exprimé dans
       * la devise de l'abonnement.
       *
       * Facultatif uniquement pour
       * conserver la compatibilité
       * avec l'ancien écran.
       */
      amount:
        money.optional(),

      receivedAmount:
        money,

      receivedCurrency:
        currency,

      externalReference:
        z
          .string()
          .trim()
          .min(1)
          .max(120)
          .optional(),
    })
    .strict()
    .refine(
      (value) =>
        value.method ===
          'CASH' ||
        Boolean(
          value.externalReference,
        ),
      {
        message:
          'Référence externe obligatoire.',

        path: [
          'externalReference',
        ],
      },
    );

type Rules =
  z.infer<
    typeof rulesSchema
  >;

type ServiceCode =
  z.infer<
    typeof serviceCodeSchema
  >;

function validateServices(
  services: ServiceCode[],
) {
  /*
   * MAIN = repas principal :
   * déjeuner OU dîner.
   *
   * On interdit donc une formule
   * qui combinerait MAIN avec
   * LUNCH/DINNER, car elle pourrait
   * créer un double droit.
   */
  if (
    services.includes(
      'MAIN',
    ) &&
    (services.includes(
      'LUNCH',
    ) ||
      services.includes(
        'DINNER',
      ))
  ) {
    throw new DomainError(
      'PLAN_RULES_INVALID',
      'Une formule MAIN ne peut pas créer simultanément des droits LUNCH ou DINNER.',
      400,
    );
  }
}
const renewalSchema = z
  .object({
    planVersionId:
      uuid.optional(),

    startsOn:
      dateSchema.optional(),
  })
  .strict();

const suspensionSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(
        5,
        'Le motif doit être précisé.',
      )
      .max(500),
  })
  .strict();

const cancellationSchema = z

  .object({
    reason: z
      .string()
      .trim()
      .min(
        5,
        'Le motif d’annulation doit être précisé.',
      )
      .max(500),
  })
  .strict();
  
const subscriptionAlertSchema = z
  .object({
    expiryDays: z
      .array(
        z
          .number()
          .int()
          .min(0)
          .max(30),
      )
      .min(1)
      .max(10),
  })
  .passthrough();

function addDays(
  value: string,
  days: number,
) {
  const date = new Date(
    `${value}T00:00:00.000Z`,
  );

  date.setUTCDate(
    date.getUTCDate() + days,
  );

  return date
    .toISOString()
    .slice(0, 10);
}

function daysBetween(
  from: string,
  to: string,
) {
  const start = new Date(
    `${from}T00:00:00.000Z`,
  );

  const end = new Date(
    `${to}T00:00:00.000Z`,
  );

  return Math.round(
    (end.getTime() -
      start.getTime()) /
      86_400_000,
  );
}



function buildRights(
  startsOn: string,
  endsOn: string,
  eligibleDays: number[],
  services: ServiceCode[],
  rules: Rules,
  closures: string[] = [],
) {
  const dates =
    serviceRightDates(
      startsOn,
      endsOn,
      eligibleDays,
      closures,
    );

  const dailyQuota =
    services.reduce(
      (total, service) =>
        total +
        (rules
          .serviceQuotas?.[
          service
        ] ?? 1),

      0,
    );

  if (
    rules.dailyLimit !==
      undefined &&
    dailyQuota >
      rules.dailyLimit
  ) {
    throw new DomainError(
      'PLAN_DAILY_LIMIT_INVALID',
      'Les quotas par service dépassent le plafond journalier configuré.',
      400,
    );
  }
  

  const rights =
    dates.flatMap(
      (date) =>
        services.flatMap(
          (service) => {
            const quota =
              rules
                .serviceQuotas?.[
                service
              ] ?? 1;

            return Array.from(
              {
                length: quota,
              },

              (
                _,
                index,
              ) => ({
                businessDate:
                  new Date(
                    date,
                  ),

                serviceCode:
                  service,

                /*
                 * Avec quota 1 :
                 * MAIN reste MAIN.
                 *
                 * Avec quota > 1 :
                 * MAIN:1, MAIN:2...
                 */
                quotaGroup:
                  quota === 1
                    ? service
                    : `${service}:${index + 1}`,
              }),
            );
          },
        ),
    );

  /*
   * Une politique periodLimit
   * exige une règle de sélection
   * explicite des jours/droits.
   *
   * On ne tronque jamais
   * arbitrairement les droits.
   */
  if (
    rules.periodLimit !==
      undefined &&
    rights.length >
      rules.periodLimit
  ) {
    throw new DomainError(
      'PLAN_PERIOD_LIMIT_REQUIRES_POLICY',
      'Le plafond de période est inférieur aux droits générés. Une politique de consommation doit être validée avant utilisation.',
      400,
    );
  }

  return rights;
}

@Controller(
  'subscriptions',
)
export class SubscriptionsController {
  constructor(
    private readonly db:
      PrismaService,
  ) {}

  /*
   * Toutes les versions sont
   * retournées pour préserver
   * l'historique.
   */
  @Require(
    'subscriptions.read',
  )
  @Get('plans')
  async plans() {
    return {
      success: true,

      data:
        await this.db.subscriptionPlan.findMany(
          {
            where: {
              active: true,
            },

            orderBy: {
              name: 'asc',
            },

            include: {
              versions: {
                orderBy: {
                  version:
                    'desc',
                },
              },
            },
          },
        ),
    };
    
  }

  @Require(
    'subscriptions.read',
  )
  @Get()
  async list(
    
    
    @Query()
    query: unknown,
  ) {
    await syncSubscriptionStatuses(
    this.db,
);
    const {
      page,
      limit,
      q,
    } =
      pageSchema.parse(
        query,
      );
      

    const where =
      q
        ? {
            client: {
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
              ],
            },
          }
        : {};

    const [
      data,
      total,
    ] =
      await this.db.$transaction(
        [
          this.db.subscription.findMany(
            {
              where,

              take: limit,

              skip:
                (page - 1) *
                limit,

              orderBy: {
                createdAt:
                  'desc',
              },

              include: {
                client: {
                  select: {
                    id: true,
                    firstName:
                      true,
                    lastName:
                      true,
                    ulcNumber:
                      true,
                  },
                },

                planVersion: {
                  include: {
                    plan: true,
                  },
                },

                payments: {
                  orderBy: {
                    createdAt:
                      'desc',
                  },
                },

                _count: {
                  select: {
                    rights: true,
                  },
                },
              },
            },
          ),

          this.db.subscription.count(
            {
              where,
            },
          ),
        ],
      );

    return {
      success: true,
      data,

      meta: {
        page,
        limit,
        total,
      },
    };
  }

  @Require('subscriptions.read')
@Get('alerts')
async alerts() {
  await syncSubscriptionStatuses(
    this.db,
  );

  const setting =
    await this.db.setting.findUnique({
      where: {
        key: 'subscription_alerts',
      },
    });

  const parsed =
    subscriptionAlertSchema.safeParse(
      setting?.value,
    );

  /*
   * Valeurs DEMO uniquement.
   * Elles seront configurables.
   */
  const expiryDays =
    parsed.success
      ? [
          ...new Set(
            parsed.data.expiryDays,
          ),
        ].sort(
          (a, b) => b - a,
        )
      : [3, 1];

  const today =
    localDate();

  const maximum =
    Math.max(
      ...expiryDays,
    );

  const until =
    addDays(
      today,
      maximum,
    );

  const [
    expirationCandidates,
    balanceCandidates,
  ] = await Promise.all([
    /*
     * Abonnements dont la fin
     * approche.
     */
    this.db.subscription.findMany({
      where: {
        status: {
          notIn: [
            'CANCELLED',
            'EXPIRED',
          ],
        },

        endsOn: {
          gte: new Date(
            today,
          ),

          lte: new Date(
            until,
          ),
        },
      },

      include: {
        client: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },

        planVersion: {
          include: {
            plan: true,
          },
        },
      },
    }),

    /*
     * Abonnements commencés
     * avec un solde restant.
     */
    this.db.subscription.findMany({
      where: {
        balance: {
          gt: 0,
        },

        startsOn: {
          lte: new Date(
            today,
          ),
        },

        status: {
          not: 'CANCELLED',
        },
      },

      include: {
        client: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },

        planVersion: {
          include: {
            plan: true,
          },
        },
      },

      orderBy: {
        startsOn: 'asc',
      },

      take: 100,
    }),
  ]);

  const expirations =
    expirationCandidates
      .map(
        (subscription) => {
          const endsOn =
            subscription.endsOn
              .toISOString()
              .slice(0, 10);

          return {
            id:
              subscription.id,

            client:
              subscription.client,

            plan:
              subscription
                .planVersion
                .plan.name,

            status:
              subscription.status,

            endsOn,

            daysRemaining:
              daysBetween(
                today,
                endsOn,
              ),
          };
        },
      )
      .filter(
        (subscription) =>
          expiryDays.includes(
            subscription.daysRemaining,
          ),
      );

  return {
    success: true,

    data: {
      configuration: {
        expiryDays,

        validated:
          setting?.validated ??
          false,

        source:
          parsed.success
            ? 'SETTING'
            : 'DEMO_DEFAULT',
      },

      expirations,

      balances:
        balanceCandidates.map(
          (subscription) => ({
            id:
              subscription.id,

            client:
              subscription.client,

            plan:
              subscription
                .planVersion
                .plan.name,

            status:
              subscription.status,

            balance:
              subscription.balance,

            currency:
              subscription.currency,

            startsOn:
              subscription.startsOn,
          }),
        ),
    },
  };
}
  @Require('subscriptions.read')
  @Get(':id')
  async detail(
    @Param('id')
    id: string,
  ) {
    uuid.parse(id);
    await syncSubscriptionStatuses(
  this.db,
);

    const subscription =
      await this.db.subscription.findUnique(
        {
          where: {
            id,
          },

          include: {
            client: {
              include: {
                category:
                  true,
              },
            },

            planVersion: {
              include: {
                plan: true,
              },
            },

            payments: {
              orderBy: {
                createdAt:
                  'desc',
              },
            },

            rights: {
              orderBy: [
                {
                  businessDate:
                    'asc',
                },

                {
                  serviceCode:
                    'asc',
                },
              ],
            },

            suspensions: {
              orderBy: {
                createdAt:
                  'desc',
              },
            },

            renewedFrom: {
              select: {
                id: true,
                startsOn:
                  true,
                endsOn:
                  true,
              },
            },

            renewals: {
              select: {
                id: true,
                startsOn:
                  true,
                endsOn:
                  true,
                status: true,
              },
            },
          },
        },
      );

    if (!subscription) {
      throw new DomainError(
        'SUBSCRIPTION_NOT_FOUND',
        'Abonnement introuvable.',
        404,
      );
    }

    return {
      success: true,
      data:
        subscription,
    };
  }

  @Require(
    'subscriptions.create',
  )
  @Post()
  create(
    @Body()
    input: unknown,

    @Headers(
      'idempotency-key',
    )
    key:
      | string
      | undefined,

    @Req()
    req: AuthRequest,
  ) {
    const body =
      createSubscriptionSchema.parse(
        input,
      );

    return mutate(
      this.db,
      'subscription.create',
      key,
      req.actor.id,
      body,

      async (tx) => {
        /*
         * Verrouillage du client :
         * deux guichets ne doivent
         * pas créer simultanément
         * deux abonnements qui se
         * chevauchent.
         */
        await tx.$queryRaw`
          SELECT id
          FROM "Client"
          WHERE id = ${body.clientId}::uuid
          FOR UPDATE
        `;

        const client =
          await tx.client.findUnique(
            {
              where: {
                id:
                  body.clientId,
              },
            },
          );

        if (
          !client ||
          client.status !==
            'ACTIVE'
        ) {
          throw new DomainError(
            'CLIENT_NOT_FOUND',
            'Client actif introuvable.',
            404,
          );
        }

        const version =
          await tx.subscriptionPlanVersion.findUnique(
            {
              where: {
                id:
                  body.planVersionId,
              },

              include: {
                plan: true,
              },
            },
          );

        if (!version) {
          throw new DomainError(
            'PLAN_VERSION_NOT_FOUND',
            'Version de formule introuvable.',
            404,
          );
        }

        const rules =
          rulesSchema.safeParse(
            version.quotaRules,
          );

        if (
          !rules.success
        ) {
          throw new DomainError(
            'PLAN_NOT_VALIDATED',
            'Les règles de cette formule ne sont pas encore validées.',
            409,
          );
        }

        /*
         * Une version RETIRED ne
         * peut pas être utilisée
         * pour une nouvelle
         * souscription.
         */
        if (
          version.status !==
            'ACTIVE'
        ) {
          throw new DomainError(
            'PLAN_NOT_ACTIVE',
            'Cette version de formule n’est pas active.',
            409,
          );
        }

        const now =
          new Date();

        if (
          version.effectiveFrom >
          now
        ) {
          throw new DomainError(
            'PLAN_NOT_EFFECTIVE',
            'Cette version tarifaire n’est pas encore applicable.',
            409,
          );
        }

        if (
          version.effectiveTo &&
          version.effectiveTo <=
            now
        ) {
          throw new DomainError(
            'PLAN_EXPIRED',
            'Cette version tarifaire n’est plus applicable.',
            409,
          );
        }

        const services =
          z
            .array(
              serviceCodeSchema,
            )
            .min(1)
            .parse(
              version.services,
            );

        validateServices(
          services,
        );

        const eligibleDays =
          z
            .array(
              z
                .number()
                .int()
                .min(0)
                .max(6),
            )
            .min(1)
            .parse(
              version
                .eligibilityDays,
            );

        const uniqueDays =
          [
            ...new Set(
              eligibleDays,
            ),
          ];

        const durationDays =
          version.durationDays;

        if (
          durationDays < 1 ||
          durationDays > 366
        ) {
          throw new DomainError(
            'PLAN_DURATION_INVALID',
            'La durée de cette formule est invalide.',
            400,
          );
        }

        if (
          body.startsOn <
          localDate()
        ) {
          throw new DomainError(
            'START_IN_PAST',
            'La date de début ne peut pas être passée.',
            400,
          );
        }

        const calendarSetting = await tx.setting.findUnique({ where: { key: 'calendrier' } });
        if (!calendarSetting?.validated) throw new DomainError('CALENDAR_NOT_VALIDATED', 'Le calendrier commercial doit être validé avant de créer un abonnement.', 409);
        const calendar = z.object({ weekdays: z.array(z.number().int().min(1).max(5)).min(1), closures: z.array(dateSchema).default([]) }).passthrough().parse(calendarSetting.value);
        const endsOn =
          serviceEndDate(
            body.startsOn,
            durationDays,
            calendar.closures,
          );

        /*
         * Anti-chevauchement.
         *
         * Les abonnements annulés
         * ne bloquent pas une
         * nouvelle période.
         */
        const overlap =
          await tx.subscription.findFirst(
            {
              where: {
                clientId:
                  body.clientId,

                status: {
                  not:
                    'CANCELLED',
                },

                startsOn: {
                  lte:
                    new Date(
                      endsOn,
                    ),
                },

                endsOn: {
                  gte:
                    new Date(
                      body.startsOn,
                    ),
                },
              },

              select: {
                id: true,
                startsOn:
                  true,
                endsOn:
                  true,
                status: true,
              },
            },
          );

        if (overlap) {
          throw new DomainError(
            'SUBSCRIPTION_OVERLAP',
            'Une période d’abonnement existe déjà sur ces dates.',
            409,
          );
        }

        const rights =
          buildRights(
            body.startsOn,
            endsOn,
            uniqueDays,
            services,
            rules.data,
            calendar.closures,
          );
          const serviceSnapshot =
  JSON.parse(
    JSON.stringify({
      planCode:
        version.plan.code,

      planName:
        version.plan.name,

      planVersion:
        version.version,

      durationDays,

      services,

      eligibleDays:
        uniqueDays,

      quotaRules:
        rules.data,

      deliveryIncluded:
        version.deliveryIncluded,
    }),
  ) as Prisma.InputJsonValue;

        const subscription =
          await tx.subscription.create(
            {
              data: {
                clientId:
                  body.clientId,

                planVersionId:
                  version.id,

                status:
                  'PENDING_PAYMENT',

                startsOn:
                  new Date(
                    body.startsOn,
                  ),

                endsOn:
                  new Date(
                    endsOn,
                  ),

                amount:
                  version.price,

                currency:
                  version.currency,

                paidAmount:
                  new Decimal(0),

                balance:
                  version.price,

                deliveryIncluded:
                  version.deliveryIncluded,

                /*
                 * Snapshot :
                 * une modification
                 * future de la
                 * formule ne change
                 * pas cet abonnement.
                 */
                serviceSnapshot,

                rights: {
                  create:
                    rights,
                },
              },

              include: {
                planVersion: {
                  include: {
                    plan: true,
                  },
                },

                _count: {
                  select: {
                    rights: true,
                  },
                },
              },
            },
          );

        await audit(
          tx,
          req.actor.id,
          'SUBSCRIPTION_CREATED',
          'Subscription',
          subscription.id,
          {
            clientId:
              body.clientId,

            planVersionId:
              version.id,

            startsOn:
              body.startsOn,

            endsOn,

            amount:
              version.price.toString(),

            currency:
              version.currency,

            generatedRights:
              rights.length,
          },
        );

        return subscription;
      },
    ).then(
      (data) => ({
        success: true,
        data,
      }),
    );
  }

  /*
   * Paiement complet OU partiel.
   */
  @Require(
    'sales.create',
  )
  @Post(':id/payments')
  pay(
    @Param('id')
    id: string,

    @Body()
    input: unknown,

    @Headers(
      'idempotency-key',
    )
    key:
      | string
      | undefined,

    @Req()
    req: AuthRequest,
  ) {
    uuid.parse(id);

    const body =
      subscriptionPaymentSchema.parse(
        input,
      );

    return mutate(
      this.db,
      'subscription.pay',
      key,
      req.actor.id,
      {
        id,
        ...body,
      },

      async (tx) => {
        await lockCash(
          tx,
          body.cashSessionId,
          req.actor.id,
        );

        await tx.$queryRaw`
          SELECT id
          FROM "Subscription"
          WHERE id = ${id}::uuid
          FOR UPDATE
        `;

        const sub =
          await tx.subscription.findUnique(
            {
              where: {
                id,
              },

              include: {
                payments:
                  true,
              },
            },
          );

        if (!sub) {
          throw new DomainError(
            'SUBSCRIPTION_NOT_FOUND',
            'Abonnement introuvable.',
            404,
          );
        }

        if (
  sub.status ===
  'CANCELLED'
) {
  throw new DomainError(
    'SUBSCRIPTION_NOT_PAYABLE',
    'Cet abonnement annulé ne peut plus recevoir de paiement.',
    409,
  );
}

        if (
          sub.balance.lte(
            0,
          )
        ) {
          throw new DomainError(
            'SUBSCRIPTION_ALREADY_PAID',
            'Cet abonnement est déjà entièrement réglé.',
            409,
          );
        }

        /*
         * Tant qu'un paiement
         * externe précédent est
         * en attente, on évite une
         * deuxième tentative qui
         * pourrait dépasser le
         * solde.
         */
        if (
          sub.payments.some(
            (payment) =>
              payment.status ===
              'PENDING',
          )
        ) {
          throw new DomainError(
            'PAYMENT_ALREADY_PENDING',
            'Un paiement est déjà en attente de confirmation.',
            409,
          );
        }

        /*
         * Compatibilité avec
         * l'ancien frontend :
         *
         * si amount n'est pas
         * envoyé et que la devise
         * reçue = devise abonnement,
         * receivedAmount devient
         * le montant imputé.
         */
        const amountRaw =
          body.amount ??
          (body.receivedCurrency ===
          sub.currency
            ? body.receivedAmount
            : undefined);

        if (!amountRaw) {
          throw new DomainError(
            'APPLIED_AMOUNT_REQUIRED',
            'Indiquez le montant à imputer sur l’abonnement.',
            400,
          );
        }

        const appliedAmount =
          new Decimal(
            amountRaw,
          );

        if (
          appliedAmount.lte(
            0,
          )
        ) {
          throw new DomainError(
            'INVALID_AMOUNT',
            'Le montant doit être supérieur à zéro.',
            400,
          );
        }

        if (
          appliedAmount.gt(
            sub.balance,
          )
        ) {
          throw new DomainError(
            'PAYMENT_EXCEEDS_BALANCE',
            'Le paiement dépasse le solde restant de l’abonnement.',
            400,
          );
        }

        const rate =
          sub.currency !==
          body.receivedCurrency
            ? await tx.exchangeRate.findFirst(
                {
                  where: {
                    status:
                      'ACTIVE',

                    baseCurrency:
                      'USD',

                    quoteCurrency:
                      'CDF',

                    effectiveFrom:
                      {
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

        /*
         * settlement compare
         * receivedAmount à
         * appliedAmount.
         *
         * Pour un abonnement, le
         * paiement doit correspondre
         * exactement au montant à
         * imputer : pas de rendu de
         * monnaie implicite.
         */
        const change =
          settlement(
            appliedAmount,
            sub.currency,

            new Decimal(
              body.receivedAmount,
            ),

            body.receivedCurrency,

            rate?.rate,
          );

        if (
          !change.eq(0)
        ) {
          throw new DomainError(
            'EXACT_AMOUNT_REQUIRED',
            'Le montant reçu doit correspondre exactement au montant imputé sur l’abonnement.',
            400,
          );
        }

        const payment =
          await tx.payment.create(
            {
              data: {
                subscriptionId:
                  id,

                cashSessionId:
                  body.cashSessionId,

                method:
                  body.method,

                operator:
                  body.method,

                status:
                  body.method ===
                  'CASH'
                    ? 'CONFIRMED'
                    : 'PENDING',

                referenceCurrency:
                  sub.currency,

                /*
                 * Ici amountDue
                 * représente le
                 * montant réellement
                 * imputé par CE
                 * paiement.
                 */
                amountDue:
                  appliedAmount,

                receivedAmount:
                  body.receivedAmount,

                receivedCurrency:
                  body.receivedCurrency,

                exchangeRateSnapshot:
                  rate?.rate,

                changeAmount:
                  new Decimal(
                    0,
                  ),

                changeCurrency:
                  sub.currency,

                idempotencyKey:
                  key!,

                externalReference:
                  body.externalReference,

                confirmedAt:
                  body.method ===
                  'CASH'
                    ? new Date()
                    : null,

                confirmedById:
                  body.method ===
                  'CASH'
                    ? req.actor.id
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
            },
          );

        if (
          payment.status ===
          'CONFIRMED'
        ) {
          /*
           * finishPayment met déjà
           * à jour :
           *
           * paidAmount
           * balance
           * PENDING_PAYMENT
           * SCHEDULED
           * ACTIVE
           * EXPIRED
           */
          await finishPayment(
            tx,
            payment.id,
            req.actor.id,
          );
        } else {
          await audit(
            tx,
            req.actor.id,
            'PAYMENT_PENDING',
            'Payment',
            payment.id,
            {
              subscriptionId:
                id,

              appliedAmount:
                appliedAmount.toString(),
            },
          );
        }

        const updated =
          await tx.subscription.findUniqueOrThrow(
            {
              where: {
                id,
              },
            },
          );

        return {
          payment,

          subscription:
            updated,
        };
      },
    ).then(
      (data) => ({
        success: true,
        data,
      }),
    );
  }
  @Require(
  'subscriptions.create',
)
@Post(':id/renew')
renew(
  @Param('id')
  id: string,

  @Body()
  input: unknown,

  @Headers(
    'idempotency-key',
  )
  key:
    | string
    | undefined,

  @Req()
  req: AuthRequest,
) {
  uuid.parse(id);

  const body =
    renewalSchema.parse(
      input,
    );

  return mutate(
    this.db,
    'subscription.renew',
    key,
    req.actor.id,
    {
      id,
      ...body,
    },

    async (tx) => {
      await tx.$queryRaw`
        SELECT id
        FROM "Subscription"
        WHERE id = ${id}::uuid
        FOR UPDATE
      `;

      const source =
        await tx.subscription.findUnique(
          {
            where: {
              id,
            },

            include: {
              planVersion:
                true,
            },
          },
        );

      if (!source) {
        throw new DomainError(
          'SUBSCRIPTION_NOT_FOUND',
          'Abonnement introuvable.',
          404,
        );
      }

      if (
        ![
          'ACTIVE',
          'SUSPENDED',
          'EXPIRED',
        ].includes(
          source.status,
        )
      ) {
        throw new DomainError(
          'RENEWAL_NOT_ALLOWED',
          'Cet abonnement ne peut pas être renouvelé dans son état actuel.',
          409,
        );
      }

      await tx.$queryRaw`
        SELECT id
        FROM "Client"
        WHERE id = ${source.clientId}::uuid
        FOR UPDATE
      `;

      const defaultStart =
        addDays(
          source.endsOn
            .toISOString()
            .slice(0, 10),

          1,
        );

      const startsOn =
        body.startsOn ??
        defaultStart;

      /*
       * Un renouvellement ne peut
       * pas écraser la période
       * précédente.
       */
      if (
        startsOn <=
        source.endsOn
          .toISOString()
          .slice(0, 10)
      ) {
        throw new DomainError(
          'RENEWAL_DATE_INVALID',
          'Le renouvellement doit commencer après la fin de la période précédente.',
          400,
        );
      }

      const startDate =
        new Date(startsOn);

      /*
       * Sans version explicitement
       * choisie, on prend la version
       * applicable du même plan à la
       * nouvelle date.
       */
      const version =
        body.planVersionId
          ? await tx.subscriptionPlanVersion.findUnique(
              {
                where: {
                  id:
                    body.planVersionId,
                },

                include: {
                  plan: true,
                },
              },
            )
          : await tx.subscriptionPlanVersion.findFirst(
              {
                where: {
                  planId:
                    source
                      .planVersion
                      .planId,

                  status: {
                    in: [
                      'ACTIVE',
                      'SCHEDULED',
                    ],
                  },

                  effectiveFrom:
                    {
                      lte:
                        startDate,
                    },

                  OR: [
                    {
                      effectiveTo:
                        null,
                    },

                    {
                      effectiveTo:
                        {
                          gt:
                            startDate,
                        },
                    },
                  ],
                },

                orderBy: [
                  {
                    effectiveFrom:
                      'desc',
                  },

                  {
                    version:
                      'desc',
                  },
                ],

                include: {
                  plan: true,
                },
              },
            );

      if (!version) {
        throw new DomainError(
          'PLAN_VERSION_NOT_FOUND',
          'Aucune version de formule applicable n’est disponible pour cette date.',
          404,
        );
      }

      /*
       * Pour un véritable
       * renouvellement, on reste
       * dans la même formule.
       *
       * Un changement de formule
       * se fait par une nouvelle
       * souscription.
       */
      if (
        version.planId !==
        source
          .planVersion
          .planId
      ) {
        throw new DomainError(
          'RENEWAL_PLAN_MISMATCH',
          'La version sélectionnée appartient à une autre formule.',
          400,
        );
      }

      if (
        version.status ===
        'RETIRED' ||
        version.effectiveFrom >
          startDate ||
        (version.effectiveTo &&
          version.effectiveTo <=
            startDate)
      ) {
        throw new DomainError(
          'PLAN_NOT_EFFECTIVE',
          'Cette version de formule n’est pas applicable à la date du renouvellement.',
          409,
        );
      }

      const rules =
        rulesSchema.safeParse(
          version.quotaRules,
        );

      if (!rules.success) {
        throw new DomainError(
          'PLAN_NOT_VALIDATED',
          'Les règles de cette formule ne sont pas validées.',
          409,
        );
      }

      const services =
        z
          .array(
            serviceCodeSchema,
          )
          .min(1)
          .parse(
            version.services,
          );

      validateServices(
        services,
      );

      const eligibleDays =
        [
          ...new Set(
            z
              .array(
                z
                  .number()
                  .int()
                  .min(0)
                  .max(6),
              )
              .min(1)
              .parse(
                version
                  .eligibilityDays,
              ),
          ),
        ];

      const durationDays =
        version.durationDays;

      const calendarSetting = await tx.setting.findUnique({ where: { key: 'calendrier' } });
      if (!calendarSetting?.validated) throw new DomainError('CALENDAR_NOT_VALIDATED', 'Le calendrier commercial doit être validé avant de renouveler un abonnement.', 409);
      const calendar = z.object({ weekdays: z.array(z.number().int().min(1).max(5)).min(1), closures: z.array(dateSchema).default([]) }).passthrough().parse(calendarSetting.value);

      const endsOn =
        serviceEndDate(
          startsOn,
          durationDays,
          calendar.closures,
        );

      const overlap =
        await tx.subscription.findFirst(
          {
            where: {
              clientId:
                source.clientId,

              status: {
                not:
                  'CANCELLED',
              },

              startsOn: {
                lte:
                  new Date(
                    endsOn,
                  ),
              },

              endsOn: {
                gte:
                  new Date(
                    startsOn,
                  ),
              },
            },

            select: {
              id: true,
            },
          },
        );

      if (overlap) {
        throw new DomainError(
          'SUBSCRIPTION_OVERLAP',
          'Une autre période d’abonnement existe déjà sur ces dates.',
          409,
        );
      }

      const rights =
        buildRights(
          startsOn,
          endsOn,
          eligibleDays,
          services,
          rules.data,
          calendar.closures,
        );

      const serviceSnapshot =
        JSON.parse(
          JSON.stringify({
            planCode:
              version.plan.code,

            planName:
              version.plan.name,

            planVersion:
              version.version,

            durationDays,

            services,

            eligibleDays,

            quotaRules:
              rules.data,

            deliveryIncluded:
              version.deliveryIncluded,
          }),
        ) as Prisma.InputJsonValue;

      const renewal =
        await tx.subscription.create(
          {
            data: {
              clientId:
                source.clientId,

              planVersionId:
                version.id,

              renewedFromId:
                source.id,

              status:
                'PENDING_PAYMENT',

              startsOn:
                new Date(
                  startsOn,
                ),

              endsOn:
                new Date(
                  endsOn,
                ),

              amount:
                version.price,

              currency:
                version.currency,

              paidAmount:
                new Decimal(0),

              balance:
                version.price,

              serviceSnapshot,

              deliveryIncluded:
                version.deliveryIncluded,

              rights: {
                create:
                  rights,
              },
            },

            include: {
              planVersion: {
                include: {
                  plan: true,
                },
              },

              _count: {
                select: {
                  rights:
                    true,
                },
              },
            },
          },
        );

      await audit(
        tx,
        req.actor.id,
        'SUBSCRIPTION_RENEWED',
        'Subscription',
        source.id,
        {
          renewalId:
            renewal.id,

          startsOn,

          endsOn,

          previousBalance:
            source.balance.toString(),

          /*
           * L'ancienne dette reste
           * sur l'ancien abonnement.
           */
          newAmount:
            version.price.toString(),
        },
      );

      await audit(
        tx,
        req.actor.id,
        'SUBSCRIPTION_CREATED_BY_RENEWAL',
        'Subscription',
        renewal.id,
        {
          renewedFromId:
            source.id,
        },
      );

      return renewal;
    },
  ).then(
    (data) => ({
      success: true,
      data,
    }),
  );
}
@Require(
  'subscriptions.suspend',
)
@Post(':id/suspend')
suspend(
  @Param('id')
  id: string,

  @Body()
  input: unknown,

  @Headers(
    'idempotency-key',
  )
  key:
    | string
    | undefined,

  @Req()
  req: AuthRequest,
) {
  uuid.parse(id);

  const body =
    suspensionSchema.parse(
      input,
    );

  return mutate(
    this.db,
    'subscription.suspend',
    key,
    req.actor.id,
    {
      id,
      ...body,
    },

    async (tx) => {
      await tx.$queryRaw`
        SELECT id
        FROM "Subscription"
        WHERE id = ${id}::uuid
        FOR UPDATE
      `;

      const subscription =
        await tx.subscription.findUnique(
          {
            where: {
              id,
            },
          },
        );

      if (!subscription) {
        throw new DomainError(
          'SUBSCRIPTION_NOT_FOUND',
          'Abonnement introuvable.',
          404,
        );
      }

      if (
        subscription.status !==
        'ACTIVE'
      ) {
        throw new DomainError(
          'SUBSCRIPTION_NOT_SUSPENDABLE',
          'Seul un abonnement actif peut être suspendu.',
          409,
        );
      }

      const today =
        localDate();

      /*
       * Une réservation existante
       * ne doit pas être supprimée
       * silencieusement.
       */
      const reserved =
        await tx.mealRight.count(
          {
            where: {
              subscriptionId:
                id,

              status:
                'RESERVED',

              businessDate: {
                gte:
                  new Date(
                    today,
                  ),
              },
            },
          },
        );

      if (reserved > 0) {
        throw new DomainError(
          'SUBSCRIPTION_HAS_RESERVED_RIGHTS',
          'Cet abonnement possède un ou plusieurs repas réservés. Traitez ces réservations avant la suspension.',
          409,
        );
      }

      const suspension =
        await tx.subscriptionSuspension.create(
          {
            data: {
              subscriptionId:
                id,

              startsOn:
                new Date(
                  today,
                ),

              reason:
                body.reason,

              createdById:
                req.actor.id,

              /*
               * Aucune extension
               * implicite.
               */
              endDateExtended:
                false,
            },
          },
        );

      await tx.subscription.update(
        {
          where: {
            id,
          },

          data: {
            status:
              'SUSPENDED',
          },
        },
      );

      /*
       * IMPORTANT :
       *
       * on ne détruit aucun
       * MealRight ici.
       *
       * Le statut SUSPENDED suffit
       * à empêcher sa consommation.
       */
      await audit(
        tx,
        req.actor.id,
        'SUBSCRIPTION_SUSPENDED',
        'Subscription',
        id,
        {
          suspensionId:
            suspension.id,

          startsOn:
            today,

          reason:
            body.reason,

          endDateExtended:
            false,
        },
      );

      return {
        id,

        status:
          'SUSPENDED',

        suspension,
      };
    },
  ).then(
    (data) => ({
      success: true,
      data,
    }),
  );
}
@Require(
  'subscriptions.suspend',
)
@Post(':id/resume')
resume(
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
  uuid.parse(id);

  return mutate(
    this.db,
    'subscription.resume',
    key,
    req.actor.id,
    {
      id,
    },

    async (tx) => {
      await tx.$queryRaw`
        SELECT id
        FROM "Subscription"
        WHERE id = ${id}::uuid
        FOR UPDATE
      `;

      const subscription =
        await tx.subscription.findUnique(
          {
            where: {
              id,
            },
          },
        );

      if (!subscription) {
        throw new DomainError(
          'SUBSCRIPTION_NOT_FOUND',
          'Abonnement introuvable.',
          404,
        );
      }

      if (
        subscription.status !==
        'SUSPENDED'
      ) {
        throw new DomainError(
          'SUBSCRIPTION_NOT_SUSPENDED',
          'Cet abonnement n’est pas suspendu.',
          409,
        );
      }

      const suspension =
        await tx.subscriptionSuspension.findFirst(
          {
            where: {
              subscriptionId:
                id,

              resumedAt:
                null,
            },

            orderBy: {
              createdAt:
                'desc',
            },
          },
        );

      if (!suspension) {
        throw new DomainError(
          'SUSPENSION_NOT_FOUND',
          'Aucune suspension ouverte n’a été trouvée.',
          409,
        );
      }

      const today =
        localDate();

      const now =
        new Date();

      /*
       * Les droits antérieurs à la
       * date de reprise qui n'ont
       * jamais été utilisés sont
       * annulés.
       *
       * Ils ne sont PAS reportés.
       */
      const cancelledRights =
        await tx.mealRight.updateMany(
          {
            where: {
              subscriptionId:
                id,

              status:
                'AVAILABLE',

              businessDate: {
                gte:
                  suspension.startsOn,

                lt:
                  new Date(
                    today,
                  ),
              },
            },

            data: {
              status:
                'CANCELLED',
            },
          },
        );

      await tx.subscriptionSuspension.update(
        {
          where: {
            id:
              suspension.id,
          },

          data: {
            endsOn:
              new Date(
                today,
              ),

            resumedAt:
              now,

            resumedById:
              req.actor.id,

            /*
             * Toujours aucune
             * prolongation.
             */
            endDateExtended:
              false,
          },
        },
      );

      let nextStatus:
        | 'PENDING_PAYMENT'
        | 'SCHEDULED'
        | 'ACTIVE'
        | 'EXPIRED';

      if (
        subscription.balance.gt(
          0,
        )
      ) {
        nextStatus =
          'PENDING_PAYMENT';
      } else if (
        subscription.startsOn
          .toISOString()
          .slice(0, 10) >
        today
      ) {
        nextStatus =
          'SCHEDULED';
      } else if (
        subscription.endsOn
          .toISOString()
          .slice(0, 10) <
        today
      ) {
        nextStatus =
          'EXPIRED';
      } else {
        nextStatus =
          'ACTIVE';
      }

      await tx.subscription.update(
        {
          where: {
            id,
          },

          data: {
            status:
              nextStatus,
          },
        },
      );

      await audit(
        tx,
        req.actor.id,
        'SUBSCRIPTION_RESUMED',
        'Subscription',
        id,
        {
          suspensionId:
            suspension.id,

          resumedOn:
            today,

          status:
            nextStatus,

          cancelledUnusedRights:
            cancelledRights.count,

          endDateExtended:
            false,
        },
      );

      return {
        id,

        status:
          nextStatus,

        cancelledUnusedRights:
          cancelledRights.count,
      };
    },
  ).then(
    (data) => ({
      success: true,
      data,
    }),
  );
}@Require(
  'subscriptions.cancel',
)
@Post(':id/cancel')
cancel(
  @Param('id')
  id: string,

  @Body()
  input: unknown,

  @Headers(
    'idempotency-key',
  )
  key:
    | string
    | undefined,

  @Req()
  req: AuthRequest,
) {
  uuid.parse(id);

  const body =
    cancellationSchema.parse(
      input,
    );

  return mutate(
    this.db,
    'subscription.cancel',
    key,
    req.actor.id,
    {
      id,
      ...body,
    },

    async (tx) => {
      await tx.$queryRaw`
        SELECT id
        FROM "Subscription"
        WHERE id = ${id}::uuid
        FOR UPDATE
      `;

      const subscription =
        await tx.subscription.findUnique(
          {
            where: {
              id,
            },
          },
        );

      if (!subscription) {
        throw new DomainError(
          'SUBSCRIPTION_NOT_FOUND',
          'Abonnement introuvable.',
          404,
        );
      }

      if (
        subscription.status ===
        'CANCELLED'
      ) {
        throw new DomainError(
          'SUBSCRIPTION_ALREADY_CANCELLED',
          'Cet abonnement est déjà annulé.',
          409,
        );
      }

      if (
        subscription.status ===
        'EXPIRED'
      ) {
        throw new DomainError(
          'SUBSCRIPTION_ALREADY_EXPIRED',
          'Un abonnement déjà expiré ne peut pas être annulé rétroactivement.',
          409,
        );
      }

      /*
       * Une réservation doit être
       * traitée explicitement.
       */
      const reserved =
        await tx.mealRight.count(
          {
            where: {
              subscriptionId:
                id,

              status:
                'RESERVED',
            },
          },
        );

      if (reserved > 0) {
        throw new DomainError(
          'SUBSCRIPTION_HAS_RESERVED_RIGHTS',
          'Des repas sont encore réservés. Annulez ou traitez ces réservations avant d’annuler l’abonnement.',
          409,
        );
      }

      /*
       * Les consommations passées
       * sont conservées.
       *
       * Seuls les droits encore
       * disponibles deviennent
       * CANCELLED.
       */
      const cancelledRights =
        await tx.mealRight.updateMany(
          {
            where: {
              subscriptionId:
                id,

              status:
                'AVAILABLE',
            },

            data: {
              status:
                'CANCELLED',
            },
          },
        );

      const today =
        localDate();

      /*
       * Si l'abonnement était
       * suspendu, on ferme la
       * période de suspension sans
       * prétendre qu'elle a été
       * "reprise".
       */
      await tx.subscriptionSuspension.updateMany(
        {
          where: {
            subscriptionId:
              id,

            resumedAt:
              null,

            endsOn:
              null,
          },

          data: {
            endsOn:
              new Date(
                today,
              ),
          },
        },
      );

      await tx.subscription.update(
        {
          where: {
            id,
          },

          data: {
            status:
              'CANCELLED',
          },
        },
      );

      await audit(
        tx,
        req.actor.id,
        'SUBSCRIPTION_CANCELLED',
        'Subscription',
        id,
        {
          reason:
            body.reason,

          cancelledRights:
            cancelledRights.count,

          /*
           * Le montant payé et le
           * solde NE SONT PAS
           * effacés.
           */
          amount:
            subscription.amount.toString(),

          paidAmount:
            subscription.paidAmount.toString(),

          balance:
            subscription.balance.toString(),
        },
      );

      return {
        id,

        status:
          'CANCELLED',

        cancelledRights:
          cancelledRights.count,

        amount:
          subscription.amount,

        paidAmount:
          subscription.paidAmount,

        balance:
          subscription.balance,
      };
    },
  ).then(
    (data) => ({
      success: true,
      data,
    }),
  );
}
}
