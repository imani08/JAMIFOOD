import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ClientPortalService } from './client-portal';

const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
function authHarness(){
  let authToken:{id:string;accountId:string;purpose:string;tokenHash:string;expiresAt:Date;usedAt:Date|null;createdAt:Date;account?:{clientId:string}}|null=null;
  const accountUpdate=vi.fn();const sessionDelete=vi.fn();
  const tokens={count:vi.fn().mockResolvedValue(0),findFirst:vi.fn(async({where}:{where:{tokenHash?:string;purpose?:string;usedAt?:null;expiresAt?:{gt:Date}}})=>authToken&&(!where.tokenHash||where.tokenHash===authToken.tokenHash)&&(!where.purpose||where.purpose===authToken.purpose)&&(!('usedAt'in where)||authToken.usedAt===null)&&(!where.expiresAt||authToken.expiresAt>where.expiresAt.gt)?authToken:null),updateMany:vi.fn(async({where,data}:{where:{id?:string;tokenHash?:string;usedAt?:null;expiresAt?:{gt:Date}};data:{usedAt:Date}})=>{if(authToken&&!authToken.usedAt&&(!where.id||where.id===authToken.id)&&(!where.tokenHash||where.tokenHash===authToken.tokenHash)&&(!where.expiresAt||authToken.expiresAt>where.expiresAt.gt)){authToken={...authToken,usedAt:data.usedAt};return{count:1};}return{count:0};}),create:vi.fn(async({data}:{data:Omit<NonNullable<typeof authToken>,'id'|'usedAt'|'createdAt'>})=>{authToken={...data,id:'token-id',usedAt:null,createdAt:new Date()};return authToken;})};
  const qrCreate=vi.fn(async({data}:{data:Record<string,unknown>})=>({id:'qr-id',status:'ACTIVE',issuedAt:new Date(),...data}));
  const tx={ $queryRaw:vi.fn(),clientAuthToken:tokens,clientAccount:{update:accountUpdate},clientSession:{deleteMany:sessionDelete},qRCode:{findFirst:vi.fn(async()=>null),create:qrCreate} };
  const transaction=vi.fn(async(fn:(value:typeof tx)=>Promise<unknown>)=>fn(tx));
  const db={$transaction:transaction,clientAuthToken:tokens,clientAccount:{findUnique:vi.fn(async()=>null)},clientSession:{},qRCode:tx.qRCode,loginAttempt:{findUnique:vi.fn(async()=>null),upsert:vi.fn(async()=>({failures:1})),update:vi.fn()}};
  const mail={sendVerificationEmail:vi.fn(async()=>({sent:false})),sendPasswordResetEmail:vi.fn(async()=>({sent:false}))};
  return{service:new ClientPortalService(db as never,mail as never),db,tokens,tx,mail,accountUpdate,sessionDelete,qrCreate,getToken:()=>authToken,setToken:(value:NonNullable<typeof authToken>)=>{authToken=value;}};
}

