import { Body, Controller, Get, Injectable, Param, Patch, Post, Req, Res } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { z } from 'zod';
import { ClientAccountType, ClientVerificationStatus } from '@jami/database';
import { AuthRequest, Public, Require } from './auth';
import { DomainError } from './http';
import { PrismaService } from './prisma.service';
import type { Request, Response } from './transport';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const sessionToken = (req: Request) => req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('jami_client_session='))?.slice('jami_client_session='.length);
const cookieOptions = () => ({ httpOnly: true, secure: process.env.COOKIE_SECURE === 'true', sameSite: 'strict' as const, path: '/' });
const accountTypeByCategory = { STUDENT_HOME: 'ETUDIANT_HOME', STUDENT_EXTERNAL: 'ETUDIANT_EXTERNE', STAFF: 'PERSONNEL_ULC' } as const;
const registerSchema = z.object({ type: z.nativeEnum(ClientAccountType), firstName: z.string().trim().min(1).max(80), lastName: z.string().trim().min(1).max(80), email: z.string().trim().email().max(254), password: z.string().min(12).max(256), confirmPassword: z.string().min(12).max(256), ulcNumber: z.string().trim().min(2).max(50), faculty: z.string().trim().max(120).optional(), promotion: z.string().trim().max(80).optional(), phone: z.string().trim().max(30).optional() }).strict().refine(body => body.password === body.confirmPassword, { path: ['confirmPassword'], message: 'Les mots de passe ne correspondent pas.' }).refine(body => body.type === 'STAFF' || (!!body.faculty && !!body.promotion), { path: ['faculty'], message: 'Faculté et promotion obligatoires pour les étudiants.' });

@Injectable()
export class ClientPortalService {
  constructor(private readonly db: PrismaService) {}

  private async issueSession(accountId: string, response: Response) {
    const token = randomBytes(32).toString('hex');
    const now = new Date();
    const maxAge = 8 * 3600000;
    await this.db.clientSession.create({ data: { accountId, tokenHash: hash(token), expiresAt: new Date(now.getTime() + maxAge), lastActivityAt: now } });
    response.cookie('jami_client_session', token, { ...cookieOptions(), maxAge });
  }

  async register(input: unknown, response: Response) {
    const body = registerSchema.parse(input);
    const email = body.email.toLowerCase();
    const ulcNumber = body.ulcNumber.toUpperCase();
    const category = await this.db.clientCategory.findFirst({ where: { code: accountTypeByCategory[body.type], active: true } });
    if (!category) throw new DomainError('REGISTRATION_UNAVAILABLE', 'Cette catégorie de compte ULC n’est pas activée.', 503);
    if (await this.db.clientAccount.findUnique({ where: { email } })) throw new DomainError('ACCOUNT_EXISTS', 'Un compte utilise déjà cette adresse e-mail.', 409);
    if (await this.db.client.findUnique({ where: { ulcNumber } })) throw new DomainError('ULC_ID_EXISTS', 'Cet identifiant ULC est déjà rattaché à un compte.', 409);
    const passwordHash = await argon2.hash(body.password, { type: argon2.argon2id });
    const client = await this.db.$transaction(async tx => {
      const created = await tx.client.create({ data: { categoryId: category.id, firstName: body.firstName, lastName: body.lastName, ulcNumber, faculty: body.faculty || null, promotion: body.promotion || null, residency: body.type === 'STUDENT_HOME' ? 'HOME' : body.type === 'STUDENT_EXTERNAL' ? 'EXTERNAL' : null, phone: body.phone || null, email, account: { create: { email, passwordHash, type: body.type, verificationStatus: 'PENDING' } } }, include: { account: true } });
      await tx.clientPortalEvent.create({ data: { accountId: created.account!.id, action: 'ACCOUNT_REGISTERED' } });
      return created;
    });
    await this.issueSession(client.account!.id, response);
    return { success: true, data: { verificationStatus: 'PENDING' as const, message: 'Votre compte est créé. La vérification de votre identité ULC est en attente.' } };
  }

