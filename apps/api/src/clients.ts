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

import {
  createHash,
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';

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
import { ClientPortalService } from './client-portal';

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

const normalizedName=(value:string)=>value.normalize('NFKC').trim().toLocaleLowerCase('fr');
const sameIdentity=(first:string,last:string,category:string,otherFirst:string,otherLast:string,otherCategory:string)=>normalizedName(first)===normalizedName(otherFirst)&&normalizedName(last)===normalizedName(otherLast)&&category===otherCategory;

const mergeSchema = z
  .object({
    targetClientId: uuid,
  })
  .strict();

const scanSchema = z
  .object({
    token: z
      .string()
      .trim()
      .min(20, 'Saisissez le code complet affiché sous le QR Code.')
      .max(200, 'Le code QR est invalide.'),
  })
  .strict();

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

function tokenHash(
  token: string,
) {
  return createHash('sha256')
    .update(token)
    .digest('hex');
}

function newQrToken() {
  return (
    'JAMI-' +
    randomBytes(32)
      .toString('base64url')
  );
}

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
  constructor(
    private readonly prisma:
      PrismaService,
    private readonly portal:
      ClientPortalService,
  ) {}

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
    let portalAccount: Record<string, unknown> = { created: false, reason: 'EMAIL_REQUIRED' };
    if (data.email) {
      try {
        portalAccount = await this.portal.provisionExistingClient(client.id, actorId);
      } catch (error) {
        portalAccount = { created: false, error: error instanceof DomainError ? error.message : 'Compte portail non créé. Réessayez depuis la fiche client.' };
      }
    }
    return { ...client, portalAccount };
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

  async detail(
    clientId: string,
  ) {
    uuid.parse(clientId);

    const client =
      await this.prisma.client.findUnique(
        {
          where: {
            id: clientId,
          },

          include: {
            category: true,

            account: {
              select: {
                id: true,
                type: true,
                verificationStatus: true,
                emailVerifiedAt: true,
                createdAt: true,
              },
            },

            qrCodes: {
              orderBy: {
                issuedAt:
                  'desc',
              },

              include: {
                history: {
                  orderBy: {
                    createdAt:
                      'desc',
                  },
                },
              },
            },
          },
        },
      );

    if (!client) {
      throw new DomainError(
        'CLIENT_NOT_FOUND',
        'Client introuvable.',
        404,
      );
    }

    return client;
  }

  async linkExistingPortalAccount(clientId:string,actorId:string) {
    uuid.parse(clientId);
    const target=await this.prisma.client.findUnique({where:{id:clientId},include:{category:true,account:true}});
    if(!target||target.status!=='ACTIVE')throw new DomainError('CLIENT_NOT_FOUND','Fiche client introuvable ou archivée.',404);
    if(target.account)throw new DomainError('CLIENT_ACCOUNT_EXISTS','Un compte portail est déjà lié à cette fiche.',409);
    if(!target.email)throw new DomainError('CLIENT_EMAIL_REQUIRED','Enregistrez d’abord le courriel vérifié du client sur sa fiche.',400);
    const candidate=await this.prisma.clientAccount.findUnique({where:{email:target.email.trim().toLowerCase()},include:{client:{include:{category:true,_count:{select:{orders:true,subscriptions:true}}}}}});
    if(!candidate)throw new DomainError('CLIENT_ACCOUNT_NOT_FOUND','Aucun compte portail ne correspond au courriel de cette fiche.',404);
    if(candidate.clientId===target.id)throw new DomainError('CLIENT_ACCOUNT_EXISTS','Un compte portail est déjà lié à cette fiche.',409);
    if(!candidate.emailVerifiedAt)throw new DomainError('CLIENT_ACCOUNT_EMAIL_UNVERIFIED','Le propriétaire doit d’abord vérifier son adresse e-mail.',409);
    if(candidate.verificationStatus==='SUSPENDED')throw new DomainError('CLIENT_ACCOUNT_SUSPENDED','Ce compte portail est suspendu et ne peut pas être rattaché.',409);
    if(!sameIdentity(target.firstName,target.lastName,target.category.code,candidate.client.firstName,candidate.client.lastName,candidate.client.category.code))throw new DomainError('CLIENT_ACCOUNT_IDENTITY_MISMATCH','Le nom ou la catégorie du compte portail ne correspond pas à cette fiche.',409);
    if(candidate.client._count.orders>0||candidate.client._count.subscriptions>0)throw new DomainError('CLIENT_ACCOUNT_HAS_ACTIVITY','Ce compte possède déjà des commandes ou abonnements sur une autre fiche. Une fusion vérifiée est nécessaire avant le rattachement.',409);
    return this.prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT "id" FROM "Client" WHERE "id" IN (${clientId}::uuid,${candidate.clientId}::uuid) ORDER BY "id" FOR UPDATE`;
      const [lockedTarget,account]=await Promise.all([
        tx.client.findUnique({where:{id:clientId},include:{category:true,account:true}}),
        tx.clientAccount.findUnique({where:{id:candidate.id},include:{client:{include:{category:true,_count:{select:{orders:true,subscriptions:true}}}}}}),
      ]);
      if(!lockedTarget||lockedTarget.status!=='ACTIVE'||lockedTarget.account)throw new DomainError('CLIENT_ACCOUNT_EXISTS','Cette fiche a changé; rechargez-la avant de réessayer.',409);
      if(!account||account.clientId!==candidate.clientId||account.email.toLowerCase()!==lockedTarget.email?.trim().toLowerCase()||!account.emailVerifiedAt)throw new DomainError('CLIENT_ACCOUNT_CHANGED','Le compte portail a changé. Rechargez la fiche et réessayez.',409);
      if(!sameIdentity(lockedTarget.firstName,lockedTarget.lastName,lockedTarget.category.code,account.client.firstName,account.client.lastName,account.client.category.code)||account.client._count.orders>0||account.client._count.subscriptions>0)throw new DomainError('CLIENT_ACCOUNT_IDENTITY_MISMATCH','Le compte portail ne peut pas être rattaché à cette fiche.',409);
      const activeCodes=await tx.qRCode.findMany({where:{clientId:account.clientId,status:'ACTIVE'},select:{id:true}});
      for(const code of activeCodes)await tx.qRCode.update({where:{id:code.id},data:{status:'REVOKED',revokedAt:new Date(),history:{create:{action:'REVOKED_ACCOUNT_RELINKED',actorId,metadata:{targetClientId:clientId}}}}});
      await tx.clientAccount.update({where:{id:account.id},data:{clientId,verificationStatus:'PENDING',verifiedAt:null,verifiedById:null}});
      await tx.clientSession.deleteMany({where:{accountId:account.id}});
      await tx.clientPortalEvent.create({data:{accountId:account.id,action:'ACCOUNT_LINKED_TO_CLIENT',metadata:{previousClientId:candidate.clientId,targetClientId:clientId}}});
      await tx.auditLog.create({data:{actorId,action:'CLIENT_PORTAL_ACCOUNT_RELINKED',entityType:'ClientAccount',entityId:account.id,oldValue:{clientId:candidate.clientId,verificationStatus:account.verificationStatus},newValue:{clientId,verificationStatus:'PENDING'},metadata:{targetClientId:clientId}}});
      return {linked:true,verificationStatus:'PENDING' as const};
    });
  }

  async controlCard(
    clientId: string,
    actorId: string,
    source: string,
  ) {
    uuid.parse(clientId);

    const businessDate =
      todayKinshasa();

    const client =
      await this.prisma.client.findUnique(
        {
          where: {
            id: clientId,
          },

          select: {
            ...clientSelect,

            subscriptions: {
              orderBy: {
                startsOn:
                  'desc',
              },

              include: {
                planVersion: {
                  include: {
                    plan: true,
                  },
                },

                rights: {
                  where: {
                    businessDate,
                  },

                  orderBy: {
                    serviceCode:
                      'asc',
                  },
                },
              },
            },
          },
        },
      );

    if (
      !client ||
      client.status !==
        'ACTIVE'
    ) {
      throw new DomainError(
        'CLIENT_NOT_ACTIVE',
        'Client introuvable ou archivé.',
        404,
      );
    }

    await this.prisma.auditLog.create(
      {
        data: {
          actorId,

          action:
            'CLIENT_CONTROL_VIEWED',

          entityType:
            'Client',

          entityId:
            client.id,

          newValue: {
            source,
          },
        },
      },
    );

    return client;
  }

  async byQr(
    input: unknown,
    actorId: string,
  ) {
    const {
      token,
    } =
      scanSchema.parse(input);

    const code =
      await this.prisma.qRCode.findUnique(
        {
          where: {
            tokenHash:
              tokenHash(token),
          },

          select: {
            id: true,
            clientId: true,
            status: true,
          },
        },
      );

    if (
      !code ||
      code.status !==
        'ACTIVE'
    ) {
      throw new DomainError(
        'QR_CODE_REVOKED',
        'Ce QR Code est invalide, révoqué ou remplacé.',
        404,
      );
    }

    return this.controlCard(
      code.clientId,
      actorId,
      'QR',
    );
  }

  issueQr(
    clientId: string,
    key:
      | string
      | undefined,
    actorId: string,
  ) {
    uuid.parse(clientId);

    return mutate(
      this.prisma,
      'qr.issue',
      key,
      actorId,
      {
        clientId,
      },

      async (tx) => {
        await tx.$queryRaw`
          SELECT id
          FROM "Client"
          WHERE id = ${clientId}::uuid
          FOR UPDATE
        `;

        const client =
          await tx.client.findUnique({
            where: {
              id: clientId,
            },
          });

        if (
          !client ||
          client.status !==
            'ACTIVE'
        ) {
          throw new DomainError(
            'CLIENT_NOT_FOUND',
            'Client introuvable.',
            404,
          );
        }

        const active =
          await tx.qRCode.findFirst({
            where: {
              clientId,
              status: 'ACTIVE',
            },
          });

        if (active) {
          throw new DomainError(
            'ACTIVE_QR_ALREADY_EXISTS',
            'Ce client possède déjà un QR Code actif. Utilisez Remplacer.',
            409,
          );
        }

        const token =
          newQrToken();

        const code =
          await tx.qRCode.create({
            data: {
              clientId,

              tokenHash:
                tokenHash(token),
              tokenCiphertext: encryptQrToken(token),

              history: {
                create: {
                  action:
                    'ISSUED',

                  actorId,
                },
              },
            },
          });

        await audit(
          tx,
          actorId,
          'QR_ISSUED',
          'QRCode',
          code.id,
          {
            clientId,
          },
        );

        return {
          token,

          qrCode: {
            id: code.id,

            status:
              code.status,

            issuedAt:
              code.issuedAt,
          },
        };
      },
    );
  }

  replaceQr(
    clientId: string,
    key:
      | string
      | undefined,
    actorId: string,
  ) {
    uuid.parse(clientId);

    return mutate(
      this.prisma,
      'qr.replace',
      key,
      actorId,
      {
        clientId,
      },

      async (tx) => {
        await tx.$queryRaw`
          SELECT id
          FROM "Client"
          WHERE id = ${clientId}::uuid
          FOR UPDATE
        `;

        const client =
          await tx.client.findUnique({
            where: {
              id: clientId,
            },
          });

        if (
          !client ||
          client.status !==
            'ACTIVE'
        ) {
          throw new DomainError(
            'CLIENT_NOT_FOUND',
            'Client introuvable.',
            404,
          );
        }

        const active =
          await tx.qRCode.findMany({
            where: {
              clientId,
              status: 'ACTIVE',
            },

            orderBy: {
              issuedAt:
                'desc',
            },
          });

        if (!active.length) {
          throw new DomainError(
            'NO_ACTIVE_QR',
            'Ce client ne possède aucun QR Code actif. Utilisez Émettre.',
            409,
          );
        }

        const token =
          newQrToken();

        // Retire the current code before inserting its replacement so the
        // partial unique index on one ACTIVE QR per client remains valid.
        for (const old of active) {
          await tx.qRCode.update({where:{id:old.id},data:{status:'REPLACED',revokedAt:new Date(),history:{create:{action:'REPLACED',actorId}}}});
        }

        const newCode =
          await tx.qRCode.create({
            data: {
              clientId,

              tokenHash:
                tokenHash(token),
              tokenCiphertext: encryptQrToken(token),

              history: {
                create: {
                  action:
                    'ISSUED',

                  actorId,
                },
              },
            },
          });

        await tx.qRCode.update({where:{id:active[0].id},data:{replacedById:newCode.id,history:{create:{action:'REPLACEMENT_LINKED',actorId,metadata:{replacedById:newCode.id}}}}});

        await audit(
          tx,
          actorId,
          'QR_REPLACED',
          'QRCode',
          newCode.id,
          {
            clientId,

            replaced:
              active.map(
                (item) =>
                  item.id,
              ),
          },
        );

        return {
          token,

          qrCode: {
            id:
              newCode.id,

            status:
              newCode.status,

            issuedAt:
              newCode.issuedAt,
          },
        };
      },
    );
  }

  revokeQr(
    clientId: string,
    qrCodeId: string,
    key:
      | string
      | undefined,
    actorId: string,
  ) {
    uuid.parse(clientId);
    uuid.parse(qrCodeId);

    return mutate(
      this.prisma,
      'qr.revoke',
      key,
      actorId,
      {
        clientId,
        qrCodeId,
      },

      async (tx) => {
        await tx.$queryRaw`
          SELECT id
          FROM "QRCode"
          WHERE id = ${qrCodeId}::uuid
          FOR UPDATE
        `;

        const code =
          await tx.qRCode.findUnique({
            where: {
              id: qrCodeId,
            },
          });

        if (
          !code ||
          code.clientId !==
            clientId
        ) {
          throw new DomainError(
            'QR_NOT_FOUND',
            'QR Code introuvable.',
            404,
          );
        }

        if (
          code.status !==
          'ACTIVE'
        ) {
          throw new DomainError(
            'QR_ALREADY_INACTIVE',
            'Ce QR Code est déjà inactif.',
            409,
          );
        }

        const revoked =
          await tx.qRCode.update({
            where: {
              id: qrCodeId,
            },

            data: {
              status:
                'REVOKED',

              revokedAt:
                new Date(),

              history: {
                create: {
                  action:
                    'REVOKED',

                  actorId,
                },
              },
            },
          });

        await audit(
          tx,
          actorId,
          'QR_REVOKED',
          'QRCode',
          qrCodeId,
          {
            clientId,
          },
        );

        return revoked;
      },
    );
  }

  archive(
    clientId: string,
    key:
      | string
      | undefined,
    actorId: string,
  ) {
    uuid.parse(clientId);

    return mutate(
      this.prisma,
      'clients.archive',
      key,
      actorId,
      {
        clientId,
      },

      async (tx) => {
        const client =
          await tx.client.findUnique({
            where: {
              id: clientId,
            },
          });

        if (!client) {
          throw new DomainError(
            'CLIENT_NOT_FOUND',
            'Client introuvable.',
            404,
          );
        }

        const activeCodes =
          await tx.qRCode.findMany({
            where: {
              clientId,

              status:
                'ACTIVE',
            },
          });

        await tx.client.update({
          where: {
            id: clientId,
          },

          data: {
            status:
              'ARCHIVED',
          },
        });

        for (
          const code
          of activeCodes
        ) {
          await tx.qRCode.update({
            where: {
              id: code.id,
            },

            data: {
              status:
                'REVOKED',

              revokedAt:
                new Date(),

              history: {
                create: {
                  action:
                    'REVOKED_CLIENT_ARCHIVED',

                  actorId,
                },
              },
            },
          });
        }

        await audit(
          tx,
          actorId,
          'CLIENT_ARCHIVED',
          'Client',
          clientId,
        );

        return {
          id: clientId,

          status:
            'ARCHIVED',
        };
      },
    );
  }

  merge(
    sourceClientId: string,
    input: unknown,
    key:
      | string
      | undefined,
    actorId: string,
  ) {
    uuid.parse(
      sourceClientId,
    );

    const {
      targetClientId,
    } =
      mergeSchema.parse(input);

    if (
      sourceClientId ===
      targetClientId
    ) {
      throw new DomainError(
        'INVALID_MERGE',
        'Une fiche ne peut pas être fusionnée avec elle-même.',
        400,
      );
    }

    return mutate(
      this.prisma,
      'clients.merge',
      key,
      actorId,
      {
        sourceClientId,
        targetClientId,
      },

      async (tx) => {
        const [
          source,
          target,
        ] =
          await Promise.all([
            tx.client.findUnique({
              where: {
                id:
                  sourceClientId,
              },
            }),

            tx.client.findUnique({
              where: {
                id:
                  targetClientId,
              },
            }),
          ]);

        if (
          !source ||
          !target
        ) {
          throw new DomainError(
            'CLIENT_NOT_FOUND',
            'Une des fiches client est introuvable.',
            404,
          );
        }

        if (
          target.status !==
          'ACTIVE'
        ) {
          throw new DomainError(
            'MERGE_TARGET_INACTIVE',
            'La fiche cible doit être active.',
            409,
          );
        }

        if (
          source.mergedIntoId
        ) {
          throw new DomainError(
            'CLIENT_ALREADY_MERGED',
            'Cette fiche a déjà été fusionnée.',
            409,
          );
        }

        const activeCodes =
          await tx.qRCode.findMany({
            where: {
              clientId:
                sourceClientId,

              status:
                'ACTIVE',
            },
          });

        await tx.client.update({
          where: {
            id:
              sourceClientId,
          },

          data: {
            status:
              'ARCHIVED',

            mergedIntoId:
              targetClientId,
          },
        });

        for (
          const code
          of activeCodes
        ) {
          await tx.qRCode.update({
            where: {
              id: code.id,
            },

            data: {
              status:
                'REVOKED',

              revokedAt:
                new Date(),

              history: {
                create: {
                  action:
                    'REVOKED_CLIENT_MERGED',

                  actorId,

                  metadata: {
                    targetClientId,
                  },
                },
              },
            },
          });
        }

        await audit(
          tx,
          actorId,
          'CLIENT_MERGED',
          'Client',
          sourceClientId,
          {
            targetClientId,
          },
        );

        return {
          sourceClientId,

          targetClientId,
        };
      },
    );
  }
}

@Controller('clients')
export class ClientsController {
  constructor(
    private readonly clients:
      ClientsService,

    private readonly prisma:
      PrismaService,
  ) {}

  @Require('clients.create')
  @Post()
  create(
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
      .create(
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

  @Require('clients.read')
  @Get()
  async list(
    @Query()
    query: unknown,
  ) {
    return {
      success: true,

      ...(await this.clients.find(
        query,
      )),
    };
  }

  @Require('clients.read')
  @Get('categories')
  async categories() {
    return {
      success: true,

      data:
        await this.prisma.clientCategory.findMany(
          {
            where: {
              active: true,
            },

            orderBy: {
              label: 'asc',
            },
          },
        ),
    };
  }

  @Require('meal.validate')
  @Post('scan')
  async scan(
    @Body()
    body: unknown,

    @Req()
    req: AuthRequest,
  ) {
    return {
      success: true,

      data:
        await this.clients.byQr(
          body,
          req.actor.id,
        ),
    };
  }

  @Require('clients.read')
  @Get(':id')
  async detail(
    @Param('id')
    id: string,
  ) {
    return {
      success: true,

      data:
        await this.clients.detail(
          id,
        ),
    };
  }

  @Require('clients.verify')
  @Post(':id/account/link')
  async linkPortalAccount(@Param('id') id:string,@Req() req:AuthRequest) {
    return {success:true,data:await this.clients.linkExistingPortalAccount(id,req.actor.id)};
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

  @Require('meal.validate')
  @Post(':id/control')
  async control(
    @Param('id')
    id: string,

    @Req()
    req: AuthRequest,
  ) {
    return {
      success: true,

      data:
        await this.clients.controlCard(
          id,
          req.actor.id,
          'MANUAL_SEARCH',
        ),
    };
  }

  @Require('clients.update')
  @Post(':id/qr/issue')
  issueQr(
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
      .issueQr(
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

  @Require('clients.update')
  @Post(':id/qr/replace')
  replaceQr(
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
      .replaceQr(
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

  @Require('clients.update')
  @Post(':id/qr/:qrCodeId/revoke')
  revokeQr(
    @Param('id')
    id: string,

    @Param('qrCodeId')
    qrCodeId: string,

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
      .revokeQr(
        id,
        qrCodeId,
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

  // Compatibilité temporaire avec l'ancien écran
  @Require('clients.update')
  @Post(':id/qr')
  async legacyQr(
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
    const detail =
      await this.clients.detail(
        id,
      );

    const hasActive =
      detail.qrCodes.some(
        (code) =>
          code.status ===
          'ACTIVE',
      );

    const data =
      hasActive
        ? await this.clients.replaceQr(
            id,
            key,
            req.actor.id,
          )
        : await this.clients.issueQr(
            id,
            key,
            req.actor.id,
          );

    return {
      success: true,
      data,
    };
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

  @Require('clients.merge')
  @Post(':id/merge')
  merge(
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
      .merge(
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
}

function encryptQrToken(token: string) {
  const keyHex = process.env.QR_TOKEN_ENCRYPTION_KEY;
  if (!keyHex || !/^[0-9a-f]{64}$/i.test(keyHex)) throw new DomainError('QR_ENCRYPTION_UNAVAILABLE', 'La clé de chiffrement QR n’est pas configurée.', 503);
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}

function decryptQrToken(value: string) {
  const keyHex = process.env.QR_TOKEN_ENCRYPTION_KEY;
  if (!keyHex || !/^[0-9a-f]{64}$/i.test(keyHex)) throw new DomainError('QR_ENCRYPTION_UNAVAILABLE', 'La clé de chiffrement QR n’est pas configurée.', 503);
  const [, iv, tag, data] = value.split('.');
  if (!iv || !tag || !data) throw new DomainError('QR_TOKEN_INVALID', 'Le QR Code est invalide.', 409);
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}