describe('client email and password tokens',()=>{
  it('stores only the hash of a 256-bit, expiring email token and enforces cooldown',async()=>{
    const h=authHarness();const raw=await (h.service as any).issueAuthToken('11111111-1111-4111-8111-111111111111','VERIFY_EMAIL');
    expect(raw).toHaveLength(43);expect(h.getToken()?.tokenHash).toBe(digest(raw));expect(h.getToken()?.tokenHash).not.toBe(raw);
    expect(h.getToken()?.expiresAt.getTime()).toBeGreaterThan(Date.now()+29*60_000);
    h.tokens.count.mockResolvedValue(5);
    await expect((h.service as any).issueAuthToken('11111111-1111-4111-8111-111111111111','VERIFY_EMAIL')).rejects.toMatchObject({status:429});
  });

  it('verifies a live email token once and rejects its reuse',async()=>{
    const h=authHarness();const raw='random-email-token-123456789';
    const row={id:'token-id',accountId:'account-id',purpose:'VERIFY_EMAIL',tokenHash:digest(raw),expiresAt:new Date(Date.now()+60_000),usedAt:null,createdAt:new Date(),account:{clientId:'11111111-1111-4111-8111-111111111111'}};
    h.setToken(row);
    const previousKey=process.env.QR_TOKEN_ENCRYPTION_KEY;process.env.QR_TOKEN_ENCRYPTION_KEY='a'.repeat(64);
    await expect(h.service.verifyEmail({token:raw})).resolves.toMatchObject({data:{verified:true,qrIssued:true}});
    process.env.QR_TOKEN_ENCRYPTION_KEY=previousKey;
    expect(h.qrCreate).toHaveBeenCalledTimes(1);
    expect(h.accountUpdate).toHaveBeenCalledWith(expect.objectContaining({data:{emailVerifiedAt:expect.any(Date)}}));
    await expect(h.service.verifyEmail({token:raw})).rejects.toMatchObject({status:400});
  });

  it('rejects expired verification tokens',async()=>{
    const h=authHarness();const raw='expired-email-token-123456789';
    h.setToken({id:'token-id',accountId:'account-id',purpose:'VERIFY_EMAIL',tokenHash:digest(raw),expiresAt:new Date(Date.now()-1),usedAt:null,createdAt:new Date()});
    await expect(h.service.verifyEmail({token:raw})).rejects.toMatchObject({status:400});
    expect(h.accountUpdate).not.toHaveBeenCalled();
  });

  it('returns the same forgot-password message for present and missing addresses',async()=>{
    const h=authHarness();const lookup=h.db.clientAccount.findUnique as ReturnType<typeof vi.fn>;
    lookup.mockResolvedValueOnce(null).mockResolvedValueOnce({id:'account-id',email:'known@example.test'});
    const absent=await h.service.forgotPassword({email:'missing@example.test'});const present=await h.service.forgotPassword({email:'known@example.test'});
    expect(absent).toEqual(present);expect(h.mail.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
  });

  it('keeps the generic recovery response when the per-address rate limit is active',async()=>{
    const h=authHarness();
    (h.db.loginAttempt.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({key:'hashed',failures:5,windowStart:new Date(),blockedUntil:new Date(Date.now()+60_000)});
    await expect(h.service.forgotPassword({email:'missing@example.test'})).resolves.toMatchObject({data:{message:'Si un compte correspond à cette adresse, un lien de récupération a été envoyé.'}});
    expect(h.db.clientAccount.findUnique).not.toHaveBeenCalled();
  });

  it('reset invalidates the token and every existing client session',async()=>{
    const h=authHarness();const raw='random-reset-token-123456789';const row={id:'token-id',accountId:'account-id',purpose:'RESET_PASSWORD',tokenHash:digest(raw),expiresAt:new Date(Date.now()+60_000),usedAt:null,createdAt:new Date()};
    h.setToken(row);
    await expect(h.service.resetPassword({token:raw,password:'NewLongPassword123!',confirmPassword:'NewLongPassword123!'})).resolves.toMatchObject({success:true});
    await expect(h.service.resetPassword({token:raw,password:'AnotherLongPassword123!',confirmPassword:'AnotherLongPassword123!'})).rejects.toMatchObject({status:400});
    expect(h.sessionDelete).toHaveBeenCalledWith({where:{accountId:'account-id'}});
    expect(h.accountUpdate).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({passwordHash:expect.any(String)})}));
    expect(h.accountUpdate.mock.calls[0][0].data.passwordHash).not.toBe('NewLongPassword123!');
  });

  it('rejects expired reset tokens',async()=>{
    const h=authHarness();const raw='expired-reset-token-123456789';
    h.setToken({id:'token-id',accountId:'account-id',purpose:'RESET_PASSWORD',tokenHash:digest(raw),expiresAt:new Date(Date.now()-1),usedAt:null,createdAt:new Date()});
    await expect(h.service.resetPassword({token:raw,password:'NewLongPassword123!',confirmPassword:'NewLongPassword123!'})).rejects.toMatchObject({status:400});
    expect(h.sessionDelete).not.toHaveBeenCalled();
  });
});
