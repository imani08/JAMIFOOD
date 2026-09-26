import { Controller, Get } from '@nestjs/common';
import { Public } from './auth';
import { PrismaService } from './prisma.service';
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}
  @Get() live() { return { success: true, data: { status: 'ok' } }; }
  @Get('ready') async ready() { await this.prisma.$queryRaw`SELECT 1`; return { success: true, data: { status: 'ready' } }; }
}
