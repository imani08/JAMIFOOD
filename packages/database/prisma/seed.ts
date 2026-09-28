import { PrismaClient } from '@prisma/client';
import { randomBytes, scryptSync } from 'node:crypto';
const db = new PrismaClient();
async function main() {
  if (process.env.NODE_ENV === 'production' || process.env.SEED_DEMO !== 'true' || !process.env.DEMO_PASSWORD || process.env.DEMO_PASSWORD.length < 12) throw new Error('Seed réservé à DEMO avec mot de passe externe de 12 caractères minimum.');
  const rolePermissions: Record<string,string[]> = {
    DIRECTION: ['users.read','users.create','users.update','users.disable','clients.read','clients.create','clients.update','clients.archive','clients.merge','subscriptions.read','subscriptions.create','subscriptions.suspend','subscriptions.cancel','pricing.read','pricing.update','cash.open','cash.close','cash.read','cash.expense','cash.validate','cash.refund','cash.adjust','sales.create','sales.read','orders.create','orders.read','orders.cancel','meal.validate','meal.correct','meal.exception','kitchen.read','kitchen.prepare','kitchen.ready','kitchen.serve','delivery.read','delivery.confirm','payments.confirm','reports.read','reports.export','audit.read','stock.read','stock.adjust','stock.inventory','menus.read',
'menus.manage',
'menus.publish','clients.verify',],
    RESPONSABLE_RESTAURANT: ['clients.read','clients.create','clients.update','subscriptions.read','subscriptions.create','pricing.read','pricing.update','cash.open','cash.close','cash.read','cash.expense','cash.validate','sales.create','sales.read','orders.create','orders.read','meal.validate','kitchen.read','kitchen.prepare','kitchen.ready','kitchen.serve','delivery.read','delivery.confirm','delivery.assign','payments.confirm','reports.read','reports.export','audit.read','stock.read','stock.adjust','stock.inventory','menus.read',
'menus.manage',
'menus.publish','clients.verify',],
    CAISSIER: ['clients.read','clients.create','subscriptions.read','subscriptions.create','cash.open','cash.close','cash.read','sales.create','sales.read','orders.create','orders.read','meal.validate','pricing.read'],
    CUISINE: ['kitchen.read','kitchen.prepare','kitchen.ready','kitchen.serve','menus.read'],
    GESTIONNAIRE_STOCK: [
  'stock.read',
  'stock.adjust',
  'stock.inventory'
], LIVREUR: ['delivery.read','delivery.confirm'], ADMIN_TECHNIQUE: ['users.read','users.create','users.update','users.disable'], CLIENT: []
  };// En environnement de développement, la Direction possède
// toutes les permissions connues de l'application.
rolePermissions.DIRECTION = [
  ...new Set(
    Object.values(rolePermissions).flat(),
  ),
];
  for (const [role, permissions] of Object.entries(rolePermissions)) {
    if (role !== 'CLIENT') permissions.push('auth.session', 'auth.password-change');
  }
  for (const code of [...new Set(Object.values(rolePermissions).flat())]) await db.permission.upsert({where:{code},update:{},create:{code,label:code}});
  for (const [code,permissions] of Object.entries(rolePermissions)) {
    const role=await db.role.upsert({where:{code},update:{},create:{code,label:code}});
    for (const permissionCode of permissions) {const permission=await db.permission.findUniqueOrThrow({where:{code:permissionCode}});await db.rolePermission.upsert({where:{roleId_permissionId:{roleId:role.id,permissionId:permission.id}},update:{},create:{roleId:role.id,permissionId:permission.id}});}
  }
  const salt=randomBytes(16).toString('hex'); const passwordHash='scrypt$'+salt+'$'+scryptSync(process.env.DEMO_PASSWORD,salt,64).toString('hex');
const demoUsers = [
  ['direction.demo', 'DIRECTION'],
  ['responsable.demo', 'RESPONSABLE_RESTAURANT'],
  ['caissier.demo', 'CAISSIER'],
  ['cuisine.demo', 'CUISINE'],
  ['stock.demo', 'GESTIONNAIRE_STOCK'],
  ['livreur.demo', 'LIVREUR'],
  ['admintech.demo', 'ADMIN_TECHNIQUE'],
] as const;

for (const [username, roleCode] of demoUsers) {
    const user=await db.user.upsert({where:{username},update:{},create:{username,firstName:roleCode,lastName:'DEMO',passwordHash}});
    const role=await db.role.findUniqueOrThrow({where:{code:roleCode}});await db.userRole.upsert({where:{userId_roleId:{userId:user.id,roleId:role.id}},update:{},create:{userId:user.id,roleId:role.id}});
  }
  const admin=await db.user.findUniqueOrThrow({where:{username:'direction.demo'}});
  for(const [code,label] of [['ETUDIANT_HOME','Étudiant résident Home'],['ETUDIANT_EXTERNE','Étudiant externe'],['PERSONNEL_ULC','Personnel ULC']]) await db.clientCategory.upsert({where:{code},update:{},create:{code,label}});
  for(const [code,name,price,services,serviceQuotas,deliveryIncluded] of [['PREMIUM','Premium intégral','140',['BREAKFAST','LUNCH','DINNER'],{BREAKFAST:1,LUNCH:1,DINNER:1},true],['COMBINEE','Combinée','110',['LUNCH','DINNER'],{LUNCH:1,DINNER:1},false],['REPAS','Repas','60',['MAIN'],{MAIN:1},false],['BREAKFAST','Petit-déjeuner','40',['BREAKFAST'],{BREAKFAST:1},false]] as const) {
    const plan=await db.subscriptionPlan.upsert({where:{code},update:{},create:{code,name}});
    await db.subscriptionPlanVersion.upsert({where:{planId_version:{planId:plan.id,version:1}},update:{},create:{planId:plan.id,version:1,price,currency:'USD',services:[...services],eligibilityDays:[1,2,3,4,5,6],quotaRules:{pendingValidation:false,days:30,serviceQuotas,demo:false},deliveryIncluded,effectiveFrom:new Date('2026-01-01'),status:'ACTIVE'}});
  }
  const category=await db.productCategory.upsert({where:{code:'DEMO'},update:{},create:{code:'DEMO',label:'Menu DEMO'}});
    const productCategories = [
    ['REPAS', 'Repas complets'],
    ['PETIT_DEJEUNER', 'Petits-déjeuners'],
    ['SANDWICH', 'Sandwichs'],
    ['SHAWARMA', 'Shawarmas'],
    ['BOISSON', 'Boissons'],
    ['SUPPLEMENT', 'Suppléments'],
  ] as const;

  for (const [code, label] of productCategories) {
    await db.productCategory.upsert({
      where: { code },
      update: {
        label,
        active: true,
      },
      create: {
        code,
        label,
        active: true,
      },
    });
  }

  const mealCategory =
    await db.productCategory.findUniqueOrThrow({
      where: { code: 'REPAS' },
    });

  const drinkCategory =
    await db.productCategory.findUniqueOrThrow({
      where: { code: 'BOISSON' },
    });

  const demoProducts = [
    {
      sku: 'DEMO-REPAS',
      name: 'Repas étudiant complet',
      categoryId: mealCategory.id,
      price: '8000',
      saleUnit: 'portion',
      description:
        'Repas complet de démonstration.',
      baseComposition:
        'Plat principal selon le menu du service.',
    },
    {
      sku: 'DEMO-JUS',
      name: 'Jus du jour · DEMO',
      categoryId: drinkCategory.id,
      price: '1700',
      saleUnit: 'bouteille',
      description:
        'Boisson de démonstration.',
      baseComposition: '',
    },
  ] as const;

  const approvedSupplements = [
    ['JAMI-SUP-FOUFOU','Portion de foufou','1000'],
    ['JAMI-SUP-CHIKWANGUE','Portion de chikwangue','1000'],
    ['JAMI-SUP-RIZ','Portion de riz','1500'],
    ['JAMI-SUP-BANANES','Portion de bananes frites','2000'],
  ] as const;

  const approvedMeal=await db.product.upsert({where:{sku:'JAMI-REPAS-COMPLET'},update:{name:'Repas complet étudiant',description:'Repas étudiant acheté à l’unité.',baseComposition:'Accompagnement · Légumes · Portion de viande ou poisson · Fruit du jour',saleUnit:'repas',categoryId:mealCategory.id},create:{sku:'JAMI-REPAS-COMPLET',name:'Repas complet étudiant',description:'Repas étudiant acheté à l’unité.',baseComposition:'Accompagnement · Légumes · Portion de viande ou poisson · Fruit du jour',saleUnit:'repas',categoryId:mealCategory.id,active:true,available:true}});
  for(const categoryCode of ['ETUDIANT_HOME','ETUDIANT_EXTERNE']) { const pp=await db.productPrice.upsert({where:{productId_categoryCode:{productId:approvedMeal.id,categoryCode}},update:{},create:{productId:approvedMeal.id,categoryCode}});if(!(await db.priceVersion.findFirst({where:{productPriceId:pp.id,status:'ACTIVE'}})))await db.priceVersion.create({data:{productPriceId:pp.id,version:((await db.priceVersion.aggregate({where:{productPriceId:pp.id},_max:{version:true}}))._max.version??0)+1,amount:'8000',currency:'CDF',effectiveFrom:new Date(),status:'ACTIVE',createdById:admin.id}}); }

  for (const [sku,name,price] of approvedSupplements) {
    const product=await db.product.upsert({where:{sku},update:{name,categoryId:(await db.productCategory.findUniqueOrThrow({where:{code:'SUPPLEMENT'}})).id,saleUnit:'portion',description:null,baseComposition:null,active:true,available:true},create:{sku,name,categoryId:(await db.productCategory.findUniqueOrThrow({where:{code:'SUPPLEMENT'}})).id,saleUnit:'portion',active:true,available:true}});
    const pp=await db.productPrice.upsert({where:{productId_categoryCode:{productId:product.id,categoryCode:'ETUDIANT_EXTERNE'}},update:{},create:{productId:product.id,categoryCode:'ETUDIANT_EXTERNE'}});
    if(!(await db.priceVersion.findFirst({where:{productPriceId:pp.id,status:'ACTIVE'}}))) await db.priceVersion.create({data:{productPriceId:pp.id,version:((await db.priceVersion.aggregate({where:{productPriceId:pp.id},_max:{version:true}}))._max.version??0)+1,amount:price,currency:'CDF',effectiveFrom:new Date(),status:'ACTIVE',createdById:admin.id}});
  }

  for (const item of demoProducts) {
    const product = await db.product.upsert({
      where: {
        sku: item.sku,
      },
      update: {
        name: item.name,
        categoryId: item.categoryId,
        saleUnit: item.saleUnit,
        description: item.description,
        baseComposition:
          item.baseComposition,
        active: true,
        available: true,
      },
      create: {
        sku: item.sku,
        name: item.name,
        categoryId: item.categoryId,
        saleUnit: item.saleUnit,
        description: item.description,
        baseComposition:
          item.baseComposition,
        active: true,
        available: true,
      },
    });

    for (const categoryCode of [
      'ETUDIANT_HOME',
      'ETUDIANT_EXTERNE',
      'PERSONNEL_ULC',
    ]) {
      const productPrice =
        await db.productPrice.upsert({
          where: {
            productId_categoryCode: {
              productId: product.id,
              categoryCode,
            },
          },
          update: {},
          create: {
            productId: product.id,
            categoryCode,
          },
        });

      const exists =
        await db.priceVersion.findFirst({
          where: {
            productPriceId:
              productPrice.id,
          },
        });

      if (!exists) {
        await db.priceVersion.create({
          data: {
            productPriceId:
              productPrice.id,
            version: 1,
            amount:
              item.sku === 'DEMO-REPAS' &&
              categoryCode ===
                'PERSONNEL_ULC'
                ? '10000'
                : item.price,
            currency: 'CDF',
            effectiveFrom: new Date(
              '2026-01-01',
            ),
            status: 'ACTIVE',
            createdById: admin.id,
          },
        });
      }
    }
  }
  await db.exchangeRate.upsert({where:{baseCurrency_quoteCurrency_effectiveFrom:{baseCurrency:'USD',quoteCurrency:'CDF',effectiveFrom:new Date('2026-01-01')}},update:{},create:{baseCurrency:'USD',quoteCurrency:'CDF',rate:'2500',effectiveFrom:new Date('2026-01-01'),source:'DEMO — taux fictif de recette R07',status:'ACTIVE',createdById:admin.id}});
  await db.cashRegister.upsert({where:{code:'DEMO-TPE-01'},update:{},create:{code:'DEMO-TPE-01',label:'Terminal de caisse DEMO'}});
  for(const [code,label] of [['DENREES','Denrées'],['GAZ','Gaz'],['TRANSPORT','Transport'],['PERSONNEL','Personnel'],['ENTRETIEN','Entretien'],['EMBALLAGES','Emballages'],['EAU','Eau'],['ELECTRICITE','Électricité']]) await db.expenseCategory.upsert({where:{code},update:{},create:{code,label}});
  for(const [key,value] of [
    ['calendrier',{weekdays:[1,2,3,4,5],publicHolidays:'CD_LEGAL',closures:[]}],
    ['livraison',{enabled:false,zones:[]}],
    ['acompte',{enabled:false}],
    ['report',{enabled:false}],
    ['flex',{enabled:false}],
    ['tpe',{mode:'MANUAL',provider:null,realTerminalConnected:false}],
  ]) await db.setting.upsert({where:{key:key as string},update:{},create:{key:key as string,value}});
  for(const [code,name,unit] of [['RIZ','Riz','kg'],['HUILE','Huile','litre'],['EAU','Bouteille d’eau','pièce']]) await db.stockItem.upsert({where:{code},update:{},create:{code,name,unit,alertThreshold:'5'}});
}
main().finally(()=>db.$disconnect());

