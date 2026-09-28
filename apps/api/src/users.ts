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
import * as argon2 from 'argon2';
import { z } from 'zod';
import { pageSchema, uuid } from '@jami/validation';

import { AuthRequest, Require } from './auth';
import { PrismaService } from './prisma.service';
import { DomainError } from './http';
import { mutate, Tx } from './transaction';

async function restrictDelegation(tx: Tx, actor: AuthRequest['actor'], roleCodes: string[]) {
  const grants=await tx.rolePermission.findMany({where:{role:{code:{in:roleCodes}}},include:{permission:true}});
  if(grants.some(grant=>!actor.permissions.includes(grant.permission.code))) throw new DomainError('ROLE_DELEGATION_FORBIDDEN','Vous ne pouvez pas attribuer ou administrer des permissions que vous ne possédez pas.',403);
}
async function restrictTarget(tx: Tx, actor: AuthRequest['actor'], id: string) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${id}::uuid FOR UPDATE`;
  const roles=await tx.userRole.findMany({where:{userId:id},include:{role:true}});
  await restrictDelegation(tx,actor,roles.map(entry=>entry.role.code));
}
async function protectLastDirection(tx: Tx, id: string, status: 'ACTIVE'|'DISABLED'|'LOCKED', roleCodes?: string[]) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('jami:last-responsable', 0))`;
  const current = await tx.userRole.findMany({where:{userId:id},include:{role:true}});
  const nextRoles = roleCodes ?? current.map(item=>item.role.code);
  if (status === 'ACTIVE' && nextRoles.includes('RESPONSABLE_RESTAURANT')) return;
  const remaining = await tx.user.count({where:{status:'ACTIVE',roles:{some:{role:{code:'RESPONSABLE_RESTAURANT'}}},id:{not:id}}});
  if (remaining < 1) throw new DomainError('LAST_ACTIVE_RESPONSABLE','Au moins un compte Responsable doit rester actif.',409);
}

const roleCodesSchema = z
  .array(z.string().trim().min(1).max(80))
  .min(1)
  .max(10);

const createUserSchema = z
  .object({
    username: z.string().trim().min(3).max(80),
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    email: z.string().trim().email().max(200).optional(),
    phone: z.string().trim().max(40).optional(),
    password: z.string().min(12).max(256),
    roleCodes: roleCodesSchema,
  })
  .strict();

const updateUserSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100).optional(),
    lastName: z.string().trim().min(1).max(100).optional(),
    email: z.string().trim().email().max(200).nullable().optional(),
    phone: z.string().trim().max(40).nullable().optional(),
    roleCodes: roleCodesSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Aucune modification fournie.',
  });

const statusSchema = z
  .object({
    status: z.enum(['ACTIVE', 'DISABLED']),
  })
  .strict();

const resetPasswordSchema = z
  .object({
    newPassword: z.string().min(12).max(256),
  })
  .strict();

const userSelect = {
  id: true,
  username: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
  roles: {
    include: {
      role: {
        include: {
          permissions: {
            include: {
              permission: true,
            },
          },
        },
      },
    },
  },
} as const;

@Controller('users')
export class UsersController {
  constructor(private readonly db: PrismaService) {}

