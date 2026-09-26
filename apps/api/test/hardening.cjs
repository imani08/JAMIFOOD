const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {mkdtemp,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
require('reflect-metadata');
test('HTTP images, products, refund, partial receipts, supplier payment and production',async()=>{
  const url=new URL(process.env.DATABASE_URL);
  assert.match(url.pathname,/^\/jami_test(?:_|$)/,'Only an isolated jami_test database is allowed');
  const {NestFactory}=require('@nestjs/core');
  const {AppModule}=require('../dist/app.module');
  const {PrismaService}=require('../dist/prisma.service');
  const sharp=require('sharp');
  const dir=await mkdtemp(join(tmpdir(),'jami-http-images-'));process.env.PRODUCT_IMAGE_DIR=dir;
  process.env.WEB_ORIGIN='http://localhost:3000';
  const app=await NestFactory.create(AppModule,{logger:false});app.setGlobalPrefix('api/v1');
  await app.listen(0,'127.0.0.1');const base=(await app.getUrl())+'/api/v1';const db=app.get(PrismaService);
  let cookie;
  async function request(path,body,key=randomUUID()){
    const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{cookie:cookie??'',origin:'http://localhost:3000','x-jami-request':'1','idempotency-key':key,...(body instanceof FormData?{}:{'content-type':'application/json'})},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});
    return {response,result:await response.json()};
  }
  async function ok(path,body,key){const {response,result}=await request(path,body,key);assert.ok(response.ok&&result.success,JSON.stringify({path,status:response.status,result}));return result.data;}
  try {
    const login=await request('/auth/login',{username:'direction.demo',password:process.env.DEMO_PASSWORD});assert.equal(login.response.status,201);cookie=login.response.headers.get('set-cookie').split(';')[0];
    const invalid=new FormData();invalid.append('image',new Blob(['fake'],{type:'image/png'}),'fake.png');assert.equal((await request('/commercial/product-images',invalid)).response.status,400);
    const png=await sharp({create:{width:4,height:4,channels:3,background:'red'}}).png().toBuffer();
    const upload=new FormData();upload.append('image',new Blob([png],{type:'image/png'}),'valid.png');
    const image=await ok('/commercial/product-images',upload);
    const category=await ok('/commercial/product-categories',{code:'T'+randomUUID().slice(0,8),label:'Recette isolée'});
    const product=await ok('/commercial/products',{name:'Produit recette',categoryId:category.id,saleUnit:'portion',imageUrl:image.url});
    const listed=await ok('/commercial/products?q=Produit%20recette');assert.ok(listed.some(p=>p.id===product.id&&p.imageUrl===image.url));
    await ok('/commercial/products/'+product.id,{name:'Produit recette modifié'});
    const fetched=await fetch(base.replace('/api/v1','')+image.url,{headers:{cookie}});assert.equal(fetched.status,200);assert.match(fetched.headers.get('content-type'),/image\/webp/);
    const absent=await fetch(base+'/product-images/'+randomUUID()+'.webp',{headers:{cookie}});assert.equal(absent.status,404);
    await ok('/commercial/products/'+product.id+'/prices',{categoryCode:'ETUDIANT_EXTERNE',amount:'8',currency:'USD',effectiveFrom:new Date().toISOString()});
    // Test-only calendar approval, never applied to the restaurant database.
    await db.setting.update({where:{key:'calendrier'},data:{validated:true}});
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Kinshasa'}).format(new Date());
    const version=await ok('/menus',{businessDate:today,serviceCode:'LUNCH'});
    await ok('/menus/versions/'+version.id+'/items',{productId:product.id,quantityAvailable:10});
    await ok('/menus/versions/'+version.id+'/publish',{});
    const registers=await ok('/cash/registers');let session=await ok('/cash');
    if(!session)session=await ok('/cash/open',{cashRegisterId:registers[0].id,openingUsd:'1000',openingCdf:'10000'});
    const order=await ok('/orders',{menuVersionId:version.id,categoryCode:'ETUDIANT_EXTERNE',serviceMode:'DINE_IN',currency:'USD',items:[{productId:product.id,quantity:1}]});
    assert.equal(order.menuVersionId,version.id);
    await ok('/commercial/products/'+product.id+'/prices',{categoryCode:'ETUDIANT_EXTERNE',amount:'9',currency:'USD',effectiveFrom:new Date().toISOString()});
    assert.equal((await db.order.findUniqueOrThrow({where:{id:order.id}})).totalAmount.toString(),'8');
    const payment=await ok('/orders/'+order.id+'/payments',{cashSessionId:session.id,method:'CASH',receivedAmount:'10',receivedCurrency:'USD'});
    assert.equal(payment.changeAmount,'2');
    const receiptsBeforeRefund=(await ok('/reports')).payments;
    const refunded=await ok('/orders/payments/'+payment.id+'/refund',{cashSessionId:session.id,amount:'8',reason:'Recette remboursement net'});
    assert.equal(refunded.remainingRefundable,'0');assert.equal((await db.payment.findUniqueOrThrow({where:{id:payment.id}})).status,'REFUNDED');
    const receiptsAfterRefund=(await ok('/reports')).payments;
    const sortedReceipts=rows=>rows.map(row=>JSON.stringify(row)).sort();
    assert.deepEqual(sortedReceipts(receiptsAfterRefund),sortedReceipts(receiptsBeforeRefund),'Refund preserves the original receipts and change currencies');
    const stock=await ok('/stock',{code:'T'+randomUUID().slice(0,8),name:'Stock recette',unit:'kg',alertThreshold:'1'});
    await ok('/stock/'+stock.id+'/movements',{quantity:'10',type:'INITIAL',reason:'Stock historique sans lot'});
    const supplier=await ok('/stock/suppliers',{name:'Fournisseur recette'});
    const purchase=await ok('/stock/purchases',{supplierId:supplier.id,amount:'500',currency:'USD',lines:[{stockItemId:stock.id,orderedQuantity:'100'}]});
    const receipt=(quantity)=>({purchaseId:purchase.id,reference:randomUUID(),lines:[{stockItemId:stock.id,quantity,unit:'kg',batchNumber:'LOT-TEST'}]});
    const first=await ok('/stock/receipts',receipt('40'));assert.equal(first.purchase.lines[0].remainingQuantity,'60');
    await ok('/stock/receipts',receipt('60'));
    assert.equal((await request('/stock/receipts',receipt('1'))).response.status,409);
    assert.equal((await db.stockItem.findUniqueOrThrow({where:{id:stock.id}})).quantity.toString(),'110');
    const movements=await db.stockMovement.count({where:{stockItemId:stock.id}});
    await ok('/stock/purchases/'+purchase.id+'/payments',{cashSessionId:session.id,amount:'200'});
    const paid=await db.purchase.findUniqueOrThrow({where:{id:purchase.id}});assert.equal(paid.amount.sub(paid.paidAmount).toString(),'300');assert.equal(await db.stockMovement.count({where:{stockItemId:stock.id}}),movements);
    const recipe=await ok('/stock/recipes',{name:'Recette test',yieldQuantity:'1',ingredients:[{stockItemId:stock.id,quantity:'1'}]});const recipeVersion=recipe.versions[0];
    const production={recipeVersionId:recipeVersion.id,quantity:'105'};
    assert.equal((await request('/stock/productions',production)).response.status,409);
    await ok('/stock/recipes/'+recipeVersion.id+'/validate',{});const key=randomUUID();await ok('/stock/productions',production,key);await ok('/stock/productions',production,key);
    assert.equal((await db.stockItem.findUniqueOrThrow({where:{id:stock.id}})).quantity.toString(),'5');
    assert.equal((await db.stockLot.findFirstOrThrow({where:{stockItemId:stock.id}})).quantity.toString(),'0');
    await ok('/commercial/products/'+product.id,{stockMode:'DIRECT',stockItemId:stock.id,stockQuantity:'1'});
    const resale=await ok('/orders',{categoryCode:'ETUDIANT_EXTERNE',serviceMode:'DINE_IN',currency:'USD',items:[{productId:product.id,quantity:1}]});
    const payKey=randomUUID(),tender={cashSessionId:session.id,method:'CASH',receivedAmount:resale.totalAmount,receivedCurrency:'USD'};
    await ok('/orders/'+resale.id+'/payments',tender,payKey);await ok('/orders/'+resale.id+'/payments',tender,payKey);
    assert.equal((await db.stockItem.findUniqueOrThrow({where:{id:stock.id}})).quantity.toString(),'4');
    const exportResponse=await fetch(base+'/reports/export',{headers:{cookie}});assert.equal(exportResponse.status,200);
    const ExcelJS=require('exceljs'),book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.from(await exportResponse.arrayBuffer()));assert.ok(book.getWorksheet('Ventes'));
    const directionCookie=cookie;
    for(const [username,allowed,forbidden] of [['caissier.demo','/cash','/reports'],['cuisine.demo','/kitchen','/orders'],['stock.demo','/stock','/reports'],['livreur.demo','/delivery','/reports'],['admintech.demo','/users','/reports'],['responsable.demo','/reports','/users']]) {
      const auth=await request('/auth/login',{username,password:process.env.DEMO_PASSWORD});cookie=auth.response.headers.get('set-cookie').split(';')[0];
      assert.equal((await request(allowed)).response.status,200,username+' allowed');assert.equal((await request(forbidden)).response.status,403,username+' forbidden');
      if(username!=='responsable.demo')assert.equal((await request('/orders/'+order.id+'/cancel',{reason:'Accès interdit test'})).response.status,403);
      if(['cuisine.demo','stock.demo','livreur.demo','admintech.demo'].includes(username))assert.equal((await request('/subscriptions/'+randomUUID())).response.status,403);
    }
    cookie=undefined;assert.equal((await request('/orders')).response.status,401);cookie=directionCookie;
    const csrf=await fetch(base+'/commercial/products',{method:'POST',headers:{cookie,origin:'https://untrusted.invalid','content-type':'application/json'},body:'{}'});assert.equal(csrf.status,403);
  } finally {await app.close();await rm(dir,{recursive:true,force:true});}
});
