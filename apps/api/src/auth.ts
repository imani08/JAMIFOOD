import { Body, CanActivate, Controller, ExecutionContext, Get, Injectable, Post, Req, Res, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import * as argon2 from 'argon2';
import { z } from 'zod';
import type { Request, Response } from './transport';
import { PrismaService } from './prisma.service';
import { DomainError } from './http';
export const Public = () => SetMetadata('public', true);
export const RequireAny = (...permissions: string[]): MethodDecorator => (target, key, descriptor) => {
  const subject = descriptor?.value ?? target;
  const existing = Reflect.getOwnMetadata('permissions', subject) as string[] | undefined;
  Reflect.defineMetadata('permissions', [...new Set([...(existing ?? []), ...permissions])], subject);
  Reflect.defineMetadata('anyPermission', true, subject);
};
// Accumulate stacked decorators instead of silently replacing a requirement.
export const Require = (...permissions: string[]): MethodDecorator & ClassDecorator =>
  (target: object, _key?: string | symbol, descriptor?: PropertyDescriptor) => {
    const subject = descriptor?.value ?? target;
    const existing = Reflect.getOwnMetadata('permissions', subject) as string[] | undefined;
    Reflect.defineMetadata('permissions', [...new Set([...(existing ?? []), ...permissions])], subject);
  };
export type Actor = { id: string; username: string; firstName: string; lastName: string; roles: string[]; permissions: string[] };
export type AuthRequest = Request & { actor: Actor; sessionId: string; requestId: string };
async function verifyPassword(stored: string, password: string) {
  if (!stored.startsWith('scrypt$')) return argon2.verify(stored, password);
  const [,salt,expected] = stored.split('$');
  const actual=scryptSync(password,salt,64);const bytes=Buffer.from(expected,'hex');
  return bytes.length===actual.length && timingSafeEqual(bytes,actual);
}
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const cookieToken = (req: Request) => req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('jami_session='))?.slice(13);
const cookieOptions = () => ({ httpOnly: true, secure: process.env.COOKIE_SECURE === 'true', sameSite: 'strict' as const, path: '/' });
@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}
  async login(input: unknown, req: Request, res: Response) {
    const { username, password } = z.object({ username: z.string().trim().min(1).max(100), password: z.string().min(1).max(256) }).strict().parse(input);
    const key = hash(username.toLowerCase());
    const attempt = await this.prisma.loginAttempt.findUnique({ where: { key } });
    if (attempt?.blockedUntil && attempt.blockedUntil > new Date()) throw new DomainError('TOO_MANY_ATTEMPTS', 'Trop de tentatives. Réessayez dans 15 minutes.', 429);
    const user = await this.prisma.user.findUnique({ where: { username } });
    const valid = user && user.status === 'ACTIVE' && await verifyPassword(user.passwordHash, password);
    if (!valid) {
      const recent = attempt && Date.now() - attempt.windowStart.getTime() < 900000;
      const row = await this.prisma.loginAttempt.upsert({ where: { key }, create: { key, failures: 1 }, update: recent ? { failures: { increment: 1 } } : { failures: 1, windowStart: new Date(), blockedUntil: null } });
      if (row.failures >= 5) await this.prisma.loginAttempt.update({ where: { key }, data: { blockedUntil: new Date(Date.now() + 900000) } });
      throw new DomainError('INVALID_CREDENTIALS', 'Identifiants invalides.', 401);
    }
    const token = randomBytes(32).toString('hex');
    await this.prisma.$transaction(async tx => {
      await tx.loginAttempt.deleteMany({ where: { key } });
      await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      await tx.session.create({ data: { userId: user.id, tokenHash: hash(token), expiresAt: new Date(Date.now() + 8 * 3600000), lastActivityAt: new Date() } });
      await tx.auditLog.create({ data: { actorId: user.id, action: 'LOGIN', entityType: 'Session', requestId: req.headers['x-request-id']?.toString() ?? crypto.randomUUID() } });
    });
    res.cookie('jami_session', token, { ...cookieOptions(), maxAge: 8 * 3600000 });
    return { success: true };
  }
  async authenticate(req: Request) {
    const token = cookieToken(req);
    if (!token) throw new DomainError('UNAUTHENTICATED', 'Veuillez vous connecter.', 401);
    const session = await this.prisma.session.findUnique({ where: { tokenHash: hash(token) }, include: { user: { include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } } } });
    if (!session || session.user.status !== 'ACTIVE' || session.expiresAt <= new Date() || Date.now() - session.lastActivityAt.getTime() > Number(process.env.SESSION_IDLE_MINUTES ?? 30) * 60000) throw new DomainError('SESSION_EXPIRED', 'Votre session a expiré. Reconnectez-vous.', 401);
    await this.prisma.session.update({ where: { id: session.id }, data: { lastActivityAt: new Date() } });
    const u = session.user;
    return { sessionId: session.id, actor: { id: u.id, username: u.username, firstName: u.firstName, lastName: u.lastName, roles: u.roles.map(r => r.role.code), permissions: [...new Set(u.roles.flatMap(r => r.role.permissions.map(p => p.permission.code)))] } };
  }
  async logout(req: AuthRequest, res: Response) {
    await this.prisma.session.deleteMany({ where: { id: req.sessionId } });
    res.clearCookie('jami_session', cookieOptions());
    return { success: true };
  }
  async changePassword(req: AuthRequest, input: unknown, res: Response) {
    const body = z.object({ currentPassword: z.string().max(256), newPassword: z.string().min(12).max(256) }).strict().parse(input);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: req.actor.id } });
    if (!(await verifyPassword(user.passwordHash, body.currentPassword))) throw new DomainError('INVALID_CREDENTIALS', 'Le mot de passe actuel est incorrect.', 401);
    const passwordHash = await argon2.hash(body.newPassword, { type: argon2.argon2id });
    await this.prisma.$transaction(async tx => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      await tx.session.deleteMany({ where: { userId: user.id } });
      await tx.auditLog.create({ data: { actorId: user.id, action: 'PASSWORD_CHANGED', entityType: 'User', entityId: user.id } });
    });
    res.clearCookie('jami_session', cookieOptions());
    return { success: true };
  }
}
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const allowed = (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(',').map(origin => origin.trim()).filter(Boolean);
      if (!req.headers.origin || !allowed.includes(req.headers.origin) || req.headers['x-jami-request'] !== '1') throw new DomainError('CSRF_REJECTED', 'Origine de la requête non autorisée.', 403);
    }
    if (this.reflector.getAllAndOverride<boolean>('public', [context.getHandler(), context.getClass()])) return true;
    Object.assign(req, await this.auth.authenticate(req));
    const required = this.reflector.getAllAndMerge<string[]>('permissions', [context.getHandler(), context.getClass()]) ?? [];
    if(!required.length)throw new DomainError('FORBIDDEN','Cette route ne possède pas d’autorisation explicite.',403);
    const anyPermission = this.reflector.getAllAndOverride<boolean>('anyPermission', [context.getHandler(), context.getClass()]);
    const granted = anyPermission ? required.some(p => req.actor.permissions.includes(p)) : required.every(p => req.actor.permissions.includes(p));
    if (!granted) throw new DomainError('FORBIDDEN', 'Vous ne disposez pas de cette permission.', 403);
    return true;
  }
}
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Public() @Post('login') login(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) { return this.auth.login(body, req, res); }
  @Require('auth.session')
  @Post('logout') logout(@Req() req: AuthRequest, @Res({ passthrough: true }) res: Response) { return this.auth.logout(req, res); }
  @Require('auth.session')
  @Get('me') me(@Req() req: AuthRequest) { return { success: true, data: req.actor }; }
  @Require('auth.password-change')
  @Post('password') password(@Req() req: AuthRequest, @Body() body: unknown, @Res({ passthrough: true }) res: Response) { return this.auth.changePassword(req, body, res); }
}