  @Require('users.read')
  @Get()
  async list(@Query() query: unknown) {
    const { page, limit, q } = pageSchema.parse(query);

    const where = q
      ? {
          OR: [
            {
              username: {
                contains: q,
                mode: 'insensitive' as const,
              },
            },
            {
              firstName: {
                contains: q,
                mode: 'insensitive' as const,
              },
            },
            {
              lastName: {
                contains: q,
                mode: 'insensitive' as const,
              },
            },
            {
              email: {
                contains: q,
                mode: 'insensitive' as const,
              },
            },
          ],
        }
      : {};

    const [data, total] = await this.db.$transaction([
      this.db.user.findMany({
        where,
        take: limit,
        skip: (page - 1) * limit,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        select: userSelect,
      }),
      this.db.user.count({ where }),
    ]);

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

  @Require('users.read')
  @Get('roles')
  async roles() {
    const data = await this.db.role.findMany({
      orderBy: {
        code: 'asc',
      },
      include: {
        permissions: {
          include: {
            permission: true,
          },
        },
      },
    });

    return {
      success: true,
      data: data.map((role) => ({
        id: role.id,
        code: role.code,
        label: role.label,
        permissions: role.permissions
          .map((item) => item.permission.code)
          .sort(),
      })),
    };
  }

  @Require('users.create')
  @Post()
  create(
    @Body() input: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: AuthRequest,
  ) {
    const body = createUserSchema.parse(input);

    return mutate(
      this.db,
      'users.create',
      key,
      req.actor.id,
      {
        ...body,
        password: '[REDACTED]',
      },
      async (tx) => {
        const existing = await tx.user.findFirst({
          where: {
            OR: [
              { username: body.username },
              ...(body.email ? [{ email: body.email }] : []),
            ],
          },
        });

        if (existing) {
          throw new DomainError(
            'USER_ALREADY_EXISTS',
            'Un utilisateur possède déjà cet identifiant ou ce courriel.',
            409,
          );
        }

        const uniqueRoleCodes = [...new Set(body.roleCodes)];
        await restrictDelegation(tx,req.actor,uniqueRoleCodes);

        const roles = await tx.role.findMany({
          where: {
            code: {
              in: uniqueRoleCodes,
            },
          },
        });

        if (roles.length !== uniqueRoleCodes.length) {
          throw new DomainError(
            'ROLE_NOT_FOUND',
            'Un ou plusieurs rôles sont invalides.',
            400,
          );
        }

        const passwordHash = await argon2.hash(body.password, {
          type: argon2.argon2id,
        });

        const user = await tx.user.create({
          data: {
            username: body.username,
            firstName: body.firstName,
            lastName: body.lastName,
            email: body.email,
            phone: body.phone,
            passwordHash,
            roles: {
              create: roles.map((role) => ({
                roleId: role.id,
              })),
            },
          },
          select: userSelect,
        });

        await tx.auditLog.create({
          data: {
            actorId: req.actor.id,
            action: 'USER_CREATED',
            entityType: 'User',
            entityId: user.id,
            newValue: {
              username: user.username,
              firstName: user.firstName,
              lastName: user.lastName,
              roles: roles.map((role) => role.code),
            },
          },
        });

        return user;
      },
    ).then((data) => ({
      success: true,
      data,
    }));
  }

  @Require('users.update')
  @Post(':id')
  update(
    @Param('id') id: string,
    @Body() input: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: AuthRequest,
  ) {
    uuid.parse(id);

    const body = updateUserSchema.parse(input);

    return mutate(
      this.db,
      'users.update',
      key,
      req.actor.id,
      {
        id,
        ...body,
      },
      async (tx) => {
        const before = await tx.user.findUnique({
          where: { id },
          include: {
            roles: {
              include: {
                role: true,
              },
            },
          },
        });

        if (!before) {
          throw new DomainError(
            'NOT_FOUND',
            'Utilisateur introuvable.',
            404,
          );
        }

        let roles:
          | {
              id: string;
              code: string;
              label: string;
            }[]
          | undefined;

        if (body.roleCodes) {
          await restrictTarget(tx,req.actor,id);
          if(id===req.actor.id)throw new DomainError('SELF_ROLE_CHANGE_FORBIDDEN','Un autre administrateur habilité doit modifier vos rôles.',403);
          const uniqueRoleCodes = [...new Set(body.roleCodes)];
          await restrictDelegation(tx,req.actor,uniqueRoleCodes);

          roles = await tx.role.findMany({
            where: {
              code: {
                in: uniqueRoleCodes,
              },
            },
          });

          if (roles.length !== uniqueRoleCodes.length) {
            throw new DomainError(
              'ROLE_NOT_FOUND',
              'Un ou plusieurs rôles sont invalides.',
              400,
            );
          }
          const directionTarget=await tx.user.findUniqueOrThrow({where:{id},select:{status:true}});
          await protectLastDirection(tx,id,directionTarget.status,uniqueRoleCodes);
        }

        await tx.user.update({
          where: { id },
          data: {
            firstName: body.firstName,
            lastName: body.lastName,
            email: body.email,
            phone: body.phone,
          },
        });

        if (roles) {
          await tx.userRole.deleteMany({
            where: {
              userId: id,
            },
          });

          await tx.userRole.createMany({
            data: roles.map((role) => ({
              userId: id,
              roleId: role.id,
            })),
          });
        }

        const after = await tx.user.findUniqueOrThrow({
          where: { id },
          select: userSelect,
        });

        await tx.auditLog.create({
          data: {
            actorId: req.actor.id,
            action: 'USER_UPDATED',
            entityType: 'User',
            entityId: id,
            oldValue: {
              firstName: before.firstName,
              lastName: before.lastName,
              email: before.email,
              phone: before.phone,
              roles: before.roles.map((item) => item.role.code),
            },
            newValue: {
              firstName: after.firstName,
              lastName: after.lastName,
              email: after.email,
              phone: after.phone,
              roles: after.roles.map((item) => item.role.code),
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

  @Require('users.disable')
  @Post(':id/status')
  changeStatus(
    @Param('id') id: string,
    @Body() input: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: AuthRequest,
  ) {
    uuid.parse(id);

    const body = statusSchema.parse(input);

    if (id === req.actor.id && body.status === 'DISABLED') {
      throw new DomainError(
        'SELF_DISABLE_FORBIDDEN',
        'Vous ne pouvez pas désactiver votre propre compte.',
        400,
      );
    }

    return mutate(
      this.db,
      'users.status',
      key,
      req.actor.id,
      {
        id,
        ...body,
      },
      async (tx) => {
        const before = await tx.user.findUnique({
          where: { id },
        });
        await restrictTarget(tx,req.actor,id);

        if (!before) {
          throw new DomainError(
            'NOT_FOUND',
            'Utilisateur introuvable.',
            404,
          );
        }
        await protectLastDirection(tx,id,body.status);

        const user = await tx.user.update({
          where: { id },
          data: {
            status: body.status,
          },
          select: userSelect,
        });

        if (body.status === 'DISABLED') {
          await tx.session.deleteMany({
            where: {
              userId: id,
            },
          });
        }

        await tx.auditLog.create({
          data: {
            actorId: req.actor.id,
            action:
              body.status === 'ACTIVE'
                ? 'USER_ENABLED'
                : 'USER_DISABLED',
            entityType: 'User',
            entityId: id,
            oldValue: {
              status: before.status,
            },
            newValue: {
              status: body.status,
            },
          },
        });

        return user;
      },
    ).then((data) => ({
      success: true,
      data,
    }));
  }

  @Require('users.update')
  @Post(':id/reset-password')
  resetPassword(
    @Param('id') id: string,
    @Body() input: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: AuthRequest,
  ) {
    uuid.parse(id);

    const body = resetPasswordSchema.parse(input);

    return mutate(
      this.db,
      'users.reset-password',
      key,
      req.actor.id,
      {
        id,
        password: '[REDACTED]',
      },
      async (tx) => {
        const user = await tx.user.findUnique({
          where: { id },
        });
        await restrictTarget(tx,req.actor,id);

        if (!user) {
          throw new DomainError(
            'NOT_FOUND',
            'Utilisateur introuvable.',
            404,
          );
        }

        const passwordHash = await argon2.hash(body.newPassword, {
          type: argon2.argon2id,
        });

        await tx.user.update({
          where: { id },
          data: {
            passwordHash,
          },
        });

        await tx.session.deleteMany({
          where: {
            userId: id,
          },
        });

        await tx.auditLog.create({
          data: {
            actorId: req.actor.id,
            action: 'USER_PASSWORD_RESET',
            entityType: 'User',
            entityId: id,
          },
        });

        return {
          id,
          reset: true,
        };
      },
    ).then((data) => ({
      success: true,
      data,
    }));
  }
}
