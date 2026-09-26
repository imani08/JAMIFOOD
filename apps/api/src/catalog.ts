import { Body, Controller, Get, Headers, Param, Post, Query, Req } from '@nestjs/common';
import { currency, money, pageSchema, uuid } from '@jami/validation';
import { z } from 'zod';
import { PrismaService } from './prisma.service';
import { AuthRequest, Require } from './auth';
import { audit, mutate } from './transaction';
import { DomainError } from './http';
import { localDate } from '@jami/shared';
@Controller()
export class CatalogController {
  constructor(private readonly db: PrismaService) {}
  @Require('sales.create') @Get('products') async products(@Query('category') category = 'ETUDIANT_EXTERNE') { return { success: true, data: await this.db.product.findMany({ where: { active: true }, take: 100, include: { category: true, prices: { where: { categoryCode: category }, include: { versions: { where: { status: 'ACTIVE', effectiveFrom: { lte: new Date() }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }] }, orderBy: { effectiveFrom: 'desc' }, take: 1 } } } } }) }; }
  @Require('pricing.read') @Get('exchange-rates') async rates() { return { success: true, data: await this.db.exchangeRate.findMany({ take: 30, orderBy: { effectiveFrom: 'desc' } }) }; }
  @Require('pricing.update') @Post('exchange-rates') rate(@Body() input: unknown, @Headers('idempotency-key') key: string | undefined, @Req() req: AuthRequest) {
    const body = z.object({ rate: z.string().regex(/^\d{1,8}(\.\d{1,8})?$/).refine(x=>Number(x)>0), source: z.string().min(3).max(200), effectiveFrom: z.string().datetime() }).strict().parse(input);
    return mutate(this.db,'rate.create',key,req.actor.id,body,async tx=>{ if (new Date(body.effectiveFrom).getTime()<Date.now()-60000) throw new DomainError('RETROACTIVE_RATE','Un taux ne peut pas prendre effet rétroactivement.'); const rate=await tx.exchangeRate.create({data:{...body,baseCurrency:'USD',quoteCurrency:'CDF',status:'ACTIVE',createdById:req.actor.id}});await audit(tx,req.actor.id,'RATE_CREATED','ExchangeRate',rate.id,{rate:body.rate,source:body.source});return rate; }).then(data=>({success:true,data}));
  }
  @Require('pricing.update') @Post('pricing/:id') price(@Param('id') id:string,@Body() input:unknown,@Headers('idempotency-key') key:string|undefined,@Req() req:AuthRequest) {
    uuid.parse(id);const body=z.object({amount:money,currency}).strict().parse(input);
    return mutate(this.db,'price.create',key,req.actor.id,{id,...body},async tx=>{await tx.$queryRaw`SELECT id FROM "ProductPrice" WHERE id = ${id}::uuid FOR UPDATE`;const last=await tx.priceVersion.findFirst({where:{productPriceId:id},orderBy:{version:'desc'}});const now=new Date();await tx.priceVersion.updateMany({where:{productPriceId:id,status:'ACTIVE'},data:{status:'RETIRED',effectiveTo:now}});const v=await tx.priceVersion.create({data:{productPriceId:id,version:(last?.version??0)+1,...body,effectiveFrom:now,status:'ACTIVE'}});await audit(tx,req.actor.id,'PRICE_CHANGED','PriceVersion',v.id,{old:last?.amount.toString()??null,new:body.amount});return v;}).then(data=>({success:true,data}));
  }
  @Require('pricing.read') @Get('settings') async settings() { return {success:true,data:await this.db.setting.findMany({orderBy:{key:'asc'}})}; }
  @Require('audit.read') @Get('audit') async logs(@Query() query:unknown) {const {page,limit}=pageSchema.parse(query);return {success:true,data:await this.db.auditLog.findMany({take:limit,skip:(page-1)*limit,orderBy:{createdAt:'desc'},select:{id:true,action:true,entityType:true,entityId:true,actorId:true,createdAt:true,requestId:true}}),meta:{page,limit,total:await this.db.auditLog.count()}};}
  
  @Require('reports.read') @Get('reports') async reports() {
    const today=new Date(localDate());
    const [sales,payments,served,subscriptions,expenses]=await Promise.all([
      this.db.order.groupBy({by:['currency'],where:{businessDate:today,paymentRequired:true,status:{notIn:['RECEIVED','CANCELLED']}},_sum:{totalAmount:true},_count:true}),
      this.db.payment.groupBy({by:['receivedCurrency','method'],where:{status:'CONFIRMED',confirmedAt:{gte:new Date(localDate()+'T00:00:00+01:00')}},_sum:{receivedAmount:true,changeAmount:true},_count:true}),
      this.db.order.count({where:{businessDate:today,status:{in:['SERVED','DELIVERED']}}}),
      this.db.subscription.count({where:{status:{in:['ACTIVE','SCHEDULED']},startsOn:{lte:today},endsOn:{gte:today},balance:0}}),
      this.db.expense.groupBy({by:['currency'],where:{occurredAt:{gte:new Date(localDate()+'T00:00:00+01:00')}},_sum:{amount:true}})
    ]);
    return {success:true,data:{date:localDate(),sales,payments,served,subscriptions,expenses,pendingPayments:await this.db.payment.count({where:{status:'PENDING'}})}};
  }
}
