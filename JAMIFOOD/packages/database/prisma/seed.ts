import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();
const permissions = ['users.read','users.create','users.update','users.disable','clients.read','clients.create','clients.update','clients.archive','clients.merge','subscriptions.read','subscriptions.create','subscriptions.update','subscriptions.suspend','subscriptions.cancel','pricing.read','pricing.update','cash.open','cash.close','cash.read','cash.expense','cash.refund','cash.adjust','sales.create','sales.read','sales.cancel','sales.refund','meal.validate','meal.correct','meal.exception','orders.create','orders.read','orders.update','orders.cancel','kitchen.read','kitchen.prepare','kitchen.ready','kitchen.serve','delivery.read','delivery.confirm','reports.read','reports.export','audit.read','stock.read','stock.adjust','stock.inventory'];
async function main() {
  if (process.env.NODE_ENV === 'production' || process.env.SEED_DEMO !== 'true') throw new Error('Le seed DEMO requiert SEED_DEMO=true et est interdit en production.');
  for (const code of permissions) await prisma.permission.upsert({ where:{code}, update:{}, create:{code,label:code} });
  const role = await prisma.role.upsert({ where:{code:'ADMIN_TECHNIQUE'}, update:{}, create:{code:'ADMIN_TECHNIQUE',label:'Administrateur technique'} });
  const all = await prisma.permission.findMany(); await prisma.rolePermission.createMany({ data:all.map(p=>({roleId:role.id,permissionId:p.id})), skipDuplicates:true });
  const hash = await argon2.hash('ChangeMe!2026', { type: argon2.argon2id });
  const admin = await prisma.user.upsert({ where:{username:'admin.demo'}, update:{}, create:{username:'admin.demo',firstName:'Admin',lastName:'DEMO',passwordHash:hash} });
  await prisma.userRole.upsert({ where:{userId_roleId:{userId:admin.id,roleId:role.id}}, update:{}, create:{userId:admin.id,roleId:role.id} });
  for (const [code,label] of [['ETUDIANT_HOME','Étudiant résident Home'],['ETUDIANT_EXTERNE','Étudiant externe'],['PERSONNEL_ULC','Personnel ULC'],['AUTRE','Autre catégorie autorisée']] as const) await prisma.clientCategory.upsert({where:{code},update:{},create:{code,label}});
  for (const [code,name,price] of [['PREMIUM_INTEGRAL','Premium intégral','140'],['COMBINEE','Combinée','110'],['REPAS','Repas','60'],['PETIT_DEJEUNER','Petit-déjeuner','40'],['FLEX','Flex','0']] as const) { const plan=await prisma.subscriptionPlan.upsert({where:{code},update:{},create:{code,name}}); await prisma.subscriptionPlanVersion.upsert({where:{planId_version:{planId:plan.id,version:1}},update:{},create:{planId:plan.id,version:1,price,currency:'USD',services:[],eligibilityDays:[],quotaRules:{pendingValidation:code==='FLEX'},deliveryIncluded:false,effectiveFrom:new Date(),status:'ACTIVE'}}); }
  console.log('Données DEMO créées. Compte: admin.demo / ChangeMe!2026');
}
main().finally(()=>prisma.$disconnect());
