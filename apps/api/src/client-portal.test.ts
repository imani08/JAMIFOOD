import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ClientPortalService, clientCreateOrderSchema, clientOrderReplay, resolveCampusDelivery } from './client-portal';

const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
describe('client order customization input',()=>{
  const menuVersionId='11111111-1111-4111-8111-111111111111';const context={serviceCode:'LUNCH' as const,businessDate:'2026-09-28'};const meal='22222222-2222-4222-8222-222222222222';const optionGroup='33333333-3333-4333-8333-333333333333';
  it('accepts duplicate products as separate customized lines and simple products without options',()=>{
    const parsed=clientCreateOrderSchema.parse({menuVersionId,...context,serviceMode:'TAKEAWAY',currency:'CDF',items:[{productId:meal,quantity:1,variant:'Riz'},{productId:meal,quantity:1,variant:'Frites',optionSelections:[{groupId:optionGroup,optionIds:[]}]}]});
    expect(parsed.items).toHaveLength(2);expect(parsed.items[0].variant).toBe('Riz');expect(parsed.items[1].variant).toBe('Frites');
    expect(clientCreateOrderSchema.parse({menuVersionId,...context,serviceMode:'TAKEAWAY',currency:'CDF',items:[{productId:meal,quantity:1}]}).items[0].optionSelections).toBeUndefined();
  });
  it('accepts the reported meal plus two-portion TAKEAWAY basket shape',()=>{
    const parsed=clientCreateOrderSchema.parse({menuVersionId,...context,serviceMode:'TAKEAWAY',currency:'CDF',items:[{productId:meal,quantity:1},{productId:'44444444-4444-4444-8444-444444444444',quantity:2}]});
    expect(parsed.items.map(item=>item.quantity)).toEqual([1,2]);
  });
  it('requires the selected published menu service and business date',()=>{
    const input={menuVersionId,...context,serviceMode:'TAKEAWAY',currency:'CDF',items:[{productId:meal,quantity:1}]};
    expect(clientCreateOrderSchema.safeParse(input).success).toBe(true);
    const {serviceCode:_serviceCode,...withoutService}=input;
    expect(clientCreateOrderSchema.safeParse(withoutService).success).toBe(false);
  });
  it('requires delivery details only when DELIVERY is explicitly selected',()=>{
    const items=[{productId:meal,quantity:1}];
    expect(clientCreateOrderSchema.safeParse({menuVersionId,...context,serviceMode:'DINE_IN',currency:'CDF',items}).success).toBe(true);
    expect(clientCreateOrderSchema.safeParse({menuVersionId,...context,serviceMode:'DELIVERY',currency:'CDF',items}).success).toBe(false);
    const details={recipientName:'Imani Charles',contactPhone:'+243800000000',dropoffPoint:'Point de remise sur le campus ULC'};
    expect(clientCreateOrderSchema.safeParse({menuVersionId,...context,serviceMode:'DELIVERY',currency:'CDF',items,delivery:details}).success).toBe(false);
    expect(clientCreateOrderSchema.safeParse({menuVersionId,...context,serviceMode:'DELIVERY',currency:'CDF',items,delivery:{...details,requestedDeliveryTime:'12:30'}}).success).toBe(true);
  });
});
describe('campus delivery configuration',()=>{
  it('requires the setting to be validated and enabled and always returns a free CDF point',()=>{
    expect(resolveCampusDelivery(null)).toMatchObject({available:false,reason:'DELIVERY_SETTING_MISSING'});
    expect(resolveCampusDelivery({validated:false,value:{enabled:true,zones:[{name:'Point de remise sur le campus ULC',fee:0,currency:'CDF'}]}})).toMatchObject({available:false,reason:'DELIVERY_SETTING_NOT_VALIDATED'});
    expect(resolveCampusDelivery({validated:true,value:{enabled:true,zones:[{name:'Point de remise sur le campus ULC',fee:500,currency:'USD'}]}})).toMatchObject({enabled:true,available:true,reason:null,fee:0,currency:'CDF',zones:[{name:'Point de remise sur le campus ULC',fee:0,currency:'CDF'}]});
    expect(resolveCampusDelivery({validated:true,value:{enabled:true,fee:{mode:'FREE',amount:0,currency:'CDF'},zones:[{name:'Campus ULC',fee:0,currency:'CDF',enabled:true}],dropoffPoints:['Point de remise sur le campus ULC'],schedule:{orderCutoffMinutes:null,useRestaurantServiceHours:true}}})).toMatchObject({available:true,serviceArea:'Campus ULC',zones:[{name:'Point de remise sur le campus ULC',fee:0,currency:'CDF'}],schedule:{orderCutoffMinutes:null,useRestaurantServiceHours:true}});
  });

  it('rejects configured points that are not explicitly on the ULC campus',()=>{
    expect(resolveCampusDelivery({validated:true,value:{enabled:true,zones:[{name:'Résidence Home 023',fee:0,currency:'CDF'}]}})).toMatchObject({available:false,reason:'DELIVERY_SETTING_INVALID',zones:[]});
  });
});
describe('client order idempotency replay',()=>{
  const previous={id:'order-1',clientId:'client-1',clientRequestHash:'hash-a',number:'WEB-2026-A',status:'RECEIVED',totalAmount:'9000',commercialTotal:'9000',coveredAmount:'0',mealRightId:null,currency:'CDF',createdAt:new Date('2026-09-28T10:00:00Z'),items:[{quantity:1,lineTotal:'9000',productSnapshot:{name:'Repas',supplement:false}}]};
  it('returns the saved order response for the same client and payload hash',()=>{
    const first=clientOrderReplay(previous,'client-1','hash-a');const retry=clientOrderReplay(previous,'client-1','hash-a');
    expect(retry).toEqual(first);expect(retry.number).toBe('WEB-2026-A');expect(retry.lines).toEqual([{name:'Repas',categoryCode:'OTHER',commercialAmount:9000,coveredAmount:0,coverageQuantity:0,quantity:1,amountDue:9000,supplement:false,meal:false,supplementAmount:0}]);
  });
  it('rejects a changed payload or another client using the same key',()=>{
    expect(()=>clientOrderReplay(previous,'client-1','hash-b')).toThrowError(expect.objectContaining({code:'IDEMPOTENCY_KEY_REUSED'}));
    expect(()=>clientOrderReplay(previous,'client-2','hash-a')).toThrowError(expect.objectContaining({code:'IDEMPOTENCY_KEY_REUSED'}));
  });
});
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