  async login(input: unknown, response: Response) {
    const body = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(256) }).strict().parse(input);
    const email = body.email.toLowerCase();
    const key = hash(`client:${email}`);
    const attempt = await this.db.loginAttempt.findUnique({ where: { key } });
    if (attempt?.blockedUntil && attempt.blockedUntil > new Date()) throw new DomainError('TOO_MANY_ATTEMPTS', 'Trop de tentatives. Réessayez dans 15 minutes.', 429);
    const account = await this.db.clientAccount.findUnique({ where: { email }, include: { client: { select: { status: true } } } });
    const valid = account && account.client.status === 'ACTIVE' && await argon2.verify(account.passwordHash, body.password);
    if (!valid) {
      const recent = attempt && Date.now() - attempt.windowStart.getTime() < 900000;
      const row = await this.db.loginAttempt.upsert({ where: { key }, create: { key, failures: 1 }, update: recent ? { failures: { increment: 1 } } : { failures: 1, windowStart: new Date(), blockedUntil: null } });
      if (row.failures >= 5) await this.db.loginAttempt.update({ where: { key }, data: { blockedUntil: new Date(Date.now() + 900000) } });
      throw new DomainError('INVALID_CREDENTIALS', 'Identifiants invalides.', 401);
    }
    await this.db.loginAttempt.deleteMany({ where: { key } });
    await this.issueSession(account.id, response);
    await this.db.clientPortalEvent.create({ data: { accountId: account.id, action: 'ACCOUNT_LOGIN' } });
    return { success: true, data: { verificationStatus: account.verificationStatus } };
  }

  async authenticate(req: Request) {
    const token = sessionToken(req);
    if (!token) throw new DomainError('UNAUTHENTICATED', 'Veuillez vous connecter.', 401);
    const session = await this.db.clientSession.findUnique({ where: { tokenHash: hash(token) }, include: { account: { include: { client: { include: { category: true } } } } } });
    const idleMinutes = Number(process.env.SESSION_IDLE_MINUTES ?? 30);
    if (!session || session.expiresAt <= new Date() || Date.now() - session.lastActivityAt.getTime() > idleMinutes * 60000 || session.account.client.status !== 'ACTIVE' || session.account.verificationStatus === 'SUSPENDED') throw new DomainError('SESSION_EXPIRED', 'Votre session a expiré. Reconnectez-vous.', 401);
    await this.db.clientSession.update({ where: { id: session.id }, data: { lastActivityAt: new Date() } });
    return session;
  }

  async me(req: Request) {
    const s = await this.authenticate(req); const c = s.account.client;
    return { success: true, data: { id: c.id, firstName: c.firstName, lastName: c.lastName, email: s.account.email, phone: c.phone, category: c.category.label, type: s.account.type, verificationStatus: s.account.verificationStatus, ulcNumber: c.ulcNumber, faculty: c.faculty, promotion: c.promotion, residency: c.residency } };
  }

  async logout(req: Request, response: Response) {
    const token = sessionToken(req); if (token) await this.db.clientSession.deleteMany({ where: { tokenHash: hash(token) } });
    response.clearCookie('jami_client_session', cookieOptions()); return { success: true, data: null };
  }

  async profile(req: Request, input: unknown) {
    const session = await this.authenticate(req);
    const body = z.object({ firstName: z.string().trim().min(1).max(80), lastName: z.string().trim().min(1).max(80), phone: z.string().trim().max(30).nullable() }).strict().parse(input);
    await this.db.$transaction(async tx => {
      await tx.client.update({ where: { id: session.account.clientId }, data: body });
      await tx.clientPortalEvent.create({ data: { accountId: session.accountId, action: 'PROFILE_UPDATED' } });
    });
    return this.me(req);
  }

  async accountData(req: Request, section: string) {
    const s = await this.authenticate(req); const clientId = s.account.clientId;
    if (section === 'subscriptions') return { success: true, data: await this.db.subscription.findMany({ where: { clientId }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, status: true, startsOn: true, endsOn: true, amount: true, currency: true, paidAmount: true, balance: true, deliveryIncluded: true, planVersion: { select: { plan: { select: { name: true } } } } } }) };
    if (section === 'rights') return { success: true, data: await this.db.mealRight.findMany({ where: { subscription: { clientId } }, orderBy: [{ businessDate: 'desc' }, { serviceCode: 'asc' }], take: 150, select: { id: true, businessDate: true, serviceCode: true, status: true, consumedAt: true, subscription: { select: { planVersion: { select: { plan: { select: { name: true } } } } } } } }) };
    if (section === 'orders' || section === 'deliveries') return { success: true, data: await this.db.order.findMany({ where: { clientId, ...(section === 'deliveries' ? { serviceMode: 'DELIVERY' as const } : {}) }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, number: true, status: true, serviceMode: true, totalAmount: true, currency: true, createdAt: true, items: { select: { quantity: true, unitPrice: true, productSnapshot: true } } } }) };
    if (section === 'payments' || section === 'receipts') return { success: true, data: await this.db.payment.findMany({ where: { order: { clientId }, ...(section === 'receipts' ? { status: 'CONFIRMED' as const } : {}) }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, orderId: true, status: true, method: true, referenceCurrency: true, amountDue: true, receivedAmount: true, receivedCurrency: true, confirmedAt: true, order: { select: { number: true, createdAt: true } } } }) };
    if (section === 'activity') {
      const [events, orders, subscriptions] = await Promise.all([this.db.clientPortalEvent.findMany({ where: { accountId: s.accountId }, orderBy: { createdAt: 'desc' }, take: 50, select: { action: true, createdAt: true } }), this.db.order.findMany({ where: { clientId }, orderBy: { createdAt: 'desc' }, take: 25, select: { number: true, status: true, createdAt: true } }), this.db.subscription.findMany({ where: { clientId }, orderBy: { createdAt: 'desc' }, take: 25, select: { status: true, createdAt: true } })]);
      return { success: true, data: [...events, ...orders.map(row => ({ action: `ORDER_${row.status}`, createdAt: row.createdAt, label: row.number })), ...subscriptions.map(row => ({ action: `SUBSCRIPTION_${row.status}`, createdAt: row.createdAt }))].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 100) };
    }
    throw new DomainError('NOT_FOUND', 'Rubrique inconnue.', 404);
  }

  async order(req: Request, id: string) {
    const s = await this.authenticate(req); const order = await this.db.order.findFirst({ where: { id, clientId: s.account.clientId }, select: { id: true, number: true, status: true, serviceMode: true, totalAmount: true, currency: true, createdAt: true, items: { select: { quantity: true, unitPrice: true, lineTotal: true, productSnapshot: true } }, statusHistory: { orderBy: { createdAt: 'asc' }, select: { toStatus: true, createdAt: true } }, delivery: { select: { status: true, assignedAt: true, deliveredAt: true } } } });
    if (!order) throw new DomainError('ORDER_NOT_FOUND', 'Commande introuvable.', 404);
    return { success: true, data: order };
  }

  async createOrder(req: Request, input: unknown) {
    const s = await this.authenticate(req);
    const body = z.object({ menuVersionId: z.string().uuid(), serviceMode: z.enum(['DINE_IN','TAKEAWAY']), currency: z.enum(['CDF','USD']), items: z.array(z.object({ productId: z.string().uuid(), quantity: z.number().int().min(1).max(100) }).strict()).min(1).max(50) }).strict().parse(input);
    const publicPriceCategory = process.env.PUBLIC_PRICE_CATEGORY_CODE;
    if (s.account.verificationStatus !== 'VERIFIED' && !publicPriceCategory) throw new DomainError('ACCOUNT_PENDING_VERIFICATION', 'Votre compte doit être vérifié avant de passer une commande.', 403);
    const menuVersion = await this.db.menuVersion.findFirst({ where: { id: body.menuVersionId, status: 'PUBLISHED', menu: { businessDate: new Date(new Intl.DateTimeFormat('en-CA', { timeZone: process.env.RESTAURANT_TIMEZONE ?? 'Africa/Kinshasa' }).format(new Date()) + 'T00:00:00.000Z') } }, include: { items: { where: { available: true, product: { active: true, available: true } } }, menu: true } });
    if (!menuVersion) throw new DomainError('MENU_UNAVAILABLE', 'Ce menu n’est plus publié pour aujourd’hui.', 409);
    const result = await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "MenuVersion" WHERE id = ${menuVersion.id}::uuid FOR UPDATE`;
      const latest = await tx.menuVersion.findUniqueOrThrow({ where: { id: menuVersion.id }, include: { items: true, menu: true } });
      const products = await tx.product.findMany({ where: { id: { in: body.items.map(row => row.productId) }, active: true, available: true } });
      const categoryCodes = s.account.verificationStatus === 'VERIFIED' ? [s.account.client.category.code] : [publicPriceCategory!];
      const lines = body.items.map(row => {
        const product = products.find(value => value.id === row.productId); const item = latest.items.find(value => value.productId === row.productId);
        if (!product || !item || !item.available || row.quantity > item.quantityAvailable - item.quantitySold) throw new DomainError('MENU_ITEM_UNAVAILABLE', 'Un article est indisponible ou épuisé.', 409);
        const snapshot = item.priceSnapshot as { categories?: Record<string,{amount:string;currency:string;priceVersionId:string}> }|null;
        const selected=categoryCodes.map(code=>({code,price:snapshot?.categories?.[code]})).find(row=>row.price?.currency===body.currency);
        if (!selected?.price) throw new DomainError('PRICE_UNAVAILABLE', 'Le tarif demandé n’est pas disponible.', 409);
        return { id:item.id,product,menuItem:item,quantity:row.quantity,price:selected.price,productSnapshot:{name:product.name,menuVersionId:latest.id,clientCategoryCode:selected.code,priceVersionId:selected.price.priceVersionId} };
      });
      const total = lines.reduce((sum,row)=>sum+Number(row.price.amount)*row.quantity,0);
      if (!Number.isFinite(total)||total<=0) throw new DomainError('INVALID_AMOUNT','Le montant de la commande est invalide.',400);
      for (const row of lines) { const updated=await tx.menuItem.updateMany({where:{id:row.menuItem.id,available:true,quantitySold:{lte:row.menuItem.quantityAvailable-row.quantity}},data:{quantitySold:{increment:row.quantity}}}); if(updated.count!==1)throw new DomainError('MENU_ITEM_UNAVAILABLE','La quantité disponible vient de changer.',409); }
      const order = await tx.order.create({ data:{number:`WEB-${new Date().getFullYear()}-${randomBytes(5).toString('hex').toUpperCase()}`,clientId:s.account.clientId,menuVersionId:latest.id,serviceMode:body.serviceMode,businessDate:latest.menu.businessDate,totalAmount:total,currency:body.currency,items:{create:lines.map(row=>({productId:row.product.id,quantity:row.quantity,unitPrice:row.price.amount,lineTotal:String(Number(row.price.amount)*row.quantity),productSnapshot:row.productSnapshot}))},statusHistory:{create:{toStatus:'RECEIVED'}}},select:{id:true,number:true,status:true,totalAmount:true,currency:true,createdAt:true} });
      await tx.clientPortalEvent.create({data:{accountId:s.accountId,action:'ORDER_CREATED',metadata:{orderId:order.id}}}); return order;
    });
    return { success: true, data: result };
  }

  async qr(req: Request) {
    const s=await this.authenticate(req);
    if(s.account.verificationStatus!=='VERIFIED')throw new DomainError('ACCOUNT_PENDING_VERIFICATION','Votre identité ULC doit être vérifiée avant l’émission du QR.',403);
    const active=await this.db.qRCode.findFirst({where:{clientId:s.account.clientId,status:'ACTIVE'},orderBy:{issuedAt:'desc'}});
    if(active?.tokenCiphertext)return {success:true,data:{id:active.id,status:active.status,issuedAt:active.issuedAt,token:this.decryptQrToken(active.tokenCiphertext)}};
    const {randomBytes,createHash,createCipheriv}=await import('node:crypto');
    const token='JAMI-'+randomBytes(32).toString('base64url'); const keyHex=process.env.QR_TOKEN_ENCRYPTION_KEY;
    if(!keyHex||!/^[0-9a-f]{64}$/i.test(keyHex))throw new DomainError('QR_ENCRYPTION_UNAVAILABLE','La clé de chiffrement QR n’est pas configurée.',503);
    const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',Buffer.from(keyHex,'hex'),iv);const encrypted=Buffer.concat([cipher.update(token,'utf8'),cipher.final()]);const tokenCiphertext=`v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
    const created=await this.db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "Client" WHERE id = ${s.account.clientId}::uuid FOR UPDATE`;const existing=await tx.qRCode.findFirst({where:{clientId:s.account.clientId,status:'ACTIVE'}});if(existing)return existing;return tx.qRCode.create({data:{clientId:s.account.clientId,tokenHash:createHash('sha256').update(token).digest('hex'),tokenCiphertext,history:{create:{action:'ISSUED',metadata:{source:'CLIENT_PORTAL'}}}}});});
    if(!created.tokenCiphertext)throw new DomainError('QR_ISSUE_CONFLICT','Réessayez de charger votre QR Code.',409);
    return {success:true,data:{id:created.id,status:created.status,issuedAt:created.issuedAt,token}};
  }

  private decryptQrToken(value:string) {
    const keyHex=process.env.QR_TOKEN_ENCRYPTION_KEY;
    if(!keyHex||!/^[0-9a-f]{64}$/i.test(keyHex))throw new DomainError('QR_ENCRYPTION_UNAVAILABLE','La clé de chiffrement QR n’est pas configurée.',503);
    const [,iv,tag,data]=value.split('.');if(!iv||!tag||!data)throw new DomainError('QR_TOKEN_INVALID','Le QR Code est invalide.',409);
    const {createDecipheriv}=require('node:crypto') as typeof import('node:crypto');const decipher=createDecipheriv('aes-256-gcm',Buffer.from(keyHex,'hex'),Buffer.from(iv,'base64url'));decipher.setAuthTag(Buffer.from(tag,'base64url'));return Buffer.concat([decipher.update(Buffer.from(data,'base64url')),decipher.final()]).toString('utf8');
  }
}

@Controller('client')
export class ClientPortalController {
  constructor(private readonly portal: ClientPortalService, private readonly db: PrismaService) {}
  @Public() @Post('register') register(@Body() input: unknown, @Res({ passthrough: true }) res: Response) { return this.portal.register(input, res); }
  @Public() @Post('login') login(@Body() input: unknown, @Res({ passthrough: true }) res: Response) { return this.portal.login(input, res); }
  @Public() @Post('logout') logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) { return this.portal.logout(req, res); }
  @Public() @Get('me') me(@Req() req: Request) { return this.portal.me(req); }
  @Public() @Patch('profile') profile(@Req() req: Request, @Body() input: unknown) { return this.portal.profile(req, input); }
  @Public() @Get('orders/:id') order(@Req() req: Request, @Param('id') id: string) { return this.portal.order(req, id); }
  @Public() @Post('orders') createOrder(@Req() req: Request, @Body() input: unknown) { return this.portal.createOrder(req, input); }
  @Public() @Get('qr') qr(@Req() req: Request) { return this.portal.qr(req); }
  @Public() @Get('subscriptions') subscriptions(@Req() req: Request) { return this.portal.accountData(req, 'subscriptions'); }
  @Public() @Get('rights') rights(@Req() req: Request) { return this.portal.accountData(req, 'rights'); }
  @Public() @Get('orders') orders(@Req() req: Request) { return this.portal.accountData(req, 'orders'); }
  @Public() @Get('payments') payments(@Req() req: Request) { return this.portal.accountData(req, 'payments'); }
  @Public() @Get('receipts') receipts(@Req() req: Request) { return this.portal.accountData(req, 'receipts'); }
  @Public() @Get('deliveries') deliveries(@Req() req: Request) { return this.portal.accountData(req, 'deliveries'); }
  @Public() @Get('activity') activity(@Req() req: Request) { return this.portal.accountData(req, 'activity'); }

  @Require('clients.verify') @Get('verification/pending') async pending() {
    return { success: true, data: await this.db.clientAccount.findMany({ where: { verificationStatus: 'PENDING' }, orderBy: { createdAt: 'asc' }, take: 100, select: { id: true, type: true, createdAt: true, email: true, client: { select: { id: true, firstName: true, lastName: true, ulcNumber: true, faculty: true, promotion: true, residency: true, phone: true, category: { select: { label: true } } } } } }) };
  }

  @Require('clients.verify') @Post('verification/:id') async verify(@Param('id') id: string, @Body() input: unknown, @Req() req: AuthRequest) {
    const body = z.object({ decision: z.enum(['VERIFIED', 'REJECTED']), reason: z.string().trim().min(3).max(500) }).strict().parse(input);
    const account = await this.db.clientAccount.findUnique({ where: { id }, include: { client: true } });
    if (!account || account.verificationStatus !== 'PENDING') throw new DomainError('VERIFICATION_UNAVAILABLE', 'Cette demande ne peut plus être traitée.', 409);
    await this.db.$transaction(async tx => {
      await tx.clientAccount.update({ where: { id }, data: { verificationStatus: body.decision, verifiedAt: body.decision === 'VERIFIED' ? new Date() : null, verifiedById: req.actor.id } });
      await tx.auditLog.create({ data: { actorId: req.actor.id, action: `CLIENT_ACCOUNT_${body.decision}`, entityType: 'ClientAccount', entityId: id, oldValue: { verificationStatus: 'PENDING' }, newValue: { verificationStatus: body.decision, reason: body.reason }, metadata: { clientId: account.clientId } } });
      await tx.clientPortalEvent.create({ data: { accountId: id, action: `ACCOUNT_${body.decision}` } });
    });
    return { success: true, data: { verificationStatus: body.decision } };
  }
}
