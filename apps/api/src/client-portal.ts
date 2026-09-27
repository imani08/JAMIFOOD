import { Body, Controller, Delete, Get, Headers, Injectable, Param, Patch, Post, Req, Res, UploadedFile, UseInterceptors, StreamableFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as argon2 from 'argon2';
import sharp from 'sharp';
import { z } from 'zod';
import { ClientAccountType, ClientVerificationStatus } from '@jami/database';
import { AuthRequest, Public, Require } from './auth';
import { DomainError } from './http';
import { PrismaService } from './prisma.service';
import { MailService } from './mail.service';
import { photoDirectory } from './client-photos';
import type { Request, Response } from './transport';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const sessionToken = (req: Request) => req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('jami_client_session='))?.slice('jami_client_session='.length);
const cookieOptions = () => ({ httpOnly: true, secure: process.env.COOKIE_SECURE === 'true', sameSite: 'strict' as const, path: '/' });
const accountTypeByCategory = { STUDENT_HOME: 'ETUDIANT_HOME', STUDENT_EXTERNAL: 'ETUDIANT_EXTERNE', STAFF: 'PERSONNEL_ULC' } as const;
const sameName = (left:string,right:string) => left.normalize('NFKC').trim().toLocaleLowerCase('fr') === right.normalize('NFKC').trim().toLocaleLowerCase('fr');
const registerSchema = z.object({ type: z.nativeEnum(ClientAccountType), firstName: z.string().trim().min(1).max(80), lastName: z.string().trim().min(1).max(80), email: z.string().trim().email().max(254), password: z.string().min(12).max(256), confirmPassword: z.string().min(12).max(256), ulcNumber: z.string().trim().min(2).max(50), faculty: z.string().trim().max(120).optional(), promotion: z.string().trim().max(80).optional(), phone: z.string().trim().max(30).optional() }).strict().refine(body => body.password === body.confirmPassword, { path: ['confirmPassword'], message: 'Les mots de passe ne correspondent pas.' }).refine(body => body.type === 'STAFF' || (!!body.faculty && !!body.promotion), { path: ['faculty'], message: 'Faculté et promotion obligatoires pour les étudiants.' });

@Injectable()
export class ClientPortalService {
  constructor(private readonly db: PrismaService, private readonly mail: MailService) {}

