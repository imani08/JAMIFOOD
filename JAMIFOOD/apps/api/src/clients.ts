import { Body, Controller, Get, Headers, Injectable, Param, Post, Query, Req } from '@nestjs/common';
import { createClientSchema, pageSchema, uuid } from '@jami/validation';
import { randomBytes, createHash } from 'node:crypto';
import { z } from 'zod';
import { PrismaService } from './prisma.service';
import { DomainError } from './http';
import { AuthRequest, Require } from './auth';
import { audit, mutate } from './transaction';
const clientSelect = { id: true, firstName: true, lastName: true, ulcNumber: true, categoryId: true, category: true, phone: true, email: true, faculty: true, promotion: true, residency: true, status: true } as const;
@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}
  create(input: unknown, key: string | undefined, actorId: string) {
    const data = createClientSchema.parse(input);
    return mutate(this.prisma, 'clients.create', key, actorId, data, async tx => {
      if (!(await tx.clientCategory.findFirst({ where: { id: data.categoryId, active: true } }))) throw new DomainError('CATEGORY_INVALID', 'Catégorie client indisponible.', 400);
      const duplicate = await tx.client.findFirst({ where: { OR: [{ firstName: { equals: data.firstName, mode: 'insensitive' }, lastName: { equals: data.lastName, mode: 'insensitive' } }, ...(data.phone ? [{ phone: data.phone }] : []), ...(data.ulcNumber ? [{ ulcNumber: data.ulcNumber }] : [])] } });
      if (duplicate) throw new DomainError('POSSIBLE_DUPLICATE', 'Un client similaire existe déjà. Vérifiez sa fiche avant de continuer.');
      const client = await tx.client.create({ data, select: clientSelect });
      await audit(tx, actorId, 'CLIENT_CREATED', 'Client', client.id);
      return client;
    });
  }
  async find(query: unknown) {
    const { q, page, limit } = pageSchema.parse(query);
    const where = { status: 'ACTIVE' as const, ...(q ? { OR: [{ firstName: { contains: q, mode: 'insensitive' as const } }, { lastName: { contains: q, mode: 'insensitive' as const } }, { ulcNumber: { contains: q, mode: 'insensitive' as const } }, { phone: { contains: q } }, ...(uuid.safeParse(q).success ? [{ id: q }] : [])] } : {}) };
    const [data, total] = await this.prisma.$transaction([this.prisma.client.findMany({ where, take: limit, skip: (page - 1) * limit, orderBy: [{ lastName: 'asc' }, { id: 'asc' }], select: clientSelect }), this.prisma.client.count({ where })]);
    return { data, meta: { page, limit, total } };
  }
  async byQr(input: unknown) {
    const { token } = z.object({ token: z.string().min(20).max(200) }).parse(input);
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const code = await this.prisma.qRCode.findUnique({ where: { tokenHash }, include: { client: { select: { ...clientSelect, subscriptions: { include: { planVersion: { include: { plan: true } }, rights: { where: { businessDate: new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kinshasa' }).format(new Date())) } } } } } } } });
    if (!code || code.status !== 'ACTIVE' || code.client.status !== 'ACTIVE') throw new DomainError('QR_CODE_REVOKED', 'Ce QR Code est invalide ou révoqué.', 404);
    return code.client;
  }
  replaceQr(clientId: string, key: string | undefined, actorId: string) {
    uuid.parse(clientId);
    return mutate(this.prisma, 'qr.replace', key, actorId, { clientId }, async tx => {
      await tx.$queryRaw`SELECT id FROM "Client" WHERE id = ${clientId}::uuid FOR UPDATE`;
      const client = await tx.client.findUnique({ where: { id: clientId } });
      if (!client || client.status !== 'ACTIVE') throw new DomainError('NOT_FOUND', 'Client introuvable.', 404);
      await tx.qRCode.updateMany({ where: { clientId, status: 'ACTIVE' }, data: { status: 'REPLACED', revokedAt: new Date() } });
      const token = 'JAMI-' + randomBytes(32).toString('hex');
      const code = await tx.qRCode.create({ data: { clientId, tokenHash: createHash('sha256').update(token).digest('hex'), history: { create: { action: 'ISSUED', actorId } } } });
      await audit(tx, actorId, 'QR_REPLACED', 'QRCode', code.id);
      return { token, clientId };
    });
  }
}
@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService, private readonly prisma: PrismaService) {}
  @Require('clients.create') @Post() create(@Body() body: unknown, @Headers('idempotency-key') key: string | undefined, @Req() req: AuthRequest) { return this.clients.create(body, key, req.actor.id).then(data => ({ success: true, data })); }
  @Require('clients.read') @Get() async list(@Query() query: unknown) { return { success: true, ...(await this.clients.find(query)) }; }
  @Require('clients.read') @Get('categories') async categories() { return { success: true, data: await this.prisma.clientCategory.findMany({ where: { active: true } }) }; }
  @Require('meal.validate') @Post('scan') async scan(@Body() body: unknown) { return { success: true, data: await this.clients.byQr(body) }; }
  @Require('clients.update') @Post(':id/qr') qr(@Param('id') id: string, @Headers('idempotency-key') key: string | undefined, @Req() req: AuthRequest) { return this.clients.replaceQr(id, key, req.actor.id).then(data => ({ success: true, data })); }
}
