import { PrismaClient } from '@prisma/client';
import { randomBytes, scryptSync } from 'node:crypto';
import { rolePermissions } from './role-permissions';
const db = new PrismaClient();
async function main() {
  if (process.env.NODE_ENV === 'production' || process.env.SEED_DEMO !== 'true' || !process.env.DEMO_PASSWORD || process.env.DEMO_PASSWORD.length < 12) throw new Error('Seed réservé à DEMO avec mot de passe externe de 12 caractères minimum.');
  const permissionLabels: Record<string,string> = {
    'auth.session':'Accès à la session', 'auth.password-change':'Changer son mot de passe',
    'users.read':'Consulter les utilisateurs', 'users.create':'Créer des utilisateurs', 'users.update':'Modifier les utilisateurs', 'users.disable':'Activer ou désactiver les utilisateurs',
    'clients.read':'Consulter les abonnés', 'clients.create':'Créer des abonnés', 'clients.update':'Modifier les abonnés', 'clients.archive':'Archiver les abonnés',
    'subscriptions.read':'Consulter les abonnements', 'subscriptions.create':'Créer et renouveler les abonnements', 'subscriptions.suspend':'Suspendre les abonnements', 'subscriptions.cancel':'Annuler les abonnements',
    'pricing.read':'Consulter les prix', 'pricing.update':'Modifier les prix', 'cash.open':'Gérer les ouvertures de caisse', 'cash.close':'Clôturer les caisses', 'cash.read':'Consulter les caisses',
    'cash.expense':'Enregistrer les dépenses', 'cash.validate':'Valider les clôtures', 'cash.refund':'Rembourser les paiements', 'cash.adjust':'Ajuster la caisse',
    'sales.create':'Enregistrer les ventes', 'sales.read':'Consulter les ventes', 'orders.create':'Créer des commandes', 'orders.read':'Consulter les commandes', 'orders.manage':'Gérer les commandes', 'orders.cancel':'Annuler les commandes',
    'meal.correct':'Corriger les droits repas', 'meal.exception':'Autoriser une exception de droit', 'payments.confirm':'Confirmer les paiements', 'reports.read':'Consulter les rapports', 'reports.export':'Exporter les rapports', 'audit.read':'Consulter le journal d’audit',
    'stock.read':'Consulter le stock', 'stock.adjust':'Modifier le stock', 'stock.inventory':'Réaliser les inventaires', 'menus.read':'Consulter les menus', 'menus.write':'Modifier les menus', 'menus.manage':'Gérer les menus', 'menus.publish':'Publier les menus',
  };
  for (const code of new Set(Object.values(rolePermissions).flat())) {
    await db.permission.upsert({ where: { code }, update: {}, create: { code, label: permissionLabels[code] ?? code } });
  }
  for (const [code,permissions] of Object.entries(rolePermissions)) {
    const role=await db.role.upsert({where:{code},update:{},create:{code,label:code}});
    if(code==='CAISSIER'||code==='RESPONSABLE_RESTAURANT'){const forbidden=await db.permission.findMany({where:{code:{notIn:permissions}},select:{id:true}});await db.rolePermission.deleteMany({where:{roleId:role.id,permissionId:{in:forbidden.map(permission=>permission.id)}}});}
    for (const permissionCode of permissions) {const permission=await db.permission.findUniqueOrThrow({where:{code:permissionCode}});await db.rolePermission.upsert({where:{roleId_permissionId:{roleId:role.id,permissionId:permission.id}},update:{},create:{roleId:role.id,permissionId:permission.id}});}
  }
  const salt=randomBytes(16).toString('hex'); const passwordHash='scrypt$'+salt+'$'+scryptSync(process.env.DEMO_PASSWORD,salt,64).toString('hex');
const demoUsers = [
  ['responsable.demo', 'RESPONSABLE_RESTAURANT'],
  ['gestionnaire.demo', 'GESTIONNAIRE'],
  ['caissier.demo', 'CAISSIER'],
  ['admintech.demo', 'ADMIN_TECHNIQUE'],
] as const;

for (const [username, roleCode] of demoUsers) {
    const user=await db.user.upsert({where:{username},update:{},create:{username,firstName:roleCode,lastName:'DEMO',passwordHash}});
    const role=await db.role.findUniqueOrThrow({where:{code:roleCode}});await db.userRole.upsert({where:{userId_roleId:{userId:user.id,roleId:role.id}},update:{},create:{userId:user.id,roleId:role.id}});
  }
  const admin=await db.user.findFirstOrThrow({where:{roles:{some:{role:{code:'RESPONSABLE_RESTAURANT'}}}}});
  for(const [code,label] of [['ETUDIANT_HOME','Étudiant résident Home'],['ETUDIANT_EXTERNE','Étudiant externe'],['PERSONNEL_ULC','Personnel ULC']]) await db.clientCategory.upsert({where:{code},update:{},create:{code,label}});
  await db.setting.upsert({where:{key:'pos_anonymous_category'},update:{},create:{key:'pos_anonymous_category',value:{categoryCode:'ETUDIANT_EXTERNE'},validated:false}});
  for(const [code,name,price,services,serviceQuotas] of [['PREMIUM','Premium intégral','140',['BREAKFAST','LUNCH','DINNER'],{BREAKFAST:1,LUNCH:1,DINNER:1}],['COMBINEE','Combinée','110',['LUNCH','DINNER'],{LUNCH:1,DINNER:1}],['REPAS','Repas','60',['MAIN'],{MAIN:1}],['BREAKFAST','Petit-déjeuner','40',['BREAKFAST'],{BREAKFAST:1}]] as const) {
    const plan=await db.subscriptionPlan.upsert({where:{code},update:{},create:{code,name}});
    await db.subscriptionPlanVersion.upsert({where:{planId_version:{planId:plan.id,version:1}},update:{},create:{planId:plan.id,version:1,price,currency:'USD',services:[...services],eligibilityDays:[1,2,3,4,5,6],quotaRules:{pendingValidation:false,days:30,serviceQuotas,demo:false},effectiveFrom:new Date('2026-01-01'),status:'ACTIVE'}});
  }
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
  const obsoleteRoleCodes=['DIRECTION','CLIENT','CUISINE','LIVREUR'];
  await db.rolePermission.deleteMany({where:{role:{code:{in:obsoleteRoleCodes}}}});
  await db.userRole.deleteMany({where:{role:{code:{in:obsoleteRoleCodes}}}});
  await db.role.deleteMany({where:{code:{in:obsoleteRoleCodes}}});
  await db.permission.deleteMany({where:{OR:[{code:{startsWith:'kitchen.'}},{code:{startsWith:'delivery.'}},{code:'meal.validate'},{code:'clients.verify'}]}});

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
    ['acompte',{enabled:false}],
    ['report',{enabled:false}],
    ['flex',{enabled:false}],
    ['tpe',{mode:'MANUAL',provider:null,realTerminalConnected:false}],
  ]) await db.setting.upsert({where:{key:key as string},update:key==='calendrier'?{validated:true,validatedById:admin.id,validatedAt:new Date()}:{},create:{key:key as string,value,...(key==='calendrier'?{validated:true,validatedById:admin.id,validatedAt:new Date()}:{})}});
  for(const [code,name,unit] of [['RIZ','Riz','kg'],['HUILE','Huile','litre'],['EAU','Bouteille d’eau','pièce']]) await db.stockItem.upsert({where:{code},update:{},create:{code,name,unit,alertThreshold:'5'}});
}
main().finally(()=>db.$disconnect());