  private async issueAuthToken(accountId: string, purpose: 'VERIFY_EMAIL'|'RESET_PASSWORD') {
    const now = new Date();
    const token=randomBytes(32).toString('base64url');
    await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "ClientAccount" WHERE id = ${accountId}::uuid FOR UPDATE`;
      const recent = await tx.clientAuthToken.count({where:{accountId,purpose,createdAt:{gte:new Date(now.getTime()-60*60_000)}}});
      const latest = await tx.clientAuthToken.findFirst({where:{accountId,purpose},orderBy:{createdAt:'desc'}});
      if (recent >= 5 || (latest && now.getTime()-latest.createdAt.getTime() < 60_000)) throw new DomainError('TOKEN_RATE_LIMIT','Veuillez patienter avant de réessayer.',429);
      await tx.clientAuthToken.updateMany({where:{accountId,purpose,usedAt:null},data:{usedAt:now}});
      await tx.clientAuthToken.create({data:{accountId,purpose,tokenHash:hash(token),expiresAt:new Date(now.getTime()+(purpose==='VERIFY_EMAIL'?30:20)*60_000)}});
    });
    return token;
  }

  async provisionExistingClient(clientId:string,actorId:string) {
    const client=await this.db.client.findUnique({where:{id:clientId},include:{category:true,account:true}});
    if(!client||client.status!=='ACTIVE')throw new DomainError('CLIENT_NOT_FOUND','Fiche client introuvable ou archivée.',404);
    if(!client.email?.trim())throw new DomainError('CLIENT_EMAIL_REQUIRED','Ajoutez et enregistrez d’abord l’adresse e-mail du client.',400);
    const type=client.category.code==='ETUDIANT_HOME'?'STUDENT_HOME':client.category.code==='ETUDIANT_EXTERNE'?'STUDENT_EXTERNAL':client.category.code==='PERSONNEL_ULC'?'STAFF':null;
    if(!type)throw new DomainError('CLIENT_CATEGORY_UNSUPPORTED','Cette catégorie ne permet pas de créer un compte portail.',409);
    const email=client.email.trim().toLowerCase();
    if(client.account&&client.account.email.toLowerCase()!==email)throw new DomainError('CLIENT_ACCOUNT_EMAIL_MISMATCH','Le courriel de la fiche diffère de celui du compte portail.',409);
    let account=client.account;
    let created=false;
    let token:string|undefined;
    if(!account) {
      const conflicting=await this.db.clientAccount.findUnique({where:{email},select:{id:true,clientId:true}});
      if(conflicting)throw new DomainError('CLIENT_ACCOUNT_EMAIL_IN_USE','Cette adresse est déjà utilisée par un compte portail. Utilisez le rattachement sécurisé du compte existant.',409);
      const passwordHash=await argon2.hash(randomBytes(48).toString('base64url'),{type:argon2.argon2id});
      token=randomBytes(32).toString('base64url');
      account=await this.db.$transaction(async tx=>{
        await tx.$queryRaw`SELECT "id" FROM "Client" WHERE "id"=${clientId}::uuid FOR UPDATE`;
        const current=await tx.client.findUnique({where:{id:clientId},include:{account:true}});
        if(!current||current.account)throw new DomainError('CLIENT_ACCOUNT_EXISTS','Cette fiche possède déjà un compte portail. Rechargez-la.',409);
        const createdAccount=await tx.clientAccount.create({data:{clientId,email,passwordHash,type,verificationStatus:'PENDING'}});
        await tx.clientAuthToken.create({data:{accountId:createdAccount.id,purpose:'ACCOUNT_INVITE',tokenHash:hash(token!),expiresAt:new Date(Date.now()+24*60*60_000)}});
        await tx.clientPortalEvent.create({data:{accountId:createdAccount.id,action:'ACCOUNT_PROVISIONED_BY_BACKOFFICE',metadata:{actorId}}});
        await tx.auditLog.create({data:{actorId,action:'CLIENT_PORTAL_ACCOUNT_CREATED',entityType:'ClientAccount',entityId:createdAccount.id,newValue:{clientId,email,type}}});
        return createdAccount;
      });
      created=true;
    } else if(account.emailVerifiedAt) {
      return {created:false,alreadyActive:true,email,invitationSent:false as const};
    } else {
      const recent=await this.db.clientAuthToken.findFirst({where:{accountId:account.id,purpose:'ACCOUNT_INVITE',usedAt:null,expiresAt:{gt:new Date()}},orderBy:{createdAt:'desc'}});
      if(recent&&Date.now()-recent.createdAt.getTime()<60_000)throw new DomainError('CLIENT_INVITE_RATE_LIMIT','Une invitation vient déjà d’être envoyée. Réessayez dans une minute.',429);
      token=randomBytes(32).toString('base64url');
      await this.db.$transaction(async tx=>{
        await tx.clientAuthToken.updateMany({where:{accountId:account!.id,purpose:'ACCOUNT_INVITE',usedAt:null},data:{usedAt:new Date()}});
        await tx.clientAuthToken.create({data:{accountId:account!.id,purpose:'ACCOUNT_INVITE',tokenHash:hash(token!),expiresAt:new Date(Date.now()+24*60*60_000)}});
        await tx.clientPortalEvent.create({data:{accountId:account!.id,action:'ACCOUNT_INVITATION_RESENT',metadata:{actorId}}});
      });
    }
    const delivery=await this.mail.sendPortalInvitation(email,`${client.firstName} ${client.lastName}`,token!).catch(()=>({sent:false as const}));
    return {created,alreadyActive:false,email,invitationSent:delivery.sent,...('developmentUrl' in delivery&&delivery.developmentUrl?{developmentUrl:delivery.developmentUrl}:{})};
  }

  async acceptInvitation(input:unknown,response:Response) {
    const body=z.object({token:z.string().min(20).max(200),password:z.string().min(12).max(256),confirmPassword:z.string().min(12).max(256)}).strict().refine(x=>x.password===x.confirmPassword,{path:['confirmPassword'],message:'Les mots de passe ne correspondent pas.'}).parse(input);
    const now=new Date();
    const invite=await this.db.clientAuthToken.findFirst({where:{tokenHash:hash(body.token),purpose:'ACCOUNT_INVITE',usedAt:null,expiresAt:{gt:now}},include:{account:true}});
    if(!invite)throw new DomainError('TOKEN_INVALID','Ce lien d’activation est invalide ou expiré. Demandez une nouvelle invitation.',400);
    const passwordHash=await argon2.hash(body.password,{type:argon2.argon2id});
    await this.db.$transaction(async tx=>{
      const claimed=await tx.clientAuthToken.updateMany({where:{id:invite.id,usedAt:null,expiresAt:{gt:now}},data:{usedAt:now}});
      if(claimed.count!==1)throw new DomainError('TOKEN_INVALID','Ce lien a déjà été utilisé. Connectez-vous au portail.',400);
      await tx.clientAccount.update({where:{id:invite.accountId},data:{passwordHash,emailVerifiedAt:now}});
      await tx.clientPortalEvent.create({data:{accountId:invite.accountId,action:'ACCOUNT_INVITATION_ACCEPTED'}});
    });
    const qr=await this.getOrCreateClientQr(invite.account.clientId);
    await this.issueSession(invite.accountId,response);
    return {success:true,data:{activated:true,qrIssued:qr.status==='ACTIVE'}};
  }

  private async allowAuthAction(purpose:'VERIFY_EMAIL'|'RESET_PASSWORD',email:string) {
    const key=hash(`client-auth:${purpose}:${email.toLowerCase()}`);
    const now=new Date();
    const attempt=await this.db.loginAttempt.findUnique({where:{key}});
    if(attempt?.blockedUntil&&attempt.blockedUntil>now)return false;
    const recent=attempt&&now.getTime()-attempt.windowStart.getTime()<15*60_000;
    const row=await this.db.loginAttempt.upsert({where:{key},create:{key,failures:1},update:recent?{failures:{increment:1}}:{failures:1,windowStart:now,blockedUntil:null}});
    if(row.failures>=5) {
      await this.db.loginAttempt.update({where:{key},data:{blockedUntil:new Date(now.getTime()+15*60_000)}});
      return false;
    }
    return true;
  }

  private async sendVerification(accountId:string,email:string) {
    const token=await this.issueAuthToken(accountId,'VERIFY_EMAIL');
    return this.mail.sendVerificationEmail(email,token);
  }

  async verifyEmail(input:unknown,response?:Response) {
    const {token}=z.object({token:z.string().min(20).max(200)}).strict().parse(input);
    const now=new Date();
    const row=await this.db.clientAuthToken.findFirst({where:{tokenHash:hash(token),purpose:'VERIFY_EMAIL',usedAt:null,expiresAt:{gt:now}},include:{account:true}});
    if(!row)throw new DomainError('TOKEN_INVALID','Ce lien est invalide ou expiré.',400);
    await this.db.$transaction(async tx=>{
      const claimed=await tx.clientAuthToken.updateMany({where:{id:row.id,usedAt:null,expiresAt:{gt:now}},data:{usedAt:now}});
      if(claimed.count!==1)throw new DomainError('TOKEN_INVALID','Ce lien est invalide ou expiré.',400);
      await tx.clientAccount.update({where:{id:row.accountId},data:{emailVerifiedAt:now}});
    });
    // Email verification is sufficient for a personal QR; ULC approval remains a separate workflow.
    const qr = await this.getOrCreateClientQr(row.account.clientId);
    if(response){await this.issueSession(row.accountId,response);await this.db.clientPortalEvent.create({data:{accountId:row.accountId,action:'EMAIL_VERIFIED_SESSION_STARTED'}});}
    return {success:true,data:{verified:true,qrIssued:qr.status==='ACTIVE'}};
  }

  async resendVerification(input:unknown) {
    const {email}=z.object({email:z.string().email().max(254)}).strict().parse(input);
    const allowed=await this.allowAuthAction('VERIFY_EMAIL',email);
    const account=allowed?await this.db.clientAccount.findUnique({where:{email:email.toLowerCase()}}):null;
    let developmentUrl:string|undefined;
    if(account&&!account.emailVerifiedAt) { try { developmentUrl=(await this.sendVerification(account.id,account.email)).developmentUrl; } catch { /* Keep resend responses generic in production. */ } }
    return {success:true,data:{message:'Si cette adresse nécessite une vérification, un lien sera envoyé.',...(process.env.MAIL_MODE==='development'&&developmentUrl?{developmentUrl}:{})}};
  }

  async forgotPassword(input:unknown) {
    const {email}=z.object({email:z.string().email().max(254)}).strict().parse(input);
    const allowed=await this.allowAuthAction('RESET_PASSWORD',email);
    const account=allowed?await this.db.clientAccount.findUnique({where:{email:email.toLowerCase()}}):null;
    if(account) {
      try { const token=await this.issueAuthToken(account.id,'RESET_PASSWORD'); await this.mail.sendPasswordResetEmail(account.email,token); }
      catch { /* Same public result for missing accounts, rate limits, and provider failures. */ }
    }
    return {success:true,data:{message:'Si un compte correspond à cette adresse, un lien de récupération a été envoyé.'}};
  }

  async resetPassword(input:unknown) {
    const body=z.object({token:z.string().min(20).max(200),password:z.string().min(12).max(256),confirmPassword:z.string().min(12).max(256)}).strict().refine(x=>x.password===x.confirmPassword,{path:['confirmPassword'],message:'Les mots de passe ne correspondent pas.'}).parse(input);
    const now=new Date(); const row=await this.db.clientAuthToken.findFirst({where:{tokenHash:hash(body.token),purpose:'RESET_PASSWORD',usedAt:null,expiresAt:{gt:now}}});
    if(!row)throw new DomainError('TOKEN_INVALID','Ce lien est invalide ou expiré.',400);
    const passwordHash=await argon2.hash(body.password,{type:argon2.argon2id});
    await this.db.$transaction(async tx=>{
      const claimed=await tx.clientAuthToken.updateMany({where:{id:row.id,usedAt:null,expiresAt:{gt:now}},data:{usedAt:now}});
      if(claimed.count!==1)throw new DomainError('TOKEN_INVALID','Ce lien est invalide ou expiré.',400);
      await tx.clientAccount.update({where:{id:row.accountId},data:{passwordHash}});
      await tx.clientSession.deleteMany({where:{accountId:row.accountId}});
    });
    return {success:true,data:{message:'Mot de passe modifié. Veuillez vous reconnecter.'}};
  }

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
    const existing=await this.db.client.findUnique({where:{ulcNumber},include:{category:true,account:true}});
    let accountId:string;
    if(existing) {
      const matches=existing.email?.trim().toLowerCase()===email&&sameName(existing.firstName,body.firstName)&&sameName(existing.lastName,body.lastName)&&existing.category.code===accountTypeByCategory[body.type];
      if(!matches)throw new DomainError('CLIENT_LINK_REQUIRES_MATCH','Ce matricule existe déjà. Le nom, la catégorie et le courriel doivent correspondre aux informations enregistrées par JAMI FOOD; contactez l’administration si le courriel est absent ou différent.',409);
      if(existing.account)throw new DomainError('CLIENT_ACCOUNT_EXISTS','Un compte portail est déjà associé à cette fiche. Connectez-vous ou réinitialisez votre mot de passe.',409);
      const passwordHash=await argon2.hash(body.password,{type:argon2.argon2id});
      const linked=await this.db.$transaction(async tx=>{
        await tx.$queryRaw`SELECT id FROM "Client" WHERE id = ${existing.id}::uuid FOR UPDATE`;
        const current=await tx.client.findUnique({where:{id:existing.id},select:{account:{select:{id:true}}}});
        if(current?.account)throw new DomainError('CLIENT_ACCOUNT_EXISTS','Un compte portail est déjà associé à cette fiche. Connectez-vous ou réinitialisez votre mot de passe.',409);
        const created=await tx.clientAccount.create({data:{clientId:existing.id,email,passwordHash,type:body.type,verificationStatus:'PENDING'}});
        await tx.clientPortalEvent.create({data:{accountId:created.id,action:'ACCOUNT_REGISTERED',metadata:{linkedExistingClient:true}}});
        return created;
      });
      accountId=linked.id;
    } else {
      const passwordHash=await argon2.hash(body.password,{type:argon2.argon2id});
      const created=await this.db.$transaction(async tx=>{
        const client=await tx.client.create({data:{categoryId:category.id,firstName:body.firstName,lastName:body.lastName,ulcNumber,faculty:body.faculty||null,promotion:body.promotion||null,residency:body.type==='STUDENT_HOME'?'HOME':body.type==='STUDENT_EXTERNAL'?'EXTERNAL':null,phone:body.phone||null,email,account:{create:{email,passwordHash,type:body.type,verificationStatus:'PENDING'}}},include:{account:true}});
        await tx.clientPortalEvent.create({data:{accountId:client.account!.id,action:'ACCOUNT_REGISTERED'}});
        return client;
      });
      accountId=created.account!.id;
    }
    const verificationToken=await this.issueAuthToken(accountId,'VERIFY_EMAIL');
    const delivery=await this.mail.sendVerificationEmail(email,verificationToken).catch(()=>({sent:false as const,developmentUrl:undefined}));
    return { success: true, data: { verificationStatus: 'PENDING' as const, emailVerified: false, emailSent: delivery.sent, ...(delivery.developmentUrl?{developmentUrl:delivery.developmentUrl}:{}), message: 'Compte créé et associé à votre fiche JAMI FOOD. Vérifiez votre adresse e-mail, puis votre identité ULC pourra être examinée.' } };
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
    if(!account.emailVerifiedAt) throw new DomainError('EMAIL_NOT_VERIFIED','Vérifiez votre adresse e-mail avant de vous connecter.',403);
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
    return { success: true, data: { id: c.id, firstName: c.firstName, lastName: c.lastName, email: s.account.email, emailVerifiedAt:s.account.emailVerifiedAt, photoUrl:c.photoObjectKey?'/api/v1/client/profile/photo':null, phone: c.phone, category: c.category.label, type: s.account.type, verificationStatus: s.account.verificationStatus, ulcNumber: c.ulcNumber, faculty: c.faculty, promotion: c.promotion, residency: c.residency } };
  }

  async logout(req: Request, response: Response) {
    const token = sessionToken(req); if (token) await this.db.clientSession.deleteMany({ where: { tokenHash: hash(token) } });
    response.clearCookie('jami_client_session', cookieOptions()); return { success: true, data: null };
  }

  async deleteAccount(req:Request,input:unknown,response:Response) {
    const session=await this.authenticate(req);
    const {currentPassword}=z.object({currentPassword:z.string().min(1).max(256)}).strict().parse(input);
    if(!await argon2.verify(session.account.passwordHash,currentPassword))throw new DomainError('INVALID_CREDENTIALS','Le mot de passe actuel est incorrect.',401);
    await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT "id" FROM "ClientAccount" WHERE "id"=${session.accountId}::uuid FOR UPDATE`;
      const account=await tx.clientAccount.findUnique({where:{id:session.accountId},select:{id:true,clientId:true,passwordHash:true}});
      if(!account||!await argon2.verify(account.passwordHash,currentPassword))throw new DomainError('INVALID_CREDENTIALS','Le compte a changé. Reconnectez-vous puis réessayez.',401);
      const codes=await tx.qRCode.findMany({where:{clientId:account.clientId,status:'ACTIVE'},select:{id:true}});
      for(const code of codes)await tx.qRCode.update({where:{id:code.id},data:{status:'REVOKED',revokedAt:new Date(),history:{create:{action:'REVOKED_ACCOUNT_DELETED',metadata:{clientInitiated:true}}}}});
      await tx.client.update({where:{id:account.clientId},data:{status:'ARCHIVED',photoObjectKey:null}});
      await tx.auditLog.create({data:{action:'CLIENT_ARCHIVED_BY_OWNER',entityType:'Client',entityId:account.clientId,metadata:{reason:'PORTAL_ACCOUNT_DELETED'}}});
      await tx.auditLog.create({data:{action:'CLIENT_PORTAL_ACCOUNT_DELETED_BY_OWNER',entityType:'ClientAccount',entityId:account.id,metadata:{clientId:account.clientId,qrCodesRevoked:codes.length}}});
      await tx.clientAccount.delete({where:{id:account.id}});
    });
    response.clearCookie('jami_client_session',cookieOptions());
    return {success:true,data:{deleted:true}};
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

  async uploadProfilePhoto(req:Request,file:{mimetype:string;buffer:Buffer}|undefined) {
    const session=await this.authenticate(req);
    if(!file)throw new DomainError('CLIENT_PHOTO_REQUIRED','Sélectionnez une photo.',400);
    const mimeToFormat:Record<string,string>={'image/jpeg':'jpeg','image/png':'png','image/webp':'webp'};
    const format=mimeToFormat[file.mimetype];if(!format)throw new DomainError('CLIENT_PHOTO_TYPE_INVALID','Formats autorisés : JPG, PNG et WEBP.',400);
    let normalized:Buffer;
    try {const input=sharp(file.buffer,{limitInputPixels:25_000_000,animated:false,failOn:'warning'});const metadata=await input.metadata();if(metadata.format!==format)throw new Error('format mismatch');normalized=await input.rotate().resize(512,512,{fit:'cover',withoutEnlargement:true}).webp({quality:82}).toBuffer();}
    catch {throw new DomainError('CLIENT_PHOTO_INVALID','Le fichier ne contient pas une image valide.',400);}
    const directory=photoDirectory();await mkdir(directory,{recursive:true});const objectKey=`${randomUUID()}.webp`;const path=resolve(directory,objectKey);await writeFile(path,normalized,{flag:'wx'});
    try {await this.db.$transaction(async tx=>{await tx.client.update({where:{id:session.account.clientId},data:{photoObjectKey:objectKey}});await tx.clientPortalEvent.create({data:{accountId:session.accountId,action:'PROFILE_PHOTO_UPDATED'}});});}
    catch(error){await unlink(path).catch(()=>{});throw error;}
    return {success:true,data:{photoUrl:'/api/v1/client/profile/photo'}};
  }

  async profilePhoto(req:Request,response:Response) {
    const session=await this.authenticate(req);const key=session.account.client.photoObjectKey;
    if(!key||! /^(?:[0-9a-f]{32}|[0-9a-f-]{36})\.(jpg|png|webp)$/i.test(key))throw new DomainError('CLIENT_PHOTO_NOT_FOUND','Photo introuvable.',404);
    const path=resolve(photoDirectory(),key);try{await stat(path);}catch{throw new DomainError('CLIENT_PHOTO_NOT_FOUND','Photo introuvable.',404);}
    response.setHeader('Content-Type',key.endsWith('.png')?'image/png':key.endsWith('.jpg')?'image/jpeg':'image/webp');response.setHeader('Cache-Control','private, no-store');return new StreamableFile(createReadStream(path));
  }

  async accountData(req: Request, section: string) {
    const s = await this.authenticate(req); const clientId = s.account.clientId;
    if (section === 'subscriptions') return { success: true, data: await this.db.subscription.findMany({ where: { clientId }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, status: true, startsOn: true, endsOn: true, amount: true, currency: true, paidAmount: true, balance: true, deliveryIncluded: true, serviceSnapshot: true, rights: { select: { id:true,status:true,businessDate:true,serviceCode:true,consumedAt:true } }, planVersion: { select: { version:true,price:true,currency:true,services:true,plan: { select: { name: true } } } } } }) };
    if (section === 'rights') return { success: true, data: await this.db.mealRight.findMany({ where: { subscription: { clientId } }, orderBy: [{ businessDate: 'desc' }, { serviceCode: 'asc' }], take: 150, select: { id: true, businessDate: true, serviceCode: true, status: true, consumedAt: true, reservedAt:true, subscription: { select: { planVersion: { select: { plan: { select: { name: true } } } } } } } }) };
    if (section === 'orders' || section === 'deliveries') return { success: true, data: await this.db.order.findMany({ where: { clientId, ...(section === 'deliveries' ? { serviceMode: 'DELIVERY' as const } : {}) }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, number: true, status: true, serviceMode: true, totalAmount: true, commercialTotal:true, coveredAmount:true, mealRightId:true, currency: true, createdAt: true, items: { select: { quantity: true, unitPrice: true, lineTotal:true, productSnapshot: true } } } }) };
    if (section === 'payments' || section === 'receipts') return { success: true, data: await this.db.payment.findMany({ where: { order: { clientId }, ...(section === 'receipts' ? { status: 'CONFIRMED' as const } : {}) }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, orderId: true, status: true, method: true, referenceCurrency: true, amountDue: true, receivedAmount: true, receivedCurrency: true, confirmedAt: true, order: { select: { number: true, createdAt: true } } } }) };
    if (section === 'activity') {
      const [events, orders, subscriptions] = await Promise.all([this.db.clientPortalEvent.findMany({ where: { accountId: s.accountId }, orderBy: { createdAt: 'desc' }, take: 50, select: { action: true, createdAt: true } }), this.db.order.findMany({ where: { clientId }, orderBy: { createdAt: 'desc' }, take: 25, select: { number: true, status: true, createdAt: true } }), this.db.subscription.findMany({ where: { clientId }, orderBy: { createdAt: 'desc' }, take: 25, select: { status: true, createdAt: true } })]);
      return { success: true, data: [...events, ...orders.map(row => ({ action: `ORDER_${row.status}`, createdAt: row.createdAt, label: row.number })), ...subscriptions.map(row => ({ action: `SUBSCRIPTION_${row.status}`, createdAt: row.createdAt }))].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 100) };
    }
    throw new DomainError('NOT_FOUND', 'Rubrique inconnue.', 404);
  }

  async order(req: Request, id: string) {
    const s = await this.authenticate(req); const order = await this.db.order.findFirst({ where: { id, clientId: s.account.clientId }, select: { id: true, number: true, status: true, serviceMode: true, totalAmount: true, commercialTotal:true, coveredAmount:true, mealRightId:true, currency: true, createdAt: true, items: { select: { quantity: true, unitPrice: true, lineTotal: true, productSnapshot: true, supplementsSnapshot:true } }, statusHistory: { orderBy: { createdAt: 'asc' }, select: { toStatus: true, createdAt: true } }, delivery: { select: { status: true, assignedAt: true, deliveredAt: true } } } });
    if (!order) throw new DomainError('ORDER_NOT_FOUND', 'Commande introuvable.', 404);
    return { success: true, data: order };
  }

  async createOrder(req: Request, input: unknown, idempotencyKey: string | undefined) {
    const s = await this.authenticate(req);
    const key=z.string().uuid().parse(idempotencyKey);
    const body = z.object({ menuVersionId: z.string().uuid(), serviceMode: z.enum(['DINE_IN','TAKEAWAY']), currency: z.enum(['CDF','USD']), items: z.array(z.object({ productId: z.string().uuid(), quantity: z.number().int().min(1).max(100) }).strict()).min(1).max(50).refine(items=>new Set(items.map(item=>item.productId)).size===items.length,'Un produit ne peut apparaître qu’une fois dans une commande.') }).strict().parse(input);
    const requestHash=hash(JSON.stringify(body));
    const publicPriceCategory = process.env.PUBLIC_PRICE_CATEGORY_CODE;
    if (s.account.verificationStatus !== 'VERIFIED' && !publicPriceCategory) throw new DomainError('ACCOUNT_PENDING_VERIFICATION', 'Votre compte doit être vérifié avant de passer une commande.', 403);
    const menuVersion = await this.db.menuVersion.findFirst({ where: { id: body.menuVersionId, status: 'PUBLISHED', menu: { businessDate: new Date(new Intl.DateTimeFormat('en-CA', { timeZone: process.env.RESTAURANT_TIMEZONE ?? 'Africa/Kinshasa' }).format(new Date()) + 'T00:00:00.000Z') } }, include: { items: { where: { available: true, product: { active: true, available: true } } }, menu: true } });
    if (!menuVersion) throw new DomainError('MENU_UNAVAILABLE', 'Ce menu n’est plus publié pour aujourd’hui.', 409);
    const result = await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      const previous=await tx.order.findUnique({where:{clientIdempotencyKey:key}});
      if(previous) {
        if(previous.clientId!==s.account.clientId||previous.clientRequestHash!==requestHash)throw new DomainError('IDEMPOTENCY_KEY_REUSED','Cette clé a déjà été utilisée pour une autre commande.',409);
        return {id:previous.id,number:previous.number,status:previous.status,totalAmount:previous.totalAmount,commercialTotal:previous.commercialTotal,coveredAmount:previous.coveredAmount,mealRightId:previous.mealRightId,currency:previous.currency,createdAt:previous.createdAt};
      }
      await tx.$queryRaw`SELECT id FROM "MenuVersion" WHERE id = ${menuVersion.id}::uuid FOR UPDATE`;
      const latest = await tx.menuVersion.findUniqueOrThrow({ where: { id: menuVersion.id }, include: { items: true, menu: true } });
      const products = await tx.product.findMany({ where: { id: { in: body.items.map(row => row.productId) }, active: true, available: true }, include: { category: true, prices: { include: { versions: { where: { status: 'ACTIVE', effectiveFrom: { lte: new Date() }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }] }, orderBy: { version: 'desc' } } } } } });
      const categoryCodes = s.account.verificationStatus === 'VERIFIED' ? [s.account.client.category.code] : [publicPriceCategory!];
      const lines = body.items.map(row => {
        const product = products.find(value => value.id === row.productId); const item = latest.items.find(value => value.productId === row.productId);
        const isSupplement=product?.category.code==='SUPPLEMENT';
        if (!product || (!isSupplement && (!item || !item.available || row.quantity > item.quantityAvailable - item.quantitySold))) throw new DomainError('MENU_ITEM_UNAVAILABLE', 'Un article est indisponible ou épuisé.', 409);
        const snapshot = item?.priceSnapshot as { categories?: Record<string,{amount:string;currency:string;priceVersionId:string}> }|null;
        const menuPrice=categoryCodes.map(code=>({code,price:snapshot?.categories?.[code]})).find(value=>value.price?.currency===body.currency);
        const supplementPrice=isSupplement?categoryCodes.map(code=>({code,price:product.prices.find(pp=>pp.categoryCode===code)?.versions[0]})).find(value=>value.price?.currency===body.currency)??{code:'ETUDIANT_EXTERNE',price:product.prices.find(pp=>pp.categoryCode==='ETUDIANT_EXTERNE')?.versions[0]}:undefined;
        const selected=menuPrice?.price?menuPrice:supplementPrice;
        if (!selected?.price) throw new DomainError('PRICE_UNAVAILABLE', 'Le tarif demandé n’est pas disponible.', 409);
        return { id:item?.id??null,product,menuItem:item,quantity:row.quantity,price:selected.price,productSnapshot:{name:product.name,menuVersionId:latest.id,clientCategoryCode:selected.code,priceVersionId:'priceVersionId' in selected.price?selected.price.priceVersionId:null,supplement:isSupplement} };
      });
      const total = lines.reduce((sum,row)=>sum+Number(row.price.amount)*row.quantity,0);
      if (!Number.isFinite(total)||total<=0) throw new DomainError('INVALID_AMOUNT','Le montant de la commande est invalide.',400);
      const mealLine=lines.find(row=>row.product.sku==='JAMI-REPAS-COMPLET');
      if(mealLine && (mealLine.quantity!==1 || body.currency!=='CDF')) throw new DomainError('MEAL_QUANTITY_INVALID','Un droit couvre un repas complet par commande, facturé en CDF.',400);
      let mealRightId:string|undefined;
      let covered=0;
      if(mealLine && s.account.verificationStatus==='VERIFIED') {
        const service=latest.menu.serviceCode;
        const date=latest.menu.businessDate;
        const matches=await tx.$queryRaw<Array<{id:string}>>`SELECT mr."id" FROM "MealRight" mr JOIN "Subscription" sub ON sub."id"=mr."subscriptionId" WHERE sub."clientId"=${s.account.clientId}::uuid AND mr."businessDate"=${date}::date AND mr."status"='AVAILABLE'::"MealRightStatus" AND sub."status" IN ('ACTIVE'::"SubscriptionStatus",'SCHEDULED'::"SubscriptionStatus") AND sub."startsOn"<=${date}::date AND sub."endsOn">=${date}::date AND sub."balance"<=0 AND (mr."serviceCode"=${service} OR (mr."serviceCode"='MAIN' AND ${service} IN ('LUNCH','DINNER'))) ORDER BY sub."startsOn" DESC LIMIT 1 FOR UPDATE OF mr SKIP LOCKED`;
        if(matches[0]) { mealRightId=matches[0].id; covered=Number(mealLine.price.amount); }
      }
      const payable=total-covered;
      for (const row of lines) { if(!row.menuItem)continue;const updated=await tx.menuItem.updateMany({where:{id:row.menuItem.id,available:true,quantitySold:{lte:row.menuItem.quantityAvailable-row.quantity}},data:{quantitySold:{increment:row.quantity}}}); if(updated.count!==1)throw new DomainError('MENU_ITEM_UNAVAILABLE','La quantité disponible vient de changer.',409); }
      const order = await tx.order.create({ data:{number:`WEB-${new Date().getFullYear()}-${randomBytes(5).toString('hex').toUpperCase()}`,clientId:s.account.clientId,clientIdempotencyKey:key,clientRequestHash:requestHash,menuVersionId:latest.id,serviceMode:body.serviceMode,businessDate:latest.menu.businessDate,totalAmount:payable,commercialTotal:total,coveredAmount:covered,mealRightId,currency:body.currency,paymentRequired:payable>0,items:{create:lines.map(row=>({productId:row.product.id,quantity:row.quantity,unitPrice:row.price.amount,lineTotal:String(Number(row.price.amount)*row.quantity),productSnapshot:{...row.productSnapshot,...(row.product.sku==='JAMI-REPAS-COMPLET'?{coveredAmount:covered,coveredBySubscription:covered>0}: {})}}))},statusHistory:{create:{toStatus:'RECEIVED'}}},select:{id:true,number:true,status:true,totalAmount:true,commercialTotal:true,coveredAmount:true,mealRightId:true,currency:true,createdAt:true} });
      if(mealRightId) {
        const held=await tx.mealRight.updateMany({where:{id:mealRightId,status:'AVAILABLE'},data:{status:'RESERVED',reservedAt:new Date()}});
        if(held.count!==1)throw new DomainError('MEAL_RIGHT_UNAVAILABLE','Votre droit vient d’être réservé dans une autre commande.',409);
        await tx.mealReservation.create({data:{mealRightId,orderId:order.id,reservedById:randomBytes(16).toString('hex').replace(/^(........)(....)(....)(....)(............)$/,'$1-$2-$3-$4-$5')}});
      }
      await tx.clientPortalEvent.create({data:{accountId:s.accountId,action:'ORDER_CREATED',metadata:{orderId:order.id}}}); return {...order,lines:lines.map(row=>({name:row.product.name,commercialAmount:Number(row.price.amount)*row.quantity,coveredAmount:row.product.sku==='JAMI-REPAS-COMPLET'?covered:0,amountDue:Number(row.price.amount)*row.quantity-(row.product.sku==='JAMI-REPAS-COMPLET'?covered:0),supplement:row.product.category.code==='SUPPLEMENT'}))};
    });
    return { success: true, data: result };
  }

  async qr(req: Request) {
    const s=await this.authenticate(req);
    if(!s.account.emailVerifiedAt)throw new DomainError('EMAIL_VERIFICATION_REQUIRED','Vérifiez votre adresse e-mail avant d’utiliser votre QR Code.',403);
    const active=await this.getOrCreateClientQr(s.account.clientId);
    return {success:true,data:{id:active.id,status:active.status,issuedAt:active.issuedAt,token:this.decryptQrToken(active.tokenCiphertext!)}};
  }

  private async getOrCreateClientQr(clientId:string) {
    const found=await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "Client" WHERE id = ${clientId}::uuid FOR UPDATE`;
      return tx.qRCode.findFirst({where:{clientId,status:'ACTIVE'},orderBy:{issuedAt:'desc'}});
    });
    if(found) {
      if(!found.tokenCiphertext)throw new DomainError('QR_RECOVERY_UNAVAILABLE','Le QR actif ne peut pas être récupéré. Contactez le service client pour le renouveler.',409);
      return found;
    }
    const {randomBytes,createHash,createCipheriv}=await import('node:crypto');
    const token='JAMI-'+randomBytes(32).toString('base64url'); const keyHex=process.env.QR_TOKEN_ENCRYPTION_KEY;
    if(!keyHex||!/^[0-9a-f]{64}$/i.test(keyHex))throw new DomainError('QR_ENCRYPTION_UNAVAILABLE','La clé de chiffrement QR n’est pas configurée.',503);
    const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',Buffer.from(keyHex,'hex'),iv);const encrypted=Buffer.concat([cipher.update(token,'utf8'),cipher.final()]);const tokenCiphertext=`v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
    return this.db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "Client" WHERE id = ${clientId}::uuid FOR UPDATE`;const existing=await tx.qRCode.findFirst({where:{clientId,status:'ACTIVE'},orderBy:{issuedAt:'desc'}});if(existing){if(!existing.tokenCiphertext)throw new DomainError('QR_RECOVERY_UNAVAILABLE','Le QR actif ne peut pas être récupéré. Contactez le service client pour le renouveler.',409);return existing;}return tx.qRCode.create({data:{clientId,tokenHash:createHash('sha256').update(token).digest('hex'),tokenCiphertext,history:{create:{action:'ISSUED',metadata:{source:'CLIENT_PORTAL'}}}}});});
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
  @Require('clients.create') @Post('accounts/from-client/:id') provisionClientAccount(@Param('id') id:string,@Req() req:AuthRequest) { return this.portal.provisionExistingClient(id,req.actor.id).then(data=>({success:true,data})); }
  @Public() @Post('accept-invitation') acceptInvitation(@Body() input:unknown,@Res({passthrough:true})res:Response) { return this.portal.acceptInvitation(input,res); }
  @Public() @Post('login') login(@Body() input: unknown, @Res({ passthrough: true }) res: Response) { return this.portal.login(input, res); }
  @Public() @Post('verify-email') verifyEmail(@Body() input: unknown,@Res({passthrough:true})res:Response) { return this.portal.verifyEmail(input,res); }
  @Public() @Post('resend-verification') resendVerification(@Body() input: unknown) { return this.portal.resendVerification(input); }
  @Public() @Post('forgot-password') forgotPassword(@Body() input: unknown) { return this.portal.forgotPassword(input); }
  @Public() @Post('reset-password') resetPassword(@Body() input: unknown) { return this.portal.resetPassword(input); }
  @Public() @Post('logout') logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) { return this.portal.logout(req, res); }
  @Public() @Delete('account') deleteAccount(@Req() req:Request,@Body() input:unknown,@Res({passthrough:true})res:Response) { return this.portal.deleteAccount(req,input,res); }
  @Public() @Get('me') me(@Req() req: Request) { return this.portal.me(req); }
  @Public() @Patch('profile') profile(@Req() req: Request, @Body() input: unknown) { return this.portal.profile(req, input); }
  @Public() @Post('profile/photo') @UseInterceptors(FileInterceptor('photo',{limits:{files:1,fileSize:5*1024*1024}})) uploadProfilePhoto(@Req() req:Request,@UploadedFile() file:{mimetype:string;buffer:Buffer}|undefined){return this.portal.uploadProfilePhoto(req,file);}
  @Public() @Get('profile/photo') profilePhoto(@Req() req:Request,@Res({passthrough:true})res:Response){return this.portal.profilePhoto(req,res);}
  @Public() @Get('orders/:id') order(@Req() req: Request, @Param('id') id: string) { return this.portal.order(req, id); }
  @Public() @Post('orders') createOrder(@Req() req: Request, @Body() input: unknown, @Headers('idempotency-key') key: string | undefined) { return this.portal.createOrder(req, input, key); }
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
