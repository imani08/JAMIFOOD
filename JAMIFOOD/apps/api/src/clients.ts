import { Body, Controller, Get, Injectable, Param, Post, Query } from '@nestjs/common';
import { createClientSchema } from '@jami/validation';
import { PrismaService } from './prisma.service';
import { DomainError } from './http';

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}
  async create(input: unknown, actorId?: string) {
    const data = createClientSchema.parse(input);
    const client = await this.prisma.client.create({ data });
    await this.prisma.auditLog.create({ data: { actorId, action: 'CLIENT_CREATED', entityType: 'Client', entityId: client.id, newValue: { firstName: client.firstName, lastName: client.lastName } } });
    return client;
  }
  async find(query: string | undefined, page = 1, limit = 25) {
    const take = Math.min(Math.max(limit, 1), 100); const skip = (Math.max(page, 1) - 1) * take;
    const where = query ? { status: 'ACTIVE' as const, OR: [{ firstName: { contains: query, mode: 'insensitive' as const } }, { lastName: { contains: query, mode: 'insensitive' as const } }, { ulcNumber: { contains: query, mode: 'insensitive' as const } }, { phone: { contains: query } }] } : { status: 'ACTIVE' as const };
    const [data, total] = await this.prisma.$transaction([this.prisma.client.findMany({ where, take, skip, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }], include: { category: true } }), this.prisma.client.count({ where })]);
    return { data, meta: { page, limit: take, total } };
  }
  async byQr(token: string) {
    const crypto = await import('node:crypto'); const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const code = await this.prisma.qRCode.findUnique({ where: { tokenHash }, include: { client: { include: { subscriptions: { where: { status: 'ACTIVE' }, include: { rights: { where: { status: { in: ['AVAILABLE', 'RESERVED'] } } } } } } } } });
    if (!code || code.status !== 'ACTIVE') throw new DomainError('QR_CODE_REVOKED', 'Ce QR Code est invalide ou révoqué.', 404);
    return code.client;
  }
}
@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}
  @Post() async create(@Body() body: unknown) { return { success: true, data: await this.clients.create(body) }; }
  @Get() async list(@Query('q') q?: string, @Query('page') page?: string, @Query('limit') limit?: string) { return { success: true, ...(await this.clients.find(q, Number(page ?? 1), Number(limit ?? 25))) }; }
  @Get('qr/:token') async scan(@Param('token') token: string) { return { success: true, data: await this.clients.byQr(token) }; }
}
