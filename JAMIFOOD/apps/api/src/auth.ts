import { Body, Controller, Get, Injectable, Post, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from './prisma.service';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}
  async login(username: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { username }, include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } });
    if (!user || user.status !== 'ACTIVE' || !(await argon2.verify(user.passwordHash, password))) throw new UnauthorizedException({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Identifiants invalides.' } });
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return { user: { id: user.id, username: user.username, firstName: user.firstName, lastName: user.lastName, permissions: user.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.code)) } };
  }
}
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Post('login') async login(@Body() body: { username: string; password: string }) { return { success: true, data: await this.auth.login(body.username, body.password) }; }
  @Post('logout') logout() { return { success: true }; }
  @Get('me') me() { return { success: true, data: null }; }
}
